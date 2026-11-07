# Replicator Foundation Implementation Plan (Phase 1, Step 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Go ETL into a multi-source replicator foundation and use it to capture raw Contratos.gov.br data for one UG or one contract into PostgreSQL. No normalization and no screens yet.

**Architecture:** New Go packages beside the untouched finance ETL (`internal/etl`). `internal/pacing` generalizes persistent request pacing per source. `internal/capture` holds the HTTP fetcher and the raw capture store (runs, content-addressed JSON captures, per-request attempts). `internal/sources/contratosgovbr` is the first connector. A new binary `cmd/replicator` exposes `sync`. Schema objects live in a new `public_sources` schema, created by an API-owned SQL migration.

**Tech Stack:** Go 1.24, `database/sql` + `github.com/lib/pq`, `net/http`, PostgreSQL 16, SQL migrations run by `apps/api/src/migrate.ts`, a Node wrapper script like `scripts/finance-etl.cjs`.

**Spec:** `docs/superpowers/specs/2026-11-07-institutional-copilot-design.md`, sections 4.1, 4.5 and 4.8, plus the roadmap (section 5, Phase 1 step 1).

## Prerequisite

`main` is in the middle of merging PR #1 (`feat/authentication`). Do not start until the merge commit exists. Then branch from `main` (for example `feat/replicator-foundation`). This step does not touch authentication code.

## Global Constraints

- English for all technical artifacts: schema, tables, columns, constraints, enum values, identifiers, comments, tests, docs (`AGENTS.md`). Any user-facing copy stays in Portuguese (there is none in this step).
- The Go program never creates schema objects. Migrations live in `apps/api/migrations/` and are applied by `pnpm db:migrate`.
- Do not modify finance ETL behavior (`apps/etl/internal/etl`, `apps/etl/cmd/etl`, `scripts/finance-etl.cjs`). `go test ./...` must stay green.
- Allowed source host: `contratos.comprasnet.gov.br` over HTTPS. Only public per-contract and per-UG endpoints under `/api/contrato/...`; no `/api/v1/...` (bearer-only).
- Request headers: `Accept: application/json` and `User-Agent: Mozilla/5.0 (compatible; contracts-ext-replicator/<Version>)`.
- At most 3 retries after the first attempt. HTTP 429, or any response with an `X-Amzn-Waf-Action` header, starts a shared cooldown of `5m01s`. A longer `Retry-After` is honored.
- Automated tests never call real sources. They use `httptest` servers and isolated PostgreSQL databases (`ETL_TEST_DATABASE_URL`, skipped when unset).
- Commit messages: conventional style (`feat(sources): …`), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Designer's calls fixed by this plan

- Contratos.gov.br pacing: minimum interval **1s**, maximum **30s**, block pause **5m01s**. The interval doubles on each new block, as finance does.
- Sub-resources captured per contract (Phase 1 needs): `historico`, `empenhos`, `garantias`, `responsaveis`, `itens`, `faturas`, `arquivos`. Cronograma, prepostos, ocorrências, terceirizados and despesas acessórias are not captured.
- A UG sync includes inactive contracts by default (`-inactive=true`).
- Response body cap: **32 MiB**. HTTP client timeout: **60s**.
- Exit code: `FAILED` → 1, `SUCCEEDED` and `PARTIAL` → 0. The JSON summary carries the status.

## Review Focus

1. **A 200 response whose body is not JSON** (WAF challenge HTML) must be recorded as `FAILED`, never stored as a capture. The test goes in Task 4.
2. **An empty listing `[]`** for a UG is a valid capture. The run ends `SUCCEEDED` with zero contracts, not an error. The test goes in Task 5.
3. **Interrupting a run (Ctrl+C / SIGTERM)** must finish it as `FAILED` with error `cancelled`, never leave it `RUNNING`. The test goes in Task 5.
4. **The same contract id in both the active and inactive listings** is synced once. The test goes in Task 5.
5. **An oversized or truncated body** (more than 32 MiB, or a connection cut mid-body) is `FAILED` and nothing is stored. The test goes in Task 4.

---

## File Structure

