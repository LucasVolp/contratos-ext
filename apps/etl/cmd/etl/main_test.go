package main

import (
	"context"
	"strings"
	"testing"
)

func TestInputValidationRunsBeforeConnecting(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	for _, sample := range []struct {
		args    []string
		message string
	}{
		{[]string{"-file", "daily.zip", "-date", "2026-02-30", "-codes", "26421"}, "date must"},
		{[]string{"-file", "daily.zip", "-date", "2026-09-30"}, "scope code"},
		{[]string{"-file", "daily.zip", "-date", "2026-09-30", "-codes", "26421"}, "DATABASE_URL is required"},
		{[]string{"-kind", "ANNUAL_BUDGET", "-file", "annual.zip", "-date", "2026-01-01", "-codes", "26421"}, "DATABASE_URL is required"},
		{[]string{"-kind", "ANNUAL_BUDGET", "-scope", "MANAGEMENT", "-file", "annual.zip", "-date", "2026-01-01", "-codes", "26421"}, "requires SUBORDINATE_AGENCY"},
		{[]string{"-kind", "MONTHLY_EXECUTION", "-file", "monthly.zip", "-date", "2026-09-30", "-codes", "26421"}, "first day"},
	} {
		err := execute(context.Background(), sample.args)
		if err == nil || !strings.Contains(err.Error(), sample.message) {
			t.Fatalf("unexpected validation: %v", err)
		}
	}
}
