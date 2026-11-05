# Finance ETL

Independent Go CLI for downloading and importing **complete source ZIPs** from the
Transparency Portal into the Contracts Ext `finance` schema. It has no dependency
on SAGA or a running envelopa service. The public CSV column names remain in their
original language; all program and database identifiers use English.

This delivery covers commitments, current items, item history, liquidations,
payments and their impacted commitments, annual institutional budgets and monthly
execution aggregates. Omit `-file` to download automatically for one period or a
range. Local ZIPs, including an existing envelopa download cache, remain supported.

## Run from the repository root

Requirements: Go 1.24+ and the configured PostgreSQL database. Apply migrations
through Contracts Ext before importing:

```sh
pnpm db:migrate
pnpm finance:import -date 2026-09-30 -codes 26421
pnpm finance:import -from 2026-09-01 -to 2026-09-30 -codes 26421
```

The downloader requires migration `202611050002_financial_download_control` in
addition to the financial foundation. Both are owned by the API migration runner;
the Go program does not create schema objects. The new control row persists request
spacing and block penalties across processes and restarts.

Use `-file` to import an already downloaded ZIP without accessing the Portal:

```sh
pnpm finance:import -file ./data/finance/despesas_20260930.zip -date 2026-09-30 -scope MANAGEMENT -codes 26421
```

The wrapper loads the root `.env`, resolves the ZIP path against the caller's
working directory and runs the Go module. `FINANCE_DATABASE_URL` overrides
`DATABASE_URL` for the ETL, allowing a dedicated import role. The local Compose
example uses `?sslmode=disable`; configure TLS for a remote database as appropriate.
If your `.env` predates the ETL, add `FINANCE_DATABASE_URL` using `.env.example`
as a reference; the Go PostgreSQL driver requires TLS by default.
The ETL itself reads `DATABASE_URL` from the environment and never runs migrations.
The wrapper defaults the cache to the repository's `data/finance` directory;
`FINANCE_CACHE_DIR` or `-cache-dir` can override it. Relative paths are resolved
against the caller's directory before entering the Go module.

To select individual units rather than an entire management scope:

```sh
pnpm finance:import -file ./data/finance/despesas_20260930.zip -date 2026-09-30 -scope MANAGEMENT_UNIT -codes 158148,158635
```

To import monthly execution or annual institutional budget:

```sh
pnpm finance:import -kind MONTHLY_EXECUTION -file ./data/finance/202609_Despesas.zip -date 2026-09-01 -scope MANAGEMENT -codes 26421
pnpm finance:import -kind ANNUAL_BUDGET -file ./data/finance/2026_OrcamentoDespesa.zip -date 2026-01-01 -scope SUBORDINATE_AGENCY -codes 26421,26415
```

Automatic monthly/yearly downloads use the same scopes and period boundaries:

```sh
pnpm finance:import -kind MONTHLY_EXECUTION -from 2026-01-01 -to 2026-09-01 -codes 26421
pnpm finance:import -kind ANNUAL_BUDGET -from 2025-01-01 -to 2026-01-01 -codes 26421,26415
```

`-from` and `-to` are inclusive period starts. Monthly dates must be the first day
of a month; annual dates must be January 1. A range cannot be combined with `-file`
or `-date`. Periods are processed sequentially and stop at the first error. Each
attempt emits its own JSON result and ingestion audit, so completed periods remain
available after a later failure. Rerunning a daily range reuses valid ZIPs while
reimporting safely; annual/monthly ranges fetch fresh source snapshots again.

| Kind | Required CSV member | Reference date | Supported scope |
|---|---|---|---|
| `DAILY_EXPENSES` (default) | Seven `YYYYMMDD_Despesas_*.csv` files | Day of the archive | `MANAGEMENT` / `MANAGEMENT_UNIT` |
| `MONTHLY_EXECUTION` | `YYYYMM_Despesas.csv` | First day of the month | `MANAGEMENT` / `MANAGEMENT_UNIT` |
| `ANNUAL_BUDGET` | `YYYY_OrcamentoDespesa.csv` | January 1 of the fiscal year | `SUBORDINATE_AGENCY` |

If omitted, scope defaults to `SUBORDINATE_AGENCY` for annual budget and
`MANAGEMENT` otherwise. Annual agency codes identify institutions, not campuses.
Rows from a different reference period cause failure. The audit records the full
month/year interval, not just the first day supplied to the CLI.

To build a standalone binary without Node:

```sh
cd apps/etl
mkdir -p ../../dist
go build -o ../../dist/finance-etl ./cmd/etl
DATABASE_URL='postgresql://contracts:contracts_local@localhost:5540/contracts?sslmode=disable' ../../dist/finance-etl -file /absolute/path/despesas_20260930.zip -date 2026-09-30 -codes 26421
```

`-trigger SCHEDULED` labels an externally scheduled invocation; it does not start
a scheduler. A cron/service can invoke the CLI, but this delivery does not install
one. Scope codes are required. No institution is hardcoded in the program.
Success emits JSON containing the ingestion run ID, status, fact count and archive
SHA-256. Failure returns a nonzero exit status and marks a started run `FAILURE`.
An incomplete archive is a failure, not `NO_DATA`. Header-only files with no
matching facts produce `NO_DATA` and do not delete existing records.

## Import behavior

- Daily imports require all seven expected CSVs for the reference date; aggregate
  imports require their expected annual/monthly member. Duplicate ZIP members,
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