| Path | Responsibility |
|---|---|
| `apps/api/migrations/202611070001_public_sources_foundation.sql` | `public_sources` schema: pacing state, capture runs, captures, attempts, latest view |
| `apps/etl/internal/testdb/testdb.go` | Isolated PostgreSQL databases for tests, with selected migrations applied; helpers `Exec`, `Scalar` |
| `apps/etl/internal/pacing/policy.go` | Pure pacing state transitions parameterized by `Policy` |
| `apps/etl/internal/pacing/postgres.go` | `PostgresGate`, persisted in `public_sources.source_pacing` |
| `apps/etl/internal/capture/canonical.go` | `Canonicalize`, `Request.Key` |
| `apps/etl/internal/capture/store.go` | Runs, captures, attempts |
| `apps/etl/internal/capture/fetch.go` | Hardened HTTP client and `Fetcher.GetJSON` with gate, retries, classification |
| `apps/etl/internal/sources/contratosgovbr/connector.go` | Contratos.gov.br endpoints, `SyncUnit`, `SyncContract` |
| `apps/etl/cmd/replicator/main.go`, `plan.go` | CLI `sync` |
| `scripts/sources-sync.cjs`, root `package.json` | `pnpm sources:sync` wrapper |
| `docs/public-sources-data-model.md`, `apps/etl/README.md` | Documentation |

---

### Task 1: `public_sources` schema and test database helper

**Files:**
- Create: `apps/api/migrations/202611070001_public_sources_foundation.sql`
- Create: `apps/etl/internal/testdb/testdb.go`
- Test: `apps/etl/internal/testdb/testdb_test.go`

**Interfaces:**
- Produces (SQL):
  - `public_sources.source_pacing(source text PK, last_request_at timestamptz NULL, blocked_until timestamptz NOT NULL DEFAULT '1970-01-01Z', rate_limited_until timestamptz NOT NULL DEFAULT '1970-01-01Z', interval_ms integer NOT NULL CHECK (interval_ms BETWEEN 100 AND 600000), updated_at timestamptz NOT NULL DEFAULT now())`, seeded with `('CONTRATOS_GOV_BR', interval_ms = 1000)`.
  - `public_sources.capture_runs(id bigint identity PK, source text NOT NULL, trigger text NOT NULL CHECK IN ('MANUAL','SCHEDULED','REQUESTED'), target_type text NOT NULL CHECK IN ('MANAGEMENT_UNIT','CONTRACT'), target_code text NOT NULL, status text NOT NULL DEFAULT 'RUNNING' CHECK IN ('RUNNING','SUCCEEDED','PARTIAL','FAILED'), request_count, captured_count, unchanged_count, not_found_count, failed_count integer NOT NULL DEFAULT 0, error text NULL, etl_version text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz NULL)`, with a CHECK that `finished_at IS NULL` exactly when `status = 'RUNNING'`.
  - `public_sources.captures(id bigint identity PK, source text NOT NULL, resource text NOT NULL, request_key text NOT NULL, content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'), payload jsonb NOT NULL, first_captured_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(), first_run_id bigint NOT NULL REFERENCES capture_runs, last_run_id bigint NOT NULL REFERENCES capture_runs, UNIQUE (source, request_key, content_hash))`, with an index on `(source, request_key, last_seen_at DESC)`.
  - `public_sources.capture_attempts(id bigint identity PK, run_id bigint NOT NULL REFERENCES capture_runs, source text NOT NULL, resource text NOT NULL, request_key text NOT NULL, outcome text NOT NULL CHECK IN ('CAPTURED','UNCHANGED','NOT_FOUND','FAILED'), http_status integer NULL, capture_id bigint NULL REFERENCES captures, error text NULL, attempted_at timestamptz NOT NULL DEFAULT now())`, with a CHECK that `capture_id IS NOT NULL` exactly when outcome is in (`CAPTURED`, `UNCHANGED`), and an index on `(source, request_key, attempted_at DESC)`.
  - View `public_sources.latest_captures`: `SELECT DISTINCT ON (source, request_key) * FROM public_sources.captures ORDER BY source, request_key, last_seen_at DESC, id DESC`.
  - `COMMENT ON` for each table, stating that the replicator owns writes and the API only reads.
- Produces (Go, package `testdb`):
  - `func Isolated(t *testing.T, migrations ...string) *sql.DB`. Same approach as `isolatedDatabase` in `internal/etl/integration_test.go`. It creates `public._sql_migrations (name text PRIMARY KEY)`, applies each named file from `apps/api/migrations/<name>.sql`, and records its name. The directory is resolved from `testdb.go`'s own location via `runtime.Caller(0)` (`../../../api/migrations`), so it works from any test package.
  - `func Exec(t *testing.T, db *sql.DB, query string, args ...any)`
  - `func Scalar(t *testing.T, db *sql.DB, query string, args ...any) string`
  - `const Migration = "202611070001_public_sources_foundation"`

- [ ] **Step 1: Write the failing test** `TestPublicSourcesMigration` in `testdb_test.go`:

