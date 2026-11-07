package capture

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type fakeGate struct{ waits, blocks, delays atomic.Int32 }

func (g *fakeGate) Wait(context.Context) error                 { g.waits.Add(1); return nil }
func (g *fakeGate) Block(context.Context, time.Duration) error { g.blocks.Add(1); return nil }
func (g *fakeGate) Delay(context.Context, time.Duration) error { g.delays.Add(1); return nil }

// serve starts a TLS server and returns a fetcher allowed to reach only it.
func serve(t *testing.T, retries int, handler http.HandlerFunc) (*Fetcher, *fakeGate, *httptest.Server, *atomic.Int32) {
	t.Helper()
	hits := &atomic.Int32{}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		handler(w, r)
	}))
	t.Cleanup(server.Close)
	host, _ := url.Parse(server.URL)
	gate := &fakeGate{}
	fetcher := &Fetcher{
		Client:    NewHTTPClient([]string{host.Host}, gate, 5*time.Second, server.Client().Transport),
		Gate:      gate,
		Retries:   retries,
		MaxBytes:  1 << 20,
		UserAgent: "Mozilla/5.0 (compatible; contracts-ext-replicator/test)",
	}
	return fetcher, gate, server, hits
}

func TestGetJSONSuccessSendsHeaders(t *testing.T) {
	fetcher, _, server, _ := serve(t, 0, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") != "application/json" || !strings.HasPrefix(r.Header.Get("User-Agent"), "Mozilla/5.0 (compatible; contracts-ext-replicator/") {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		_, _ = w.Write([]byte(`[{"id":13847}]`))
	})
	res := fetcher.GetJSON(context.Background(), server.URL+"/api/contrato/ug/158148")
	if res.Err != nil || res.Status != 200 || len(res.Hash) != 64 || string(res.Canonical) != `[{"id":13847}]` {
		t.Fatalf("result = %+v", res)
	}
}

func TestGetJSONNonJSONBodyFails(t *testing.T) {
	fetcher, _, server, hits := serve(t, 3, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(`<html>challenge</html>`))
	})
	res := fetcher.GetJSON(context.Background(), server.URL+"/x")
	if res.Err == nil || res.Canonical != nil || hits.Load() != 1 {
		t.Fatalf("result = %+v, hits = %d", res, hits.Load())
	}
}

func TestGetJSONOversizedOrTruncatedBodyFails(t *testing.T) {
	fetcher, _, server, _ := serve(t, 0, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/big" {
			_, _ = w.Write([]byte(`["` + strings.Repeat("a", 60) + `"]`))
			return
		}
		conn, buffer, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		_, _ = buffer.WriteString("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n[{\"id\":1")
		_ = buffer.Flush()
		_ = conn.Close()
	})
	fetcher.MaxBytes = 16
	if res := fetcher.GetJSON(context.Background(), server.URL+"/big"); res.Err == nil || res.Canonical != nil {
		t.Fatalf("oversized result = %+v", res)
	}
	fetcher.MaxBytes = 1 << 20
	if res := fetcher.GetJSON(context.Background(), server.URL+"/cut"); res.Err == nil || res.Canonical != nil {
		t.Fatalf("truncated result = %+v", res)
	}
}

func TestGetJSONNotFound(t *testing.T) {
	fetcher, _, server, hits := serve(t, 3, func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) })
	res := fetcher.GetJSON(context.Background(), server.URL+"/x")
	if !res.NotFound || res.Err != nil || res.Status != 404 || hits.Load() != 1 {
		t.Fatalf("result = %+v, hits = %d", res, hits.Load())
	}
}

func TestGetJSONBlockedRetriesThroughGate(t *testing.T) {
	var calls atomic.Int32
	fetcher, gate, server, _ := serve(t, 3, func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) <= 2 {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		_, _ = w.Write([]byte(`[]`))
	})
	res := fetcher.GetJSON(context.Background(), server.URL+"/x")
	if res.Err != nil || gate.blocks.Load() != 2 || gate.waits.Load() != 3 {
		t.Fatalf("result = %+v, blocks = %d, waits = %d", res, gate.blocks.Load(), gate.waits.Load())
	}
}

func TestGetJSONWafHeaderCountsAsBlock(t *testing.T) {
	fetcher, gate, server, _ := serve(t, 0, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Amzn-Waf-Action", "captcha")
		w.WriteHeader(http.StatusForbidden)
	})
	res := fetcher.GetJSON(context.Background(), server.URL+"/x")
	if !errors.Is(res.Err, ErrBlocked) || gate.blocks.Load() != 1 {
		t.Fatalf("result = %+v, blocks = %d", res, gate.blocks.Load())
	}
}

func TestGetJSONServerErrorExhaustsRetries(t *testing.T) {
	fetcher, gate, server, hits := serve(t, 2, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "2")
		w.WriteHeader(http.StatusServiceUnavailable)
	})
	res := fetcher.GetJSON(context.Background(), server.URL+"/x")
	if res.Err == nil || res.Status != 503 || hits.Load() != 3 || gate.delays.Load() != 3 {
		t.Fatalf("result = %+v, hits = %d, delays = %d", res, hits.Load(), gate.delays.Load())
	}
}

func TestGetJSONClientErrorDoesNotRetry(t *testing.T) {
	fetcher, _, server, hits := serve(t, 3, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusBadRequest) })
	if res := fetcher.GetJSON(context.Background(), server.URL+"/x"); res.Err == nil || hits.Load() != 1 {
		t.Fatalf("result = %+v, hits = %d", res, hits.Load())
	}
}

func TestRedirectToForeignHostRejected(t *testing.T) {
	fetcher, _, server, hits := serve(t, 3, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://example.org/", http.StatusFound)
	})
	res := fetcher.GetJSON(context.Background(), server.URL+"/x")
	if res.Err == nil || hits.Load() != 1 {
		t.Fatalf("result = %+v, hits = %d", res, hits.Load())
	}
}

func TestGetJSONStopsOnCancelledContext(t *testing.T) {
	fetcher, _, server, hits := serve(t, 3, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusServiceUnavailable) })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	res := fetcher.GetJSON(ctx, server.URL+"/x")
	if !errors.Is(res.Err, context.Canceled) || hits.Load() != 0 {
		t.Fatalf("result = %+v, hits = %d", res, hits.Load())
	}
}

func TestRetryAfterParsesSecondsAndDates(t *testing.T) {
	now := time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC)
	if got := retryAfter("120", now); got != 2*time.Minute {
		t.Fatalf("seconds = %v", got)
	}
	if got := retryAfter(now.Add(time.Minute).Format(http.TimeFormat), now); got != time.Minute {
		t.Fatalf("date = %v", got)
	}
	if got := retryAfter("soon", now); got != 0 {
		t.Fatalf("invalid = %v", got)
	}
	// An absurd header must not freeze the source for every process.
	if got := retryAfter("1000000000", now); got != MaxRetryAfter {
		t.Fatalf("huge seconds = %v, want %v", got, MaxRetryAfter)
	}
	if got := retryAfter(now.AddDate(30, 0, 0).Format(http.TimeFormat), now); got != MaxRetryAfter {
		t.Fatalf("far date = %v, want %v", got, MaxRetryAfter)
	}
}
