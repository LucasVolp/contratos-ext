package pacing

import (
	"testing"
	"time"
)

var testPolicy = Policy{Minimum: time.Second, Maximum: 30 * time.Second, BlockPause: 5*time.Minute + time.Second}

func TestReserveSpacesRequests(t *testing.T) {
	t0 := time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC)
	state, delay := State{}.Reserve(t0, testPolicy)
	if delay != 0 {
		t.Fatalf("first reservation delay = %v", delay)
	}
	if _, delay = state.Reserve(t0.Add(500*time.Millisecond), testPolicy); delay != 500*time.Millisecond {
		t.Fatalf("early reservation delay = %v, want 500ms", delay)
	}
	if _, delay = state.Reserve(t0.Add(time.Second), testPolicy); delay != 0 {
		t.Fatalf("on-time reservation delay = %v, want 0", delay)
	}
}

func TestPenalizeDoublesUpToMaximum(t *testing.T) {
	now := time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC)
	state := State{Interval: time.Second}
	want := []time.Duration{2 * time.Second, 4 * time.Second, 8 * time.Second, 16 * time.Second, 30 * time.Second, 30 * time.Second}
	for i, expected := range want {
		state = state.Penalize(now, 0, testPolicy)
		if state.Interval != expected {
			t.Fatalf("penalty %d interval = %v, want %v", i+1, state.Interval, expected)
		}
		now = now.Add(time.Hour) // past every block window
	}
}

func TestPenalizeDuringActiveBlockDoesNotRestart(t *testing.T) {
	t0 := time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC)
	first := State{Interval: time.Second}.Penalize(t0, 0, testPolicy)
	second := first.Penalize(t0.Add(time.Minute), 0, testPolicy)
	if !second.BlockedUntil.Equal(first.BlockedUntil) || second.Interval != first.Interval {
		t.Fatalf("duplicate penalty changed state: %+v -> %+v", first, second)
	}
	if !first.BlockedUntil.Equal(t0.Add(testPolicy.BlockPause)) {
		t.Fatalf("blocked until %v, want %v", first.BlockedUntil, t0.Add(testPolicy.BlockPause))
	}
}

func TestPenalizeHonorsLongerRetryAfter(t *testing.T) {
	now := time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC)
	state := State{Interval: time.Second}.Penalize(now, 10*time.Minute, testPolicy)
	if !state.BlockedUntil.Equal(now.Add(10 * time.Minute)) {
		t.Fatalf("blocked until %v, want %v", state.BlockedUntil, now.Add(10*time.Minute))
	}
}

func TestPolicyValidate(t *testing.T) {
	if err := testPolicy.Validate(); err != nil {
		t.Fatalf("valid policy rejected: %v", err)
	}
	for _, policy := range []Policy{
		{Minimum: 50 * time.Millisecond, Maximum: time.Second, BlockPause: time.Minute},
		{Minimum: 2 * time.Second, Maximum: time.Second, BlockPause: time.Minute},
		{Minimum: time.Second, Maximum: time.Second, BlockPause: 0},
	} {
		if err := policy.Validate(); err == nil {
			t.Fatalf("invalid policy accepted: %+v", policy)
		}
	}
}
