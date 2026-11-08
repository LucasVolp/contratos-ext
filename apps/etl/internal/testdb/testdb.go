// Package testdb creates isolated PostgreSQL databases for replicator tests.
// It is imported only by tests.
package testdb

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	_ "github.com/lib/pq"
)

// Migration is the API migration that creates the public_sources schema.
const Migration = "202611070001_public_sources_foundation"

// ContractsMigration is the API migration that creates the typed contract tables.
const ContractsMigration = "202611080001_public_sources_contracts"

// SyncMigration is the API migration that re-keys contract children per contract
// and adds the daily run tables.
const SyncMigration = "202611090001_public_sources_contract_sync"

// Isolated creates a random database on ETL_TEST_DATABASE_URL, applies the named
// API migrations in order and drops the database when the test ends. Tests are
// skipped when ETL_TEST_DATABASE_URL is unset.
func Isolated(t *testing.T, migrations ...string) *sql.DB {
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
		if _, err := admin.Exec(`DROP DATABASE "` + name + `" WITH (FORCE)`); err != nil {
			t.Error(err)
		}
		_ = admin.Close()
	})
	Exec(t, db, `CREATE TABLE public._sql_migrations (name text PRIMARY KEY)`)
	_, self, _, _ := runtime.Caller(0)
	directory := filepath.Join(filepath.Dir(self), "..", "..", "..", "api", "migrations")
	for _, migration := range migrations {
		content, err := os.ReadFile(filepath.Join(directory, migration+".sql"))
		if err != nil {
			t.Fatal(err)
		}
		Exec(t, db, string(content))
		Exec(t, db, "INSERT INTO public._sql_migrations VALUES ($1)", migration)
	}
	return db
}

// Exec runs a statement and fails the test on error.
func Exec(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

// Scalar returns the single text value of a query and fails the test on error.
func Scalar(t *testing.T, db *sql.DB, query string, args ...any) string {
	t.Helper()
	var value string
	if err := db.QueryRow(query, args...).Scan(&value); err != nil {
		t.Fatal(err)
	}
	return value
}
