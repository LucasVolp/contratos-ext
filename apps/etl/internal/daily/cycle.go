// Package daily runs the automatic daily sync cycle: every management unit (UG)
// registered in the app is captured from Contratos.gov.br and normalized.
package daily

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"contracts-ext/etl/internal/capture"
	"contracts-ext/etl/internal/normalize"
	"contracts-ext/etl/internal/sources/contratosgovbr"
)

// InactiveMaxAge is how old the sub-resources of an unchanged inactive
// contract may get before they are captured again.
const InactiveMaxAge = 30 * 24 * time.Hour

// DuePolicy decides which listed contracts get their sub-resources captured:
// active contracts always; inactive ones when never normalized, when their
// listing element differs from the stored header, when a sub-resource part
// is MISSING, FAILED or absent, or when the oldest part is older than maxAge.
// FAILED parts are retried on every cycle, since a failed attempt still
// refreshes last_attempt_at.
func DuePolicy(db *sql.DB, source string, now func() time.Time, maxAge time.Duration) contratosgovbr.DueFunc {
	return func(ctx context.Context, c contratosgovbr.Listed) (bool, error) {
		if c.Active {
			return true, nil
		}
		// The header part is refreshed by every listing capture, so only the
		// sub-resource parts decide freshness.
		var due bool
		err := db.QueryRowContext(ctx, `SELECT c.source_data IS DISTINCT FROM $3::jsonb
			OR p.part_count < $4 OR coalesce(p.unavailable, true) OR coalesce(p.oldest < $5, true)
			FROM public_sources.contracts c
			CROSS JOIN LATERAL (
				SELECT count(*) AS part_count, bool_or(status IN ('MISSING', 'FAILED')) AS unavailable,
				       min(coalesce(last_attempt_at, captured_at)) AS oldest
				FROM public_sources.contract_parts
				WHERE source = c.source AND contract_external_id = c.external_id AND part <> 'header'
			) p
			WHERE c.source = $1 AND c.external_id = $2`,
			source, c.ID, string(c.Element), len(contratosgovbr.ContractResources), now().Add(-maxAge)).Scan(&due)
		if errors.Is(err, sql.ErrNoRows) {
			return true, nil
		}
		if err != nil {
			return false, fmt.Errorf("read contract %d freshness: %w", c.ID, err)
		}
		return due, nil
	}
}

// Cycle captures and normalizes every registered UG once.
type Cycle struct {
	DB         *sql.DB
	Store      *capture.Store
	Connector  *contratosgovbr.Connector
	Normalizer *normalize.Normalizer
	Version    string
	Log        *slog.Logger
}

// UnitResult is the outcome of one UG in a cycle.
type UnitResult struct {
	Unit          string             `json:"unit"`
	RunID         int64              `json:"runId"`
	Capture       capture.RunSummary `json:"capture"`
	Normalization normalize.Summary  `json:"normalization"`
}

// CycleResult is the outcome of a cycle.
type CycleResult struct {
	DailyRunID  int64        `json:"dailyRunId"`
	Status      string       `json:"status"`
	Units       []UnitResult `json:"units"`
	FailedUnits int          `json:"failedUnits"`
}

// Run records a daily run and syncs every registered UG in order. A failed UG
// does not stop the cycle, which still ends COMPLETED. It returns an error
// only when the context is cancelled (CANCELLED) or the database fails
// (FAILED).
func (c *Cycle) Run(ctx context.Context) (CycleResult, error) {
	result := CycleResult{Status: "FAILED"}
	err := c.DB.QueryRowContext(ctx, `INSERT INTO public_sources.daily_runs (source, etl_version) VALUES ($1, $2) RETURNING id`,
		contratosgovbr.Source, c.Version).Scan(&result.DailyRunID)
	if err != nil {
		return result, fmt.Errorf("start daily run: %w", err)
	}
	err = c.runUnits(ctx, &result)
	message := ""
	switch {
	case ctx.Err() != nil:
		result.Status, message = "CANCELLED", "cancelled"
		err = fmt.Errorf("daily run cancelled: %w", ctx.Err())
	case err != nil:
		result.Status, message = "FAILED", err.Error()
	default:
		result.Status = "COMPLETED"
	}
	_, finishErr := c.DB.ExecContext(context.WithoutCancel(ctx), `UPDATE public_sources.daily_runs
		SET status = $2, unit_count = $3, failed_unit_count = $4, error = NULLIF($5, ''), finished_at = clock_timestamp()
		WHERE id = $1`, result.DailyRunID, result.Status, len(result.Units), result.FailedUnits, message)
	if finishErr != nil {
		result.Status = "FAILED"
		return result, errors.Join(err, fmt.Errorf("finish daily run: %w", finishErr))
	}
	c.logger().Info("Daily run finished", "dailyRunId", result.DailyRunID, "status", result.Status,
		"units", len(result.Units), "failedUnits", result.FailedUnits)
	return result, err
}

