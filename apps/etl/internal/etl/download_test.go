package etl

import (
	"context"
	"crypto/x509"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

type fakeGate struct {
	now       time.Time
	state     pacingState
	starts    []time.Time
	penalties []time.Duration
}

func newFakeGate() *fakeGate {
	return &fakeGate{now: time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC), state: pacingState{interval: minimumDownloadInterval}}
}
func (gate *fakeGate) wait(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	for {
		state, delay := gate.state.reserve(gate.now, minimumDownloadInterval)
		gate.state = state
		if delay == 0 {
			gate.starts = append(gate.starts, gate.now)
			return nil
		}
		gate.now = gate.now.Add(delay)
	}
}
func (gate *fakeGate) block(ctx context.Context, after time.Duration) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	gate.state = gate.state.penalize(gate.now, after)
	gate.penalties = append(gate.penalties, gate.state.interval)
	return nil
}
func (gate *fakeGate) delay(ctx context.Context, delay time.Duration) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	gate.state.blockedUntil = later(gate.state.blockedUntil, gate.now.Add(delay))
	return nil
}

func autoOptions(t *testing.T, dataset string) Options {
	t.Helper()
	opts := aggregateOptions(dataset)
	if dataset == DailyExpenses {
		opts = testOptions("")
	}
	opts.File = ""
	opts.Download = &DownloadOptions{Directory: t.TempDir(), Interval: minimumDownloadInterval, Retries: 3}
	return opts
}

func zipPayload(t *testing.T, opts Options) []byte {
	t.Helper()
	var file string
	if opts.dataset() == DailyExpenses {
		file = writeFixture(t, dailyFixture(), true, Kind(-1))
	} else {
		rows := []Row{monthlyRow()}
		if opts.dataset() == AnnualBudget {
			rows = []Row{annualRow()}
		}
		file = writeAggregateFixture(t, opts, rows, "")
	}
	payload, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	return payload
}

func TestRequestSpacingAndCooldownState(t *testing.T) {
	now := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	state, delay := (pacingState{interval: minimumDownloadInterval}).reserve(now, minimumDownloadInterval)
	if delay != 0 || !state.lastRequest.Valid {
		t.Fatal("first slot not granted")
	}
	_, delay = state.reserve(now.Add(5*time.Second), minimumDownloadInterval)
	if delay != 15*time.Second {
		t.Fatal("requests are not spaced by 20 seconds")
	}
	state = state.penalize(now, 0)
	if state.interval != 40*time.Second || !state.blockedUntil.Equal(now.Add(downloadBlockPause)) {
		t.Fatal("block did not increase interval and pause")
	}
	duplicate := state.penalize(now.Add(time.Second), 0)
	if duplicate.interval != state.interval || !duplicate.blockedUntil.Equal(state.blockedUntil) {
		t.Fatal("duplicate block restarted the pause")
	}
	for i := 0; i < 5; i++ {
		state = state.penalize(state.blockedUntil, 0)
	}
	if state.interval != maximumDownloadInterval {
		t.Fatal("adaptive interval exceeds cap")
	}
	state.lastRequest = sql.NullTime{Time: now, Valid: true}
	if _, delay := state.reserve(now, time.Minute); delay < downloadBlockPause {
		t.Fatal("new caller bypassed cooldown")
	}
	transient := pacingState{interval: minimumDownloadInterval, blockedUntil: now.Add(45 * time.Second)}
	transient = transient.penalize(now, 0)
	if transient.interval != 40*time.Second || transient.blockedUntil.Sub(now) != downloadBlockPause {
		t.Fatal("a transient Retry-After suppressed a later WAF penalty")
	}
}

func TestAutomaticSourcePathsAndCachePolicy(t *testing.T) {
	for _, sample := range []struct {
		dataset, path string
		calls         int
	}{
		{DailyExpenses, "/despesas/20260930", 1}, {MonthlyExecution, "/despesas-execucao/202609", 2}, {AnnualBudget, "/orcamento-despesa/2026", 2},
	} {
		t.Run(sample.dataset, func(t *testing.T) {
			opts := autoOptions(t, sample.dataset)
			payload := zipPayload(t, opts)
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Path != sample.path {
					t.Errorf("unexpected source path %s", r.URL.Path)
				}
				_, _ = w.Write(payload)
			}))
			defer server.Close()
			opts.Download.baseURL = server.URL
			gate := newFakeGate()
			client := newDownloader(*opts.Download, gate)
			for i := 0; i < 2; i++ {
				file, err := client.acquire(context.Background(), opts)
				if err != nil {
					t.Fatal(err)
				}
				if filepath.Base(file) != archiveName(opts) {
					t.Fatal("wrong cache identity")
				}
			}
			if calls != sample.calls || len(gate.starts) != sample.calls {
				t.Fatal("cache bypassed freshness policy or pacing")
			}
			if sample.dataset == DailyExpenses {
				client.options.Refresh = true
				if _, err := client.acquire(context.Background(), opts); err != nil {
					t.Fatal(err)
				}
				if calls != 2 {
					t.Fatal("explicit daily refresh ignored")
				}
			}
		})
	}
}