```go
db := testdb.Isolated(t, testdb.Migration)
if got := testdb.Scalar(t, db, `SELECT interval_ms FROM public_sources.source_pacing WHERE source = 'CONTRATOS_GOV_BR'`); got != "1000" { t.Fatalf("seed interval = %s", got) }
// A finished run cannot stay RUNNING and a RUNNING run cannot have finished_at.
if _, err := db.Exec(`INSERT INTO public_sources.capture_runs (source, trigger, target_type, target_code, etl_version, finished_at) VALUES ('X','MANUAL','CONTRACT','1','t', now())`); err == nil { t.Fatal("RUNNING run accepted finished_at") }
// FAILED attempts cannot reference a capture; CAPTURED attempts must.
```

Use `testdb.Exec` to insert one valid run, then assert that a `CAPTURED` attempt with `capture_id NULL` is rejected.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/etl && ETL_TEST_DATABASE_URL='postgresql://contracts:contracts_local@localhost:5540/contracts?sslmode=disable' go test ./internal/testdb -run TestPublicSourcesMigration -count=1`
Expected: FAIL (package or migration file missing).

- [ ] **Step 3: Write the migration and `testdb.go`** as specified in Interfaces.

- [ ] **Step 4: Run the test again, plus the API migration path**

Run the same `go test` command. Expected: PASS.
Run: `pnpm db:migrate`. Expected: applies `202611070001_public_sources_foundation` with no error.
Run: `pnpm --filter @contracts/api test`. Expected: PASS (the migration runner accepts the new file).

- [ ] **Step 5: Commit**

```bash
git add apps/api/migrations/202611070001_public_sources_foundation.sql apps/etl/internal/testdb
git commit -m "feat(sources): add public sources capture schema"
```

---

### Task 2: Per-source persistent pacing

**Files:**
- Create: `apps/etl/internal/pacing/policy.go`, `apps/etl/internal/pacing/postgres.go`
- Test: `apps/etl/internal/pacing/policy_test.go`, `apps/etl/internal/pacing/postgres_test.go`

**Interfaces:**
- Consumes: `testdb.Isolated`, table `public_sources.source_pacing` (Task 1).
- Produces:
  - `type Policy struct { Minimum, Maximum, BlockPause time.Duration }` and `func (p Policy) Validate() error`, which requires `0 < Minimum <= Maximum`, `BlockPause > 0`, and `Minimum >= 100ms`.
  - `type State struct { LastRequest sql.NullTime; BlockedUntil, RateLimitedUntil time.Time; Interval time.Duration }`
  - `func (s State) Reserve(now time.Time, p Policy) (State, time.Duration)`: same semantics as `pacingState.reserve` in `internal/etl/pacing.go`.
  - `func (s State) Penalize(now time.Time, retryAfter time.Duration, p Policy) State`: same semantics as `pacingState.penalize`, using `p.Minimum`, `p.Maximum`, `p.BlockPause` instead of the finance constants.
  - `type Gate interface { Wait(ctx context.Context) error; Block(ctx context.Context, retryAfter time.Duration) error; Delay(ctx context.Context, d time.Duration) error }`
  - `type TxStarter interface { BeginTx(context.Context, *sql.TxOptions) (*sql.Tx, error) }`
  - `type PostgresGate struct { DB TxStarter; Source string; Policy Policy; Log func(string, ...any) }`, which implements `Gate`. It works like finance's `postgresGate`: row lock `FOR UPDATE` on `public_sources.source_pacing WHERE source = $1`, database `clock_timestamp()`, waits outside transactions, cancellable. Interval is persisted in milliseconds. A missing source row returns the error `pacing state for source <X> is not installed`.

- [ ] **Step 1: Write the failing unit tests** in `policy_test.go`, with `p := Policy{Minimum: time.Second, Maximum: 30 * time.Second, BlockPause: 5*time.Minute + time.Second}`:
  - `TestReserveSpacesRequests`: after one reservation at `t0`, a reservation at `t0+500ms` returns delay `500ms`; at `t0+1s` it returns `0`.
  - `TestPenalizeDoublesUpToMaximum`: successive penalties at non-overlapping times give intervals `2s, 4s, 8s, 16s, 30s, 30s`.
  - `TestPenalizeDuringActiveBlockDoesNotRestart`: a second `Penalize` at `t0+1m` keeps the same `BlockedUntil` and `Interval`.
  - `TestPenalizeHonorsLongerRetryAfter`: `retryAfter = 10m` gives `BlockedUntil == now+10m`.
  - `TestPolicyValidate`: `Minimum: 50ms` is rejected.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/etl && go test ./internal/pacing -run 'TestReserve|TestPenalize|TestPolicy' -count=1`
Expected: FAIL (undefined).

- [ ] **Step 3: Implement `policy.go`.**

- [ ] **Step 4: Run the unit tests.** Expected: PASS.

