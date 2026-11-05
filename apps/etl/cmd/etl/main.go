package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"contracts-ext/etl/internal/etl"
)

func execute(ctx context.Context, args []string) error {
	plan, err := parsePlan(args)
	if err != nil {
		return err
	}
	if plan.options.Date.IsZero() {
		return nil
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
	for date := plan.options.Date; !date.After(plan.through); date = nextPeriod(date, plan.options.Dataset) {
		opts := plan.options
		opts.Date = date
		result, err := etl.Run(ctx, db, opts)
		if result.RunID != 0 {
			_ = json.NewEncoder(os.Stdout).Encode(result)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := execute(ctx, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
