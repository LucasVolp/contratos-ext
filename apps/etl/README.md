# Finance ETL

Independent Go CLI for importing a **complete daily expenses ZIP** from the
Transparency Portal into the Contracts Ext `finance` schema. It has no dependency
on SAGA or a running envelopa service. The public CSV column names remain in their
original language; all program and database identifiers use English.

This delivery covers commitments, current items, item history, liquidations,
payments and their impacted commitments. Automatic downloads, date-range scheduling,
annual budgets and monthly aggregates are subsequent steps. Input ZIPs can be
downloaded manually or reused from an existing envelopa download cache.

## Run from the repository root

Requirements: Go 1.24+ and the configured PostgreSQL database. Apply migrations
through Contracts Ext before importing:

```sh
pnpm db:migrate
pnpm finance:import -file ./data/finance/despesas_20260930.zip -date 2026-09-30 -scope MANAGEMENT -codes 26421
```

The wrapper loads the root `.env`, resolves the ZIP path against the caller's
working directory and runs the Go module. `FINANCE_DATABASE_URL` overrides
`DATABASE_URL` for the ETL, allowing a dedicated import role. The local Compose
example uses `?sslmode=disable`; configure TLS for a remote database as appropriate.
If your `.env` predates the ETL, add `FINANCE_DATABASE_URL` using `.env.example`
as a reference; the Go PostgreSQL driver requires TLS by default.
The ETL itself reads `DATABASE_URL` from the environment and never runs migrations.

To select individual units rather than an entire management scope:

```sh
pnpm finance:import -file ./data/finance/despesas_20260930.zip -date 2026-09-30 -scope MANAGEMENT_UNIT -codes 158148,158635
```

To build a standalone binary without Node:

```sh
cd apps/etl
mkdir -p ../../dist
go build -o ../../dist/finance-etl ./cmd/etl
DATABASE_URL='postgresql://contracts:contracts_local@localhost:5540/contracts?sslmode=disable' ../../dist/finance-etl -file /absolute/path/despesas_20260930.zip -date 2026-09-30 -codes 26421
```

`-trigger SCHEDULED` labels an externally scheduled invocation; it does not start
a scheduler. Scope codes are required. No institution is hardcoded in the program.
Success emits JSON containing the ingestion run ID, status, fact count and archive
SHA-256. Failure returns a nonzero exit status and marks a started run `FAILURE`.
An incomplete archive is a failure, not `NO_DATA`. Header-only files with no
matching facts produce `NO_DATA` and do not delete existing records.

## Import behavior

- Requires all seven expected CSVs for the reference date. Duplicate ZIP members,
  missing required columns and malformed rows abort the import. Members are streamed
  directly from ZIP without filesystem extraction. Each CSV is limited to 1 GiB.
- Supports Windows-1252 source data and UTF-8 exports. It filters documents by
  management/unit, items by their full commitment identity, and impacts by their
  payment/liquidation identity. It keeps payments against earlier-year commitments.
- Values remain exact decimal strings, including signed adjustments. Missing amounts
  stay null. Nonfinite values, numeric overflow and excess fractional precision fail
  instead of silently rounding. Source `MU`/`-1` classification markers stay in raw
  data and do not create artificial expense natures.
- Requires full document codes, preserving unit, management, fiscal year and leading
  zeros. References allow impacts/history to precede the commitment header. A current
  item without its archive header fails instead of being silently dropped.
- Repeated impact rows are summed at the exact database key before upsert; replay
  replaces amounts instead of adding them again. Historical operations use canonical
  source row hashes and occurrence ordinals, preserving identical repeated operations
  and remaining stable when row order changes.
- A source-wide PostgreSQL advisory lock serializes overlapping scopes, including
  management versus unit selection. The whole selected archive commits atomically.
  The audit attempt is created separately so failures remain visible after rollback.
- Only documents included in a complete archive refresh their child sets. Stale
  current items and impact rows are removed in that transaction; history and other
  documents remain. An older archive cannot replace a newer header or its children;
  missing historical headers can still be filled later.
- `processedRecords` counts fact rows actually upserted, excluding dimension/reference
  maintenance. A nonempty archive containing only older snapshots may succeed with
  zero writes. Status and fact updates commit together. Ctrl-C/SIGTERM rolls back
  open fact transactions and attempts to record failure with a separate cleanup context.

Grant the import role read access to `public._sql_migrations`, schema usage, and
`SELECT/INSERT/UPDATE/DELETE` plus sequence usage only on ETL-owned finance tables.
Do not grant DDL, writes to existing catalog tables or writes to internal
`budget_distributions`. See [Financial data model](../../docs/finance-data-model.md).

## Tests

```sh
cd apps/etl
go test ./...
go vet ./...
ETL_TEST_DATABASE_URL='postgresql://contracts:contracts_local@localhost:5540/contracts?sslmode=disable' go test ./... -count=1
```

Database tests require `CREATEDB`, create isolated random databases and remove
them afterward. They never migrate/import into the configured application database.
Without `ETL_TEST_DATABASE_URL`, PostgreSQL tests are explicitly skipped.

Optional real-file smoke test, using a local download:

```sh
ETL_TEST_DATABASE_URL='postgresql://contracts:contracts_local@localhost:5540/contracts?sslmode=disable' \
ETL_TEST_ARCHIVE=/absolute/path/despesas_20260930.zip \
ETL_TEST_ARCHIVE_DATE=2026-09-30 \
go test ./internal/etl -run TestCachedPortalArchiveIntegration -count=1 -v
```

The real-file smoke test uses management code `26421` as a test fixture scope; the
CLI always requires an explicit scope. No test downloads from the Portal.
