package normalize

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/lib/pq"
)

// ContractResult is the outcome of normalizing one contract.
type ContractResult struct {
	ExternalID int64
	Status     string // NORMALIZED, SKIPPED_NO_HEADER or FAILED
	BadDates   int
	Error      string
}

// Summary totals normalization results.
type Summary struct {
	Normalized int `json:"normalized"`
	Skipped    int `json:"skipped"`
	Failed     int `json:"failed"`
	BadDates   int `json:"badDates"`
}

func (s *Summary) add(r ContractResult) {
	switch r.Status {
	case "NORMALIZED":
		s.Normalized++
	case "SKIPPED_NO_HEADER":
		s.Skipped++
	default:
		s.Failed++
	}
	s.BadDates += r.BadDates
}

// Normalizer rebuilds typed contract snapshots from the latest captures.
type Normalizer struct {
	DB     *sql.DB
	Source string
}

// row is a typed child row ready to insert.
type row interface {
	values(contractID int64) []any
}

type part struct {
	name, resource, segment, table string
	columns                        []string
	mapRows                        func(json.RawMessage, *Mapped) ([]row, error)
}

func rowsOf[T row](mapper func(json.RawMessage, *Mapped) ([]T, error)) func(json.RawMessage, *Mapped) ([]row, error) {
	return func(payload json.RawMessage, m *Mapped) ([]row, error) {
		typed, err := mapper(payload, m)
		if err != nil {
			return nil, err
		}
		rows := make([]row, len(typed))
		for i := range typed {
			rows[i] = typed[i]
		}
		return rows, nil
	}
}

var parts = []part{
	{"history", "contract_history", "historico", "contract_amendments", []string{"external_id", "number", "type_code", "type_name", "qualifications", "observation", "signature_date", "publication_date", "start_date", "end_date", "initial_value", "global_value", "new_global_value", "installment_count", "installment_value", "new_installment_count", "new_installment_value", "new_value_start_date", "contract_status", "source_data"}, rowsOf(MapAmendments)},
	{"commitments", "contract_commitments", "empenhos", "contract_commitments", []string{"external_id", "unit_code", "management_code", "number", "issue_date", "creditor", "resource_source", "work_program", "internal_plan", "expense_nature", "committed", "to_liquidate", "liquidated", "paid", "rp_registered", "rp_to_liquidate", "rp_liquidated", "rp_paid", "source_data"}, rowsOf(MapCommitments)},
	{"guarantees", "contract_guarantees", "garantias", "contract_guarantees", []string{"external_id", "guarantee_type", "amount", "due_date", "source_data"}, rowsOf(MapGuarantees)},
	{"responsibles", "contract_responsibles", "responsaveis", "contract_responsibles", []string{"external_id", "responsible_name", "masked_document", "role", "installation", "ordinance", "status", "start_date", "end_date", "source_data"}, rowsOf(MapResponsibles)},
	{"items", "contract_items", "itens", "contract_items", []string{"external_id", "item_type", "material_type", "group_name", "catalog_item", "description", "quantity", "unit_value", "total_value", "purchase_item_number", "start_date", "history", "source_data"}, rowsOf(MapItems)},
	{"invoices", "contract_invoices", "faturas", "contract_invoices", []string{"external_id", "invoice_type", "billing_instrument", "number", "series", "issue_date", "deadline_date", "due_date", "liquidation_date", "amount", "interest", "fine", "disallowance", "net_amount", "status", "reference_month", "reference_year", "source_data"}, rowsOf(MapInvoices)},
	{"files", "contract_files", "arquivos", "contract_files", []string{"external_id", "file_type", "description", "url", "origin", "sei_link", "process_number", "source_data"}, rowsOf(MapFiles)},
}