func (c *Cycle) runUnits(ctx context.Context, result *CycleResult) error {
	units, err := c.units(ctx)
	if err != nil {
		return err
	}
	due := DuePolicy(c.DB, contratosgovbr.Source, time.Now, InactiveMaxAge)
	for _, unit := range units {
		outcome, err := c.runUnit(ctx, result.DailyRunID, unit, due)
		if outcome.RunID != 0 {
			result.Units = append(result.Units, outcome)
			if outcome.Capture.Status == "FAILED" || outcome.Normalization.Failed > 0 {
				result.FailedUnits++
			}
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// units returns the valid UASGs registered in the app, the ones whose last
// good active listing is oldest first (never captured before any), then by
// UASG, so cycles interrupted again and again do not starve the last units.
func (c *Cycle) units(ctx context.Context) ([]string, error) {
	rows, err := c.DB.QueryContext(ctx, `SELECT i.uasg FROM "Institution" i
		LEFT JOIN LATERAL (
			SELECT max(a.attempted_at) AS last_good_at FROM public_sources.capture_attempts a
			WHERE a.source = $1 AND a.request_key = '/api/contrato/ug/' || i.uasg AND a.outcome IN ('CAPTURED', 'UNCHANGED')
		) good ON true
		ORDER BY good.last_good_at ASC NULLS FIRST, i.uasg`, contratosgovbr.Source)
	if err != nil {
		return nil, fmt.Errorf("read registered units: %w", err)
	}
	defer rows.Close()
	var units []string
	for rows.Next() {
		var unit string
		if err := rows.Scan(&unit); err != nil {
			return nil, fmt.Errorf("read registered units: %w", err)
		}
		if !contratosgovbr.ValidUnit(unit) {
			c.logger().Warn("Skipped registered unit with an invalid UASG", "uasg", unit)
			continue
		}
		units = append(units, unit)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read registered units: %w", err)
	}
	return units, nil
}

// runUnit captures and normalizes one UG. Source failures are part of the
// outcome; the error is only for cancellation or a database failure.
func (c *Cycle) runUnit(ctx context.Context, dailyRunID int64, unit string, due contratosgovbr.DueFunc) (UnitResult, error) {
	outcome := UnitResult{Unit: unit}
	runID, err := c.Store.StartRun(ctx, capture.RunStart{Source: contratosgovbr.Source, Trigger: "SCHEDULED",
		TargetType: "MANAGEMENT_UNIT", TargetCode: unit, Version: c.Version, DailyRunID: dailyRunID})
	if err != nil {
		return outcome, err
	}
	outcome.RunID = runID
	summary, syncErr := c.Connector.SyncUnitWith(ctx, runID, unit, due)
	if errors.Is(syncErr, context.Canceled) {
		summary.Error = "cancelled"
	}
	outcome.Capture = summary
	if err := c.Store.FinishRun(context.WithoutCancel(ctx), runID, summary); err != nil {
		return outcome, err
	}
	if err := ctx.Err(); err != nil {
		return outcome, err
	}
	if syncErr != nil {
		// A failed listing fails this unit only; the cycle moves on.
		c.logger().Warn("Unit sync failed", "unit", unit, "runId", runID, "error", syncErr)
		return outcome, nil
	}
	normalized, err := c.Normalizer.Unit(ctx, unit)
	outcome.Normalization = normalized
	if err != nil {
		return outcome, fmt.Errorf("normalize unit %s: %w", unit, err)
	}
	for _, failure := range normalized.Failures {
		c.logger().Warn("Contract normalization failed", "unit", unit, "id", failure.ExternalID, "error", failure.Error)
	}
	c.logger().Info("Unit synced", "unit", unit, "runId", runID, "capture", summary.Status,
		"requests", summary.Requests, "normalized", normalized.Normalized, "failed", normalized.Failed)
	return outcome, nil
}

func (c *Cycle) logger() *slog.Logger {
	if c.Log == nil {
		return slog.New(slog.DiscardHandler)
	}
	return c.Log
}
