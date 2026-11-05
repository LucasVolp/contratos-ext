package etl

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

const minimumDownloadInterval = 20 * time.Second
const maximumDownloadInterval = 2 * time.Minute
const downloadBlockPause = 5*time.Minute + time.Second

type pacingState struct {
	lastRequest      sql.NullTime
	blockedUntil     time.Time
	rateLimitedUntil time.Time
	interval         time.Duration
}

func (state pacingState) reserve(now time.Time, minimum time.Duration) (pacingState, time.Duration) {
	state.interval = max(state.interval, minimum)
	earliest := state.blockedUntil
	if state.lastRequest.Valid {
		earliest = later(earliest, state.lastRequest.Time.Add(state.interval))
	}
	if earliest.After(now) {
		return state, earliest.Sub(now)
	}
	state.lastRequest = sql.NullTime{Time: now, Valid: true}
	return state, 0
}

func (state pacingState) penalize(now time.Time, retryAfter time.Duration) pacingState {
	if !state.rateLimitedUntil.After(now) {
		state.interval = min(maximumDownloadInterval, max(minimumDownloadInterval, state.interval)*2)
		state.rateLimitedUntil = later(state.blockedUntil, now.Add(downloadBlockPause))
	}
	// A second notification during an active block does not restart the default
	// pause or double the interval. A longer server Retry-After is still honored.
	if retryAfter > 0 {
		state.rateLimitedUntil = later(state.rateLimitedUntil, now.Add(retryAfter))
	}
	state.blockedUntil = later(state.blockedUntil, state.rateLimitedUntil)
	return state
}

func later(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

type downloadGate interface {
	wait(context.Context) error
	block(context.Context, time.Duration) error
	delay(context.Context, time.Duration) error
}

type transactionStarter interface {
	BeginTx(context.Context, *sql.TxOptions) (*sql.Tx, error)
}

type postgresGate struct {
	db      transactionStarter
	minimum time.Duration
	log     func(string, ...any)
}

func (gate *postgresGate) update(ctx context.Context, change func(pacingState, time.Time) (pacingState, time.Duration)) (time.Duration, error) {
	tx, err := gate.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var state pacingState
	var seconds int
	err = tx.QueryRowContext(ctx, `SELECT last_request_at, blocked_until, rate_limited_until, interval_seconds
		FROM finance.download_state WHERE source = $1 FOR UPDATE`, Source).Scan(&state.lastRequest, &state.blockedUntil, &state.rateLimitedUntil, &seconds)
	if err != nil {
		return 0, fmt.Errorf("read shared download state: %w", err)
	}
	state.interval = max(time.Duration(seconds)*time.Second, gate.minimum)
	var now time.Time
	if err = tx.QueryRowContext(ctx, "SELECT clock_timestamp()").Scan(&now); err != nil {
		return 0, err
	}
	state, delay := change(state, now)
	_, err = tx.ExecContext(ctx, `UPDATE finance.download_state
        SET last_request_at = $2, blocked_until = $3, interval_seconds = $4, rate_limited_until = $5, updated_at = clock_timestamp()
        WHERE source = $1`, Source, state.lastRequest, state.blockedUntil, int(state.interval/time.Second), state.rateLimitedUntil)
	if err != nil {
		return 0, err
	}
	if err = tx.Commit(); err != nil {
		return 0, err
	}
	return delay, nil
}

func (gate *postgresGate) wait(ctx context.Context) error {
	for {
		delay, err := gate.update(ctx, func(state pacingState, now time.Time) (pacingState, time.Duration) {
			return state.reserve(now, gate.minimum)
		})
		if err != nil {
			return err
		}
		if delay <= 0 {
			return nil
		}
		if gate.log != nil {
			gate.log("Waiting for shared download slot", "delay", delay.Round(time.Second))
		}
		if err := waitContext(ctx, delay); err != nil {
			return err
		}
	}
}

func (gate *postgresGate) block(ctx context.Context, retryAfter time.Duration) error {
	_, err := gate.update(ctx, func(state pacingState, now time.Time) (pacingState, time.Duration) {
		return state.penalize(now, retryAfter), 0
	})
	return err
}

func (gate *postgresGate) delay(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}
	_, err := gate.update(ctx, func(state pacingState, now time.Time) (pacingState, time.Duration) {
		state.blockedUntil = later(state.blockedUntil, now.Add(delay))
		return state, 0
	})
	return err
}

func waitContext(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
