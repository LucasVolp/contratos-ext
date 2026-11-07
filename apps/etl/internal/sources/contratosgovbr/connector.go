// Package contratosgovbr captures public Contratos.gov.br contract data: the
// contract listings of a management unit (UG) and each contract's sub-resources.
package contratosgovbr

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"contracts-ext/etl/internal/capture"
	"contracts-ext/etl/internal/pacing"
)

const (
	Source  = "CONTRATOS_GOV_BR"
	BaseURL = "https://contratos.comprasnet.gov.br"
	Host    = "contratos.comprasnet.gov.br"
)

// DefaultPolicy paces Contratos.gov.br requests.
var DefaultPolicy = pacing.Policy{Minimum: time.Second, Maximum: 30 * time.Second, BlockPause: 5*time.Minute + time.Second}

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

// ContractIDs returns the positive integer ids of a contract listing, in order.
func ContractIDs(listing []byte) ([]int64, error) {
	var rows []struct {
		ID *json.Number `json:"id"`
	}
	decoder := json.NewDecoder(bytes.NewReader(listing))
	decoder.UseNumber()
	if err := decoder.Decode(&rows); err != nil {
		return nil, fmt.Errorf("contract listing is not an array of contracts: %w", err)
	}
	ids := make([]int64, 0, len(rows))
	for i, row := range rows {
		if row.ID == nil {
			return nil, fmt.Errorf("contract listing row %d has no id", i)
		}
		id, err := row.ID.Int64()
		if err != nil || id <= 0 {
			return nil, fmt.Errorf("contract listing row %d has invalid id %q", i, row.ID.String())
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// SyncUnit captures the active (and optionally inactive) contract listings of a
// UG and every listed contract's sub-resources. A failed active listing is fatal;
// other failures make the run partial.
func (c *Connector) SyncUnit(ctx context.Context, runID int64, unit string, includeInactive bool) (summary capture.RunSummary, err error) {
	defer func() { finalize(&summary, err) }()
	if !ValidUnit(unit) {
		return summary, fmt.Errorf("unit must be a six-digit UG code")
	}
	listings := []capture.Request{{Resource: "contracts_active_by_unit", Path: "/api/contrato/ug/" + unit}}
	if includeInactive {
		listings = append(listings, capture.Request{Resource: "contracts_inactive_by_unit", Path: "/api/contrato/inativo/ug/" + unit})
	}
	var ids []int64
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
		listed, err := ContractIDs(res.Canonical)
		if err != nil {
			return summary, err
		}
		for _, id := range listed {
			if !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
	}
	for i, id := range ids {
		if err := c.syncContractResources(ctx, runID, id, &summary); err != nil {
			return summary, err
		}
		if c.Log != nil {
			c.Log("Captured contract", "id", id, "position", i+1, "total", len(ids))
		}
	}
	return summary, nil
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
