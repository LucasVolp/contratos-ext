package main

import (
	"bytes"
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"contracts-ext/etl/internal/testdb"
)

func TestParseSyncValidation(t *testing.T) {
	accepted := [][]string{
		{"-source", "CONTRATOS_GOV_BR", "-unit", "158148"},
		{"-source", "CONTRATOS_GOV_BR", "-contract", "13847", "-trigger", "SCHEDULED"},
		{"-source", "CONTRATOS_GOV_BR", "-unit", "015814", "-inactive=false", "-retries", "0", "-interval", "2500ms"},
	}
	for _, args := range accepted {
		if _, err := parseSync(args); err != nil {
			t.Fatalf("%v rejected: %v", args, err)
		}
	}
	rejected := [][]string{
		{"-source", "CONTRATOS_GOV_BR"},
		{"-source", "CONTRATOS_GOV_BR", "-unit", "158148", "-contract", "13847"},
		{"-source", "CONTRATOS_GOV_BR", "-unit", "15814"},
		{"-source", "PNCP", "-unit", "158148"},
		{"-source", "CONTRATOS_GOV_BR", "-unit", "158148", "-retries", "4"},
		{"-source", "CONTRATOS_GOV_BR", "-unit", "158148", "-interval", "500ms"},
		{"-source", "CONTRATOS_GOV_BR", "-unit", "158148", "-interval", "31s"},
		{"-source", "CONTRATOS_GOV_BR", "-unit", "158148", "-interval", "1500us"},
		{"-source", "CONTRATOS_GOV_BR", "-unit", "158148", "-trigger", "REQUESTED"},
		{"-source", "CONTRATOS_GOV_BR", "-contract", "-5"},
		{"-source", "CONTRATOS_GOV_BR", "-unit", "158148", "extra"},
	}
	for _, args := range rejected {
		if _, err := parseSync(args); err == nil {
			t.Fatalf("%v accepted", args)
		}
	}
	plan, _ := parseSync([]string{"-source", "CONTRATOS_GOV_BR", "-unit", "158148"})
	if !plan.inactive || plan.trigger != "MANUAL" || plan.retries != 3 || plan.interval.String() != "1s" {
		t.Fatalf("defaults = %+v", plan)
	}
}

// useDatabase points DATABASE_URL at the named isolated database.
func useDatabase(t *testing.T, name string) {
	t.Helper()
	parsed, err := url.Parse(os.Getenv("ETL_TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	parsed.Path = "/" + name
	t.Setenv("DATABASE_URL", parsed.String())
}

func TestExecuteRequiresMigration(t *testing.T) {
	db := testdb.Isolated(t)
	useDatabase(t, testdb.Scalar(t, db, "SELECT current_database()"))
	var stdout, stderr bytes.Buffer
	code := execute(context.Background(), []string{"sync", "-source", "CONTRATOS_GOV_BR", "-unit", "158148"}, &stdout, &stderr)
	if code != 1 || !strings.Contains(stderr.String(), "run pnpm db:migrate") {
		t.Fatalf("code = %d, stderr = %q", code, stderr.String())
	}
}

func TestExecuteReportsConnectionErrors(t *testing.T) {
	if os.Getenv("ETL_TEST_DATABASE_URL") == "" {
		t.Skip("ETL_TEST_DATABASE_URL is required for PostgreSQL integration tests")
	}
	useDatabase(t, "database_that_does_not_exist")
	var stdout, stderr bytes.Buffer
	code := execute(context.Background(), []string{"sync", "-source", "CONTRATOS_GOV_BR", "-unit", "158148"}, &stdout, &stderr)
	if code != 1 || strings.Contains(stderr.String(), "db:migrate") || !strings.Contains(stderr.String(), "connect to PostgreSQL") {
		t.Fatalf("code = %d, stderr = %q", code, stderr.String())
	}
}

func TestExecuteRejectsUnknownCommand(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := execute(context.Background(), []string{"normalize"}, &stdout, &stderr); code != 1 || !strings.Contains(stderr.String(), "usage") {
		t.Fatalf("code = %d, stderr = %q", code, stderr.String())
	}
}

func TestExecuteCancelledRunIsRecorded(t *testing.T) {
	db := testdb.Isolated(t, testdb.Migration, testdb.ContractsMigration, testdb.SyncMigration)
	useDatabase(t, testdb.Scalar(t, db, "SELECT current_database()"))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/contrato/id/13847" {
			cancel()
		}
		_, _ = w.Write([]byte(`{"id":13847}`))
	}))
	defer server.Close()
	previousURL, previousTransport := sourceBaseURL, sourceTransport
	sourceBaseURL, sourceTransport = server.URL, server.Client().Transport
	t.Cleanup(func() { sourceBaseURL, sourceTransport = previousURL, previousTransport })
	var stdout, stderr bytes.Buffer
	code := execute(ctx, []string{"sync", "-source", "CONTRATOS_GOV_BR", "-contract", "13847"}, &stdout, &stderr)
	if code != 1 {
		t.Fatalf("code = %d, stderr = %q", code, stderr.String())
	}
	row := testdb.Scalar(t, db, `SELECT concat_ws(',', count(*), min(status), min(error), bool_and(finished_at IS NOT NULL)) FROM public_sources.capture_runs`)
	if row != "1,FAILED,cancelled,t" {
		t.Fatalf("run row = %s", row)
	}
	if !strings.Contains(stdout.String(), `"status":"FAILED"`) {
		t.Fatalf("stdout = %q", stdout.String())
	}
}

