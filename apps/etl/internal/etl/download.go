package etl

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const portalDownloadURL = "https://portaldatransparencia.gov.br/download-de-dados"
const maximumArchiveBytes = 512 << 20

var errPortalBlocked = errors.New("portal rate limit or CAPTCHA block")
var errRedirect = errors.New("untrusted or excessive download redirect")

type DownloadOptions struct {
	Directory string
	Interval  time.Duration
	Retries   int
	Refresh   bool
	Log       func(string, ...any)
	// Test seams are private; CLI users cannot bypass shared pacing or replace the source.
	gate      downloadGate
	transport http.RoundTripper
	baseURL   string
}

func (options DownloadOptions) validate() error {
	if options.Directory == "" {
		return fmt.Errorf("download cache directory is required")
	}
	if options.Interval < minimumDownloadInterval || options.Interval > maximumDownloadInterval || options.Interval%time.Second != 0 {
		return fmt.Errorf("download interval must be whole seconds between 20s and 2m")
	}
	if options.Retries < 0 || options.Retries > 3 {
		return fmt.Errorf("download retries must be between 0 and 3")
	}
	return nil
}

func archiveName(opts Options) string {
	switch opts.dataset() {
	case MonthlyExecution:
		return opts.Date.Format("200601") + "_Despesas.zip"
	case AnnualBudget:
		return opts.Date.Format("2006") + "_OrcamentoDespesa.zip"
	default:
		return "despesas_" + opts.Date.Format("20060102") + ".zip"
	}
}

func sourceResource(opts Options) string {
	switch opts.dataset() {
	case MonthlyExecution:
		return "despesas-execucao/" + opts.Date.Format("200601")
	case AnnualBudget:
		return "orcamento-despesa/" + opts.Date.Format("2006")
	default:
		return "despesas/" + opts.Date.Format("20060102")
	}
}

type downloader struct {
	options DownloadOptions
	gate    downloadGate
	client  *http.Client
}

func newDownloader(options DownloadOptions, gate downloadGate) *downloader {
	if options.gate != nil {
		gate = options.gate
	}
	download := &downloader{options: options, gate: gate}
	transport := options.transport
	if transport == nil {
		configured := http.DefaultTransport.(*http.Transport).Clone()
		// Avoid implicit retries on reused HTTP/1 connections or HTTP/2 streams.
		// Every application retry must acquire a fresh shared request slot.
		configured.DisableKeepAlives = true
		configured.ForceAttemptHTTP2 = false
		configured.TLSNextProto = map[string]func(string, *tls.Conn) http.RoundTripper{}
		if configured.TLSClientConfig == nil {
			configured.TLSClientConfig = &tls.Config{}
		}
		// DefaultTransport.Clone may already contain ALPN protocols from its HTTP/2
		// initialization. Disabling handlers alone would negotiate h2 but send HTTP/1.
		configured.TLSClientConfig.NextProtos = []string{"http/1.1"}
		transport = configured
	}
	base := options.baseURL
	if base == "" {
		base = portalDownloadURL
	}
	parsed, _ := url.Parse(base)
	download.client = &http.Client{
		Transport: transport,
		Timeout:   10 * time.Minute,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if req.Response != nil && isPortalBlock(req.Response) {
				return errPortalBlocked
			}
			trusted := req.URL.Scheme == "https" && (req.URL.Host == "portaldatransparencia.gov.br" || req.URL.Host == "dadosabertos-download.cgu.gov.br")
			// Permit only the injected test origin in addition to the official hosts.
			if options.baseURL != "" {
				trusted = trusted || (req.URL.Host == parsed.Host && req.URL.Scheme == parsed.Scheme)
			}
			if len(via) >= 5 || !trusted {
				return errRedirect
			}
			// Redirect requests also consume a slot; they must never bypass pacing.
			return download.gate.wait(req.Context())
		},
	}
	return download
}

func validateSourceArchive(ctx context.Context, opts Options, filename string) error {
	opts.File = filename
	if opts.dataset() == DailyExpenses {
		_, err := ReadDaily(ctx, opts)
		return err
	}
	_, err := ReadAggregate(ctx, opts)
	return err
}

