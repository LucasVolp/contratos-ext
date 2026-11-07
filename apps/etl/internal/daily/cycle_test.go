package daily_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"sync"
	"testing"
	"time"

	"contracts-ext/etl/internal/capture"
	"contracts-ext/etl/internal/daily"
	"contracts-ext/etl/internal/normalize"
	"contracts-ext/etl/internal/sources/contratosgovbr"
	"contracts-ext/etl/internal/testdb"
)

// appMigrations create the "Institution" table the cycle reads its units from.
var appMigrations = []string{"202610300001_initial", "202610310001_public_catalog", "202610310002_authentication", "202610310003_institution_organization"}

type noWaitGate struct{}

func (noWaitGate) Wait(context.Context) error                 { return nil }
func (noWaitGate) Block(context.Context, time.Duration) error { return nil }
func (noWaitGate) Delay(context.Context, time.Duration) error { return nil }

// source is a fake Contratos.gov.br: listed paths answer their body, every
// other path answers [].
type source struct {
	mu       sync.Mutex
	bodies   map[string]string
	statuses map[string]int
	hits     map[string]int
	onHit    func(path string)
}

func newSource() *source {
	return &source{bodies: map[string]string{}, statuses: map[string]int{}, hits: map[string]int{}}
}

func (s *source) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	s.hits[r.URL.Path]++
	status, body, onHit := s.statuses[r.URL.Path], s.bodies[r.URL.Path], s.onHit
	s.mu.Unlock()
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

func (s *source) count(path string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.hits[path]
}

// contract is a listing element in the source's nested shape.
func contract(id int64, unit, globalValue string) string {
	return fmt.Sprintf(`{"id":%d,"numero":"%05d/2024","contratante":{"orgao":{"codigo":"26421","unidade_gestora":{"codigo":%q}}},"valor_global":%q,"situacao":"Ativo"}`, id, id, unit, globalValue)
}

func newCycle(t *testing.T, s *source) *daily.Cycle {
	t.Helper()
	db := testdb.Isolated(t, append(appMigrations, testdb.Migration, testdb.ContractsMigration, testdb.SyncMigration)...)
	for _, uasg := range []string{"158454", "ABC", "158148"} {
		testdb.Exec(t, db, `INSERT INTO "Institution" (id, name, uasg, "updatedAt") VALUES (gen_random_uuid(), $1, $2, now())`, "Institution "+uasg, uasg)
	}
	server := httptest.NewTLSServer(s)
	t.Cleanup(server.Close)
	host, _ := url.Parse(server.URL)
	gate := noWaitGate{}
	store := &capture.Store{DB: db}
	return &daily.Cycle{
		DB:    db,
		Store: store,
		Connector: &contratosgovbr.Connector{
			Fetcher: &capture.Fetcher{
				Client:    capture.NewHTTPClient([]string{host.Host}, gate, 5*time.Second, server.Client().Transport),
				Gate:      gate,
				Retries:   1,
				MaxBytes:  1 << 20,
				UserAgent: "Mozilla/5.0 (compatible; contracts-ext-replicator/test)",
			},
			Store:   store,
			BaseURL: server.URL,
		},
		Normalizer: &normalize.Normalizer{DB: db, Source: contratosgovbr.Source},
		Version:    "test",
		Log:        slog.New(slog.DiscardHandler),
	}
}

func contractExists(t *testing.T, db *sql.DB, id int64) bool {
	t.Helper()
	return testdb.Scalar(t, db, `SELECT count(*) FROM public_sources.contracts WHERE source = $1 AND external_id = $2`, contratosgovbr.Source, id) == "1"
}

func TestCycleRunsEveryRegisteredUnit(t *testing.T) {
	s := newSource()
	s.bodies["/api/contrato/ug/158148"] = "[" + contract(10, "158148", "1.000,00") + "]"
	s.bodies["/api/contrato/ug/158454"] = "[" + contract(20, "158454", "2.000,00") + "]"
	cycle := newCycle(t, s)
	result, err := cycle.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "COMPLETED" || len(result.Units) != 2 || result.FailedUnits != 0 {
		t.Fatalf("result = %+v", result)
	}
	if result.Units[0].Unit != "158148" || result.Units[1].Unit != "158454" || result.Units[0].Normalization.Normalized != 1 {
		t.Fatalf("units = %+v", result.Units)
	}
	if !contractExists(t, cycle.DB, 10) || !contractExists(t, cycle.DB, 20) {
		t.Fatal("contracts of both units must be normalized")
	}
	daily := strconv.FormatInt(result.DailyRunID, 10)
	if got := testdb.Scalar(t, cycle.DB, `SELECT count(*) FROM public_sources.capture_runs WHERE daily_run_id = $1 AND trigger = 'SCHEDULED' AND status = 'SUCCEEDED'`, daily); got != "2" {
		t.Fatalf("capture runs of the daily run = %s", got)
	}
	if got := testdb.Scalar(t, cycle.DB, `SELECT status || ' ' || unit_count || ' ' || failed_unit_count || ' ' || (finished_at IS NOT NULL) FROM public_sources.daily_runs WHERE id = $1`, daily); got != "COMPLETED 2 0 true" {
		t.Fatalf("daily run = %s", got)
	}
	if s.count("/api/contrato/ug/ABC") != 0 {
		t.Fatal("an invalid UASG must not reach the source")
	}
}