- [ ] **Step 5: Write the failing integration test** `TestPostgresGatePersistsAcrossConnections` in `postgres_test.go`. Mirror `TestPersistentPacingAcrossIndependentConnections`, but on `public_sources.source_pacing` with source `CONTRATOS_GOV_BR`:
  - two connections: the second `Wait` within 50ms hits `context.DeadlineExceeded`;
  - after `Block(ctx, 0)`, `interval_ms` is `2000`;
  - a duplicate `Block` does not change `blocked_until`;
  - a fresh gate respects the persisted cooldown.

  Also write `TestPostgresGateUnknownSource`: `Source: "NOPE"` → `Wait` returns an error containing `not installed`.

- [ ] **Step 6: Run it to verify it fails**, with `ETL_TEST_DATABASE_URL=… go test ./internal/pacing -run TestPostgresGate -count=1`. Expected: FAIL.

- [ ] **Step 7: Implement `postgres.go`.**

- [ ] **Step 8: Run the whole package with race detection**, with `ETL_TEST_DATABASE_URL=… go test -race ./internal/pacing -count=1`. Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/etl/internal/pacing
git commit -m "feat(sources): add per-source persistent request pacing"
```

---

### Task 3: Canonical JSON and capture store

**Files:**
- Create: `apps/etl/internal/capture/canonical.go`, `apps/etl/internal/capture/store.go`
- Test: `apps/etl/internal/capture/canonical_test.go`, `apps/etl/internal/capture/store_test.go`

**Interfaces:**
- Consumes: Task 1 tables, `testdb`.
- Produces:
  - `func Canonicalize(body []byte) (canonical []byte, hash string, err error)`. Decode with `json.Decoder.UseNumber()` into `any`, re-encode with `encoding/json` (sorted map keys, no HTML escaping via `SetEscapeHTML(false)`, no trailing newline). `hash` is the lowercase hex SHA-256 of `canonical`. Trailing data after the first JSON value is an error.
  - `type Request struct { Resource string; Path string; Query url.Values }` and `func (r Request) Key() string`, which returns `Path`, plus `"?" + Query.Encode()` when the query is non-empty (`Encode` sorts keys).
  - `type Outcome string` with constants `Captured = "CAPTURED"`, `Unchanged = "UNCHANGED"`, `NotFound = "NOT_FOUND"`, `Failed = "FAILED"`.
  - `type Result struct { Status int; Canonical []byte; Hash string; NotFound bool; Err error }`. Produced by Task 4.
  - `type RunStart struct { Source, Trigger, TargetType, TargetCode, Version string }`
  - `type RunSummary struct { Status string; Requests, Captured, Unchanged, NotFound, Failed int; Error string }`. JSON tags `status, requests, captured, unchanged, notFound, failed, error,omitempty`. Method `func (s *RunSummary) Add(o Outcome)` increments `Requests` and the matching counter.
  - `type Store struct { DB *sql.DB }`
  - `func (s *Store) StartRun(ctx context.Context, start RunStart) (int64, error)`
  - `func (s *Store) Record(ctx context.Context, runID int64, source string, req Request, res Result) (Outcome, error)`. One transaction:
    - `res.Err != nil` → attempt `FAILED`, with the error text and status.
    - `res.NotFound` → attempt `NOT_FOUND`.
    - Otherwise, read the `content_hash` of the latest capture for `(source, req.Key())`.
      - If it equals `res.Hash`: update `last_seen_at = now(), last_run_id`, attempt `UNCHANGED`.
      - If not: upsert on `(source, request_key, content_hash)`. Insert a new row, or update `last_seen_at/last_run_id` of an older identical row. Attempt `CAPTURED`.
    - Always insert exactly one `capture_attempts` row.
  - `func (s *Store) FinishRun(ctx context.Context, runID int64, summary RunSummary) error`. Sets status, counters, error, `finished_at = now()`.

- [ ] **Step 1: Write the failing unit tests** in `canonical_test.go`:
  - `TestCanonicalizeSortsKeysAndKeepsNumbers`: `{"b":1,"a":"54.793,53","n":12345678901234567890}` and `{"a":"54.793,53","n":12345678901234567890,"b":1}` produce identical canonical bytes and hash. The canonical output contains `12345678901234567890` verbatim.
  - `TestCanonicalizeRejectsNonJSON`: `<html>` and `{"a":1} trailing` both return an error.
  - `TestRequestKeySortsQuery`: `Request{Path: "/api/x", Query: url.Values{"b": {"2"}, "a": {"1"}}}.Key() == "/api/x?a=1&b=2"`. An empty query gives `"/api/x"`.

- [ ] **Step 2: Run them to verify they fail**, with `cd apps/etl && go test ./internal/capture -run 'TestCanonicalize|TestRequestKey' -count=1`. Expected: FAIL.

- [ ] **Step 3: Implement `canonical.go`.** Run the tests. Expected: PASS.

- [ ] **Step 4: Write the failing integration test** `TestStoreRecordsOutcomes` in `store_test.go`. Start a run. For one request key, record contents A, A, B, A, then a `NotFound` and an `Err`. Assert:
  - the outcomes are `CAPTURED, UNCHANGED, CAPTURED, CAPTURED, NOT_FOUND, FAILED`;
  - `SELECT count(*) FROM public_sources.captures` is `2`, because A is reused;
  - `latest_captures` payload for the key equals A;
  - `capture_attempts` has `6` rows;
  - after `FinishRun` with `Status: "PARTIAL"`, the run row has `finished_at IS NOT NULL` and the counters match the `RunSummary`.

- [ ] **Step 5: Run it to verify it fails**, with `ETL_TEST_DATABASE_URL=… go test ./internal/capture -run TestStore -count=1`. Expected: FAIL.

- [ ] **Step 6: Implement `store.go`.** Run the tests. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/etl/internal/capture/canonical.go apps/etl/internal/capture/canonical_test.go apps/etl/internal/capture/store.go apps/etl/internal/capture/store_test.go
git commit -m "feat(sources): store content-addressed raw captures with run audit"
```