// Child rows belong to the contract whose URL they were captured from, so the
// store always uses that id (commitment rows carry no contract id at all).
func (a Amendment) values(id int64) []any {
	return []any{a.ExternalID, a.Number, a.TypeCode, a.TypeName, pq.Array(a.Qualifications), a.Observation, a.SignatureDate, a.PublicationDate, a.StartDate, a.EndDate, a.InitialValue, a.GlobalValue, a.NewGlobalValue, a.InstallmentCount, a.InstallmentValue, a.NewInstallmentCount, a.NewInstallmentValue, a.NewValueStartDate, a.ContractStatus, string(a.SourceData)}
}
func (c Commitment) values(id int64) []any {
	return []any{c.ExternalID, c.UnitCode, c.ManagementCode, c.Number, c.IssueDate, c.Creditor, c.ResourceSource, c.WorkProgram, c.InternalPlan, c.ExpenseNature, c.Committed, c.ToLiquidate, c.Liquidated, c.Paid, c.RPRegistered, c.RPToLiquidate, c.RPLiquidated, c.RPPaid, string(c.SourceData)}
}
func (g Guarantee) values(id int64) []any {
	return []any{g.ExternalID, g.GuaranteeType, g.Amount, g.DueDate, string(g.SourceData)}
}
func (r Responsible) values(id int64) []any {
	return []any{r.ExternalID, r.Name, r.MaskedDocument, r.Role, r.Installation, r.Ordinance, r.Status, r.StartDate, r.EndDate, string(r.SourceData)}
}
func (i Item) values(id int64) []any {
	return []any{i.ExternalID, i.ItemType, i.MaterialType, i.GroupName, i.CatalogItem, i.Description, i.Quantity, i.UnitValue, i.TotalValue, i.PurchaseItemNumber, i.StartDate, string(i.History), string(i.SourceData)}
}
func (v Invoice) values(id int64) []any {
	return []any{v.ExternalID, v.InvoiceType, v.BillingInstrument, v.Number, v.Series, v.IssueDate, v.DeadlineDate, v.DueDate, v.LiquidationDate, v.Amount, v.Interest, v.Fine, v.Disallowance, v.NetAmount, v.Status, v.ReferenceMonth, v.ReferenceYear, string(v.SourceData)}
}
func (f File) values(id int64) []any {
	return []any{f.ExternalID, f.FileType, f.Description, f.URL, f.Origin, f.SeiLink, f.ProcessNumber, string(f.SourceData)}
}

type partState struct {
	payload    json.RawMessage
	capturedAt sql.NullTime
	attemptAt  sql.NullTime
	outcome    sql.NullString
	lastError  sql.NullString
	rows       []row
	status     string
}

