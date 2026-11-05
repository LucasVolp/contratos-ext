package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"contracts-ext/etl/internal/etl"
)

func execute(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("finance-etl", flag.ContinueOnError)
	file := flags.String("file", "", "Complete daily expenses ZIP file")
	date := flags.String("date", "", "Archive reference date (YYYY-MM-DD)")
	scope := flags.String("scope", "MANAGEMENT", "MANAGEMENT or MANAGEMENT_UNIT")
	codes := flags.String("codes", "", "Comma-separated scope codes; leading zeros are preserved")
	trigger := flags.String("trigger", "MANUAL", "MANUAL or SCHEDULED")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments")
	}
	parsedDate, err := time.Parse("2006-01-02", *date)
	if err != nil {
		return fmt.Errorf("date must be YYYY-MM-DD")
	}
	opts := etl.Options{File: *file, Date: parsedDate, ScopeType: *scope, Codes: etl.NormalizeCodes(*codes), Trigger: *trigger}
	if err := opts.Validate(); err != nil {
		return err
	}
	connection := os.Getenv("DATABASE_URL")
	if connection == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	db, err := sql.Open("postgres", connection)
	if err != nil {
		return fmt.Errorf("open PostgreSQL connection: %w", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(2)
	ping, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err = db.PingContext(ping); err != nil {
		return fmt.Errorf("connect to PostgreSQL: %w", err)
	}
	result, err := etl.Run(ctx, db, opts)
	if result.RunID != 0 {
		_ = json.NewEncoder(os.Stdout).Encode(result)
	}
	return err
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := execute(ctx, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