---

### Task 4: Hardened JSON fetcher

**Files:**
- Create: `apps/etl/internal/capture/fetch.go`
- Test: `apps/etl/internal/capture/fetch_test.go`

**Interfaces:**
- Consumes: `pacing.Gate` (Task 2); `Canonicalize`, `Result` (Task 3).
- Produces:
  - `func NewHTTPClient(allowedHosts []string, gate pacing.Gate, timeout time.Duration, transport http.RoundTripper) *http.Client`. When `transport` is nil, it is cloned from `http.DefaultTransport`, with keep-alives and HTTP/2 disabled exactly as in `internal/etl/download.go` `newDownloader`, so no implicit retries bypass the gate. Tests pass the `httptest` server's transport. Redirects are allowed only to `https` plus an allowed host, at most 5. Each redirect calls `gate.Wait`. A redirect response that is a block (429 or WAF header) stops with `ErrBlocked`.
  - `var ErrBlocked = errors.New("source rate limit or WAF block")`
  - `type Fetcher struct { Client *http.Client; Gate pacing.Gate; Retries int; MaxBytes int64; UserAgent string; Log func(string, ...any) }`
  - `func (f *Fetcher) GetJSON(ctx context.Context, rawURL string) Result`. Per attempt: `Gate.Wait`, then GET with the Global Constraints headers. Classification:

| Response | Result | Retry |
|---|---|---|
| 200, valid JSON within `MaxBytes` | `Status`, `Canonical`, `Hash` | — |
| 200, non-JSON or body exceeds `MaxBytes` or read error | `Err` | no |
| 404 | `NotFound: true` | no |
| 429 or `X-Amzn-Waf-Action` present | `Gate.Block(retryAfter)`; `Err` wraps `ErrBlocked` if retries exhausted | yes |
| 408, 5xx, network error | `Gate.Delay(retryAfter)` when `Retry-After` present; `Err` if exhausted | yes |
| other status | `Err` | no |

  `Retry-After` parsing accepts seconds and HTTP-dates (reuse the logic of `retryAfter` in `internal/etl/download.go` by copying it into this package; do not import `internal/etl`). Context cancellation returns immediately with `Err = ctx.Err()`.

- [ ] **Step 1: Write the failing tests** in `fetch_test.go`. Use an `httptest.NewTLSServer`, its client transport, its host in `allowedHosts`, and a fake gate (a struct counting `Wait`/`Block`/`Delay` calls, never sleeping):
  - `TestGetJSONSuccessSendsHeaders`: the server asserts `Accept == "application/json"` and the `User-Agent` prefix `Mozilla/5.0 (compatible; contracts-ext-replicator/`; the result has `Status 200` and a 64-char `Hash`.
  - `TestGetJSONNonJSONBodyFails` (Review Focus 1): a 200 `text/html` `<html>challenge</html>` gives `Err != nil`, `Canonical == nil`, 1 server hit.
  - `TestGetJSONOversizedOrTruncatedBodyFails` (Review Focus 5): with `MaxBytes: 16`, a 64-byte JSON array fails. A handler that hijacks the connection and closes it mid-body after declaring `Content-Length: 100` fails. Both have `Canonical == nil`.
  - `TestGetJSONNotFound`: 404 gives `NotFound` and 1 hit.
  - `TestGetJSONBlockedRetriesThroughGate`: 429, 429, then 200 with `Retries: 3` gives success, `Block` called 2 times, `Wait` called 3 times.
  - `TestGetJSONWafHeaderCountsAsBlock`: 403 with `X-Amzn-Waf-Action: captcha` gives `Block` called. With `Retries: 0`, `errors.Is(res.Err, ErrBlocked)`.
  - `TestGetJSONServerErrorExhaustsRetries`: always 503 with `Retries: 2` gives 3 hits and `Err != nil`.
  - `TestRedirectToForeignHostRejected`: a 302 to `https://example.org/` gives `Err != nil`, and the foreign host is never contacted.