func TestCycleContinuesAfterUnitFailure(t *testing.T) {
	s := newSource()
	s.statuses["/api/contrato/ug/158148"] = http.StatusInternalServerError
	s.bodies["/api/contrato/ug/158454"] = "[" + contract(20, "158454", "2.000,00") + "]"
	cycle := newCycle(t, s)
	result, err := cycle.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "COMPLETED" || result.FailedUnits != 1 || len(result.Units) != 2 || result.Units[0].Capture.Status != "FAILED" {
		t.Fatalf("result = %+v", result)
	}
	if got := s.count("/api/contrato/ug/158148"); got != 2 {
		t.Fatalf("failed listing requested %d times, want every retry", got)
	}
	if !contractExists(t, cycle.DB, 20) {
		t.Fatal("the unit after the failed one must be normalized")
	}
	if got := testdb.Scalar(t, cycle.DB, `SELECT failed_unit_count FROM public_sources.daily_runs WHERE id = $1`, result.DailyRunID); got != "1" {
		t.Fatalf("failed_unit_count = %s", got)
	}
}

func TestDuePolicy(t *testing.T) {
	s := newSource()
	element := contract(30, "158148", "1.000,00")
	s.bodies["/api/contrato/inativo/ug/158148"] = "[" + element + "]"
	s.bodies["/api/contrato/ug/158454"] = "[" + contract(40, "158454", "4.000,00") + "]"
	cycle := newCycle(t, s)
	for range 2 {
		if result, err := cycle.Run(context.Background()); err != nil || result.Status != "COMPLETED" || result.FailedUnits != 0 {
			t.Fatalf("result = %+v, err = %v", result, err)
		}
	}
	if got := s.count("/api/contrato/30/historico"); got != 1 {
		t.Fatalf("unchanged inactive contract refreshed %d times in two cycles, want 1", got)
	}
	if got := s.count("/api/contrato/40/historico"); got != 2 {
		t.Fatalf("active contract refreshed %d times in two cycles, want 2", got)
	}

	due := daily.DuePolicy(cycle.DB, contratosgovbr.Source, time.Now, daily.InactiveMaxAge)
	check := func(name string, c contratosgovbr.Listed, want bool) {
		t.Helper()
		got, err := due(context.Background(), c)
		if err != nil || got != want {
			t.Fatalf("%s: due = %v, err = %v, want %v", name, got, err, want)
		}
	}
	check("unchanged inactive", contratosgovbr.Listed{ID: 30, Element: []byte(element)}, false)
	check("changed element", contratosgovbr.Listed{ID: 30, Element: []byte(contract(30, "158148", "9.000,00"))}, true)
	check("active", contratosgovbr.Listed{ID: 30, Active: true, Element: []byte(element)}, true)
	check("unknown", contratosgovbr.Listed{ID: 999, Element: []byte(contract(999, "158148", "1,00"))}, true)
	testdb.Exec(t, cycle.DB, `UPDATE public_sources.contract_parts SET status = 'MISSING' WHERE contract_external_id = 30 AND part = 'files'`)
	check("missing part", contratosgovbr.Listed{ID: 30, Element: []byte(element)}, true)
	testdb.Exec(t, cycle.DB, `UPDATE public_sources.contract_parts SET status = 'AVAILABLE' WHERE contract_external_id = 30`)
	testdb.Exec(t, cycle.DB, `DELETE FROM public_sources.contract_parts WHERE contract_external_id = 30 AND part = 'files'`)
	check("absent part", contratosgovbr.Listed{ID: 30, Element: []byte(element)}, true)
	if _, err := cycle.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	check("refreshed", contratosgovbr.Listed{ID: 30, Element: []byte(element)}, false)
	// A failed refresh keeps a fresh last_attempt_at, but must be retried on the next cycle.
	testdb.Exec(t, cycle.DB, `UPDATE public_sources.contract_parts SET status = 'FAILED', last_error = 'source returned HTTP 500' WHERE contract_external_id = 30 AND part = 'guarantees'`)
	check("failed part", contratosgovbr.Listed{ID: 30, Element: []byte(element)}, true)
	before := s.count("/api/contrato/30/garantias")
	if _, err := cycle.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := s.count("/api/contrato/30/garantias"); got != before+1 {
		t.Fatalf("failed part requested %d times after the retry cycle, want %d", got, before+1)
	}
	check("retried", contratosgovbr.Listed{ID: 30, Element: []byte(element)}, false)
	testdb.Exec(t, cycle.DB, `UPDATE public_sources.contract_parts SET last_attempt_at = now() - interval '31 days' WHERE contract_external_id = 30`)
	check("stale parts", contratosgovbr.Listed{ID: 30, Element: []byte(element)}, true)
}

func TestCycleCancelled(t *testing.T) {
	s := newSource()
	s.bodies["/api/contrato/ug/158148"] = "[" + contract(10, "158148", "1.000,00") + "]"
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s.onHit = func(path string) {
		if path == "/api/contrato/ug/158454" {
			cancel()
		}
	}
	cycle := newCycle(t, s)
	result, err := cycle.Run(ctx)
	if !errors.Is(err, context.Canceled) || result.Status != "CANCELLED" {
		t.Fatalf("result = %+v, err = %v", result, err)
	}
	if got := testdb.Scalar(t, cycle.DB, `SELECT status || ' ' || (finished_at IS NOT NULL) FROM public_sources.daily_runs WHERE id = $1`, result.DailyRunID); got != "CANCELLED true" {
		t.Fatalf("daily run = %s", got)
	}
	if got := testdb.Scalar(t, cycle.DB, `SELECT status FROM public_sources.capture_runs WHERE daily_run_id = $1 AND target_code = '158454'`, result.DailyRunID); got != "FAILED" {
		t.Fatalf("cancelled unit capture run = %s", got)
	}
}
