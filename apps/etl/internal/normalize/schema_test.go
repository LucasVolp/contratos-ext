package normalize_test

import (
	"database/sql"
	"testing"

	"contracts-ext/etl/internal/testdb"
)

func migrated(t *testing.T) *sql.DB {
	t.Helper()
	return testdb.Isolated(t, testdb.Migration, testdb.ContractsMigration, testdb.SyncMigration)
}

func TestContractNumberKey(t *testing.T) {
	db := migrated(t)
	for in, want := range map[string]string{
		"00004/2017":   "4/2017",
		" 4/2017 ":     "4/2017",
		"2026ne000234": "2026NE000234",
		"0000/2020":    "0/2020",
		"12 / 2019":    "12/2019",
	} {
		if got := testdb.Scalar(t, db, `SELECT public_sources.contract_number_key($1)`, in); got != want {
			t.Fatalf("contract_number_key(%q) = %q, want %q", in, got, want)
		}
	}
	if got := testdb.Scalar(t, db, `SELECT coalesce(public_sources.contract_number_key(''), 'NULL')`); got != "NULL" {
		t.Fatalf("blank key = %q", got)
	}
}

func TestContractPartsRejectUnknownPart(t *testing.T) {
	db := migrated(t)
	testdb.Exec(t, db, `INSERT INTO public_sources.contracts (source, external_id, number, managing_unit_code, header_resource, captured_at, source_data)
		VALUES ('CONTRATOS_GOV_BR', 1, '1/2020', '158148', 'contract', now(), '{}')`)
	if _, err := db.Exec(`INSERT INTO public_sources.contract_parts (source, contract_external_id, part, status)
		VALUES ('CONTRATOS_GOV_BR', 1, 'payments', 'AVAILABLE')`); err == nil {
		t.Fatal("unknown part accepted")
	}
	testdb.Exec(t, db, `INSERT INTO public_sources.contract_parts (source, contract_external_id, part, status)
		VALUES ('CONTRATOS_GOV_BR', 1, 'header', 'AVAILABLE')`)
	testdb.Exec(t, db, `DELETE FROM public_sources.contracts`)
	if got := testdb.Scalar(t, db, `SELECT count(*) FROM public_sources.contract_parts`); got != "0" {
		t.Fatalf("parts not cascaded: %s", got)
	}
}

func TestDailyRunsSchema(t *testing.T) {
	db := migrated(t)
	if _, err := db.Exec(`INSERT INTO public_sources.daily_runs (source, status, etl_version) VALUES ('CONTRATOS_GOV_BR', 'COMPLETED', 'test')`); err == nil {
		t.Fatal("completed run without finished_at accepted")
	}
	testdb.Exec(t, db, `INSERT INTO public_sources.daily_runs (source, status, etl_version, finished_at) VALUES ('CONTRATOS_GOV_BR', 'COMPLETED', 'test', now())`)
	if got := testdb.Scalar(t, db, `SELECT count(*) FROM public_sources.daily_runs WHERE unit_count = 0 AND failed_unit_count = 0`); got != "1" {
		t.Fatalf("defaults = %s", got)
	}
	testdb.Exec(t, db, `INSERT INTO public_sources.capture_runs (source, trigger, target_type, target_code, etl_version) VALUES ('CONTRATOS_GOV_BR', 'SCHEDULED', 'MANAGEMENT_UNIT', '158148', 'test')`)
	if got := testdb.Scalar(t, db, `SELECT count(*) FROM public_sources.capture_runs WHERE daily_run_id IS NULL`); got != "1" {
		t.Fatalf("daily_run_id not nullable: %s", got)
	}
}