// Contract rebuilds one contract. Mapping problems give Status FAILED and leave
// earlier rows untouched; only database failures return an error.
func (n *Normalizer) Contract(ctx context.Context, externalID int64) (ContractResult, error) {
	result := ContractResult{ExternalID: externalID}
	tx, err := n.DB.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	id := strconv.FormatInt(externalID, 10)
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('public_sources.contract:' || $1 || ':' || $2))`, n.Source, id); err != nil {
		return result, err
	}
	var m Mapped
	header, headerResource, headerSeen, err := n.header(ctx, tx, id, &m)
	if errors.Is(err, sql.ErrNoRows) {
		result.Status = "SKIPPED_NO_HEADER"
		return result, nil
	}
	var mapping mappingError
	if errors.As(err, &mapping) {
		return failed(result, err), nil
	}
	if err != nil {
		return result, err
	}
	states := make([]partState, len(parts))
	for i, p := range parts {
		state, err := n.partState(ctx, tx, "/api/contrato/"+id+"/"+p.segment)
		if err != nil {
			return result, err
		}
		if state.payload != nil {
			if state.rows, err = p.mapRows(state.payload, &m); err != nil {
				return failed(result, err), nil
			}
		}
		states[i] = state
	}
	if err = n.writeContract(ctx, tx, header, headerResource, headerSeen); err != nil {
		return result, err
	}
	if err = n.writePart(ctx, tx, externalID, "header", "AVAILABLE", sql.NullTime{Time: headerSeen, Valid: true}, sql.NullTime{}, sql.NullString{}, 1); err != nil {
		return result, err
	}
	for i, p := range parts {
		state := states[i]
		if _, err = tx.ExecContext(ctx, `DELETE FROM public_sources.`+p.table+` WHERE source = $1 AND contract_external_id = $2`, n.Source, externalID); err != nil {
			return result, err
		}
		if err = n.insertRows(ctx, tx, p, externalID, state.rows); err != nil {
			return result, fmt.Errorf("insert %s: %w", p.table, err)
		}
		if err = n.writePart(ctx, tx, externalID, p.name, state.status, state.capturedAt, state.attemptAt, state.lastError, len(state.rows)); err != nil {
			return result, err
		}
	}
	if err = tx.Commit(); err != nil {
		return result, err
	}
	result.Status, result.BadDates = "NORMALIZED", m.BadDates
	return result, nil
}

type mappingError struct{ error }

func failed(result ContractResult, err error) ContractResult {
	result.Status, result.Error = "FAILED", err.Error()
	return result
}

func (n *Normalizer) header(ctx context.Context, tx *sql.Tx, id string, m *Mapped) (Contract, string, time.Time, error) {
	var payload []byte
	var seen time.Time
	err := tx.QueryRowContext(ctx, `SELECT payload, last_seen_at FROM public_sources.latest_captures
		WHERE source = $1 AND resource = 'contract' AND request_key = '/api/contrato/id/' || $2`, n.Source, id).Scan(&payload, &seen)
	if err == nil {
		c, err := MapIDContract(payload, m)
		if err == nil && strconv.FormatInt(c.ExternalID, 10) != id {
			err = fmt.Errorf("contracts: /id payload returned contract %d", c.ExternalID)
		}
		if err != nil {
			return Contract{}, "", seen, mappingError{err}
		}
		return c, "contract", seen, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Contract{}, "", seen, err
	}
	var resource string
	err = tx.QueryRowContext(ctx, `SELECT element, c.resource, c.last_seen_at
		FROM public_sources.latest_captures c
		CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.payload) = 'array' THEN c.payload ELSE '[]'::jsonb END) element
		WHERE c.source = $1 AND c.resource IN ('contracts_active_by_unit', 'contracts_inactive_by_unit') AND element->>'id' = $2
		ORDER BY c.last_seen_at DESC, c.id DESC LIMIT 1`, n.Source, id).Scan(&payload, &resource, &seen)
	if err != nil {
		return Contract{}, "", seen, err
	}
	c, err := MapListingContract(payload, m)
	if err != nil {
		return Contract{}, "", seen, mappingError{err}
	}
	return c, resource, seen, nil
}

func (n *Normalizer) partState(ctx context.Context, tx *sql.Tx, key string) (partState, error) {
	var state partState
	var payload []byte
	err := tx.QueryRowContext(ctx, `SELECT payload, last_seen_at FROM public_sources.latest_captures WHERE source = $1 AND request_key = $2`, n.Source, key).Scan(&payload, &state.capturedAt)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return state, err
	}
	if payload != nil {
		state.payload = payload
	}
	err = tx.QueryRowContext(ctx, `SELECT outcome, attempted_at, error FROM public_sources.capture_attempts
		WHERE source = $1 AND request_key = $2 ORDER BY attempted_at DESC, id DESC LIMIT 1`, n.Source, key).Scan(&state.outcome, &state.attemptAt, &state.lastError)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return state, err
	}
	switch {
	case !state.outcome.Valid && state.payload == nil:
		state.status = "MISSING"
	case state.outcome.String == "NOT_FOUND":
		state.status = "NOT_FOUND"
	case state.outcome.String == "FAILED":
		state.status = "FAILED"
	default:
		state.status = "AVAILABLE"
	}
	if state.status != "FAILED" {
		state.lastError = sql.NullString{}
	}
	return state, nil
}

func (n *Normalizer) writeContract(ctx context.Context, tx *sql.Tx, c Contract, resource string, seen time.Time) error {
	columns := []string{"source", "external_id", "number", "managing_unit_code", "origin_unit_code", "purchase_unit_code", "agency_code", "supplier_type", "supplier_document", "supplier_name", "type_code", "type_name", "category", "process_number", "object", "modality", "bidding_number", "legal_basis", "signature_date", "publication_date", "start_date", "end_date", "initial_value", "global_value", "installment_count", "installment_value", "accumulated_value", "status", "header_resource", "captured_at", "source_data"}
	values := []any{n.Source, c.ExternalID, c.Number, c.ManagingUnitCode, c.OriginUnitCode, c.PurchaseUnitCode, c.AgencyCode, c.SupplierType, c.SupplierDocument, c.SupplierName, c.TypeCode, c.TypeName, c.Category, c.ProcessNumber, c.Object, c.Modality, c.BiddingNumber, c.LegalBasis, c.SignatureDate, c.PublicationDate, c.StartDate, c.EndDate, c.InitialValue, c.GlobalValue, c.InstallmentCount, c.InstallmentValue, c.AccumulatedValue, c.Status, resource, seen, string(c.SourceData)}
	updates := make([]string, 0, len(columns))
	for _, column := range columns[2:] {
		updates = append(updates, column+" = EXCLUDED."+column)
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO public_sources.contracts (`+strings.Join(columns, ", ")+`) VALUES (`+placeholders(1, len(columns))+`)
		ON CONFLICT (source, external_id) DO UPDATE SET `+strings.Join(updates, ", ")+`, normalized_at = now()`, values...)
	return err
}

