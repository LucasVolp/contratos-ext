// Command replicator captures public source data into the public_sources schema
// and normalizes it into typed tables.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	_ "github.com/lib/pq"

	"contracts-ext/etl/internal/capture"
	"contracts-ext/etl/internal/normalize"
	"contracts-ext/etl/internal/pacing"
	"contracts-ext/etl/internal/sources/contratosgovbr"
)

const version = "0.2.0"

var requiredMigrations = []string{"202611070001_public_sources_foundation", "202611080001_public_sources_contracts"}

const usage = `usage:
  replicator sync -source CONTRATOS_GOV_BR (-unit <UG> | -contract <id>) [-inactive=true] [-trigger MANUAL|SCHEDULED] [-retries 3] [-interval 1s] [-normalize=true]
  replicator normalize -source CONTRATOS_GOV_BR (-unit <UG> | -contract <id> | -all)`

// Test seams; there are no flags for these.
var sourceBaseURL = contratosgovbr.BaseURL
var sourceTransport http.RoundTripper

type syncOutput struct {
	RunID int64 `json:"runId"`
	capture.RunSummary
	Normalization *normalize.Summary `json:"normalization,omitempty"`
}

// execute runs the CLI and returns its exit code: 1 for configuration errors,
// FAILED runs and failed normalizations; 0 otherwise.
func execute(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	fail := func(err error) int {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if len(args) == 0 || (args[0] != "sync" && args[0] != "normalize") {
		return fail(errors.New(usage))
	}
	var syncArgs syncPlan
	var normalizeArgs normalizePlan
	var err error
	if args[0] == "sync" {
		syncArgs, err = parseSync(args[1:])
	} else {
		normalizeArgs, err = parseNormalize(args[1:])
	}
	if err != nil {
		return fail(fmt.Errorf("%w\n%s", err, usage))
	}
	db, err := openDatabase(ctx)
	if err != nil {
		return fail(err)
	}
	defer db.Close()
	logger := slog.New(slog.NewTextHandler(stderr, nil))
	normalizer := &normalize.Normalizer{DB: db, Source: contratosgovbr.Source}
	if args[0] == "normalize" {
		summary, err := runNormalize(ctx, normalizer, normalizeArgs.unit, normalizeArgs.contractID, normalizeArgs.all)
		if err != nil {
			return fail(err)
		}
		_ = json.NewEncoder(stdout).Encode(summary)
		if summary.Failed > 0 {
			return 1
		}
		return 0
	}
	return runSync(ctx, db, normalizer, syncArgs, logger, stdout, stderr)
}

func openDatabase(ctx context.Context) (*sql.DB, error) {
	connection := os.Getenv("DATABASE_URL")
	if connection == "" {
		return nil, errors.New("DATABASE_URL is required")
	}
	db, err := sql.Open("postgres", connection)
	if err != nil {
		return nil, fmt.Errorf("open PostgreSQL connection: %w", err)
	}
	db.SetMaxOpenConns(2)
	ping, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err = db.PingContext(ping); err != nil {
		db.Close()
		return nil, fmt.Errorf("connect to PostgreSQL: %w", err)
	}
	for _, migration := range requiredMigrations {
		var installed bool
		err = db.QueryRowContext(ping, `SELECT to_regclass('public._sql_migrations') IS NOT NULL
			AND EXISTS (SELECT 1 FROM public._sql_migrations WHERE name = $1)`, migration).Scan(&installed)
		if err != nil {
			db.Close()
			return nil, fmt.Errorf("check installed migrations: %w", err)
		}
		if !installed {
			db.Close()
			return nil, fmt.Errorf("required migration %s is not installed; run pnpm db:migrate first", migration)
		}
	}
	return db, nil
}

func runNormalize(ctx context.Context, n *normalize.Normalizer, unit string, contractID int64, all bool) (normalize.Summary, error) {
	switch {
	case all:
		return n.All(ctx)
	case unit != "":
		return n.Unit(ctx, unit)
	}
	var summary normalize.Summary
	result, err := n.Contract(ctx, contractID)
	if err != nil {
		return summary, err
	}
	switch result.Status {
	case "NORMALIZED":
		summary.Normalized = 1
	case "SKIPPED_NO_HEADER":
		summary.Skipped = 1
	default:
		summary.Failed = 1
	}
	summary.BadDates = result.BadDates
	return summary, nil
}

func runSync(ctx context.Context, db *sql.DB, normalizer *normalize.Normalizer, plan syncPlan, logger *slog.Logger, stdout, stderr io.Writer) int {
	base, err := url.Parse(sourceBaseURL)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	policy := contratosgovbr.DefaultPolicy
	policy.Minimum = plan.interval
	gate := &pacing.PostgresGate{DB: db, Source: contratosgovbr.Source, Policy: policy, Log: logger.Info}
	store := &capture.Store{DB: db}
	connector := &contratosgovbr.Connector{
		Fetcher: &capture.Fetcher{
			Client:    capture.NewHTTPClient([]string{base.Host}, gate, 60*time.Second, sourceTransport),
			Gate:      gate,
			Retries:   plan.retries,
			MaxBytes:  32 << 20,
			UserAgent: "Mozilla/5.0 (compatible; contracts-ext-replicator/" + version + ")",
			Log:       logger.Warn,
		},
		Store:   store,
		BaseURL: sourceBaseURL,
		Log:     logger.Info,
	}
	start := capture.RunStart{Source: contratosgovbr.Source, Trigger: plan.trigger, TargetType: "MANAGEMENT_UNIT", TargetCode: plan.unit, Version: "replicator/" + version}
	if plan.contractID != 0 {
		start.TargetType, start.TargetCode = "CONTRACT", strconv.FormatInt(plan.contractID, 10)
	}
	runID, err := store.StartRun(ctx, start)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	var summary capture.RunSummary
	if plan.contractID != 0 {
		summary, err = connector.SyncContract(ctx, runID, plan.contractID)
	} else {
		summary, err = connector.SyncUnit(ctx, runID, plan.unit, plan.inactive)
	}
	if errors.Is(err, context.Canceled) {
		summary.Error = "cancelled"
	}
	if finishErr := store.FinishRun(context.WithoutCancel(ctx), runID, summary); finishErr != nil {
		fmt.Fprintln(stderr, finishErr)
		return 1
	}
	if err != nil {
		fmt.Fprintln(stderr, err)
	}
	out := syncOutput{RunID: runID, RunSummary: summary}
	code := 0
	if summary.Status == "FAILED" {
		code = 1
	} else if plan.normalize {
		normalized, normalizeErr := runNormalize(ctx, normalizer, plan.unit, plan.contractID, false)
		if normalizeErr != nil {
			fmt.Fprintln(stderr, normalizeErr)
			code = 1
		}
		if normalized.Failed > 0 {
			code = 1
		}
		out.Normalization = &normalized
	}
	_ = json.NewEncoder(stdout).Encode(out)
	return code
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	os.Exit(execute(ctx, os.Args[1:], os.Stdout, os.Stderr))
}