func (download *downloader) acquire(ctx context.Context, opts Options) (string, error) {
	directory := filepath.Join(download.options.Directory, opts.dataset())
	filename := filepath.Join(directory, archiveName(opts))
	if opts.dataset() == DailyExpenses && !download.options.Refresh {
		if _, err := os.Stat(filename); err == nil {
			if err = validateSourceArchive(ctx, opts, filename); err == nil {
				if download.options.Log != nil {
					download.options.Log("Reusing validated daily ZIP", "file", filename)
				}
				return filename, nil
			}
			if ctx.Err() != nil {
				return "", ctx.Err()
			}
			if download.options.Log != nil {
				download.options.Log("Daily cache is invalid; downloading a replacement", "file", filename)
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
	}
	if err := os.MkdirAll(directory, 0755); err != nil {
		return "", err
	}
	base := download.options.baseURL
	if base == "" {
		base = portalDownloadURL
	}
	endpoint := strings.TrimRight(base, "/") + "/" + sourceResource(opts)
	for attempt := 0; attempt <= download.options.Retries; attempt++ {
		if err := download.gate.wait(ctx); err != nil {
			return "", err
		}
		if download.options.Log != nil {
			download.options.Log("Downloading source ZIP", "resource", sourceResource(opts), "attempt", attempt+1)
		}
		failure := download.fetch(ctx, endpoint, filename, opts)
		if failure == nil {
			return filename, nil
		}
		if ctx.Err() != nil && !failure.blocked {
			return "", ctx.Err()
		}
		// Persist cooldown even on the final allowed attempt, and even if a signal
		// arrives just after the server reports a block.
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		var pacingError error
		if failure.blocked {
			pacingError = download.gate.block(cleanup, failure.retryAfter)
			if download.options.Log != nil {
				download.options.Log("Portal blocked the request; shared cooldown recorded", "minimumPause", downloadBlockPause, "retryAfter", failure.retryAfter)
			}
		} else if failure.retryAfter > 0 {
			pacingError = download.gate.delay(cleanup, failure.retryAfter)
		}
		cancel()
		if pacingError != nil {
			return "", errors.Join(failure, pacingError)
		}
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		if !failure.retryable || attempt == download.options.Retries {
			return "", failure
		}
		if download.options.Log != nil {
			download.options.Log("Download failed; retry will respect shared pacing", "error", failure.Error())
		}
	}
	return "", fmt.Errorf("download attempts exhausted")
}

type downloadFailure struct {
	err        error
	blocked    bool
	retryable  bool
	retryAfter time.Duration
}

func (failure *downloadFailure) Error() string { return failure.err.Error() }
func (failure *downloadFailure) Unwrap() error { return failure.err }

func isPortalBlock(response *http.Response) bool {
	return response.StatusCode == http.StatusTooManyRequests || response.Header.Get("X-Amzn-Waf-Action") != ""
}

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

func (download *downloader) fetch(ctx context.Context, endpoint, filename string, opts Options) *downloadFailure {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return &downloadFailure{err: err}
	}
	request.Header.Set("User-Agent", "contracts-ext-finance-etl/"+Version)
	request.Header.Set("Accept", "application/zip, application/octet-stream;q=0.9")
	response, err := download.client.Do(request)
	if response != nil {
		defer response.Body.Close()
	}
	if err != nil {
		failure := &downloadFailure{err: fmt.Errorf("source request failed: %w", err), retryable: !errors.Is(err, errRedirect)}
		if errors.Is(err, errPortalBlocked) {
			failure.blocked = true
			if response != nil {
				failure.retryAfter = retryAfter(response.Header.Get("Retry-After"), time.Now())
			}
		}
		return failure
	}
	if isPortalBlock(response) {
		return &downloadFailure{err: fmt.Errorf("%w: HTTP %d", errPortalBlocked, response.StatusCode), blocked: true, retryable: true, retryAfter: retryAfter(response.Header.Get("Retry-After"), time.Now())}
	}
	if response.StatusCode != http.StatusOK {
		return &downloadFailure{err: fmt.Errorf("source download returned HTTP %d", response.StatusCode), retryable: response.StatusCode >= 500 || response.StatusCode == http.StatusRequestTimeout, retryAfter: retryAfter(response.Header.Get("Retry-After"), time.Now())}
	}
	if response.ContentLength > maximumArchiveBytes {
		return &downloadFailure{err: fmt.Errorf("source archive exceeds 512 MiB limit")}
	}
	file, err := os.CreateTemp(filepath.Dir(filename), filepath.Base(filename)+".*.part")
	if err != nil {
		return &downloadFailure{err: err}
	}
	temporary := file.Name()
	defer os.Remove(temporary)
	size, copyErr := io.Copy(file, io.LimitReader(response.Body, maximumArchiveBytes+1))
	closeErr := file.Close()
	if err := errors.Join(copyErr, closeErr); err != nil {
		var fileError *os.PathError
		return &downloadFailure{err: fmt.Errorf("save downloaded archive: %w", err), retryable: !errors.As(err, &fileError)}
	}
	if size > maximumArchiveBytes {
		return &downloadFailure{err: fmt.Errorf("source archive exceeds 512 MiB limit")}
	}
	if err := validateSourceArchive(ctx, opts, temporary); err != nil {
		return &downloadFailure{err: fmt.Errorf("downloaded archive is invalid: %w", err)}
	}
	if err := os.Rename(temporary, filename); err != nil {
		return &downloadFailure{err: err}
	}
	return nil
}
