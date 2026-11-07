package daily

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"time"

	"contracts-ext/etl/internal/sources/contratosgovbr"
)

// NextRun returns the next occurrence of at ("HH:MM", 24 hours) in loc that is
// strictly after now.
func NextRun(now time.Time, at string, loc *time.Location) (time.Time, error) {
	clock, err := time.Parse("15:04", at)
	if err != nil || len(at) != len("15:04") {
		return time.Time{}, fmt.Errorf("time of day %q must be HH:MM (00:00 to 23:59)", at)
	}
	local := now.In(loc)
	next := time.Date(local.Year(), local.Month(), local.Day(), clock.Hour(), clock.Minute(), 0, 0, loc)
	if !next.After(now) {
		next = time.Date(local.Year(), local.Month(), local.Day()+1, clock.Hour(), clock.Minute(), 0, 0, loc)
	}
	return next, nil
}

// RunOnStart reports whether a starting process must run a cycle right away:
// true unless a cycle of the source completed within the last 24 hours.
// Cancelled and failed cycles do not count.
func RunOnStart(ctx context.Context, db *sql.DB, source string, now time.Time) (bool, error) {
	var recent bool
	err := db.QueryRowContext(ctx, `SELECT EXISTS (
			SELECT 1 FROM public_sources.daily_runs
			WHERE source = $1 AND status = 'COMPLETED' AND finished_at > $2)`,
		source, now.Add(-24*time.Hour)).Scan(&recent)
	if err != nil {
		return false, fmt.Errorf("read the last completed daily run: %w", err)
	}
	return !recent, nil
}

// RunLocked runs a cycle while holding the source's daily advisory lock, so two
// replicator processes never sync the same source at once. It returns
// ran=false, without recording anything, when another process holds the lock.
func (c *Cycle) RunLocked(ctx context.Context) (CycleResult, bool, error) {
	conn, err := c.DB.Conn(ctx)
	if err != nil {
		return CycleResult{Status: "FAILED"}, false, fmt.Errorf("take a connection for the daily lock: %w", err)
	}
	defer conn.Close()
	var locked bool
	err = conn.QueryRowContext(ctx, `SELECT pg_try_advisory_lock(hashtext('public_sources.daily:' || $1::text))`,
		contratosgovbr.Source).Scan(&locked)
	if err != nil {
		return CycleResult{Status: "FAILED"}, false, fmt.Errorf("take the daily lock: %w", err)
	}
	if !locked {
		return CycleResult{}, false, nil
	}
	defer func() {
		_, unlockErr := conn.ExecContext(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock(hashtext('public_sources.daily:' || $1::text))`,
			contratosgovbr.Source)
		if unlockErr != nil {
			// Never hand a connection that may still hold the lock back to the pool.
			_ = conn.Raw(func(any) error { return driver.ErrBadConn })
			c.logger().Error("Could not release the daily lock; the connection was discarded", "error", unlockErr)
		}
	}()
	result, err := c.Run(ctx)
	return result, true, err
}

// Serve runs the daily schedule until ctx ends: one cycle on start unless one
// completed in the last 24 hours, then one cycle every day at "HH:MM" in loc.
// A failed cycle is logged and the next day's cycle still runs. It always
// returns a non-nil error: the context's, once ctx ends (a cycle in progress
// is recorded as CANCELLED first), or a configuration or database failure.
func (c *Cycle) Serve(ctx context.Context, at string, loc *time.Location) error {
	if _, err := NextRun(time.Now(), at, loc); err != nil {
		return err
	}
	start, err := RunOnStart(ctx, c.DB, contratosgovbr.Source, time.Now())
	if err != nil {
		return err
	}
	if start {
		c.runOnce(ctx)
	} else {
		c.logger().Info("Skipped the start cycle: a daily run completed in the last 24 hours")
	}
	for ctx.Err() == nil {
		next, err := NextRun(time.Now(), at, loc)
		if err != nil {
			return err
		}
		c.logger().Info("Waiting for the next daily run", "at", next.Format(time.RFC3339))
		timer := time.NewTimer(time.Until(next))
		select {
		case <-ctx.Done():
			timer.Stop()
		case <-timer.C:
			c.runOnce(ctx)
		}
	}
	return ctx.Err()
}

// runOnce runs one locked cycle and logs its outcome; errors never stop the schedule.
func (c *Cycle) runOnce(ctx context.Context) {
	result, ran, err := c.RunLocked(ctx)
	switch {
	case errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded):
		c.logger().Warn("Daily run cancelled", "dailyRunId", result.DailyRunID)
	case err != nil:
		c.logger().Error("Daily run failed; the next scheduled run will try again", "dailyRunId", result.DailyRunID, "error", err)
	case !ran:
		c.logger().Warn("Skipped the daily run: another daily run is in progress")
	}
}
