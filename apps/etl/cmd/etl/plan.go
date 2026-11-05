package main

import (
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"time"

	"contracts-ext/etl/internal/etl"
)

type executionPlan struct {
	options etl.Options
	through time.Time
}

func parsePlan(args []string) (executionPlan, error) {
	flags := flag.NewFlagSet("finance-etl", flag.ContinueOnError)
	file := flags.String("file", "", "Local ZIP file; omit to download automatically")
	kind := flags.String("kind", etl.DailyExpenses, "DAILY_EXPENSES, MONTHLY_EXECUTION or ANNUAL_BUDGET")
	date := flags.String("date", "", "Single reference period start (YYYY-MM-DD)")
	from := flags.String("from", "", "First period start in an automatic download range (inclusive)")
	to := flags.String("to", "", "Last period start in an automatic download range (inclusive)")
	scope := flags.String("scope", "", "MANAGEMENT, MANAGEMENT_UNIT or SUBORDINATE_AGENCY; defaults according to kind")
	codes := flags.String("codes", "", "Comma-separated scope codes; leading zeros are preserved")
	trigger := flags.String("trigger", "MANUAL", "MANUAL or SCHEDULED")
	cacheDefault := os.Getenv("FINANCE_CACHE_DIR")
	if cacheDefault == "" {
		cacheDefault = "data/finance"
	}
	cache := flags.String("cache-dir", cacheDefault, "Directory for validated downloaded ZIPs")
	interval := flags.Duration("download-interval", 20*time.Second, "Minimum request interval (whole seconds, 20s to 2m)")
	retries := flags.Int("download-retries", 3, "Maximum retries after the initial request (0 to 3)")
	refresh := flags.Bool("refresh-download", false, "Download a fresh daily ZIP instead of reusing valid cache")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return executionPlan{}, nil
		}
		return executionPlan{}, err
	}
	if flags.NArg() != 0 {
		return executionPlan{}, fmt.Errorf("unexpected positional arguments")
	}
	ranged := *from != "" || *to != ""
	if ranged && (*file != "" || *date != "") {
		return executionPlan{}, fmt.Errorf("date ranges cannot be combined with -file or -date")
	}
	if ranged && (*from == "" || *to == "") {
		return executionPlan{}, fmt.Errorf("-from and -to must be supplied together")
	}
	startValue, endValue := *date, *date
	if ranged {
		startValue, endValue = *from, *to
	}
	start, err := time.Parse("2006-01-02", startValue)
	if err != nil {
		return executionPlan{}, fmt.Errorf("date must be YYYY-MM-DD")
	}
	end, err := time.Parse("2006-01-02", endValue)
	if err != nil {
		return executionPlan{}, fmt.Errorf("date must be YYYY-MM-DD")
	}
	if end.Before(start) {
		return executionPlan{}, fmt.Errorf("range end precedes its start")
	}
	if *scope == "" {
		*scope = "MANAGEMENT"
		if *kind == etl.AnnualBudget {
			*scope = "SUBORDINATE_AGENCY"
		}
	}
	opts := etl.Options{File: *file, Date: start, ScopeType: *scope, Codes: etl.NormalizeCodes(*codes), Trigger: *trigger, Dataset: *kind}
	if *file == "" {
		opts.Download = &etl.DownloadOptions{Directory: *cache, Interval: *interval, Retries: *retries, Refresh: *refresh, Log: slog.Info}
	} else if *refresh {
		return executionPlan{}, fmt.Errorf("-refresh-download cannot be combined with -file")
	}
	if err := opts.Validate(); err != nil {
		return executionPlan{}, err
	}
	last := opts
	last.Date = end
	if err := last.Validate(); err != nil {
		return executionPlan{}, err
	}
	return executionPlan{options: opts, through: end}, nil
}

func nextPeriod(date time.Time, dataset string) time.Time {
	switch dataset {
	case etl.MonthlyExecution:
		return date.AddDate(0, 1, 0)
	case etl.AnnualBudget:
		return date.AddDate(1, 0, 0)
	default:
		return date.AddDate(0, 0, 1)
	}
}
