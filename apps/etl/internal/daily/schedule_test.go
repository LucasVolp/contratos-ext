package daily_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"contracts-ext/etl/internal/daily"
	"contracts-ext/etl/internal/sources/contratosgovbr"
	"contracts-ext/etl/internal/testdb"
)

func TestNextRun(t *testing.T) {
	saoPaulo, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name string
		now  string
		want string
	}{
		{"before the time", "2026-11-07T02:59:00-03:00", "2026-11-07T03:00:00-03:00"},
		{"exactly at the time", "2026-11-07T03:00:00-03:00", "2026-11-08T03:00:00-03:00"},
		{"after the time", "2026-11-07T23:00:00-03:00", "2026-11-08T03:00:00-03:00"},
		{"given in UTC", "2026-11-07T05:59:00Z", "2026-11-07T03:00:00-03:00"},
	}
	for _, c := range cases {
		now, err := time.Parse(time.RFC3339, c.now)
		if err != nil {
			t.Fatal(err)
		}
		got, err := daily.NextRun(now, "03:00", saoPaulo)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if got.Format(time.RFC3339) != c.want {
			t.Fatalf("%s: next run = %s, want %s", c.name, got.Format(time.RFC3339), c.want)
		}
	}
	for _, at := range []string{"25:00", "3:00", "03:60", "0300", "", "03:00:00", "ab:cd"} {
		if _, err := daily.NextRun(time.Now(), at, saoPaulo); err == nil {
			t.Fatalf("%q accepted", at)
		}
	}
}

func TestRunOnStart(t *testing.T) {
	cycle := newCycle(t, newSource())
	db := cycle.DB
	now := time.Now()
	check := func(name string, want bool) {
		t.Helper()
		got, err := daily.RunOnStart(context.Background(), db, contratosgovbr.Source, now)
		if err != nil || got != want {
			t.Fatalf("%s: RunOnStart = %v, err = %v, want %v", name, got, err, want)
		}
	}
	check("no runs", true)
	insert := func(status string, finishedAgo string) {
		t.Helper()
		testdb.Exec(t, db, `INSERT INTO public_sources.daily_runs (source, status, etl_version, started_at, finished_at)
			VALUES ($1, $2, 'test', now() - $3::interval, now() - $3::interval)`, contratosgovbr.Source, status, finishedAgo)
	}
	insert("CANCELLED", "1 hour")
	check("cancelled cycle is not completed", true)
	insert("FAILED", "1 hour")
	check("failed cycle is not completed", true)
	insert("COMPLETED", "25 hours")
	check("completed cycle older than 24 hours", true)
	insert("COMPLETED", "2 hours")
	check("completed cycle 2 hours ago", false)
}

func TestRunLockedSkipsWhileHeld(t *testing.T) {
	cycle := newCycle(t, newSource())
	const lock = `'public_sources.daily:' || $1::text`
	holder, err := cycle.DB.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Close()
	if _, err := holder.ExecContext(context.Background(), `SELECT pg_advisory_lock(hashtext(`+lock+`))`, contratosgovbr.Source); err != nil {
		t.Fatal(err)
	}
	result, ran, err := cycle.RunLocked(context.Background())
	if err != nil || ran {
		t.Fatalf("second cycle is skipped while the lock is held: ran = %v, err = %v", ran, err)
	}
	if result.DailyRunID != 0 || testdb.Scalar(t, cycle.DB, `SELECT count(*) FROM public_sources.daily_runs`) != "0" {
		t.Fatalf("a skipped cycle must not create a daily run: %+v", result)
	}
	if _, err := holder.ExecContext(context.Background(), `SELECT pg_advisory_unlock(hashtext(`+lock+`))`, contratosgovbr.Source); err != nil {
		t.Fatal(err)
	}
	result, ran, err = cycle.RunLocked(context.Background())
	if err != nil || !ran || result.Status != "COMPLETED" {
		t.Fatalf("cycle after the lock is released: ran = %v, result = %+v, err = %v", ran, result, err)
	}
	var free bool
	if err := holder.QueryRowContext(context.Background(), `SELECT pg_try_advisory_lock(hashtext(`+lock+`))`, contratosgovbr.Source).Scan(&free); err != nil || !free {
		t.Fatalf("RunLocked must release the lock when it ends: free = %v, err = %v", free, err)
	}
}

