// Package contratosgovbr captures public Contratos.gov.br contract data: the
// contract listings of a management unit (UG) and each contract's sub-resources.
package contratosgovbr

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"sync"
	"time"

	"contracts-ext/etl/internal/capture"
	"contracts-ext/etl/internal/pacing"
)

const (
	Source  = "CONTRATOS_GOV_BR"
	BaseURL = "https://contratos.comprasnet.gov.br"
	Host    = "contratos.comprasnet.gov.br"
)

// DefaultPolicy paces Contratos.gov.br requests: at most five per second
// across every process sharing the database.
var DefaultPolicy = pacing.Policy{Minimum: 200 * time.Millisecond, Maximum: 30 * time.Second, BlockPause: 5*time.Minute + time.Second}

// DefaultConcurrency is how many contracts of a UG are fetched at once. It is
// also the upper bound accepted from the command line.
const DefaultConcurrency = 5

// SubResource maps a stable resource name to its source path segment.
type SubResource struct {
	Resource, Segment string
}

// ContractResources are the per-contract sub-resources captured in Phase 1.
var ContractResources = []SubResource{
	{"contract_history", "historico"},
	{"contract_commitments", "empenhos"},
	{"contract_guarantees", "garantias"},
	{"contract_responsibles", "responsaveis"},
	{"contract_items", "itens"},
	{"contract_invoices", "faturas"},
	{"contract_files", "arquivos"},
}

// Connector captures Contratos.gov.br resources into the capture store.
type Connector struct {
	Fetcher *capture.Fetcher
	Store   *capture.Store
	BaseURL string
	Log     func(string, ...any)
	// Concurrency is how many contracts are fetched at once; 0 or 1 fetches
	// them one by one. Every request still waits on the shared gate.
	Concurrency int
}

// ValidUnit reports whether code is a six-digit UG code (leading zeros kept).
func ValidUnit(code string) bool {
	if len(code) != 6 {
		return false
	}
	for _, r := range code {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// Listed is one contract element of a UG listing.
type Listed struct {
	ID      int64
	Active  bool            // listed by the active listing
	Element json.RawMessage // the raw listing element
}

// DueFunc reports whether a listed contract's sub-resources should be captured.
type DueFunc func(ctx context.Context, c Listed) (bool, error)

// ContractIDs returns the positive integer ids of a contract listing, in order.
func ContractIDs(listing []byte) ([]int64, error) {
	listed, err := listedContracts(listing, false)
	if err != nil {
		return nil, err
	}
	ids := make([]int64, len(listed))
	for i, c := range listed {
		ids[i] = c.ID
	}
	return ids, nil
}

// listedContracts decodes a contract listing into its elements, in order.
func listedContracts(listing []byte, active bool) ([]Listed, error) {
	var elements []json.RawMessage
	decoder := json.NewDecoder(bytes.NewReader(listing))
	decoder.UseNumber()
	if err := decoder.Decode(&elements); err != nil {
		return nil, fmt.Errorf("contract listing is not an array of contracts: %w", err)
	}
	listed := make([]Listed, 0, len(elements))
	for i, element := range elements {
		var row struct {
			ID *json.Number `json:"id"`
		}
		decoder := json.NewDecoder(bytes.NewReader(element))
		decoder.UseNumber()
		if err := decoder.Decode(&row); err != nil {
			return nil, fmt.Errorf("contract listing is not an array of contracts: %w", err)
		}
		if row.ID == nil {
			return nil, fmt.Errorf("contract listing row %d has no id", i)
		}
		id, err := row.ID.Int64()
		if err != nil || id <= 0 {
			return nil, fmt.Errorf("contract listing row %d has invalid id %q", i, row.ID.String())
		}
		listed = append(listed, Listed{ID: id, Active: active, Element: element})
	}
	return listed, nil
}

// SyncUnit captures the active (and optionally inactive) contract listings of a
// UG and every listed contract's sub-resources. A failed active listing is fatal;
// other failures make the run partial.
func (c *Connector) SyncUnit(ctx context.Context, runID int64, unit string, includeInactive bool) (capture.RunSummary, error) {
	return c.syncUnit(ctx, runID, unit, includeInactive, func(context.Context, Listed) (bool, error) { return true, nil })
}

// SyncUnitWith captures the active and inactive contract listings of a UG and
// the sub-resources of the listed contracts for which due returns true. A
// failed active listing is fatal; other source failures make the run partial.
func (c *Connector) SyncUnitWith(ctx context.Context, runID int64, unit string, due DueFunc) (capture.RunSummary, error) {
	return c.syncUnit(ctx, runID, unit, true, due)
}

func (c *Connector) syncUnit(ctx context.Context, runID int64, unit string, includeInactive bool, due DueFunc) (summary capture.RunSummary, err error) {
	defer func() { finalize(&summary, err) }()
	if !ValidUnit(unit) {
		return summary, fmt.Errorf("unit must be a six-digit UG code")
	}
	listings := []capture.Request{{Resource: "contracts_active_by_unit", Path: "/api/contrato/ug/" + unit}}
	if includeInactive {
		listings = append(listings, capture.Request{Resource: "contracts_inactive_by_unit", Path: "/api/contrato/inativo/ug/" + unit})
	}
	var contracts []Listed
	seen := map[int64]bool{}
	for i, req := range listings {
		res, outcome, err := c.capture(ctx, runID, req, &summary)
		if err != nil {
			return summary, err
		}
		if outcome == capture.Failed || outcome == capture.NotFound {
			if i == 0 {
				return summary, fmt.Errorf("active contract listing for unit %s failed: %s", unit, describe(res))
			}
			continue
		}
		listed, err := listedContracts(res.Canonical, i == 0)
		if err != nil {
			return summary, err
		}
		for _, contract := range listed {
			if !seen[contract.ID] {
				seen[contract.ID] = true
				contracts = append(contracts, contract)
			}
		}
	}
	var ids []int64
	for _, contract := range contracts {
		ok, err := due(ctx, contract)
		if err != nil {
			return summary, fmt.Errorf("decide refresh of contract %d: %w", contract.ID, err)
		}
		if ok {
			ids = append(ids, contract.ID)
		}
	}
	if c.Log != nil && len(ids) < len(contracts) {
		c.Log("Skipped contracts not due for refresh", "unit", unit, "skipped", len(contracts)-len(ids), "total", len(contracts))
	}
	return summary, c.syncContracts(ctx, runID, ids, &summary)
}

// syncContracts captures the sub-resources of ids with up to c.Concurrency
// workers. The first cancellation or store failure stops every worker and is
// returned; source failures are only counted in summary.
func (c *Connector) syncContracts(ctx context.Context, runID int64, ids []int64, summary *capture.RunSummary) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var (
		mu       sync.Mutex
		firstErr error
		done     int
		wg       sync.WaitGroup
	)
	next := make(chan int64)
	for range max(1, min(c.Concurrency, len(ids))) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for id := range next {
				var local capture.RunSummary
				err := c.syncContractResources(ctx, runID, id, &local)
				mu.Lock()
				summary.Merge(local)
				if err != nil && firstErr == nil {
					firstErr = err
					cancel()
				}
				if err == nil {
					done++
					if c.Log != nil {
						c.Log("Captured contract", "id", id, "position", done, "total", len(ids))
					}
				}
				mu.Unlock()
			}
		}()
	}
