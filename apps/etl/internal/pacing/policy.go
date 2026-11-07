// Package pacing spaces requests to a public source and records cooldowns after
// rate-limit or WAF responses. State transitions are pure; PostgresGate persists
// them so independent processes using the same database share one pace.
package pacing

import (
	"database/sql"
	"fmt"
	"time"
)

// PenaltyDecay is how long after a cooldown ends, without a new block, the
// doubled interval is dropped and the policy minimum applies again.
const PenaltyDecay = time.Hour

// Policy holds the pacing limits of one source.
type Policy struct {
	Minimum    time.Duration // smallest interval between requests
	Maximum    time.Duration // cap for the interval after repeated blocks
	BlockPause time.Duration // default cooldown after a block
}

// Validate rejects limits that cannot pace a source safely.
func (p Policy) Validate() error {
	if p.Minimum < 100*time.Millisecond {
		return fmt.Errorf("pacing minimum must be at least 100ms")
	}
	if p.Maximum < p.Minimum {
		return fmt.Errorf("pacing maximum must not be below the minimum")
	}
	if p.BlockPause <= 0 {
		return fmt.Errorf("pacing block pause must be positive")
	}
	return nil
}

// State is the shared pacing state of one source. Interval is only the penalty
// interval earned by blocks (zero when none); a run's own minimum is applied on
// top of it and never stored, so one slow run cannot slow later ones.
type State struct {
	LastRequest      sql.NullTime
	BlockedUntil     time.Time
	RateLimitedUntil time.Time
	Interval         time.Duration
}

// Reserve claims a request slot at now, or returns how long to wait first. A
// penalty older than PenaltyDecay past its cooldown is dropped.
func (s State) Reserve(now time.Time, p Policy) (State, time.Duration) {
	if s.Interval > 0 && now.After(s.RateLimitedUntil.Add(PenaltyDecay)) {
		s.Interval = 0
	}
	earliest := s.BlockedUntil
	if s.LastRequest.Valid {
		earliest = later(earliest, s.LastRequest.Time.Add(max(s.Interval, p.Minimum)))
	}
	if earliest.After(now) {
		return s, earliest.Sub(now)
	}
	s.LastRequest = sql.NullTime{Time: now, Valid: true}
	return s, 0
}

// Penalize records a block. A new block doubles the interval (capped at the
// maximum) and starts the default pause; a repeated notice during an active
// block changes nothing except honoring a longer Retry-After.
func (s State) Penalize(now time.Time, retryAfter time.Duration, p Policy) State {
	if !s.RateLimitedUntil.After(now) {
		s.Interval = min(p.Maximum, max(p.Minimum, s.Interval)*2)
		s.RateLimitedUntil = later(s.BlockedUntil, now.Add(p.BlockPause))
	}
	if retryAfter > 0 {
		s.RateLimitedUntil = later(s.RateLimitedUntil, now.Add(retryAfter))
	}
	s.BlockedUntil = later(s.BlockedUntil, s.RateLimitedUntil)
	return s
}

func later(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}