func (n *Normalizer) writePart(ctx context.Context, tx *sql.Tx, id int64, name, status string, captured, attempted sql.NullTime, lastError sql.NullString, count int) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO public_sources.contract_parts (source, contract_external_id, part, status, captured_at, last_attempt_at, last_error, row_count)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (source, contract_external_id, part) DO UPDATE SET status = EXCLUDED.status, captured_at = EXCLUDED.captured_at,
		last_attempt_at = EXCLUDED.last_attempt_at, last_error = EXCLUDED.last_error, row_count = EXCLUDED.row_count`,
		n.Source, id, name, status, captured, attempted, lastError, count)
	return err
}

const insertBatch = 500

func (n *Normalizer) insertRows(ctx context.Context, tx *sql.Tx, p part, contractID int64, rows []row) error {
	columns := append([]string{"source", "contract_external_id"}, p.columns...)
	for start := 0; start < len(rows); start += insertBatch {
		batch := rows[start:min(len(rows), start+insertBatch)]
		groups := make([]string, 0, len(batch))
		values := make([]any, 0, len(batch)*len(columns))
		for _, r := range batch {
			groups = append(groups, "("+placeholders(len(values)+1, len(columns))+")")
			values = append(values, n.Source, contractID)
			values = append(values, r.values(contractID)...)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO public_sources.`+p.table+` (`+strings.Join(columns, ", ")+`) VALUES `+strings.Join(groups, ", "), values...); err != nil {
			return err
		}
	}
	return nil
}

func placeholders(first, count int) string {
	marks := make([]string, count)
	for i := range marks {
		marks[i] = "$" + strconv.Itoa(first+i)
	}
	return strings.Join(marks, ", ")
}

// Unit normalizes every contract listed for a UG in its latest listings.
func (n *Normalizer) Unit(ctx context.Context, unit string) (Summary, error) {
	return n.many(ctx, `SELECT DISTINCT (element->>'id')::bigint FROM public_sources.latest_captures c
		CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.payload) = 'array' THEN c.payload ELSE '[]'::jsonb END) element
		WHERE c.source = $1 AND c.request_key IN ('/api/contrato/ug/' || $2, '/api/contrato/inativo/ug/' || $2)
		AND element->>'id' ~ '^[1-9][0-9]*$' ORDER BY 1`, n.Source, unit)
}

// All normalizes every contract known from any listing or contract capture.
func (n *Normalizer) All(ctx context.Context) (Summary, error) {
	return n.many(ctx, `SELECT DISTINCT (element->>'id')::bigint FROM public_sources.latest_captures c
		CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.payload) = 'array' THEN c.payload ELSE '[]'::jsonb END) element
		WHERE c.source = $1 AND c.resource IN ('contract', 'contracts_active_by_unit', 'contracts_inactive_by_unit')
		AND element->>'id' ~ '^[1-9][0-9]*$' ORDER BY 1`, n.Source)
}

func (n *Normalizer) many(ctx context.Context, query string, args ...any) (Summary, error) {
	var summary Summary
	rows, err := n.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return summary, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return summary, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return summary, err
	}
	for _, id := range ids {
		result, err := n.Contract(ctx, id)
		if err != nil {
			return summary, fmt.Errorf("normalize contract %d: %w", id, err)
		}
		summary.add(result)
	}
	return summary, nil
}