func TestServeStopsOnCancellationAfterRecordingIt(t *testing.T) {
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
	err := cycle.Serve(ctx, "03:00", time.UTC)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Serve = %v, want context.Canceled", err)
	}
	if got := testdb.Scalar(t, cycle.DB, `SELECT string_agg(status, ',') FROM public_sources.daily_runs`); got != "CANCELLED" {
		t.Fatalf("daily runs = %s, want the cancelled cycle recorded", got)
	}
}

func TestServeSkipsStartCycleAfterRecentCompletion(t *testing.T) {
	cycle := newCycle(t, newSource())
	testdb.Exec(t, cycle.DB, `INSERT INTO public_sources.daily_runs (source, status, etl_version, finished_at)
		VALUES ($1, 'COMPLETED', 'test', now() - interval '1 hour')`, contratosgovbr.Source)
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	if err := cycle.Serve(ctx, "03:00", time.UTC); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Serve = %v, want the context error", err)
	}
	if got := testdb.Scalar(t, cycle.DB, `SELECT count(*) FROM public_sources.daily_runs`); got != "1" {
		t.Fatalf("daily runs = %s, want no start cycle after a recent completion", got)
	}
}

func TestRunLockedMarksInterruptedRunsFailed(t *testing.T) {
	cycle := newCycle(t, newSource())
	db := cycle.DB
	old := testdb.Scalar(t, db, `INSERT INTO public_sources.daily_runs (source, etl_version, started_at)
		VALUES ($1, 'test', now() - interval '2 days') RETURNING id`, contratosgovbr.Source)
	testdb.Exec(t, db, `INSERT INTO public_sources.capture_runs (source, trigger, target_type, target_code, etl_version, daily_run_id)
		VALUES ($1, 'SCHEDULED', 'MANAGEMENT_UNIT', '158148', 'test', $2)`, contratosgovbr.Source, old)
	other := testdb.Scalar(t, db, `INSERT INTO public_sources.daily_runs (source, etl_version) VALUES ('OTHER_SOURCE', 'test') RETURNING id`)

	result, ran, err := cycle.RunLocked(context.Background())
	if err != nil || !ran || result.Status != "COMPLETED" {
		t.Fatalf("RunLocked: ran = %v, result = %+v, err = %v", ran, result, err)
	}
	if got := testdb.Scalar(t, db, `SELECT status || ' ' || coalesce(error, '') || ' ' || (finished_at IS NOT NULL) FROM public_sources.daily_runs WHERE id = $1`, old); got != "FAILED interrupted true" {
		t.Fatalf("leftover daily run = %s, want FAILED interrupted", got)
	}
	if got := testdb.Scalar(t, db, `SELECT status || ' ' || coalesce(error, '') || ' ' || (finished_at IS NOT NULL) FROM public_sources.capture_runs WHERE daily_run_id = $1`, old); got != "FAILED interrupted true" {
		t.Fatalf("leftover capture run = %s, want FAILED interrupted", got)
	}
	if got := testdb.Scalar(t, db, `SELECT status FROM public_sources.daily_runs WHERE id = $1`, other); got != "RUNNING" {
		t.Fatalf("another source's run = %s, want it untouched", got)
	}
	if got := testdb.Scalar(t, db, `SELECT status FROM public_sources.daily_runs WHERE id = $1`, result.DailyRunID); got != "COMPLETED" {
		t.Fatalf("new daily run = %s, want COMPLETED", got)
	}
}