func TestBlockedRequestsPauseAndIncreaseTheInterval(t *testing.T) {
	opts := autoOptions(t, DailyExpenses)
	payload := zipPayload(t, opts)
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls <= 3 {
			w.Header().Set("X-Amzn-Waf-Action", "captcha")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	opts.Download.baseURL = server.URL
	gate := newFakeGate()
	if _, err := newDownloader(*opts.Download, gate).acquire(context.Background(), opts); err != nil {
		t.Fatal(err)
	}
	if calls != 4 || len(gate.penalties) != 3 {
		t.Fatal("wrong retry budget")
	}
	for i, want := range []time.Duration{40 * time.Second, 80 * time.Second, 120 * time.Second} {
		if gate.penalties[i] != want || gate.starts[i+1].Sub(gate.starts[i]) < downloadBlockPause {
			t.Fatal("retry bypassed adaptive pause")
		}
	}
}

func TestExhaustedRetryStillPersistsCooldownAndRetryAfter(t *testing.T) {
	opts := autoOptions(t, DailyExpenses)
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Retry-After", "600")
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()
	opts.Download.baseURL = server.URL
	gate := newFakeGate()
	_, err := newDownloader(*opts.Download, gate).acquire(context.Background(), opts)
	if err == nil || !errors.Is(err, errPortalBlocked) || calls != 4 {
		t.Fatalf("unexpected exhausted result: %v", err)
	}
	if gate.state.blockedUntil.Sub(gate.now) != 10*time.Minute {
		t.Fatal("final failure did not persist server cooldown")
	}
	for i := 1; i < len(gate.starts); i++ {
		if gate.starts[i].Sub(gate.starts[i-1]) != 10*time.Minute {
			t.Fatal("ignored longer Retry-After")
		}
	}
}

func TestTransientResponsesAndRedirectsUseSharedSlots(t *testing.T) {
	opts := autoOptions(t, DailyExpenses)
	payload := zipPayload(t, opts)
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			w.Header().Set("Retry-After", "45")
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if r.URL.Path != "/archive.zip" {
			http.Redirect(w, r, "/archive.zip", http.StatusFound)
			return
		}
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	opts.Download.baseURL = server.URL
	gate := newFakeGate()
	if _, err := newDownloader(*opts.Download, gate).acquire(context.Background(), opts); err != nil {
		t.Fatal(err)
	}
	if calls != 3 || len(gate.starts) != 3 {
		t.Fatal("redirect or retry escaped pacing")
	}
	if gate.starts[1].Sub(gate.starts[0]) != 45*time.Second || gate.starts[2].Sub(gate.starts[1]) != 20*time.Second {
		t.Fatal("wrong retry or redirect spacing")
	}
}

func TestInvalidDownloadPreservesPreviousCacheAndCleansPartialFiles(t *testing.T) {
	opts := autoOptions(t, MonthlyExecution)
	payload := zipPayload(t, opts)
	cached := filepath.Join(opts.Download.Directory, opts.dataset(), archiveName(opts))
	if err := os.MkdirAll(filepath.Dir(cached), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cached, payload, 0600); err != nil {
		t.Fatal(err)
	}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; _, _ = fmt.Fprint(w, "<html>not a ZIP</html>") }))
	defer server.Close()
	opts.Download.baseURL = server.URL
	if _, err := newDownloader(*opts.Download, newFakeGate()).acquire(context.Background(), opts); err == nil {
		t.Fatal("accepted HTML as a source ZIP")
	}
	if calls != 1 {
		t.Fatal("retried permanent invalid source body")
	}
	after, err := os.ReadFile(cached)
	if err != nil || string(after) != string(payload) {
		t.Fatal("bad download replaced previous valid cache")
	}
	parts, _ := filepath.Glob(filepath.Join(filepath.Dir(cached), "*.part"))
	if len(parts) != 0 {
		t.Fatal("partial downloads left on disk")
	}
}

func TestDownloadCancellationAndMissingArchivesDoNotRetry(t *testing.T) {
	for _, status := range []int{http.StatusNotFound, http.StatusForbidden} {
		opts := autoOptions(t, DailyExpenses)
		calls := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(status) }))
		opts.Download.baseURL = server.URL
		_, err := newDownloader(*opts.Download, newFakeGate()).acquire(context.Background(), opts)
		server.Close()
		if err == nil || calls != 1 {
			t.Fatal("retried unavailable/forbidden archive without a WAF signal")
		}
	}
	opts := autoOptions(t, DailyExpenses)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("PK"))
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	opts.Download.baseURL = server.URL
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := newDownloader(*opts.Download, newFakeGate()).acquire(ctx, opts); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("ignored cancellation: %v", err)
	}
	parts, _ := filepath.Glob(filepath.Join(opts.Download.Directory, opts.dataset(), "*.part"))
	if len(parts) != 0 {
		t.Fatal("cancelled download left partial file")
	}
}