- [ ] **Step 2: Run them to verify they fail**, with `cd apps/etl && go test ./internal/capture -run 'TestGetJSON|TestRedirect' -count=1`. Expected: FAIL.

- [ ] **Step 3: Implement `fetch.go`.**

- [ ] **Step 4: Run the package tests**, with `go test -race ./internal/capture -count=1`. Expected: PASS. Integration tests run too when `ETL_TEST_DATABASE_URL` is set.

- [ ] **Step 5: Commit**

```bash
git add apps/etl/internal/capture/fetch.go apps/etl/internal/capture/fetch_test.go
git commit -m "feat(sources): add paced JSON fetcher with block handling"
```

---

### Task 5: Contratos.gov.br connector

**Files:**
- Create: `apps/etl/internal/sources/contratosgovbr/connector.go`
- Test: `apps/etl/internal/sources/contratosgovbr/connector_test.go`

**Interfaces:**
- Consumes: `capture.Fetcher`, `capture.Store`, `capture.Request`, `capture.RunSummary`, `capture.Outcome` (Tasks 3–4); `pacing.Policy` (Task 2).
- Produces:
  - `const Source = "CONTRATOS_GOV_BR"`, `const BaseURL = "https://contratos.comprasnet.gov.br"`, `const Host = "contratos.comprasnet.gov.br"`
  - `var DefaultPolicy = pacing.Policy{Minimum: time.Second, Maximum: 30 * time.Second, BlockPause: 5*time.Minute + time.Second}`
  - `var ContractResources = []SubResource{{"contract_history","historico"},{"contract_commitments","empenhos"},{"contract_guarantees","garantias"},{"contract_responsibles","responsaveis"},{"contract_items","itens"},{"contract_invoices","faturas"},{"contract_files","arquivos"}}`, with `type SubResource struct { Resource, Segment string }`
  - Resource names and paths:
    - `contracts_active_by_unit` → `/api/contrato/ug/{unit}`
    - `contracts_inactive_by_unit` → `/api/contrato/inativo/ug/{unit}`
    - `contract` → `/api/contrato/id/{id}`
    - each sub-resource → `/api/contrato/{id}/{segment}`
  - `type Connector struct { Fetcher *capture.Fetcher; Store *capture.Store; BaseURL string; Log func(string, ...any) }`
  - `func ValidUnit(code string) bool`: exactly 6 ASCII digits; leading zeros are kept.
  - `func ContractIDs(listing []byte) ([]int64, error)`: parses a JSON array of objects and returns each positive integer `id`, in order. A non-array or a missing/invalid `id` is an error.
  - `func (c *Connector) SyncUnit(ctx context.Context, runID int64, unit string, includeInactive bool) (capture.RunSummary, error)`:
    - Capture the active listing. If it is `FAILED` or `NOT_FOUND`, return an error (the caller finishes the run `FAILED`).
    - If `includeInactive`, capture the inactive listing. Failure counts as failed and marks the run partial; it does not abort.
    - Union the ids parsed (via `ContractIDs`) from each successful listing's `Result.Canonical`, deduplicating while keeping first-seen order, and run `syncContractResources` for each. This works the same whether the listing was `CAPTURED` or `UNCHANGED`.
  - `func (c *Connector) SyncContract(ctx context.Context, runID int64, contractID int64) (capture.RunSummary, error)`: capture `contract`, then all sub-resources. A `NOT_FOUND` contract returns an error.
  - Summary status (set by both methods before returning):
    - `SUCCEEDED` when `Failed == 0`;
    - `PARTIAL` when `Failed > 0` and at least one request succeeded;
    - `FAILED` otherwise.
    - `NOT_FOUND` on a sub-resource is not a failure.
    - On context cancellation, return `ctx.Err()` immediately with the summary so far.

