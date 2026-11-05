package main

import (
	"context"
	"strings"
	"testing"
	"time"

	"contracts-ext/etl/internal/etl"
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

func TestAutomaticPlansValidateRangesAndPacingBeforeConnecting(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	for _, args := range [][]string{
		{"-from", "2026-09-30", "-to", "2026-09-01", "-codes", "26421"},
		{"-from", "2026-09-01", "-codes", "26421"},
		{"-date", "2026-09-01", "-from", "2026-09-01", "-to", "2026-09-02", "-codes", "26421"},
		{"-file", "daily.zip", "-from", "2026-09-01", "-to", "2026-09-02", "-codes", "26421"},
		{"-date", "2026-09-01", "-codes", "26421", "-download-interval", "1s"},
		{"-date", "2026-09-01", "-codes", "26421", "-download-retries", "4"},
		{"-kind", "MONTHLY_EXECUTION", "-from", "2026-01-01", "-to", "2026-09-30", "-codes", "26421"},
	} {
		if _, err := parsePlan(args); err == nil {
			t.Fatalf("accepted unsafe/ambiguous plan: %v", args)
		}
	}
	for _, sample := range []struct {
		kind, from, to string
		periods        int
	}{
		{etl.DailyExpenses, "2026-09-29", "2026-10-01", 3},
		{etl.MonthlyExecution, "2026-01-01", "2026-03-01", 3},
		{etl.AnnualBudget, "2025-01-01", "2026-01-01", 2},
	} {
		plan, err := parsePlan([]string{"-kind", sample.kind, "-from", sample.from, "-to", sample.to, "-codes", "26421"})
		if err != nil {
			t.Fatal(err)
		}
		if plan.options.Download == nil || plan.options.Download.Interval != 20*time.Second || plan.options.Download.Retries != 3 {
			t.Fatal("unsafe automatic download defaults")
		}
		count := 0
		for date := plan.options.Date; !date.After(plan.through); date = nextPeriod(date, plan.options.Dataset) {
			count++
		}
		if count != sample.periods {
			t.Fatal("incorrect period expansion")
		}
	}
}
