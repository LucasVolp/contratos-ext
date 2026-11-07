package testdb_test

import (
	"testing"

	"contracts-ext/etl/internal/testdb"
)

func TestPublicSourcesMigration(t *testing.T) {
	db := testdb.Isolated(t, testdb.Migration)
	if got := testdb.Scalar(t, db, `SELECT penalty_interval_ms FROM public_sources.source_pacing WHERE source = 'CONTRATOS_GOV_BR'`); got != "0" {
		t.Fatalf("seed penalty interval = %s, want 0", got)
	}
	if _, err := db.Exec(`INSERT INTO public_sources.capture_runs (source, trigger, target_type, target_code, etl_version, finished_at)
		VALUES ('X', 'MANUAL', 'CONTRACT', '1', 't', now())`); err == nil {
		t.Fatal("RUNNING run accepted finished_at")
	}
	if _, err := db.Exec(`INSERT INTO public_sources.capture_runs (source, trigger, target_type, target_code, etl_version, status)
		VALUES ('X', 'MANUAL', 'CONTRACT', '1', 't', 'SUCCEEDED')`); err == nil {
		t.Fatal("finished run accepted without finished_at")
	}
	run := testdb.Scalar(t, db, `INSERT INTO public_sources.capture_runs (source, trigger, target_type, target_code, etl_version)
		VALUES ('X', 'MANUAL', 'CONTRACT', '1', 't') RETURNING id`)
	if _, err := db.Exec(`INSERT INTO public_sources.capture_attempts (run_id, source, resource, request_key, outcome)
		VALUES ($1, 'X', 'contract', '/api/contrato/id/1', 'CAPTURED')`, run); err == nil {
		t.Fatal("CAPTURED attempt accepted without capture")
	}
	testdb.Exec(t, db, `INSERT INTO public_sources.capture_attempts (run_id, source, resource, request_key, outcome, error)
		VALUES ($1, 'X', 'contract', '/api/contrato/id/1', 'FAILED', 'boom')`, run)
	if got := testdb.Scalar(t, db, `SELECT count(*) FROM public_sources.latest_captures`); got != "0" {
		t.Fatalf("latest_captures = %s rows, want 0", got)
	}
}