- [ ] **Step 1: Write the failing tests** in `connector_test.go`. Use an `httptest.NewTLSServer` serving fixture JSON by path, plus a real `capture.Store` on `testdb.Isolated(t, testdb.Migration)`, a fake no-sleep gate and `BaseURL` set to the server URL. Fixtures are trimmed from the real 2026-11-07 responses (listing objects with `id`, sub-resources as arrays like `[{"id":8514191,"unidade_gestora":"158345","gestao":"26421","numero":"2022NE000066"}]`).
  - `TestSyncUnitCapturesListingsAndSubResources`: active `[{"id":13847}]` and inactive `[{"id":20001}]` give `Requests == 2 + 2*7 == 16`, status `SUCCEEDED`, 16 `capture_attempts` rows, and `latest_captures` has a row for `/api/contrato/13847/empenhos`.
  - `TestSyncUnitDeduplicatesContracts` (Review Focus 4): id 13847 in both listings gives `Requests == 2 + 7`.
  - `TestSyncUnitEmptyListingSucceeds` (Review Focus 2): both listings `[]` give `Requests == 2`, status `SUCCEEDED`, no error.
  - `TestSyncUnitActiveListingFailureIsFatal`: active listing 500 (with fetcher `Retries: 0`) gives an error and no sub-resource requests.
  - `TestSyncUnitSubResourceFailureIsPartial`: `/api/contrato/13847/garantias` returns 500 → status `PARTIAL`, `Failed == 1`, no error.
  - `TestSyncUnitSecondRunIsUnchanged`: running the same fixtures twice → the second summary has `Unchanged == Requests` and the `captures` count does not grow.
  - `TestSyncUnitStopsOnCancellation` (Review Focus 3, connector half): the server handler for the first sub-resource cancels the context, and `SyncUnit` returns `context.Canceled` without requesting the remaining resources.
  - `TestSyncContractNotFound`: `/api/contrato/id/999` 404 → error.
  - `TestValidUnitAndContractIDs`: `ValidUnit("158148")` is true, `"15814"` false, `"15814a"` false. `ContractIDs([]byte("{}"))` is an error.

- [ ] **Step 2: Run them to verify they fail**, with `cd apps/etl && ETL_TEST_DATABASE_URL=… go test ./internal/sources/... -count=1`. Expected: FAIL.

- [ ] **Step 3: Implement `connector.go`.** `syncContractResources(ctx, runID, id, *summary)` is the private loop shared by both public methods. It records each result via `Store.Record` and calls `summary.Add`.