## Aggregate snapshot behavior

Annual and monthly source rows are summed at their complete stored classification
key using exact decimals before upsert. Null classification dimensions are part of
that key. Categories, agencies, action codes, locations and amendment authors are
kept separate where the source supports them; alphanumeric action codes remain text.
All contributing source rows are retained in `source_data`.

A successful nonempty refresh removes obsolete classifications only for represented
agency/year or management-unit/month scopes. Data outside those scope boundaries
is preserved. A requested agency/unit with no matching rows retains its previous
snapshot. An empty file is not evidence that the previous budget should be erased.
The whole selected snapshot, cleanup and successful audit status commit atomically.

Annual budget has no management-unit/campus allocation or application modality.
The importer preserves the actual category/group/element dimensions, without
manufacturing expense-nature codes or internal allocations. Monthly execution
never creates daily financial documents. Neither source writes `budget_distributions`.

Unlike daily documents, the aggregate period is not the source snapshot's publication
time: an annual/monthly file can be regenerated. A manually supplied file is treated
as the authoritative replacement for that period. No publication timestamp is inferred
from its filename, modification time or import time; an older version of the same
period can therefore replace a newer one if supplied manually.

Grant the import role read access to `public._sql_migrations`, schema usage, and
`SELECT/INSERT/UPDATE/DELETE` plus sequence usage only on ETL-owned finance tables.
Do not grant DDL, writes to existing catalog tables or writes to internal
`budget_distributions`. See [Financial data model](../../docs/finance-data-model.md).

## Automatic download pacing and cache

- Source routes are the official [daily expenses](https://portaldatransparencia.gov.br/download-de-dados/despesas),
  [monthly execution](https://portaldatransparencia.gov.br/download-de-dados/despesas-execucao)
  and [annual budget](https://portaldatransparencia.gov.br/download-de-dados/orcamento-despesa)
  downloads. URLs are derived from kind and period, not user-supplied endpoints.
- HTTP requests start at least **20 seconds** apart. Redirect requests consume a
  shared slot too. `-download-interval` may increase the minimum up to `2m`, in whole
  seconds; it cannot reduce it below `20s`. Transport connection reuse/HTTP2 retries
  are disabled so retries cannot occur outside the application pacing gate.
- HTTP 429 or any `X-Amzn-Waf-Action` response starts a **5m01s** shared cooldown.
  The effective interval doubles (20s → 40s → 80s → 120s), capped at two minutes.
  A longer `Retry-After` is honored, including HTTP-date headers. Duplicate notices
  during the active rate-limit window do not restart the default penalty.
- `finance.download_state` stores last request time, cooldown deadlines and the
  effective interval. Short row-lock transactions reserve slots using database time;
  waits happen outside transactions and are cancellable. These values survive ETL
  restarts, including the penalty on the final failed attempt. The increased interval
  is conservative and stays in effect across later runs.
- At most **three retries after the first attempt** are made; `-download-retries`
  accepts 0–3. Network/transfer failures, HTTP 408 and 5xx responses retry through
  the same gate. A server `Retry-After` on a transient response also delays callers.
  A missing archive (404), plain forbidden response (403) or invalid ZIP fails the
  period without repeated requests. CAPTCHA responses are paused, never bypassed.
- Daily ZIPs are validated and reused without a request. `-refresh-download` forces
  a new daily download. Monthly and annual ZIPs are always fetched again because the
  source can regenerate the same period's snapshot.
- Downloads stream to unique `.part` files with a 512 MiB compressed-size limit.
  Expected CSV members, required headers, CSV parsing and CRC are checked before
  atomic rename. Failure or cancellation removes only the new partial file and keeps
  the last complete cache. No failed download replaces financial facts with stale
  cache contents or a false empty dataset.

The shared gate coordinates only ETL processes using **this same database**. The
Portal observes the public IP: envelopa, another database or another client on the
same IP has its own request traffic. Run those downloaders separately or integrate
them with the same coordinator; this database cannot enforce their pace.

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
CLI always requires an explicit scope selection via codes. Automated tests never
download from the Portal.
Downloader tests use local HTTP servers, a virtual clock for long cooldowns, and
isolated PostgreSQL databases for shared pacing, independent connections, restart
persistence, download-to-import integration, cancelled waits and failed-attempt audit.
Run `go test -race ./...` with `ETL_TEST_DATABASE_URL` to include concurrency checks.

For a real monthly archive smoke test, set `ETL_TEST_MONTHLY_ARCHIVE` to the cached
ZIP and `ETL_TEST_MONTHLY_DATE` to its month start, then run
`go test ./internal/etl -run TestCachedMonthlyArchiveIntegration -count=1 -v` with
`ETL_TEST_DATABASE_URL`. Monthly source validation was exercised against the real
September 2026 ZIP (404 grouped facts for management 26421, loaded and replayed).
Annual source mapping follows envelopa's CSV mapper. A real automatic download of
the 2026 annual budget was also imported on 2026-11-05: 100 grouped facts for agency
26421, in an isolated database. To replay that downloaded file offline in tests, set
`ETL_TEST_ANNUAL_ARCHIVE` and `ETL_TEST_ANNUAL_DATE=2026-01-01`, then run
`go test ./internal/etl -run TestCachedAnnualArchiveIntegration -count=1 -v` with
`ETL_TEST_DATABASE_URL`.