func TestRetryAfterAndDownloadValidation(t *testing.T) {
	now := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	if retryAfter("45", now) != 45*time.Second || retryAfter(now.Add(time.Minute).Format(http.TimeFormat), now) != time.Minute {
		t.Fatal("Retry-After parsing failed")
	}
	if retryAfter("invalid", now) != 0 || retryAfter("-1", now) != 0 {
		t.Fatal("invalid Retry-After accepted")
	}
	opts := autoOptions(t, DailyExpenses)
	opts.Download.Interval = time.Second
	if err := opts.Validate(); err == nil || !strings.Contains(err.Error(), "20s") {
		t.Fatal("unsafe interval accepted")
	}
	opts.Download.Interval = minimumDownloadInterval
	opts.Download.Retries = 4
	if opts.Validate() == nil {
		t.Fatal("unbounded retry budget accepted")
	}
}

func TestTruncatedTransfersRetryWithoutPublishingPartialFiles(t *testing.T) {
	opts := autoOptions(t, DailyExpenses)
	opts.Download.Retries = 1
	payload := zipPayload(t, opts)
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		_, _ = w.Write(payload[:20])
	}))
	defer server.Close()
	opts.Download.baseURL = server.URL
	gate := newFakeGate()
	if _, err := newDownloader(*opts.Download, gate).acquire(context.Background(), opts); err == nil {
		t.Fatal("accepted truncated transfer")
	}
	if calls != 2 || len(gate.starts) != 2 || gate.starts[1].Sub(gate.starts[0]) != minimumDownloadInterval {
		t.Fatal("truncated transfer retry escaped its budget or pacing")
	}
	entries, err := os.ReadDir(filepath.Join(opts.Download.Directory, opts.dataset()))
	if err != nil || len(entries) != 0 {
		t.Fatal("truncated file was published or retained")
	}
}

func TestWafHeadersOnSuccessfulOrRedirectResponsesAreStillBlocks(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusFound} {
		opts := autoOptions(t, DailyExpenses)
		payload := zipPayload(t, opts)
		calls := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls++
			if calls == 1 {
				w.Header().Set("X-Amzn-Waf-Action", "challenge")
				if status == http.StatusFound {
					w.Header().Set("Location", "/challenge")
				}
				w.WriteHeader(status)
				return
			}
			if r.URL.Path == "/challenge" {
				t.Error("followed WAF redirect instead of pausing")
			}
			_, _ = w.Write(payload)
		}))
		opts.Download.baseURL = server.URL
		gate := newFakeGate()
		_, err := newDownloader(*opts.Download, gate).acquire(context.Background(), opts)
		server.Close()
		if err != nil || calls != 2 || len(gate.penalties) != 1 || gate.starts[1].Sub(gate.starts[0]) != downloadBlockPause {
			t.Fatalf("ignored WAF on HTTP %d: %v", status, err)
		}
	}
}

func TestInvalidDailyCacheIsReplacedAndUntrustedRedirectIsRejected(t *testing.T) {
	opts := autoOptions(t, DailyExpenses)
	cached := filepath.Join(opts.Download.Directory, opts.dataset(), archiveName(opts))
	if err := os.MkdirAll(filepath.Dir(cached), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cached, []byte("incomplete ZIP"), 0600); err != nil {
		t.Fatal(err)
	}
	payload := zipPayload(t, opts)
	calls, redirect := 0, false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if redirect {
			http.Redirect(w, r, "https://example.invalid/archive.zip", http.StatusFound)
			return
		}
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	opts.Download.baseURL = server.URL
	gate := newFakeGate()
	if _, err := newDownloader(*opts.Download, gate).acquire(context.Background(), opts); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatal("invalid cache was reused")
	}
	redirect, opts.Download.Refresh = true, true
	if _, err := newDownloader(*opts.Download, gate).acquire(context.Background(), opts); !errors.Is(err, errRedirect) {
		t.Fatalf("untrusted redirect was followed: %v", err)
	}
	if calls != 2 || len(gate.starts) != 2 {
		t.Fatal("redirect rejection consumed more attempts or request slots")
	}
}

func TestTlsNegotiatesTheEnabledHttpProtocol(t *testing.T) {
	opts := autoOptions(t, DailyExpenses)
	payload := zipPayload(t, opts)
	protocol := 0
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		protocol = r.ProtoMajor
		_, _ = w.Write(payload)
	}))
	server.EnableHTTP2 = true
	server.StartTLS()
	defer server.Close()
	opts.Download.baseURL = server.URL
	client := newDownloader(*opts.Download, newFakeGate())
	transport := client.client.Transport.(*http.Transport)
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	transport.TLSClientConfig.RootCAs = roots
	if _, err := client.acquire(context.Background(), opts); err != nil {
		t.Fatal(err)
	}
	if protocol != 1 {
		t.Fatal("negotiated a protocol outside the paced retry policy")
	}
}
