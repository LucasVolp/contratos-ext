package capture_test

import (
	"context"
	"errors"
	"testing"

	"contracts-ext/etl/internal/capture"
	"contracts-ext/etl/internal/testdb"
)

func result(t *testing.T, body string) capture.Result {
	t.Helper()
	canonical, hash, err := capture.Canonicalize([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	return capture.Result{Status: 200, Canonical: canonical, Hash: hash}
}

func TestStoreRecordsOutcomes(t *testing.T) {
	db := testdb.Isolated(t, testdb.Migration)
	ctx := context.Background()
	store := &capture.Store{DB: db}
	run, err := store.StartRun(ctx, capture.RunStart{Source: "CONTRATOS_GOV_BR", Trigger: "MANUAL", TargetType: "CONTRACT", TargetCode: "13847", Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	req := capture.Request{Resource: "contract_commitments", Path: "/api/contrato/13847/empenhos"}
	a, b := result(t, `[{"numero":"2022NE000066"}]`), result(t, `[{"numero":"2022NE000066"},{"numero":"2023NE000001"}]`)
	inputs := []capture.Result{a, a, b, a, {Status: 404, NotFound: true}, {Status: 500, Err: errors.New("source returned HTTP 500")}}
	want := []capture.Outcome{capture.Captured, capture.Unchanged, capture.Captured, capture.Captured, capture.NotFound, capture.Failed}
	var summary capture.RunSummary
	for i, input := range inputs {
		outcome, err := store.Record(ctx, run, "CONTRATOS_GOV_BR", req, input)
		if err != nil {
			t.Fatal(err)
		}
		if outcome != want[i] {
			t.Fatalf("record %d outcome = %s, want %s", i, outcome, want[i])
		}
		summary.Add(outcome)
	}
	if got := testdb.Scalar(t, db, `SELECT count(*) FROM public_sources.captures`); got != "2" {
		t.Fatalf("captures = %s, want 2", got)
	}
	if got := testdb.Scalar(t, db, `SELECT payload::text FROM public_sources.latest_captures WHERE request_key = $1`, req.Key()); got != `[{"numero": "2022NE000066"}]` {
		t.Fatalf("latest payload = %s", got)
	}
	if got := testdb.Scalar(t, db, `SELECT count(*) FROM public_sources.capture_attempts WHERE run_id = $1`, run); got != "6" {
		t.Fatalf("attempts = %s, want 6", got)
	}
	if got := testdb.Scalar(t, db, `SELECT error FROM public_sources.capture_attempts WHERE outcome = 'FAILED'`); got != "source returned HTTP 500" {
		t.Fatalf("failed attempt error = %s", got)
	}
	summary.Status = "PARTIAL"
	if err := store.FinishRun(ctx, run, summary); err != nil {
		t.Fatal(err)
	}
	row := testdb.Scalar(t, db, `SELECT concat_ws(',', status, request_count, captured_count, unchanged_count, not_found_count, failed_count, finished_at IS NOT NULL)
		FROM public_sources.capture_runs WHERE id = $1`, run)
	if row != "PARTIAL,6,3,1,1,1,t" {
		t.Fatalf("run row = %s", row)
	}
}
