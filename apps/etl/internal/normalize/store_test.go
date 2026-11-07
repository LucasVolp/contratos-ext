package normalize_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"contracts-ext/etl/internal/capture"
	"contracts-ext/etl/internal/normalize"
	"contracts-ext/etl/internal/testdb"
)

const source = "CONTRATOS_GOV_BR"

type seeder struct {
	t     *testing.T
	db    *sql.DB
	store *capture.Store
	run   int64
}

func newSeeder(t *testing.T) *seeder {
	t.Helper()
	db := migrated(t)
	store := &capture.Store{DB: db}
	run, err := store.StartRun(context.Background(), capture.RunStart{Source: source, Trigger: "MANUAL", TargetType: "CONTRACT", TargetCode: "1", Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	return &seeder{t: t, db: db, store: store, run: run}
}

func (s *seeder) body(resource, path, body string) {
	s.t.Helper()
	canonical, hash, err := capture.Canonicalize([]byte(body))
	if err != nil {
		s.t.Fatal(err)
	}
	if _, err := s.store.Record(context.Background(), s.run, source, capture.Request{Resource: resource, Path: path}, capture.Result{Status: 200, Canonical: canonical, Hash: hash}); err != nil {
		s.t.Fatal(err)
	}
}

func (s *seeder) file(resource, path, name string) {
	s.t.Helper()
	data, err := os.ReadFile("testdata/" + name)
	if err != nil {
		s.t.Fatal(err)
	}
	s.body(resource, path, string(data))
}

func (s *seeder) failed(resource, path string) {
	s.t.Helper()
	if _, err := s.store.Record(context.Background(), s.run, source, capture.Request{Resource: resource, Path: path}, capture.Result{Status: 500, Err: errors.New("source returned HTTP 500")}); err != nil {
		s.t.Fatal(err)
	}
}

// fullContract seeds contract 1057026 with every part, all with real-shaped fixtures.
func (s *seeder) fullContract() {
	p := "/api/contrato/1057026/"
	s.file("contract", "/api/contrato/id/1057026", "id_contract.json")
	s.file("contract_history", p+"historico", "historico.json")
	s.file("contract_commitments", p+"empenhos", "empenhos.json")
	s.file("contract_guarantees", p+"garantias", "garantias.json")
	s.file("contract_responsibles", p+"responsaveis", "responsaveis.json")
	s.file("contract_items", p+"itens", "itens.json")
	s.file("contract_invoices", p+"faturas", "faturas.json")
	s.file("contract_files", p+"arquivos", "arquivos.json")
}

func (s *seeder) notFound(resource, path string) {
	s.t.Helper()
	if _, err := s.store.Record(context.Background(), s.run, source, capture.Request{Resource: resource, Path: path}, capture.Result{Status: 404, NotFound: true}); err != nil {
		s.t.Fatal(err)
	}
}

// listingItem returns the listing fixture with the given fields overridden.
func listingItem(t *testing.T, overrides map[string]any) string {
	t.Helper()
	data, err := os.ReadFile("testdata/listing_item.json")
	if err != nil {
		t.Fatal(err)
	}
	var item map[string]any
	if err := json.Unmarshal(data, &item); err != nil {
		t.Fatal(err)
	}
	for k, v := range overrides {
		item[k] = v
	}
	out, err := json.Marshal(item)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func (s *seeder) normalizer() *normalize.Normalizer {
	return &normalize.Normalizer{DB: s.db, Source: source}
}

func (s *seeder) scalar(query string, args ...any) string {
	s.t.Helper()
	return testdb.Scalar(s.t, s.db, query, args...)
}

func TestNormalizeContractFromIDCapture(t *testing.T) {
	s := newSeeder(t)
	s.fullContract()
	result, err := s.normalizer().Contract(context.Background(), 1057026)
	if err != nil || result.Status != "NORMALIZED" {
		t.Fatalf("result = %+v, err = %v", result, err)
	}
	if got := s.scalar(`SELECT number_key || '|' || managing_unit_code || '|' || header_resource FROM public_sources.contracts`); got != "2026NE000234|158148|contract" {
		t.Fatalf("contract = %s", got)
	}
	if got := s.scalar(`SELECT count(*) FILTER (WHERE status = 'AVAILABLE') || '/' || count(*) FROM public_sources.contract_parts`); got != "8/8" {
		t.Fatalf("parts = %s", got)
	}
	if got := s.scalar(`SELECT quantity::text FROM public_sources.contract_items`); got != "750.625000" {
		t.Fatalf("quantity = %s", got)
	}
	if got := s.scalar(`SELECT transparency_code || '|' || contract_external_id FROM public_sources.contract_commitments`); got != "158345264212022NE000066|1057026" {
		t.Fatalf("commitment = %s", got)
	}
	if got := s.scalar(`SELECT row_count FROM public_sources.contract_parts WHERE part = 'history'`); got != "2" {
		t.Fatalf("history row count = %s", got)
	}
	if got := s.scalar(`SELECT count(*) FROM public_sources.contract_responsibles WHERE source_data::text LIKE '%123.456.789-01%'`); got != "0" {
		t.Fatal("full CPF stored")
	}
}

func TestNormalizeContractFromListingOnly(t *testing.T) {
	s := newSeeder(t)
	item, err := os.ReadFile("testdata/listing_item.json")
	if err != nil {
		t.Fatal(err)
	}
	s.body("contracts_active_by_unit", "/api/contrato/ug/158148", "["+string(item)+"]")
	result, err := s.normalizer().Contract(context.Background(), 13847)
	if err != nil || result.Status != "NORMALIZED" {
		t.Fatalf("result = %+v, err = %v", result, err)
	}
	if got := s.scalar(`SELECT header_resource FROM public_sources.contracts`); got != "contracts_active_by_unit" {
		t.Fatalf("header resource = %s", got)
	}
	if got := s.scalar(`SELECT count(*) FROM public_sources.contract_parts WHERE status = 'MISSING'`); got != "7" {
		t.Fatalf("missing parts = %s", got)
	}
}

func TestNormalizeSkipsWithoutHeader(t *testing.T) {
	s := newSeeder(t)
	result, err := s.normalizer().Contract(context.Background(), 999)
	if err != nil || result.Status != "SKIPPED_NO_HEADER" {
		t.Fatalf("result = %+v, err = %v", result, err)
	}
	if got := s.scalar(`SELECT count(*) FROM public_sources.contracts`); got != "0" {
		t.Fatalf("contracts = %s", got)
	}
}

func TestNormalizeKeepsLastGoodCaptureOnFailure(t *testing.T) {
	s := newSeeder(t)
	s.fullContract()
	n := s.normalizer()
	if _, err := n.Contract(context.Background(), 1057026); err != nil {
		t.Fatal(err)
	}
	captured := s.scalar(`SELECT captured_at::text FROM public_sources.contract_parts WHERE part = 'guarantees'`)
	s.failed("contract_guarantees", "/api/contrato/1057026/garantias")
	if result, err := n.Contract(context.Background(), 1057026); err != nil || result.Status != "NORMALIZED" {
		t.Fatalf("result = %+v, err = %v", result, err)
	}
	if got := s.scalar(`SELECT count(*) FROM public_sources.contract_guarantees`); got != "1" {
		t.Fatalf("guarantees = %s", got)
	}
	row := s.scalar(`SELECT status || '|' || (last_error IS NOT NULL) || '|' || captured_at::text FROM public_sources.contract_parts WHERE part = 'guarantees'`)
	if row != "FAILED|true|"+captured {
		t.Fatalf("part = %s, want FAILED|true|%s", row, captured)
	}
}

func TestNormalizeIsSnapshot(t *testing.T) {
	s := newSeeder(t)
	s.fullContract()
	s.body("contract_items", "/api/contrato/1057026/itens", `[{"id":1,"contrato_id":1057026,"quantidade":"1"},{"id":2,"contrato_id":1057026,"quantidade":"2"},{"id":3,"contrato_id":1057026,"quantidade":"3"}]`)
	n := s.normalizer()
	if _, err := n.Contract(context.Background(), 1057026); err != nil {
		t.Fatal(err)
	}
	s.body("contract_items", "/api/contrato/1057026/itens", `[{"id":2,"contrato_id":1057026,"quantidade":"2"}]`)
	if _, err := n.Contract(context.Background(), 1057026); err != nil {
		t.Fatal(err)
	}
	if got := s.scalar(`SELECT string_agg(external_id::text, ',') FROM public_sources.contract_items`); got != "2" {
		t.Fatalf("items = %s", got)
	}
}

func TestNormalizeMappingErrorRollsBack(t *testing.T) {
	s := newSeeder(t)
	s.fullContract()
	n := s.normalizer()
	if _, err := n.Contract(context.Background(), 1057026); err != nil {
		t.Fatal(err)
	}
	s.body("contract_invoices", "/api/contrato/1057026/faturas", `[{"id":9,"contrato_id":1057026,"valor":"abc"}]`)
	result, err := n.Contract(context.Background(), 1057026)
	if err != nil || result.Status != "FAILED" || !strings.Contains(result.Error, "contract_invoices") {
		t.Fatalf("result = %+v, err = %v", result, err)
	}
	if got := s.scalar(`SELECT net_amount::text FROM public_sources.contract_invoices`); got != "6100.000000" {
		t.Fatalf("previous invoice lost: %s", got)
	}
}

func TestNormalizeUnitDeduplicates(t *testing.T) {
	s := newSeeder(t)
	item, err := os.ReadFile("testdata/listing_item.json")
	if err != nil {
		t.Fatal(err)
	}
	s.body("contracts_active_by_unit", "/api/contrato/ug/158148", "["+string(item)+"]")
	s.body("contracts_inactive_by_unit", "/api/contrato/inativo/ug/158148", "["+string(item)+"]")
	summary, err := s.normalizer().Unit(context.Background(), "158148")
	if err != nil || summary.Normalized != 1 || summary.Failed != 0 {
		t.Fatalf("summary = %+v, err = %v", summary, err)
	}
	all, err := s.normalizer().All(context.Background())
	if err != nil || all.Normalized != 1 {
		t.Fatalf("all = %+v, err = %v", all, err)
	}
}

func TestNormalizeSharedCommitmentAcrossContracts(t *testing.T) {
	s := newSeeder(t)
	s.body("contracts_active_by_unit", "/api/contrato/ug/158148", "["+listingItem(t, nil)+"]")
	s.fullContract()
	s.file("contract_commitments", "/api/contrato/13847/empenhos", "empenhos.json")
	ctx := context.Background()
	if result, err := s.normalizer().Contract(ctx, 1057026); err != nil || result.Status != "NORMALIZED" {
		t.Fatalf("result = %+v, err = %v", result, err)
	}
	summary, err := s.normalizer().Unit(ctx, "158148")
	if err != nil || summary.Normalized != 1 || summary.Failed != 0 {
		t.Fatalf("summary = %+v, err = %v", summary, err)
	}
	got := s.scalar(`SELECT string_agg(contract_external_id::text, ',' ORDER BY contract_external_id) FROM public_sources.contract_commitments WHERE external_id = 8514191`)
	if got != "13847,1057026" {
		t.Fatalf("commitment owners = %s", got)
	}
}

func TestNormalizeManyContinuesAfterContractDatabaseError(t *testing.T) {
	s := newSeeder(t)
	s.body("contracts_active_by_unit", "/api/contrato/ug/158148", "["+listingItem(t, nil)+","+listingItem(t, map[string]any{"id": 13848})+"]")
	s.body("contract_commitments", "/api/contrato/13847/empenhos", `[{"id":1,"unidade_gestora":"158345","gestao":"26421","numero":"2022NE000001","empenhado":"1.000.000.000.000.000.000.000,00"}]`)
	summary, err := s.normalizer().Unit(context.Background(), "158148")
	if err != nil {
		t.Fatalf("Unit returned %v", err)
	}
	if summary.Normalized != 1 || summary.Failed != 1 {
		t.Fatalf("summary = %+v", summary)
	}
	if len(summary.Failures) != 1 || summary.Failures[0].ExternalID != 13847 || summary.Failures[0].Error == "" {
		t.Fatalf("failures = %+v", summary.Failures)
	}
	if got := s.scalar(`SELECT string_agg(external_id::text, ',') FROM public_sources.contracts`); got != "13848" {
		t.Fatalf("contracts = %s", got)
	}
}

func TestNormalizeHeaderUsesFreshestCapture(t *testing.T) {
	s := newSeeder(t)
	s.file("contract", "/api/contrato/id/1057026", "id_contract.json")
	listing := listingItem(t, map[string]any{"id": 1057026, "numero": "2026NE000234", "objeto": "OBJETO DA LISTAGEM MAIS RECENTE"})
	s.body("contracts_active_by_unit", "/api/contrato/ug/158148", "["+listing+"]")
	if result, err := s.normalizer().Contract(context.Background(), 1057026); err != nil || result.Status != "NORMALIZED" {
		t.Fatalf("result = %+v, err = %v", result, err)
	}
	if got := s.scalar(`SELECT object || '|' || header_resource FROM public_sources.contracts`); got != "OBJETO DA LISTAGEM MAIS RECENTE|contracts_active_by_unit" {
		t.Fatalf("contract = %s", got)
	}
}

func TestNormalizeNotFoundPartClearsRows(t *testing.T) {
	s := newSeeder(t)
	s.fullContract()
	n := s.normalizer()
	if _, err := n.Contract(context.Background(), 1057026); err != nil {
		t.Fatal(err)
	}
	if got := s.scalar(`SELECT count(*) FROM public_sources.contract_guarantees`); got != "1" {
		t.Fatalf("guarantees before = %s", got)
	}
	s.notFound("contract_guarantees", "/api/contrato/1057026/garantias")
	if result, err := n.Contract(context.Background(), 1057026); err != nil || result.Status != "NORMALIZED" {
		t.Fatalf("result = %+v, err = %v", result, err)
	}
	if got := s.scalar(`SELECT count(*) FROM public_sources.contract_guarantees`); got != "0" {
		t.Fatalf("guarantees = %s", got)
	}
	if got := s.scalar(`SELECT status || '|' || row_count FROM public_sources.contract_parts WHERE part = 'guarantees'`); got != "NOT_FOUND|0" {
		t.Fatalf("part = %s", got)
	}
}

func TestNormalizeHeaderPartReflectsListingAttempt(t *testing.T) {
	s := newSeeder(t)
	s.body("contracts_active_by_unit", "/api/contrato/ug/158148", "["+listingItem(t, nil)+"]")
	seen := s.scalar(`SELECT last_seen_at::text FROM public_sources.captures WHERE request_key = '/api/contrato/ug/158148'`)
	s.failed("contracts_active_by_unit", "/api/contrato/ug/158148")
	if result, err := s.normalizer().Contract(context.Background(), 13847); err != nil || result.Status != "NORMALIZED" {
		t.Fatalf("result = %+v, err = %v", result, err)
	}
	got := s.scalar(`SELECT status || '|' || captured_at::text FROM public_sources.contract_parts WHERE part = 'header'`)
	if got != "FAILED|"+seen {
		t.Fatalf("header part = %s, want FAILED|%s", got, seen)
	}
}
