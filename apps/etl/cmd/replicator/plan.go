package main

import (
	"flag"
	"fmt"
	"io"
	"time"

	"contracts-ext/etl/internal/sources/contratosgovbr"
)

type syncPlan struct {
	source     string
	unit       string
	contractID int64
	inactive   bool
	trigger    string
	retries    int
	interval   time.Duration
}

// parseSync parses the flags of `replicator sync`.
func parseSync(args []string) (syncPlan, error) {
	flags := flag.NewFlagSet("replicator sync", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	policy := contratosgovbr.DefaultPolicy
	var plan syncPlan
	flags.StringVar(&plan.source, "source", "", "Source to sync: CONTRATOS_GOV_BR")
	flags.StringVar(&plan.unit, "unit", "", "Six-digit UG code whose contracts are synced")
	flags.Int64Var(&plan.contractID, "contract", 0, "Contratos.gov.br contract id to sync")
	flags.BoolVar(&plan.inactive, "inactive", true, "Also sync the UG's inactive contracts")
	flags.StringVar(&plan.trigger, "trigger", "MANUAL", "MANUAL or SCHEDULED")
	flags.IntVar(&plan.retries, "retries", 3, "Retries after the first attempt (0 to 3)")
	flags.DurationVar(&plan.interval, "interval", policy.Minimum, "Minimum request interval (whole milliseconds, 1s to 30s)")
	if err := flags.Parse(args); err != nil {
		return syncPlan{}, err
	}
	switch {
	case flags.NArg() != 0:
		return syncPlan{}, fmt.Errorf("unexpected positional arguments")
	case plan.source != contratosgovbr.Source:
		return syncPlan{}, fmt.Errorf("-source must be %s", contratosgovbr.Source)
	case (plan.unit == "") == (plan.contractID == 0):
		return syncPlan{}, fmt.Errorf("exactly one of -unit or -contract is required")
	case plan.unit != "" && !contratosgovbr.ValidUnit(plan.unit):
		return syncPlan{}, fmt.Errorf("-unit must be a six-digit UG code")
	case plan.contractID < 0:
		return syncPlan{}, fmt.Errorf("-contract must be a positive id")
	case plan.trigger != "MANUAL" && plan.trigger != "SCHEDULED":
		return syncPlan{}, fmt.Errorf("-trigger must be MANUAL or SCHEDULED")
	case plan.retries < 0 || plan.retries > 3:
		return syncPlan{}, fmt.Errorf("-retries must be between 0 and 3")
	case plan.interval%time.Millisecond != 0 || plan.interval < policy.Minimum || plan.interval > policy.Maximum:
		return syncPlan{}, fmt.Errorf("-interval must be whole milliseconds between %s and %s", policy.Minimum, policy.Maximum)
	}
	return plan, nil
}
