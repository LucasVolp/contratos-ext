// Command replicator captures public source data into the public_sources schema.
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
	"contracts-ext/etl/internal/pacing"
	"contracts-ext/etl/internal/sources/contratosgovbr"
)

const version = "0.1.0"
const requiredMigration = "202611070001_public_sources_foundation"
const usage = "usage: replicator sync -source CONTRATOS_GOV_BR (-unit <UG> | -contract <id>) [-inactive=true] [-trigger MANUAL|SCHEDULED] [-retries 3] [-interval 1s]"

// Test seams; there are no flags for these.
var sourceBaseURL = contratosgovbr.BaseURL
var sourceTransport http.RoundTripper

type output struct {
	RunID int64 `json:"runId"`
	capture.RunSummary
}

// execute runs the CLI and returns its exit code: 1 for configuration errors
// and FAILED runs, 0 for SUCCEEDED and PARTIAL runs.
func execute(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	fail := func(err error) int {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if len(args) == 0 || args[0] != "sync" {
		return fail(errors.New(usage))
	}
	plan, err := parseSync(args[1:])
	if err != nil {
		return fail(fmt.Errorf("%w\n%s", err, usage))
	}
	connection := os.Getenv("DATABASE_URL")
	if connection == "" {
		return fail(errors.New("DATABASE_URL is required"))
	}
	db, err := sql.Open("postgres", connection)
	if err != nil {
		return fail(fmt.Errorf("open PostgreSQL connection: %w", err))
	}
	defer db.Close()
	db.SetMaxOpenConns(2)
	ping, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err = db.PingContext(ping); err != nil {
		return fail(fmt.Errorf("connect to PostgreSQL: %w", err))
	}
	var installed bool
	err = db.QueryRowContext(ping, `SELECT to_regclass('public._sql_migrations') IS NOT NULL
		AND EXISTS (SELECT 1 FROM public._sql_migrations WHERE name = $1)`, requiredMigration).Scan(&installed)
	if err != nil {
		return fail(fmt.Errorf("check installed migrations: %w", err))
	}
	if !installed {
		return fail(fmt.Errorf("required migration %s is not installed; run pnpm db:migrate before syncing", requiredMigration))
	}
	base, err := url.Parse(sourceBaseURL)
	if err != nil {
		return fail(err)
	}
	logger := slog.New(slog.NewTextHandler(stderr, nil))
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
		return fail(err)
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
		return fail(finishErr)
	}
	_ = json.NewEncoder(stdout).Encode(output{RunID: runID, RunSummary: summary})
	if err != nil {
		fmt.Fprintln(stderr, err)
	}
	if summary.Status == "FAILED" {
		return 1
	}
	return 0
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	os.Exit(execute(ctx, os.Args[1:], os.Stdout, os.Stderr))
}
