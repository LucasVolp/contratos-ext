package contratosgovbr_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"contracts-ext/etl/internal/capture"
	"contracts-ext/etl/internal/sources/contratosgovbr"
	"contracts-ext/etl/internal/testdb"
)

type noWaitGate struct{}

func (noWaitGate) Wait(context.Context) error                 { return nil }
func (noWaitGate) Block(context.Context, time.Duration) error { return nil }
func (noWaitGate) Delay(context.Context, time.Duration) error { return nil }

// Trimmed from real Contratos.gov.br responses captured on 2026-11-07.
const commitments = `[{"id":8514191,"unidade_gestora":"158345","gestao":"26421","numero":"2022NE000066","empenhado":"54.793,53"}]`

type fixture struct {
	mu       sync.Mutex
	bodies   map[string]string // path -> JSON body; missing paths answer []
	statuses map[string]int    // path -> forced status
	hits     map[string]int
	onHit    func(path string)
}

func newFixture(active, inactive string) *fixture {
	return &fixture{
		bodies: map[string]string{
			"/api/contrato/ug/158148":         active,
			"/api/contrato/inativo/ug/158148": inactive,
			"/api/contrato/13847/empenhos":    commitments,
		},
		statuses: map[string]int{},
		hits:     map[string]int{},
	}
}

func (f *fixture) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.hits[r.URL.Path]++
	status, body, onHit := f.statuses[r.URL.Path], f.bodies[r.URL.Path], f.onHit
	f.mu.Unlock()
	if onHit != nil {
		onHit(r.URL.Path)
	}
	if status != 0 {
		w.WriteHeader(status)
		return
	}
	if body == "" {
		body = "[]"
	}
	_, _ = w.Write([]byte(body))
}

func (f *fixture) count(path string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.hits[path]
}

type harness struct {
	connector *contratosgovbr.Connector
	store     *capture.Store
	fixture   *fixture
	t         *testing.T
}

func newHarness(t *testing.T, f *fixture) *harness {
	t.Helper()
	db := testdb.Isolated(t, testdb.Migration)
	server := httptest.NewTLSServer(f)
	t.Cleanup(server.Close)
	host, _ := url.Parse(server.URL)
	gate := noWaitGate{}
	fetcher := &capture.Fetcher{
		Client:    capture.NewHTTPClient([]string{host.Host}, gate, 5*time.Second, server.Client().Transport),
		Gate:      gate,
		MaxBytes:  1 << 20,
		UserAgent: "Mozilla/5.0 (compatible; contracts-ext-replicator/test)",
	}
	store := &capture.Store{DB: db}
	return &harness{connector: &contratosgovbr.Connector{Fetcher: fetcher, Store: store, BaseURL: server.URL}, store: store, fixture: f, t: t}
}

func (h *harness) run(target string) int64 {
	h.t.Helper()
	id, err := h.store.StartRun(context.Background(), capture.RunStart{Source: contratosgovbr.Source, Trigger: "MANUAL", TargetType: "MANAGEMENT_UNIT", TargetCode: target, Version: "test"})
	if err != nil {
		h.t.Fatal(err)
	}
	return id
}

func (h *harness) syncUnit(ctx context.Context) (capture.RunSummary, error) {
	return h.connector.SyncUnit(ctx, h.run("158148"), "158148", true)
}

