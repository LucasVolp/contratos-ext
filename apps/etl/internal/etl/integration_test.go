package etl

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func isolatedDatabase(t *testing.T, migrate bool) *sql.DB {
	t.Helper()
	connection := os.Getenv("ETL_TEST_DATABASE_URL")
	if connection == "" {
		t.Skip("ETL_TEST_DATABASE_URL is required for PostgreSQL integration tests")
	}
	admin, err := sql.Open("postgres", connection)
	if err != nil {
		t.Fatal(err)
	}
	random := make([]byte, 12)
	if _, err = rand.Read(random); err != nil {
		t.Fatal(err)
	}
	name := "etl_test_" + hex.EncodeToString(random)
	if _, err = admin.Exec(`CREATE DATABASE "` + name + `"`); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	parsed, err := url.Parse(connection)
	if err != nil {
		t.Fatal(err)
	}
	parsed.Path = "/" + name
	db, err := sql.Open("postgres", parsed.String())
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(4)
	t.Cleanup(func() {
		_ = db.Close()
		if _, err := admin.Exec(`DROP DATABASE "` + name + `"`); err != nil {
			t.Error(err)
		}
		_ = admin.Close()
	})
	if migrate {
		execSQL(t, db, `CREATE TABLE public._sql_migrations (name text PRIMARY KEY)`)
		for _, name := range []string{RequiredMigration, DownloadMigration, SourceCompatibilityMigration, MonthlyHierarchyMigration, ItemOccurrenceMigration} {
			migration, err := os.ReadFile(filepath.Join("..", "..", "..", "api", "migrations", name+".sql"))
			if err != nil {
				t.Fatal(err)
			}
			execSQL(t, db, string(migration))
			execSQL(t, db, "INSERT INTO public._sql_migrations VALUES ($1)", name)
		}
	}
	return db
}

