package normalize_test

import (
	"context"
	"database/sql"
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
