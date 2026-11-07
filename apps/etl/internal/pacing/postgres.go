package pacing

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// Gate paces requests to one source.
type Gate interface {
	// Wait blocks until a request slot is reserved or ctx ends.
	Wait(ctx context.Context) error
	// Block records a rate-limit or WAF response.
	Block(ctx context.Context, retryAfter time.Duration) error
	// Delay postpones every caller by d (for example a transient Retry-After).
	Delay(ctx context.Context, d time.Duration) error
}

// TxStarter is satisfied by *sql.DB and *sql.Conn.
type TxStarter interface {
	BeginTx(context.Context, *sql.TxOptions) (*sql.Tx, error)
}

// PostgresGate persists pacing state in public_sources.source_pacing. Slots are
// reserved in short row-locked transactions using database time; waits happen
// outside transactions and are cancellable.
type PostgresGate struct {
	DB     TxStarter
	Source string
	Policy Policy
	Log    func(string, ...any)
}

func (gate *PostgresGate) update(ctx context.Context, change func(State, time.Time) (State, time.Duration)) (time.Duration, error) {
	tx, err := gate.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var state State
	var milliseconds int64
	err = tx.QueryRowContext(ctx, `SELECT last_request_at, blocked_until, rate_limited_until, interval_ms
		FROM public_sources.source_pacing WHERE source = $1 FOR UPDATE`, gate.Source).
		Scan(&state.LastRequest, &state.BlockedUntil, &state.RateLimitedUntil, &milliseconds)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, fmt.Errorf("pacing state for source %s is not installed", gate.Source)
	}
	if err != nil {
		return 0, fmt.Errorf("read pacing state: %w", err)
	}
	state.Interval = max(time.Duration(milliseconds)*time.Millisecond, gate.Policy.Minimum)
	var now time.Time
	if err = tx.QueryRowContext(ctx, "SELECT clock_timestamp()").Scan(&now); err != nil {
		return 0, err
	}
	state, delay := change(state, now)
	_, err = tx.ExecContext(ctx, `UPDATE public_sources.source_pacing
		SET last_request_at = $2, blocked_until = $3, rate_limited_until = $4, interval_ms = $5, updated_at = clock_timestamp()
		WHERE source = $1`, gate.Source, state.LastRequest, state.BlockedUntil, state.RateLimitedUntil, state.Interval.Milliseconds())
	if err != nil {
		return 0, err
	}
	if err = tx.Commit(); err != nil {
		return 0, err
	}
	return delay, nil
}

// Wait implements Gate.
func (gate *PostgresGate) Wait(ctx context.Context) error {
	for {
		delay, err := gate.update(ctx, func(state State, now time.Time) (State, time.Duration) {
			return state.Reserve(now, gate.Policy)
		})
		if err != nil {
			return err
		}
		if delay <= 0 {
			return nil
		}
		if gate.Log != nil && delay >= time.Second {
			gate.Log("Waiting for source request slot", "source", gate.Source, "delay", delay.Round(time.Second))
		}
		if err := sleep(ctx, delay); err != nil {
			return err
		}
	}
}

// Block implements Gate.
func (gate *PostgresGate) Block(ctx context.Context, retryAfter time.Duration) error {
	_, err := gate.update(ctx, func(state State, now time.Time) (State, time.Duration) {
		return state.Penalize(now, retryAfter, gate.Policy), 0
	})
	return err
}

// Delay implements Gate.
func (gate *PostgresGate) Delay(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	_, err := gate.update(ctx, func(state State, now time.Time) (State, time.Duration) {
		state.BlockedUntil = later(state.BlockedUntil, now.Add(d))
		return state, 0
	})
	return err
}

func sleep(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