- [ ] **Step 4: Run the tests**, with `ETL_TEST_DATABASE_URL=… go test -race ./internal/sources/... -count=1`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/etl/internal/sources
git commit -m "feat(sources): capture Contratos.gov.br contracts and sub-resources"
```

---

### Task 6: `replicator sync` CLI, wrapper and docs

**Files:**
- Create: `apps/etl/cmd/replicator/main.go`, `apps/etl/cmd/replicator/plan.go`, `apps/etl/cmd/replicator/main_test.go`
- Create: `scripts/sources-sync.cjs`, `docs/public-sources-data-model.md`
- Modify: `package.json` (root, `scripts`), `apps/etl/README.md`, `README.md` (Architecture paragraph: one sentence linking the new doc), `.env.example` (add `SOURCES_DATABASE_URL=`, commented like `FINANCE_DATABASE_URL`)

**Interfaces:**
- Consumes: everything above.
- Produces:
  - CLI: `replicator sync -source CONTRATOS_GOV_BR (-unit <6 digits> | -contract <id>) [-inactive=true] [-trigger MANUAL|SCHEDULED] [-retries 3] [-interval 1s]`
    - `-retries` accepts 0–3.
    - `-interval` must be whole milliseconds between the policy minimum (1s) and maximum (30s). It raises `Policy.Minimum` and can never lower it.
    - `-unit` and `-contract` are mutually exclusive, and one is required.
    - The only accepted `-source` is `CONTRATOS_GOV_BR`.
    - `REQUESTED` is rejected on the CLI; it is reserved for step 6.
  - `type syncPlan struct { source, unit string; contractID int64; inactive bool; trigger string; retries int; interval time.Duration }` and `func parseSync(args []string) (syncPlan, error)` in `plan.go`.
  - `func execute(ctx context.Context, args []string, stdout io.Writer) int` in `main.go`. It returns the exit code:
    - Require `DATABASE_URL`.
    - Check that `testdb.Migration`'s name is installed. Use the literal constant `requiredMigration = "202611070001_public_sources_foundation"` in `main.go`; do not import `testdb` in production code. If missing: `required migration 202611070001_public_sources_foundation is not installed; run pnpm db:migrate before syncing`.
    - Build `PostgresGate{Source, Policy}`, `NewHTTPClient([]string{host of sourceBaseURL}, gate, 60*time.Second, sourceTransport)`, `Fetcher{MaxBytes: 32 << 20, Retries, UserAgent}`, `Store`, `Connector{BaseURL: sourceBaseURL}`.
    - Unexported test seams: `var sourceBaseURL = contratosgovbr.BaseURL` and `var sourceTransport http.RoundTripper` (nil in production). There are no CLI flags for either.
    - `StartRun` with `TargetType` `MANAGEMENT_UNIT` or `CONTRACT`.
    - Run `SyncUnit`/`SyncContract`.
    - `FinishRun` using `context.WithoutCancel(ctx)`. Status rules: a connector error gives `FAILED` with the error text, and `context.Canceled` gives the exact error `cancelled`.
    - Print one JSON line `{"runId":…, "status":…, "requests":…, …}` to stdout.
    - Return 1 for `FAILED` or config errors, 0 otherwise.
    - `main` wires `signal.NotifyContext(os.Interrupt, syscall.SIGTERM)` like `cmd/etl/main.go`.
  - Root script: `"sources:sync": "node scripts/sources-sync.cjs sync"`. `scripts/sources-sync.cjs` loads `.env` and runs `go run ./cmd/replicator` in `apps/etl` with `DATABASE_URL = SOURCES_DATABASE_URL || DATABASE_URL`. It has the same structure as `scripts/finance-etl.cjs`, minus path rewriting.

- [ ] **Step 1: Write the failing tests** in `main_test.go`:
  - `TestParseSyncValidation`, table-driven:
    - accepted: `-source CONTRATOS_GOV_BR -unit 158148`; `-source CONTRATOS_GOV_BR -contract 13847 -trigger SCHEDULED`;
    - rejected: no target; both targets; `-unit 15814`; `-source PNCP`; `-retries 4`; `-interval 500ms`; `-interval 31s`; `-trigger REQUESTED`; a positional argument.
  - `TestExecuteRequiresMigration`: an isolated DB without the migration (`testdb.Isolated(t)` with no names) and `DATABASE_URL` set to it gives exit code 1, and stderr/stdout mention `run pnpm db:migrate`.
  - `TestExecuteCancelledRunIsRecorded` (Review Focus 3, CLI half): run against a migrated isolated DB, with `sourceBaseURL`/`sourceTransport` set to an `httptest.NewTLSServer`. The handler for `/api/contrato/id/13847` calls the test's `cancel()` before responding. Run `execute(ctx, []string{"sync","-source","CONTRATOS_GOV_BR","-contract","13847"}, &out)`. Assert exit code 1, and that the only `capture_runs` row has `status = 'FAILED'`, `error = 'cancelled'` and `finished_at IS NOT NULL`. Set the test's `source_pacing.interval_ms` to `100` first so the gate does not slow the test.

- [ ] **Step 2: Run them to verify they fail**, with `cd apps/etl && ETL_TEST_DATABASE_URL=… go test ./cmd/replicator -count=1`. Expected: FAIL.

- [ ] **Step 3: Implement `plan.go` and `main.go`.** Run the tests. Expected: PASS.

- [ ] **Step 4: Add the wrapper, root script, `.env.example` entry and docs.**
  - `docs/public-sources-data-model.md`: purpose, ownership (the replicator writes, the API reads, migrations owned by the API), the four tables plus the view with column meanings, outcome semantics (`UNCHANGED` = same hash as the latest capture for that key), the run status rules, and the pacing values. Add a recommended grant note for a dedicated role: `USAGE` on schema `public_sources`; `SELECT, INSERT, UPDATE` on its tables; no DDL.
  - `apps/etl/README.md`: a new section "Public sources replicator" with the `pnpm sources:sync` examples below, the pacing rules, exit codes and how to run its tests.

- [ ] **Step 5: Full verification**

Run: `cd apps/etl && go vet ./... && ETL_TEST_DATABASE_URL=… go test -race ./... -count=1`
Expected: PASS, including the unchanged finance tests.
Run: `pnpm test`. Expected: PASS.
Manual smoke test (real source, one small contract, run by a human, not CI):
`pnpm db:migrate && pnpm sources:sync -source CONTRATOS_GOV_BR -contract 1057026`
Expected: one JSON line with `"status":"SUCCEEDED"` and `"requests":8`. Running it again gives `"unchanged":8`.

- [ ] **Step 6: Commit**

```bash
git add apps/etl/cmd/replicator scripts/sources-sync.cjs package.json .env.example apps/etl/README.md README.md docs/public-sources-data-model.md
git commit -m "feat(sources): add replicator sync CLI for Contratos.gov.br"
```

---

## Out of scope for this step (later roadmap steps)

- Normalized contract tables and app contract resolution (step 2), the commitment link (step 3), derived facts (step 4).
- File download and the document store (step 5). `contract_files` captures only the listing JSON here.
- The sync request table, worker mode and compose scheduling (step 6); `REQUESTED` is reserved in the schema.
- Moving finance pacing onto `internal/pacing` (possible follow-up; finance stays untouched now).
