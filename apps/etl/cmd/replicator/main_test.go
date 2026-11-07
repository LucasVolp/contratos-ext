package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

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