func TestExecuteSyncsContract(t *testing.T) {
	db := testdb.Isolated(t, testdb.Migration, testdb.ContractsMigration, testdb.SyncMigration)
	useDatabase(t, testdb.Scalar(t, db, "SELECT current_database()"))
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/contrato/id/13847" {
			_, _ = w.Write([]byte(`{"id":13847}`))
			return
		}
		_, _ = w.Write([]byte(`[]`))
	}))
	defer server.Close()
	previousURL, previousTransport := sourceBaseURL, sourceTransport
	sourceBaseURL, sourceTransport = server.URL, server.Client().Transport
	t.Cleanup(func() { sourceBaseURL, sourceTransport = previousURL, previousTransport })
	var stdout, stderr bytes.Buffer
	// One-second spacing makes eight requests take about seven seconds; that is
	// acceptable here and proves the production gate is wired in.
	code := execute(context.Background(), []string{"sync", "-source", "CONTRATOS_GOV_BR", "-contract", "13847", "-normalize=false"}, &stdout, &stderr)
	if code != 0 || !strings.Contains(stdout.String(), `"status":"SUCCEEDED"`) || !strings.Contains(stdout.String(), `"requests":8`) {
		t.Fatalf("code = %d, stdout = %q, stderr = %q", code, stdout.String(), stderr.String())
	}
}

func TestParseDailyValidation(t *testing.T) {
	accepted := [][]string{
		{"-source", "CONTRATOS_GOV_BR"},
		{"-source", "CONTRATOS_GOV_BR", "-once", "-at", "23:30", "-timezone", "UTC", "-retries", "0", "-interval", "2s"},
	}
	for _, args := range accepted {
		if _, err := parseDaily(args); err != nil {
			t.Fatalf("%v rejected: %v", args, err)
		}
	}
	rejected := [][]string{
		{},
		{"-source", "PNCP"},
		{"-source", "CONTRATOS_GOV_BR", "-at", "25:00"},
		{"-source", "CONTRATOS_GOV_BR", "-timezone", "Mars/Olympus"},
		{"-source", "CONTRATOS_GOV_BR", "-retries", "4"},
		{"-source", "CONTRATOS_GOV_BR", "-interval", "500ms"},
		{"-source", "CONTRATOS_GOV_BR", "extra"},
	}
	for _, args := range rejected {
		if _, err := parseDaily(args); err == nil {
			t.Fatalf("%v accepted", args)
		}
	}
	plan, _ := parseDaily([]string{"-source", "CONTRATOS_GOV_BR"})
	if plan.once || plan.at != "03:00" || plan.timezone != "America/Sao_Paulo" || plan.retries != 3 || plan.interval.String() != "1s" {
		t.Fatalf("defaults = %+v", plan)
	}
}

