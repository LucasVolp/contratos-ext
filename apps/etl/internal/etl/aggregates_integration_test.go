package etl

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"
)

func runAggregateFixture(t *testing.T, db *sql.DB, opts Options, rows []Row) Result {
	t.Helper()
	opts.File = writeAggregateFixture(t, opts, rows, "")
	result, err := Run(context.Background(), db, opts)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestMonthlySnapshotIntegration(t *testing.T) {
	db := isolatedDatabase(t, true)
	opts, row := aggregateOptions(MonthlyExecution), monthlyRow()
	rows := []Row{row, cloneRow(row, Row{"Valor Empenhado (R$)": "0,20"}),
		cloneRow(row, Row{"Código Categoria Econômica": "4", "Valor Empenhado (R$)": "0,40"}),
		cloneRow(row, Row{"Código Unidade Gestora": "158148", "Valor Empenhado (R$)": "0,50"}),
		cloneRow(row, Row{"Código Órgão Subordinado": "26415", "Valor Empenhado (R$)": "0,60"}),
		cloneRow(row, Row{"Código Modalidade da Despesa": "90", "Valor Empenhado (R$)": "0,70"})}
	first := runAggregateFixture(t, db, opts, rows)
	if first.Status != "SUCCESS" || first.ProcessedRecords != 5 {
		t.Fatal(first)
	}
	if got := scalar(t, db, "SELECT sum(committed_value_brl) FROM finance.monthly_execution"); got != "2.500000" {
		t.Fatal(got)
	}
	if got := scalar(t, db, "SELECT count(*) FROM finance.commitments"); got != "0" {
		t.Fatal("monthly totals created detailed documents")
	}
	if got := scalar(t, db, "SELECT period_start::text || '/' || period_end::text FROM finance.ingestion_runs WHERE id = $1", first.RunID); got != "2026-09-01/2026-09-30" {
		t.Fatal("wrong audited monthly interval")
	}
	runAggregateFixture(t, db, opts, rows)
	if got := scalar(t, db, "SELECT sum(committed_value_brl) FROM finance.monthly_execution"); got != "2.500000" {
		t.Fatal("monthly replay incremented totals")
	}
	if got := scalar(t, db, "SELECT count(*) FROM finance.monthly_execution"); got != "5" {
		t.Fatal("monthly replay duplicated null dimensions")
	}

	august := opts
	august.Date = august.Date.AddDate(0, -1, 0)
	runAggregateFixture(t, db, august, []Row{cloneRow(row, Row{"Ano e mês do lançamento": "2026/08"})})
	unit := opts
	unit.ScopeType, unit.Codes = "MANAGEMENT_UNIT", []string{"015814"}
	runAggregateFixture(t, db, unit, []Row{cloneRow(row, Row{"Valor Empenhado (R$)": "1,00"})})
	if got := scalar(t, db, "SELECT count(*) FROM finance.monthly_execution WHERE reference_month = '2026-09-01'"); got != "2" {
		t.Fatal("stale classifications were not removed")
	}
	if got := scalar(t, db, "SELECT committed_value_brl FROM finance.monthly_execution WHERE management_unit_code = '158148'"); got != "0.500000" {
		t.Fatal("another unit was cleared")
	}
	if got := scalar(t, db, "SELECT count(*) FROM finance.monthly_execution WHERE reference_month = '2026-08-01'"); got != "1" {
		t.Fatal("another month was cleared")
	}
	if got := scalar(t, db, "SELECT count(*) FROM finance.monthly_execution WHERE liquidated_value_brl IS NULL"); got != "3" {
		t.Fatal("unknown amounts became zero")
	}
	empty := runAggregateFixture(t, db, opts, nil)
	if empty.Status != "NO_DATA" || scalar(t, db, "SELECT count(*) FROM finance.monthly_execution") != "3" {
		t.Fatal("empty archive cleared existing snapshots")
	}

	// Fail after the first upsert to prove that a partial refresh is rolled back.
	execSQL(t, db, `CREATE FUNCTION finance.reject_monthly_action() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.action_code = 'FAIL' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_monthly_action BEFORE INSERT OR UPDATE ON finance.monthly_execution
        FOR EACH ROW EXECUTE FUNCTION finance.reject_monthly_action()`)
	broken := []Row{cloneRow(row, Row{"Valor Empenhado (R$)": "999,00"}), cloneRow(row, Row{"Código Ação": "FAIL"})}
	unit.File = writeAggregateFixture(t, unit, broken, "")
	failed, err := Run(context.Background(), db, unit)
	if err == nil || failed.Status != "FAILURE" {
		t.Fatal("expected atomic refresh failure")
	}
	if got := scalar(t, db, "SELECT committed_value_brl FROM finance.monthly_execution WHERE management_unit_code = '015814' AND reference_month = '2026-09-01'"); got != "1.000000" {
		t.Fatal("failed refresh changed previous amounts")
	}
	if got := scalar(t, db, "SELECT status FROM finance.ingestion_runs WHERE id = $1", failed.RunID); got != "FAILURE" {
		t.Fatal("failed aggregate import not audited")
	}
}

func TestAnnualSnapshotIntegration(t *testing.T) {
	db := isolatedDatabase(t, true)
	execSQL(t, db, `INSERT INTO finance.management_units (management_code, code) VALUES ('26421','015814');
        INSERT INTO finance.expense_natures (code) VALUES ('339030');
        INSERT INTO finance.budget_distributions (id, fiscal_year, management_code, management_unit_code, expense_nature_code, type, amount)
        VALUES ('00000000-0000-4000-8000-000000000001', 2026, '26421','015814','339030','ESTIMATE',999)`)
	opts, row := aggregateOptions(AnnualBudget), annualRow()
	opts.Codes = []string{"26421", "26415"}
	rows := []Row{row, cloneRow(row, Row{"ORÇAMENTO INICIAL (R$)": "0,20"}),
		cloneRow(row, Row{"CÓDIGO AÇÃO": "20RG"}), cloneRow(row, Row{"CÓDIGO ÓRGÃO SUBORDINADO": "26415"})}
	first := runAggregateFixture(t, db, opts, rows)
	if first.Status != "SUCCESS" || first.ProcessedRecords != 3 {
		t.Fatal(first)
	}
	if got := scalar(t, db, "SELECT initial_budget FROM finance.annual_budgets WHERE subordinate_agency_code = '26421' AND action_code = '20RL'"); got != "0.300000" {
		t.Fatal("annual source rows were not summed")
	}
	if got := scalar(t, db, "SELECT period_end::text FROM finance.ingestion_runs WHERE id = $1", first.RunID); got != "2026-12-31" {
		t.Fatal("wrong annual audited interval")
	}
	runAggregateFixture(t, db, opts, rows)
	if got := scalar(t, db, "SELECT count(*) FROM finance.annual_budgets"); got != "3" {
		t.Fatal("annual replay duplicated rows")
	}
	prior := opts
	prior.Date = prior.Date.AddDate(-1, 0, 0)
	prior.Codes = []string{"26421"}
	runAggregateFixture(t, db, prior, []Row{cloneRow(row, Row{"EXERCÍCIO": "2025"})})
	opts.Codes = []string{"26421"}
	runAggregateFixture(t, db, opts, []Row{cloneRow(row, Row{"ORÇAMENTO INICIAL (R$)": "1,00"})})
	if got := scalar(t, db, "SELECT count(*) FROM finance.annual_budgets WHERE fiscal_year = 2026 AND subordinate_agency_code = '26421'"); got != "1" {
		t.Fatal("stale annual action retained")
	}
	if got := scalar(t, db, "SELECT count(*) FROM finance.annual_budgets WHERE subordinate_agency_code = '26415'"); got != "1" {
		t.Fatal("another agency was cleared")
	}
	if got := scalar(t, db, "SELECT count(*) FROM finance.annual_budgets WHERE fiscal_year = 2025"); got != "1" {
		t.Fatal("another fiscal year was cleared")
	}
	// Selecting an absent agency together with an existing one does not erase it.
	opts.Codes = []string{"26421", "26415"}
	runAggregateFixture(t, db, opts, []Row{row})
	if got := scalar(t, db, "SELECT count(*) FROM finance.annual_budgets WHERE subordinate_agency_code = '26415'"); got != "1" {
		t.Fatal("absent agency was treated as zero")
	}
	empty := runAggregateFixture(t, db, opts, nil)
	if empty.Status != "NO_DATA" {
		t.Fatal(empty)
	}
	if got := scalar(t, db, "SELECT amount FROM finance.budget_distributions"); got != "999.000000" {
		t.Fatal("ETL overwrote internal planning")
	}
	if got := scalar(t, db, "SELECT count(*) FROM finance.management_units"); got != "1" {
		t.Fatal("annual budget manufactured a campus")
	}
	if got := scalar(t, db, "SELECT count(*) FROM finance.expense_natures"); got != "1" {
		t.Fatal("annual budget manufactured a six-digit nature")
	}
}

func TestCachedMonthlyArchiveIntegration(t *testing.T) {
	file, date := os.Getenv("ETL_TEST_MONTHLY_ARCHIVE"), os.Getenv("ETL_TEST_MONTHLY_DATE")
	if file == "" || date == "" {
		t.Skip("set ETL_TEST_MONTHLY_ARCHIVE and ETL_TEST_MONTHLY_DATE for the real monthly archive smoke test")
	}
	opts := aggregateOptions(MonthlyExecution)
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil {
		t.Fatal(err)
	}
	opts.File, opts.Date = file, parsed
	db := isolatedDatabase(t, true)
	first, err := Run(context.Background(), db, opts)
	if err != nil {
		t.Fatal(err)
	}
	if first.Status != "SUCCESS" || first.ProcessedRecords == 0 {
		t.Fatal(first)
	}
	total := scalar(t, db, "SELECT sum(committed_value_brl) FROM finance.monthly_execution")
	second, err := Run(context.Background(), db, opts)
	if err != nil || second.ProcessedRecords != first.ProcessedRecords {
		t.Fatalf("monthly replay failed: %v %v", second, err)
	}
	if scalar(t, db, "SELECT sum(committed_value_brl) FROM finance.monthly_execution") != total {
		t.Fatal("monthly replay changed source totals")
	}
	t.Logf("real monthly archive loaded and replayed: %d aggregate facts per attempt", first.ProcessedRecords)
}

func TestCachedAnnualArchiveIntegration(t *testing.T) {
	file, date := os.Getenv("ETL_TEST_ANNUAL_ARCHIVE"), os.Getenv("ETL_TEST_ANNUAL_DATE")
	if file == "" || date == "" {
		t.Skip("set ETL_TEST_ANNUAL_ARCHIVE and ETL_TEST_ANNUAL_DATE for the real annual archive smoke test")
	}
	opts := aggregateOptions(AnnualBudget)
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil {
		t.Fatal(err)
	}
	opts.File, opts.Date = file, parsed
	db := isolatedDatabase(t, true)
	first, err := Run(context.Background(), db, opts)
	if err != nil || first.Status != "SUCCESS" || first.ProcessedRecords == 0 {
		t.Fatalf("annual source import failed: %v %v", first, err)
	}
	total := scalar(t, db, "SELECT sum(updated_budget) FROM finance.annual_budgets")
	second, err := Run(context.Background(), db, opts)
	if err != nil || second.ProcessedRecords != first.ProcessedRecords {
		t.Fatalf("annual replay failed: %v %v", second, err)
	}
	if scalar(t, db, "SELECT sum(updated_budget) FROM finance.annual_budgets") != total {
		t.Fatal("annual replay changed source totals")
	}
	t.Logf("real annual archive loaded and replayed: %d aggregate facts per attempt", first.ProcessedRecords)
}