func TestSyncUnitCapturesListingsAndSubResources(t *testing.T) {
	h := newHarness(t, newFixture(`[{"id":13847}]`, `[{"id":20001}]`))
	summary, err := h.syncUnit(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if summary.Requests != 2+2*7 || summary.Status != "SUCCEEDED" || summary.Captured != 16 {
		t.Fatalf("summary = %+v", summary)
	}
	db := h.store.DB
	if got := testdb.Scalar(t, db, `SELECT count(*) FROM public_sources.capture_attempts`); got != "16" {
		t.Fatalf("attempts = %s", got)
	}
	if got := testdb.Scalar(t, db, `SELECT resource FROM public_sources.latest_captures WHERE request_key = '/api/contrato/13847/empenhos'`); got != "contract_commitments" {
		t.Fatalf("commitments resource = %s", got)
	}
	if got := testdb.Scalar(t, db, `SELECT payload->0->>'numero' FROM public_sources.latest_captures WHERE request_key = '/api/contrato/13847/empenhos'`); got != "2022NE000066" {
		t.Fatalf("commitment number = %s", got)
	}
}

func TestSyncUnitDeduplicatesContracts(t *testing.T) {
	h := newHarness(t, newFixture(`[{"id":13847}]`, `[{"id":13847}]`))
	summary, err := h.syncUnit(context.Background())
	if err != nil || summary.Requests != 2+7 {
		t.Fatalf("summary = %+v, err = %v", summary, err)
	}
}

func TestSyncUnitEmptyListingSucceeds(t *testing.T) {
	h := newHarness(t, newFixture(`[]`, `[]`))
	summary, err := h.syncUnit(context.Background())
	if err != nil || summary.Requests != 2 || summary.Status != "SUCCEEDED" {
		t.Fatalf("summary = %+v, err = %v", summary, err)
	}
}

func TestSyncUnitActiveListingFailureIsFatal(t *testing.T) {
	f := newFixture(`[{"id":13847}]`, `[]`)
	f.statuses["/api/contrato/ug/158148"] = http.StatusInternalServerError
	h := newHarness(t, f)
	summary, err := h.syncUnit(context.Background())
	if err == nil || summary.Status != "FAILED" || f.count("/api/contrato/13847/empenhos") != 0 {
		t.Fatalf("summary = %+v, err = %v", summary, err)
	}
}

func TestSyncUnitSubResourceFailureIsPartial(t *testing.T) {
	f := newFixture(`[{"id":13847}]`, `[]`)
	f.statuses["/api/contrato/13847/garantias"] = http.StatusInternalServerError
	h := newHarness(t, f)
	summary, err := h.syncUnit(context.Background())
	if err != nil || summary.Status != "PARTIAL" || summary.Failed != 1 {
		t.Fatalf("summary = %+v, err = %v", summary, err)
	}
}

func TestSyncUnitSubResourceNotFoundIsNotFailure(t *testing.T) {
	f := newFixture(`[{"id":13847}]`, `[]`)
	f.statuses["/api/contrato/13847/faturas"] = http.StatusNotFound
	h := newHarness(t, f)
	summary, err := h.syncUnit(context.Background())
	if err != nil || summary.Status != "SUCCEEDED" || summary.NotFound != 1 {
		t.Fatalf("summary = %+v, err = %v", summary, err)
	}
}

func TestSyncUnitSecondRunIsUnchanged(t *testing.T) {
	h := newHarness(t, newFixture(`[{"id":13847}]`, `[]`))
	if _, err := h.syncUnit(context.Background()); err != nil {
		t.Fatal(err)
	}
	before := testdb.Scalar(t, h.store.DB, `SELECT count(*) FROM public_sources.captures`)
	summary, err := h.syncUnit(context.Background())
	if err != nil || summary.Unchanged != summary.Requests || summary.Requests != 9 {
		t.Fatalf("summary = %+v, err = %v", summary, err)
	}
	if after := testdb.Scalar(t, h.store.DB, `SELECT count(*) FROM public_sources.captures`); after != before {
		t.Fatalf("captures grew from %s to %s", before, after)
	}
}

func TestSyncUnitStopsOnCancellation(t *testing.T) {
	f := newFixture(`[{"id":13847}]`, `[]`)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	f.onHit = func(path string) {
		if path == "/api/contrato/13847/historico" {
			cancel()
		}
	}
	h := newHarness(t, f)
	_, err := h.syncUnit(ctx)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	if f.count("/api/contrato/13847/empenhos") != 0 {
		t.Fatal("kept requesting after cancellation")
	}
}

func TestSyncContractCapturesContractAndSubResources(t *testing.T) {
	f := newFixture(`[]`, `[]`)
	f.bodies["/api/contrato/id/13847"] = `{"id":13847,"numero":"00004/2017"}`
	h := newHarness(t, f)
	summary, err := h.connector.SyncContract(context.Background(), h.run("13847"), 13847)
	if err != nil || summary.Requests != 8 || summary.Status != "SUCCEEDED" {
		t.Fatalf("summary = %+v, err = %v", summary, err)
	}
}

func TestSyncContractNotFound(t *testing.T) {
	f := newFixture(`[]`, `[]`)
	f.statuses["/api/contrato/id/999"] = http.StatusNotFound
	h := newHarness(t, f)
	summary, err := h.connector.SyncContract(context.Background(), h.run("999"), 999)
	if err == nil || summary.Status != "FAILED" || f.count("/api/contrato/999/empenhos") != 0 {
		t.Fatalf("summary = %+v, err = %v", summary, err)
	}
}

func TestValidUnitAndContractIDs(t *testing.T) {
	if !contratosgovbr.ValidUnit("158148") || !contratosgovbr.ValidUnit("015814") || contratosgovbr.ValidUnit("15814") || contratosgovbr.ValidUnit("15814a") {
		t.Fatal("unit validation")
	}
	ids, err := contratosgovbr.ContractIDs([]byte(`[{"id":13847},{"id":20001}]`))
	if err != nil || len(ids) != 2 || ids[0] != 13847 || ids[1] != 20001 {
		t.Fatalf("ids = %v, err = %v", ids, err)
	}
	for _, bad := range []string{`{}`, `[{"numero":"1"}]`, `[{"id":0}]`, `[{"id":"x"}]`} {
		if _, err := contratosgovbr.ContractIDs([]byte(bad)); err == nil || !strings.Contains(err.Error(), "listing") {
			t.Fatalf("accepted %s (err = %v)", bad, err)
		}
	}
}