func TestDailyRequiresSource(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := execute(context.Background(), []string{"daily"}, &stdout, &stderr); code != 1 || !strings.Contains(stderr.String(), "usage") {
		t.Fatalf("code = %d, stderr = %q", code, stderr.String())
	}
}

// useDailySource prepares an isolated database with one registered institution
// and a fake source that lists no contracts.
func useDailySource(t *testing.T) *sql.DB {
	t.Helper()
	db := testdb.Isolated(t, "202610300001_initial", "202610310001_public_catalog", "202610310002_authentication",
		"202610310003_institution_organization", testdb.Migration, testdb.ContractsMigration, testdb.SyncMigration)
	useDatabase(t, testdb.Scalar(t, db, "SELECT current_database()"))
	testdb.Exec(t, db, `INSERT INTO "Institution" (id, name, uasg, "updatedAt") VALUES (gen_random_uuid(), 'Institution 158148', '158148', now())`)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[]`))
	}))
	t.Cleanup(server.Close)
	previousURL, previousTransport := sourceBaseURL, sourceTransport
	sourceBaseURL, sourceTransport = server.URL, server.Client().Transport
	t.Cleanup(func() { sourceBaseURL, sourceTransport = previousURL, previousTransport })
	return db
}

func TestDailyOnce(t *testing.T) {
	db := useDailySource(t)
	var stdout, stderr bytes.Buffer
	code := execute(context.Background(), []string{"daily", "-source", "CONTRATOS_GOV_BR", "-once"}, &stdout, &stderr)
	if code != 0 || !strings.Contains(stdout.String(), `"status":"COMPLETED"`) || !strings.Contains(stdout.String(), `"unit":"158148"`) {
		t.Fatalf("code = %d, stdout = %q, stderr = %q", code, stdout.String(), stderr.String())
	}
	if got := testdb.Scalar(t, db, `SELECT string_agg(status, ',') FROM public_sources.daily_runs`); got != "COMPLETED" {
		t.Fatalf("daily runs = %s", got)
	}
}

func TestDailyOnceFailsWhileAnotherRunHoldsTheLock(t *testing.T) {
	db := useDailySource(t)
	holder, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Close()
	if _, err := holder.ExecContext(context.Background(), `SELECT pg_advisory_lock(hashtext('public_sources.daily:CONTRATOS_GOV_BR'))`); err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	code := execute(context.Background(), []string{"daily", "-source", "CONTRATOS_GOV_BR", "-once"}, &stdout, &stderr)
	if code != 1 || !strings.Contains(stderr.String(), "another daily run is in progress") || stdout.Len() != 0 {
		t.Fatalf("code = %d, stdout = %q, stderr = %q", code, stdout.String(), stderr.String())
	}
	if got := testdb.Scalar(t, db, `SELECT count(*) FROM public_sources.daily_runs`); got != "0" {
		t.Fatalf("daily runs = %s", got)
	}
}

func TestDailyScheduleStopsOnSignalWithExitZero(t *testing.T) {
	db := useDailySource(t)
	testdb.Exec(t, db, `INSERT INTO public_sources.daily_runs (source, status, etl_version, finished_at)
		VALUES ('CONTRATOS_GOV_BR', 'COMPLETED', 'test', now() - interval '1 hour')`)
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	var stdout, stderr bytes.Buffer
	code := execute(ctx, []string{"daily", "-source", "CONTRATOS_GOV_BR"}, &stdout, &stderr)
	if code != 0 || !strings.Contains(stderr.String(), "Waiting for the next daily run") {
		t.Fatalf("code = %d, stdout = %q, stderr = %q", code, stdout.String(), stderr.String())
	}
}

func TestParseNormalizeValidation(t *testing.T) {
	for _, args := range [][]string{
		{"-source", "CONTRATOS_GOV_BR", "-unit", "158148"},
		{"-source", "CONTRATOS_GOV_BR", "-contract", "13847"},
		{"-source", "CONTRATOS_GOV_BR", "-all"},
	} {
		if _, err := parseNormalize(args); err != nil {
			t.Fatalf("%v rejected: %v", args, err)
		}
	}
	for _, args := range [][]string{
		{"-source", "CONTRATOS_GOV_BR"},
		{"-source", "CONTRATOS_GOV_BR", "-unit", "158148", "-all"},
		{"-source", "CONTRATOS_GOV_BR", "-unit", "1581"},
		{"-source", "PNCP", "-all"},
		{"-source", "CONTRATOS_GOV_BR", "-contract", "-1"},
	} {
		if _, err := parseNormalize(args); err == nil {
			t.Fatalf("%v accepted", args)
		}
	}
}

func TestExecuteSyncNormalizes(t *testing.T) {
	db := testdb.Isolated(t, testdb.Migration, testdb.ContractsMigration, testdb.SyncMigration)
	useDatabase(t, testdb.Scalar(t, db, "SELECT current_database()"))
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/contrato/id/13847" {
			_, _ = w.Write([]byte(`[{"id":13847,"numero":"00004/2017","unidade_codigo":"158148","valor_global":"682.318,13"}]`))
			return
		}
		_, _ = w.Write([]byte(`[]`))
	}))
	defer server.Close()
	previousURL, previousTransport := sourceBaseURL, sourceTransport
	sourceBaseURL, sourceTransport = server.URL, server.Client().Transport
	t.Cleanup(func() { sourceBaseURL, sourceTransport = previousURL, previousTransport })
	var stdout, stderr bytes.Buffer
	code := execute(context.Background(), []string{"sync", "-source", "CONTRATOS_GOV_BR", "-contract", "13847"}, &stdout, &stderr)
	if code != 0 || !strings.Contains(stdout.String(), `"normalization":{"normalized":1`) {
		t.Fatalf("code = %d, stdout = %q, stderr = %q", code, stdout.String(), stderr.String())
	}
	if got := testdb.Scalar(t, db, "SELECT global_value::text FROM public_sources.contracts"); got != "682318.130000" {
		t.Fatalf("global value = %s", got)
	}
}

func TestExecuteNormalizeWithoutSyncSkips(t *testing.T) {
	db := testdb.Isolated(t, testdb.Migration, testdb.ContractsMigration, testdb.SyncMigration)
	useDatabase(t, testdb.Scalar(t, db, "SELECT current_database()"))
	var stdout, stderr bytes.Buffer
	code := execute(context.Background(), []string{"normalize", "-source", "CONTRATOS_GOV_BR", "-contract", "999"}, &stdout, &stderr)
	if code != 0 || !strings.Contains(stdout.String(), `"skipped":1`) {
		t.Fatalf("code = %d, stdout = %q, stderr = %q", code, stdout.String(), stderr.String())
	}
}

func TestExecuteRequiresContractsMigration(t *testing.T) {
	db := testdb.Isolated(t, testdb.Migration)
	useDatabase(t, testdb.Scalar(t, db, "SELECT current_database()"))
	var stdout, stderr bytes.Buffer
	code := execute(context.Background(), []string{"normalize", "-source", "CONTRATOS_GOV_BR", "-all"}, &stdout, &stderr)
	if code != 1 || !strings.Contains(stderr.String(), "202611080001_public_sources_contracts") {
		t.Fatalf("code = %d, stderr = %q", code, stderr.String())
	}
}
