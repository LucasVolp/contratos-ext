package capture

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// Outcome classifies one source request.
type Outcome string

const (
	Captured  Outcome = "CAPTURED"  // content differs from the latest capture of the key
	Unchanged Outcome = "UNCHANGED" // content equals the latest capture of the key
	NotFound  Outcome = "NOT_FOUND" // the source answered 404
	Failed    Outcome = "FAILED"    // error, block or invalid response
)

// Result is what a fetch produced for one request.
type Result struct {
	Status    int
	Canonical []byte
	Hash      string
	NotFound  bool
	Err       error
}

// RunStart describes a sync execution.
type RunStart struct {
	Source, Trigger, TargetType, TargetCode, Version string
	DailyRunID                                       int64 // daily cycle that started the run; 0 for none
}

// RunSummary counts a run's requests by outcome.
type RunSummary struct {
	Status    string `json:"status"`
	Requests  int    `json:"requests"`
	Captured  int    `json:"captured"`
	Unchanged int    `json:"unchanged"`
	NotFound  int    `json:"notFound"`
	Failed    int    `json:"failed"`
	Error     string `json:"error,omitempty"`
}

// Add counts one request outcome.
func (s *RunSummary) Add(outcome Outcome) {
	s.Requests++
	switch outcome {
	case Captured:
		s.Captured++
	case Unchanged:
		s.Unchanged++
	case NotFound:
		s.NotFound++
	default:
		s.Failed++
	}
}

// Store writes runs, captures and attempts to the public_sources schema.
type Store struct {
	DB *sql.DB
}

// StartRun records a RUNNING execution and returns its id.
func (s *Store) StartRun(ctx context.Context, start RunStart) (int64, error) {
	var id int64
	daily := sql.NullInt64{Int64: start.DailyRunID, Valid: start.DailyRunID != 0}
	err := s.DB.QueryRowContext(ctx, `INSERT INTO public_sources.capture_runs (source, trigger, target_type, target_code, etl_version, daily_run_id)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, start.Source, start.Trigger, start.TargetType, start.TargetCode, start.Version, daily).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("start capture run: %w", err)
	}
	return id, nil
}

// Record stores one request result and its attempt row in one transaction.
func (s *Store) Record(ctx context.Context, runID int64, source string, req Request, res Result) (Outcome, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	key := req.Key()
	status := sql.NullInt64{Int64: int64(res.Status), Valid: res.Status != 0}
	outcome, captureID, message := Failed, sql.NullInt64{}, sql.NullString{}
	switch {
	case res.Err != nil:
		message = sql.NullString{String: res.Err.Error(), Valid: true}
	case res.NotFound:
		outcome = NotFound
	default:
		var latestID int64
		var latestHash string
		err = tx.QueryRowContext(ctx, `SELECT id, content_hash FROM public_sources.captures
			WHERE source = $1 AND request_key = $2 ORDER BY last_seen_at DESC, id DESC LIMIT 1`, source, key).Scan(&latestID, &latestHash)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return "", fmt.Errorf("read latest capture: %w", err)
		}
		if err == nil && latestHash == res.Hash {
			outcome = Unchanged
			_, err = tx.ExecContext(ctx, `UPDATE public_sources.captures SET last_seen_at = clock_timestamp(), last_run_id = $2 WHERE id = $1`, latestID, runID)
			captureID = sql.NullInt64{Int64: latestID, Valid: true}
		} else {
			outcome = Captured
			err = tx.QueryRowContext(ctx, `INSERT INTO public_sources.captures
				(source, resource, request_key, content_hash, payload, first_captured_at, last_seen_at, first_run_id, last_run_id)
				VALUES ($1, $2, $3, $4, $5, clock_timestamp(), clock_timestamp(), $6, $6)
				ON CONFLICT (source, request_key, content_hash)
				DO UPDATE SET last_seen_at = clock_timestamp(), last_run_id = EXCLUDED.last_run_id
				RETURNING id`, source, req.Resource, key, res.Hash, string(res.Canonical), runID).Scan(&captureID)
		}
		if err != nil {
			return "", fmt.Errorf("store capture: %w", err)
		}
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO public_sources.capture_attempts
		(run_id, source, resource, request_key, outcome, http_status, capture_id, error)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, runID, source, req.Resource, key, string(outcome), status, captureID, message)
	if err != nil {
		return "", fmt.Errorf("store capture attempt: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return "", err
	}
	return outcome, nil
}

// FinishRun stores the final status and counters of a run.
func (s *Store) FinishRun(ctx context.Context, runID int64, summary RunSummary) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE public_sources.capture_runs
		SET status = $2, request_count = $3, captured_count = $4, unchanged_count = $5, not_found_count = $6,
		    failed_count = $7, error = NULLIF($8, ''), finished_at = clock_timestamp()
		WHERE id = $1`, runID, summary.Status, summary.Requests, summary.Captured, summary.Unchanged,
		summary.NotFound, summary.Failed, summary.Error)
	if err != nil {
		return fmt.Errorf("finish capture run: %w", err)
	}
	return nil
}
