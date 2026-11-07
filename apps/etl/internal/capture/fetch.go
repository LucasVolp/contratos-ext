package capture

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"contracts-ext/etl/internal/pacing"
)

// ErrBlocked marks a rate-limit (HTTP 429) or WAF response.
var ErrBlocked = errors.New("source rate limit or WAF block")

var errRedirect = errors.New("untrusted or excessive redirect")

// NewHTTPClient builds a client that follows at most five HTTPS redirects within
// allowedHosts, each consuming a gate slot. A nil transport gets a hardened
// default without connection reuse or HTTP/2, so the transport never retries
// requests behind the gate's back.
func NewHTTPClient(allowedHosts []string, gate pacing.Gate, timeout time.Duration, transport http.RoundTripper) *http.Client {
	if transport == nil {
		configured := http.DefaultTransport.(*http.Transport).Clone()
		configured.DisableKeepAlives = true
		configured.ForceAttemptHTTP2 = false
		configured.TLSNextProto = map[string]func(string, *tls.Conn) http.RoundTripper{}
		if configured.TLSClientConfig == nil {
			configured.TLSClientConfig = &tls.Config{}
		}
		configured.TLSClientConfig.NextProtos = []string{"http/1.1"}
		transport = configured
	}
	return &http.Client{
		Transport: transport,
		Timeout:   timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if req.Response != nil && isBlock(req.Response) {
				return ErrBlocked
			}
			if len(via) >= 5 || req.URL.Scheme != "https" || !slices.Contains(allowedHosts, req.URL.Host) {
				return errRedirect
			}
			return gate.Wait(req.Context())
		},
	}
}

// Fetcher performs paced GET requests that must return JSON.
type Fetcher struct {
	Client    *http.Client
	Gate      pacing.Gate
	Retries   int   // retries after the first attempt (0 to 3)
	MaxBytes  int64 // response body cap
	UserAgent string
	Log       func(string, ...any)
}

type attempt struct {
	result     Result
	retryable  bool
	blocked    bool
	retryAfter time.Duration
}

// GetJSON fetches rawURL and returns its canonical JSON, a not-found marker or
// an error. Blocks and transient failures retry through the gate.
func (f *Fetcher) GetJSON(ctx context.Context, rawURL string) Result {
	var last attempt
	for try := 0; try <= f.Retries; try++ {
		if err := ctx.Err(); err != nil {
			return Result{Err: err}
		}
		if err := f.Gate.Wait(ctx); err != nil {
			return Result{Err: err}
		}
		last = f.once(ctx, rawURL)
		if err := ctx.Err(); err != nil {
			return Result{Err: err}
		}
		var pacingErr error
		if last.blocked {
			pacingErr = f.Gate.Block(context.WithoutCancel(ctx), last.retryAfter)
			if f.Log != nil {
				f.Log("Source blocked the request; cooldown recorded", "url", rawURL, "retryAfter", last.retryAfter)
			}
		} else if last.retryAfter > 0 {
			pacingErr = f.Gate.Delay(context.WithoutCancel(ctx), last.retryAfter)
		}
		if pacingErr != nil {
			return Result{Status: last.result.Status, Err: fmt.Errorf("record pacing penalty: %w", pacingErr)}
		}
		if !last.retryable {
			return last.result
		}
		if f.Log != nil && try < f.Retries {
			f.Log("Request failed; retrying through the gate", "url", rawURL, "error", last.result.Err)
		}
	}
	return last.result
}

func (f *Fetcher) once(ctx context.Context, rawURL string) attempt {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return attempt{result: Result{Err: err}}
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", f.UserAgent)
	response, err := f.Client.Do(request)
	if err != nil {
		failure := attempt{result: Result{Err: fmt.Errorf("source request failed: %w", err)}}
		switch {
		case errors.Is(err, ErrBlocked):
			failure.blocked, failure.retryable = true, true
		case !errors.Is(err, errRedirect):
			failure.retryable = true
		}
		return failure
	}
	defer response.Body.Close()
	status := response.StatusCode
	wait := retryAfter(response.Header.Get("Retry-After"), time.Now())
	switch {
	case isBlock(response):
		return attempt{result: Result{Status: status, Err: fmt.Errorf("%w: HTTP %d", ErrBlocked, status)}, blocked: true, retryable: true, retryAfter: wait}
	case status == http.StatusNotFound:
		return attempt{result: Result{Status: status, NotFound: true}}
	case status == http.StatusRequestTimeout || status >= 500:
		return attempt{result: Result{Status: status, Err: fmt.Errorf("source returned HTTP %d", status)}, retryable: true, retryAfter: wait}
	case status != http.StatusOK:
		return attempt{result: Result{Status: status, Err: fmt.Errorf("source returned HTTP %d", status)}}
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, f.MaxBytes+1))
	if err != nil {
		return attempt{result: Result{Status: status, Err: fmt.Errorf("read source response: %w", err)}}
	}
	if int64(len(body)) > f.MaxBytes {
		return attempt{result: Result{Status: status, Err: fmt.Errorf("source response exceeds %d bytes", f.MaxBytes)}}
	}
	canonical, hash, err := Canonicalize(body)
	if err != nil {
		return attempt{result: Result{Status: status, Err: err}}
	}
	return attempt{result: Result{Status: status, Canonical: canonical, Hash: hash}}
}

func isBlock(response *http.Response) bool {
	return response.StatusCode == http.StatusTooManyRequests || response.Header.Get("X-Amzn-Waf-Action") != ""
}

// retryAfter parses a Retry-After header in seconds or HTTP-date form.
func retryAfter(value string, now time.Time) time.Duration {
	if seconds, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64); err == nil && seconds > 0 {
		if seconds > math.MaxInt64/int64(time.Second) {
			return time.Duration(math.MaxInt64)
		}
		return time.Duration(seconds) * time.Second
	}
	if date, err := http.ParseTime(value); err == nil && date.After(now) {
		return date.Sub(now)
	}
	return 0
}