func execSQL(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

func scalar(t *testing.T, db *sql.DB, query string, args ...any) string {
	t.Helper()
	var value string
	if err := db.QueryRow(query, args...).Scan(&value); err != nil {
		t.Fatal(err)
	}
	return value
}

func TestDailyImportIntegration(t *testing.T) {
	db := isolatedDatabase(t, true)
	ctx := context.Background()
	run := func(rows map[Kind][]Row) Result {
		t.Helper()
		result, err := Run(ctx, db, testOptions(writeFixture(t, rows, true, Kind(-1))))
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	first := run(dailyFixture())
	if first.Status != "SUCCESS" {
		t.Fatal(first)
	}
	reference := scalar(t, db, "SELECT id FROM finance.commitment_references WHERE document_code = '015814264212025NE000002'")
	for table, want := range map[string]string{"commitments": "1", "payments": "1", "liquidations": "1", "commitment_items": "2", "commitment_item_history": "3", "payment_commitments": "1", "liquidation_commitments": "1"} {
		if got := scalar(t, db, "SELECT count(*) FROM finance."+table); got != want {
			t.Fatalf("%s: %s != %s", table, got, want)
		}
	}
	if got := scalar(t, db, "SELECT paid_value_brl FROM finance.payment_commitments"); got != "0.300000" {
		t.Fatalf("incorrect prior-year payment: %s", got)
	}
	if got := scalar(t, db, "SELECT current_value FROM finance.commitment_items WHERE sequential = 1"); got != "10.123456" {
		t.Fatal(got)
	}
	if got := scalar(t, db, "SELECT code FROM finance.management_units"); got != "015814" {
		t.Fatal("lost leading zero")
	}
	run(dailyFixture())
	if got := scalar(t, db, "SELECT count(*) FROM finance.commitment_item_history"); got != "3" {
		t.Fatal("replay duplicated history")
	}
	if got := scalar(t, db, "SELECT paid_value_brl FROM finance.payment_commitments"); got != "0.300000" {
		t.Fatal("replay incremented money")
	}

	broken := dailyFixture()
	broken[Commitments][0]["Valor Original do Empenho"] = "999,00"
	broken[Items][0]["Valor Atual"] = "0,0000001"
	failed, err := Run(ctx, db, testOptions(writeFixture(t, broken, false, Kind(-1))))
	if err == nil || failed.Status != "FAILURE" {
		t.Fatal("lossy source amount was accepted")
	}
	if got := scalar(t, db, "SELECT original_value FROM finance.commitments"); got != "100.000000" {
		t.Fatal("failed import changed the prior header")
	}
	if got := scalar(t, db, "SELECT status FROM finance.ingestion_runs WHERE id = $1", failed.RunID); got != "FAILURE" {
		t.Fatal("failure not audited")
	}

	rows := dailyFixture()
	rows[Items] = rows[Items][:1]
	// Reordering the source rows does not change operation identities.
	rows[History][0], rows[History][2] = rows[History][2], rows[History][0]
	rows[PaymentImpacts] = nil
	run(rows)
	if got := scalar(t, db, "SELECT count(*) FROM finance.commitment_items"); got != "1" {
		t.Fatal("stale item retained")
	}
	if got := scalar(t, db, "SELECT count(*) FROM finance.payment_commitments"); got != "0" {
		t.Fatal("stale impact retained")
	}
	if got := scalar(t, db, "SELECT count(*) FROM finance.commitment_item_history"); got != "3" {
		t.Fatal("history changed after reorder")
	}
	// Restore payment links before the prior-year header arrives.
	run(dailyFixture())
	header := documentRow(Commitments, "015814264212025NE000002")
	header["Data Emissão"] = "20/12/2025"
	run(map[Kind][]Row{Commitments: {header}})
	if got := scalar(t, db, "SELECT id FROM finance.commitments WHERE fiscal_year = 2025"); got != reference {
		t.Fatal("late header replaced its reference")
	}
	if got := scalar(t, db, "SELECT count(*) FROM finance.payment_commitments pc JOIN finance.commitments c ON c.id = pc.commitment_id WHERE c.fiscal_year = 2025"); got != "1" {
		t.Fatal("lost cross-year relationship")
	}

	options := testOptions(writeFixture(t, dailyFixture(), false, Kind(-1)))
	options.Codes = []string{"99999"}
	empty, err := Run(ctx, db, options)
	if err != nil || empty.Status != "NO_DATA" {
		t.Fatalf("empty scope not distinguished: %v %v", empty, err)
	}
	if got := scalar(t, db, "SELECT count(*) FROM finance.commitments"); got != "2" {
		t.Fatal("empty scope cleared prior data")
	}
	older := dailyFixture()
	older[Commitments][0]["Valor Original do Empenho"] = "999,00"
	older[Items] = nil
	olderOptions := testOptions(writeFixture(t, older, false, Kind(-1), "20260929"))
	olderOptions.Date = olderOptions.Date.AddDate(0, 0, -1)
	if _, err := Run(ctx, db, olderOptions); err != nil {
		t.Fatal(err)
	}
	if got := scalar(t, db, "SELECT original_value FROM finance.commitments WHERE fiscal_year = 2026"); got != "100.000000" {
		t.Fatal("older archive replaced a newer header")
	}
	if got := scalar(t, db, "SELECT count(*) FROM finance.commitment_items WHERE commitment_id = (SELECT id FROM finance.commitments WHERE fiscal_year = 2026)"); got != "2" {
		t.Fatal("older archive removed newer items")
	}

	// A concurrent encompassing scope and unit scope must share the same lock.
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = conn.ExecContext(ctx, "SELECT pg_advisory_lock(4100, 14134)"); err != nil {
		t.Fatal(err)
	}
	blocked, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	_, err = Run(blocked, db, options)
	cancel()
	if _, unlockErr := conn.ExecContext(ctx, "SELECT pg_advisory_unlock(4100, 14134)"); unlockErr != nil {
		t.Fatal(unlockErr)
	}
	conn.Close()
	if err == nil {
		t.Fatal("concurrent import ignored the source lock")
	}
}

func TestImporterDoesNotCreateItsSchema(t *testing.T) {
	db := isolatedDatabase(t, false)
	_, err := Run(context.Background(), db, testOptions("missing.zip"))
	if err == nil || !strings.Contains(err.Error(), "pnpm db:migrate") {
		t.Fatalf("expected migration prerequisite: %v", err)
	}
	if got := scalar(t, db, "SELECT count(*) FROM information_schema.schemata WHERE schema_name = 'finance'"); got != "0" {
		t.Fatal("ETL created its schema")
	}
}

func TestCachedPortalArchiveIntegration(t *testing.T) {
	file := os.Getenv("ETL_TEST_ARCHIVE")
	date := os.Getenv("ETL_TEST_ARCHIVE_DATE")
	if file == "" || date == "" {
		t.Skip("set ETL_TEST_ARCHIVE and ETL_TEST_ARCHIVE_DATE for the real source archive smoke test")
	}
	parsedDate, err := time.Parse("2006-01-02", date)
	if err != nil {
		t.Fatal(err)
	}
	db := isolatedDatabase(t, true)
	options := testOptions(file)
	options.Date = parsedDate
	result, err := Run(context.Background(), db, options)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "SUCCESS" {
		t.Fatalf("expected source facts: %v", result)
	}
	replay, err := Run(context.Background(), db, options)
	if err != nil || replay.ProcessedRecords != result.ProcessedRecords {
		t.Fatalf("real archive replay failed: %v %v", replay, err)
	}
	t.Log(fmt.Sprintf("real archive loaded and replayed: %d facts per attempt", result.ProcessedRecords))
}

func TestHeaderlessItemsAndChronologyIntegration(t *testing.T) {
	db := isolatedDatabase(t, true)
	code := "015814264212026NE000001"
	run := func(date string, rows map[Kind][]Row) {
		t.Helper()
		opts := testOptions(writeFixture(t, rows, false, Kind(-1), date))
		opts.Date, _ = time.Parse("20060102", date)
		if _, err := Run(context.Background(), db, opts); err != nil {
			t.Fatal(err)
		}
	}
	rows := dailyFixture()
	rows[Commitments] = nil
	run("20260930", rows)
	if scalar(t, db, "SELECT count(*) FROM finance.commitments") != "0" {
		t.Fatal("manufactured header")
	}
	if scalar(t, db, "SELECT count(*) FROM finance.commitment_items") != "2" {
		t.Fatal("lost headerless items")
	}
	older := dailyFixture()
	older[Items][0]["Valor Atual"] = "999,00"
	older[Items] = older[Items][:1]
	run("20260929", older)
	if scalar(t, db, "SELECT count(*) FROM finance.commitments") != "1" {
		t.Fatal("late header missing")
	}
	if scalar(t, db, "SELECT count(*) FROM finance.commitment_items") != "2" {
		t.Fatal("old header cleared newer items")
	}
	if scalar(t, db, "SELECT current_value FROM finance.commitment_items WHERE sequential = 1") != "10.123456" {
		t.Fatal("old archive overwrote items")
	}
	partial := map[Kind][]Row{Items: {{"Código Empenho": code, "Sequencial": "1", "Valor Atual": "30,00"}}}
	run("20261001", partial)
	if scalar(t, db, "SELECT count(*) FROM finance.commitment_items") != "2" {
		t.Fatal("partial items erased siblings")
	}
	run("20260930", rows)
	if scalar(t, db, "SELECT current_value FROM finance.commitment_items WHERE sequential = 1") != "30.000000" {
		t.Fatal("old headerless archive overwrote items")
	}
	run("20261002", map[Kind][]Row{Commitments: {documentRow(Commitments, code)}})
	if scalar(t, db, "SELECT count(*) FROM finance.commitment_items") != "0" {
		t.Fatal("new complete header did not replace item snapshot")
	}
	run("20261001", partial)
	if scalar(t, db, "SELECT count(*) FROM finance.commitment_items") != "0" {
		t.Fatal("older orphan items bypassed newer header")
	}
}

func TestRepeatedItemSequentialIntegration(t *testing.T) {
	db := isolatedDatabase(t, true)
	rows := dailyFixture()
	rows[Commitments] = nil
	rows[Items] = append(rows[Items], cloneRow(rows[Items][0], Row{"Valor Unitário": "1321,80"}))
	run := func() {
		t.Helper()
		if _, err := Run(context.Background(), db, testOptions(writeFixture(t, rows, false, Kind(-1)))); err != nil {
			t.Fatal(err)
		}
	}
	run()
	before := scalar(t, db, "SELECT string_agg(id::text || ':' || source_data::text, '|' ORDER BY id) FROM finance.commitment_items")
	rows[Items][0], rows[Items][2] = rows[Items][2], rows[Items][0]
	run()
	if scalar(t, db, "SELECT count(*) FROM finance.commitment_items") != "3" {
		t.Fatal("lost or duplicated repeated sequentials")
	}
	if scalar(t, db, "SELECT string_agg(id::text || ':' || source_data::text, '|' ORDER BY id) FROM finance.commitment_items") != before {
		t.Fatal("source order changed item identity")
	}
	rows[Items] = rows[Items][:1]
	run()
	if scalar(t, db, "SELECT count(*) FROM finance.commitment_items") != "2" {
		t.Fatal("represented sequential was not refreshed independently of siblings")
	}
}