feed:
	for _, id := range ids {
		select {
		case next <- id:
		case <-ctx.Done():
			break feed
		}
	}
	close(next)
	wg.Wait()
	if firstErr == nil {
		// Cancelled by the caller before any worker noticed.
		firstErr = ctx.Err()
	}
	return firstErr
}

// SyncContract captures one contract by id and its sub-resources.
func (c *Connector) SyncContract(ctx context.Context, runID int64, contractID int64) (summary capture.RunSummary, err error) {
	defer func() { finalize(&summary, err) }()
	if contractID <= 0 {
		return summary, fmt.Errorf("contract id must be positive")
	}
	req := capture.Request{Resource: "contract", Path: "/api/contrato/id/" + strconv.FormatInt(contractID, 10)}
	res, outcome, err := c.capture(ctx, runID, req, &summary)
	if err != nil {
		return summary, err
	}
	if outcome == capture.Failed || outcome == capture.NotFound {
		return summary, fmt.Errorf("contract %d failed: %s", contractID, describe(res))
	}
	return summary, c.syncContractResources(ctx, runID, contractID, &summary)
}

func (c *Connector) syncContractResources(ctx context.Context, runID, id int64, summary *capture.RunSummary) error {
	prefix := "/api/contrato/" + strconv.FormatInt(id, 10) + "/"
	for _, sub := range ContractResources {
		if _, _, err := c.capture(ctx, runID, capture.Request{Resource: sub.Resource, Path: prefix + sub.Segment}, summary); err != nil {
			return err
		}
	}
	return nil
}

// capture fetches and records one request. It returns an error only for
// cancellation or a store failure; source failures are outcomes.
func (c *Connector) capture(ctx context.Context, runID int64, req capture.Request, summary *capture.RunSummary) (capture.Result, capture.Outcome, error) {
	res := c.Fetcher.GetJSON(ctx, c.BaseURL+req.Key())
	if err := ctx.Err(); err != nil {
		return res, "", err
	}
	outcome, err := c.Store.Record(ctx, runID, Source, req, res)
	if err != nil {
		return res, "", err
	}
	summary.Add(outcome)
	return res, outcome, nil
}

func describe(res capture.Result) string {
	if res.Err != nil {
		return res.Err.Error()
	}
	if res.NotFound {
		return "not found"
	}
	return "HTTP " + strconv.Itoa(res.Status)
}

func finalize(summary *capture.RunSummary, err error) {
	succeeded := summary.Captured + summary.Unchanged + summary.NotFound
	switch {
	case err != nil:
		summary.Status = "FAILED"
		summary.Error = err.Error()
	case summary.Failed == 0:
		summary.Status = "SUCCEEDED"
	case succeeded > 0:
		summary.Status = "PARTIAL"
	default:
		summary.Status = "FAILED"
	}
}
