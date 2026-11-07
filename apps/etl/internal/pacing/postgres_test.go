package pacing_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"contracts-ext/etl/internal/pacing"
	"contracts-ext/etl/internal/testdb"
)

const source = "CONTRATOS_GOV_BR"

var policy = pacing.Policy{Minimum: time.Second, Maximum: 30 * time.Second, BlockPause: 5*time.Minute + time.Second}

func TestPostgresGatePersistsAcrossConnections(t *testing.T) {
	db := testdb.Isolated(t, testdb.Migration)
	ctx := context.Background()
	first, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	a := &pacing.PostgresGate{DB: first, Source: source, Policy: policy}
	b := &pacing.PostgresGate{DB: second, Source: source, Policy: policy}
	if err := a.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	stamp := testdb.Scalar(t, db, "SELECT last_request_at::text FROM public_sources.source_pacing WHERE source = $1", source)
	waiting, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
	err = b.Wait(waiting)
	cancel()
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("second connection bypassed request spacing: %v", err)
	}
	if testdb.Scalar(t, db, "SELECT last_request_at::text FROM public_sources.source_pacing WHERE source = $1", source) != stamp {
		t.Fatal("cancelled waiter reserved a future request")
	}
	if err := a.Block(ctx, 0); err != nil {
		t.Fatal(err)
	}
	if got := testdb.Scalar(t, db, "SELECT penalty_interval_ms FROM public_sources.source_pacing WHERE source = $1", source); got != "2000" {
		t.Fatalf("adaptive interval = %s ms, want 2000", got)
	}
	blocked := testdb.Scalar(t, db, "SELECT blocked_until::text FROM public_sources.source_pacing WHERE source = $1", source)
	if err := b.Block(ctx, 0); err != nil {
		t.Fatal(err)
	}
	if testdb.Scalar(t, db, "SELECT blocked_until::text FROM public_sources.source_pacing WHERE source = $1", source) != blocked {
		t.Fatal("duplicate block restarted cooldown")
	}
	restarted := &pacing.PostgresGate{DB: db, Source: source, Policy: policy}
	waiting, cancel = context.WithTimeout(ctx, 50*time.Millisecond)
	err = restarted.Wait(waiting)
	cancel()
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("fresh gate discarded persistent cooldown")
	}
	testdb.Exec(t, db, `UPDATE public_sources.source_pacing SET last_request_at = clock_timestamp() - interval '1 minute',
		blocked_until = '1970-01-01', rate_limited_until = clock_timestamp() - interval '1 minute' WHERE source = $1`, source)
	if err := restarted.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	if got := testdb.Scalar(t, db, "SELECT penalty_interval_ms FROM public_sources.source_pacing WHERE source = $1", source); got != "2000" {
		t.Fatalf("restart reset the adaptive interval to %s ms", got)
	}
}

func TestPostgresGateMinimumIsNotPersisted(t *testing.T) {
	db := testdb.Isolated(t, testdb.Migration)
	slow := policy
	slow.Minimum = 30 * time.Second
	gate := &pacing.PostgresGate{DB: db, Source: source, Policy: slow}
	if err := gate.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := testdb.Scalar(t, db, "SELECT penalty_interval_ms FROM public_sources.source_pacing WHERE source = $1", source); got != "0" {
		t.Fatalf("a run's -interval was persisted as %s ms", got)
	}
}

func TestPostgresGateDelayPostponesRequests(t *testing.T) {
	db := testdb.Isolated(t, testdb.Migration)
	ctx := context.Background()
	gate := &pacing.PostgresGate{DB: db, Source: source, Policy: policy}
	if err := gate.Delay(ctx, time.Minute); err != nil {
		t.Fatal(err)
	}
	waiting, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
	defer cancel()
	if err := gate.Wait(waiting); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("delay was not honored: %v", err)
	}
}

func TestPostgresGateUnknownSource(t *testing.T) {
	db := testdb.Isolated(t, testdb.Migration)
	gate := &pacing.PostgresGate{DB: db, Source: "NOPE", Policy: policy}
	err := gate.Wait(context.Background())
	if err == nil || !strings.Contains(err.Error(), "not installed") {
		t.Fatalf("unknown source error = %v", err)
	}
}
