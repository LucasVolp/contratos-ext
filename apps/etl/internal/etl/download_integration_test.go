package etl

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPersistentPacingAcrossIndependentConnections(t *testing.T) {
	db := isolatedDatabase(t, true)
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
	a := &postgresGate{db: first, minimum: minimumDownloadInterval}
	b := &postgresGate{db: second, minimum: minimumDownloadInterval}
	if err := a.wait(ctx); err != nil {
		t.Fatal(err)
	}
	stamp := scalar(t, db, "SELECT last_request_at::text FROM finance.download_state WHERE source = $1", Source)
	waiting, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
	err = b.wait(waiting)
	cancel()
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("second connection bypassed request spacing: %v", err)
	}
	if scalar(t, db, "SELECT last_request_at::text FROM finance.download_state WHERE source = $1", Source) != stamp {
		t.Fatal("cancelled waiter reserved a future request")
	}
	if err := a.block(ctx, 0); err != nil {
		t.Fatal(err)
	}
	if scalar(t, db, "SELECT interval_seconds FROM finance.download_state WHERE source = $1", Source) != "40" {
		t.Fatal("adaptive interval was not persisted")
	}
	blocked := scalar(t, db, "SELECT blocked_until::text FROM finance.download_state WHERE source = $1", Source)
	if err := b.block(ctx, 0); err != nil {
		t.Fatal(err)
	}
	if scalar(t, db, "SELECT blocked_until::text FROM finance.download_state WHERE source = $1", Source) != blocked {
		t.Fatal("duplicate block restarted cooldown")
	}
	restarted := &postgresGate{db: db, minimum: minimumDownloadInterval}
	waiting, cancel = context.WithTimeout(ctx, 50*time.Millisecond)
	err = restarted.wait(waiting)
	cancel()
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("fresh client discarded persistent cooldown")
	}
	execSQL(t, db, "UPDATE finance.download_state SET last_request_at = clock_timestamp() - interval '2 minutes', blocked_until = '1970-01-01', rate_limited_until = '1970-01-01' WHERE source = $1", Source)
	if err := restarted.wait(ctx); err != nil {
		t.Fatal(err)
	}
	if scalar(t, db, "SELECT interval_seconds FROM finance.download_state WHERE source = $1", Source) != "40" {
		t.Fatal("restart reset the adaptive interval")
	}

	// Both contenders start with an eligible shared state. Exactly one gets a slot.
	execSQL(t, db, "UPDATE finance.download_state SET last_request_at = NULL, blocked_until = '1970-01-01', rate_limited_until = '1970-01-01', interval_seconds = 20 WHERE source = $1", Source)
	results := make(chan error, 2)
	start := make(chan struct{})
	for _, gate := range []*postgresGate{a, b} {
		go func(gate *postgresGate) {
			<-start
			ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
			defer cancel()
			results <- gate.wait(ctx)
		}(gate)
	}
	close(start)
	successes := 0
	for i := 0; i < 2; i++ {
		err := <-results
		if err == nil {
			successes++
		} else if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatal(err)
		}
	}
	if successes != 1 {
		t.Fatal("concurrent connections obtained overlapping request slots")
	}
}

func TestAutomaticDownloadImportIntegration(t *testing.T) {
	db := isolatedDatabase(t, true)
	opts := autoOptions(t, DailyExpenses)
	payload := zipPayload(t, opts)
	calls, invalid := 0, false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if invalid {
			_, _ = w.Write([]byte("not a ZIP"))
			return
		}
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	opts.Download.baseURL = server.URL
	first, err := Run(context.Background(), db, opts)
	if err != nil || first.Status != "SUCCESS" {
		t.Fatalf("automatic import failed: %v %v", first, err)
	}
	if scalar(t, db, "SELECT source_file FROM finance.ingestion_runs WHERE id = $1", first.RunID) != "despesas_20260930.zip" {
		t.Fatal("audit lost source file identity")
	}
	stamp := scalar(t, db, "SELECT last_request_at::text FROM finance.download_state WHERE source = $1", Source)
	replay, err := Run(context.Background(), db, opts)
	if err != nil || replay.ProcessedRecords != first.ProcessedRecords || calls != 1 {
		t.Fatalf("validated daily cache was not reused: %v %v", replay, err)
	}
	if scalar(t, db, "SELECT last_request_at::text FROM finance.download_state WHERE source = $1", Source) != stamp {
		t.Fatal("cache hit consumed a request slot")
	}
	before := scalar(t, db, "SELECT sum(paid_value_brl) FROM finance.payment_commitments")
	invalid = true
	opts.Download.Refresh = true
	opts.Download.gate = newFakeGate()
	failed, err := Run(context.Background(), db, opts)
	if err == nil || failed.Status != "FAILURE" {
		t.Fatal("bad automatic download was not audited as failure")
	}
	if scalar(t, db, "SELECT sum(paid_value_brl) FROM finance.payment_commitments") != before {
		t.Fatal("bad download changed existing facts")
	}
	cached, err := os.ReadFile(filepath.Join(opts.Download.Directory, opts.dataset(), archiveName(opts)))
	if err != nil || string(cached) != string(payload) {
		t.Fatal("bad download replaced last complete ZIP")
	}
	if scalar(t, db, "SELECT status FROM finance.ingestion_runs WHERE id = $1", failed.RunID) != "FAILURE" {
		t.Fatal("failed download audit missing")
	}
}

func TestFinalBlockedDownloadKeepsSharedCooldown(t *testing.T) {
	db := isolatedDatabase(t, true)
	opts := autoOptions(t, DailyExpenses)
	opts.Download.Retries = 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "600")
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()
	opts.Download.baseURL = server.URL
	failed, err := Run(context.Background(), db, opts)
	if err == nil || failed.Status != "FAILURE" || !errors.Is(err, errPortalBlocked) {
		t.Fatalf("expected blocked failure: %v %v", failed, err)
	}
	if scalar(t, db, "SELECT blocked_until > clock_timestamp() + interval '599 seconds' FROM finance.download_state WHERE source = $1", Source) != "true" {
		t.Fatal("final attempt discarded Retry-After")
	}
	if scalar(t, db, "SELECT interval_seconds FROM finance.download_state WHERE source = $1", Source) != "40" {
		t.Fatal("final block discarded adaptive interval")
	}
}

func TestDownloadRequiresItsMigrationButOfflineImportDoesNot(t *testing.T) {
	db := isolatedDatabase(t, true)
	execSQL(t, db, "DELETE FROM public._sql_migrations WHERE name = $1", DownloadMigration)
	opts := autoOptions(t, DailyExpenses)
	_, err := Run(context.Background(), db, opts)
	if err == nil {
		t.Fatal("download started without persistent control migration")
	}
	if scalar(t, db, "SELECT count(*) FROM finance.ingestion_runs") != "0" {
		t.Fatal("download audit created before prerequisites were verified")
	}
	offline := testOptions(writeFixture(t, dailyFixture(), false, Kind(-1)))
	if _, err := Run(context.Background(), db, offline); err != nil {
		t.Fatalf("offline import incorrectly depends on download state: %v", err)
	}
}
