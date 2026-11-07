# Automatic Contract Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Contracts of every registered institution's UASG are replicated daily by the Go replicator, and the app only consults them: no import, no manual creation, editable internal notes only.

**Architecture:** A new `replicator daily` mode reads the UASGs from `"Institution"`, captures each unit's listings, refreshes sub-resources by policy, normalizes per unit and records a run-level row. The API replaces the `"Contract"` table with reads over `public_sources.contracts` (scoped by managing UG, limited to registered UASGs) plus a `"ContractNote"` table. The web gets dedicated contract list/detail components and drops the import, create and edit pages for contracts.

**Tech Stack:** Go 1.24 (`database/sql`, `lib/pq`), PostgreSQL 16, Fastify 5 + raw SQL via `pg`, Next.js 16 / React 19 / Tailwind 4, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-07-automatic-contract-sync-design.md` (builds on `docs/superpowers/specs/2026-11-07-institutional-copilot-design.md`).

**Branch:** `feat/automatic-contract-sync` (worktree `.claude/worktrees/automatic-contract-sync`), already rebased on `main` 10ec9c1 with step 2 commits on top; suites green at `cae831f`.

## Global Constraints

- English for every technical artifact (tables, columns, enums, identifiers, comments, tests, docs); Portuguese user-facing copy (`AGENTS.md`).
- Any `apps/web` change follows `docs/ui-rules.md` and passes its §8 checklist: shared primitives first (`components/ui.tsx`, `components/ui/data-table.tsx`, `@contracts/validation`, `lib/decimal-display.ts`), tokens only, usable at 360 px without page-level horizontal scroll, WCAG 2.2 AA, LGPD-aware masking, no fabricated data, server components by default.
- Automated tests never call real external sources (Go uses `httptest`/`sourceTransport`; e2e uses `page.route` mocks).
- Never run `pnpm db:migrate` against the shared dev database `contracts`; integration tests use throwaway databases (`createTestDatabase`, `testdb.Isolated`).
- Do not edit applied migrations; schema changes go in new migrations.
- Pacing from step 1 (`contratosgovbr.DefaultPolicy`, shared `PostgresGate`) applies to every source request; no relaxing to go faster.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Go integration tests need `ETL_TEST_DATABASE_URL=postgresql://contracts:contracts_local@localhost:5540/contracts?sslmode=disable` (it only creates isolated databases).

## Review Focus

- Unrestricted viewer (`GESTOR_GERAL`, scope `null`) must only see contracts of registered UASGs, and a UASG removed from `"Institution"` disappears from lists while its replica rows stay → Task 4 test `unrestricted viewer sees only registered UASGs`.
- A contract URL with a non-numeric, zero or > int64 external id must answer 404, never 500 → Task 4 test `invalid external ids are 404`.
- A container restart in the middle of the long first load: the cancelled run must not count as completed (so the next start runs again) and two processes must never run at once → Task 3 tests `cancelled cycle is not completed` and `second cycle is skipped while the lock is held`.
- Notes must survive daily re-normalization and the source changing the header → Task 4 test `notes survive replica updates`.
- A supplier that is a natural person must never be shown with a full CPF → Task 4 test `supplier CPF is masked`.

---

### Task 1: Normalizer hardening and sources schema for daily runs

**Files:**
- Create: `apps/api/migrations/202611090001_public_sources_contract_sync.sql`
- Modify: `apps/etl/internal/normalize/store.go`
- Modify: `apps/etl/internal/testdb/testdb.go` (add `SyncMigration = "202611090001_public_sources_contract_sync"`)
- Modify: `apps/etl/cmd/replicator/main.go` (`requiredMigrations` gains the new migration; `version = "0.3.0"`)
- Test: `apps/etl/internal/normalize/store_test.go`, `apps/etl/internal/normalize/schema_test.go`

**Interfaces:**
- Produces (SQL): child tables `contract_amendments`, `contract_guarantees`, `contract_responsibles`, `contract_items`, `contract_invoices`, `contract_commitments`, `contract_files` re-keyed to `PRIMARY KEY (source, contract_external_id, external_id)` (drop the old PK constraint and the now-redundant `*_contract_idx` indexes); table `public_sources.daily_runs (id bigint identity PK, source text NOT NULL, status text NOT NULL DEFAULT 'RUNNING' CHECK IN ('RUNNING','COMPLETED','CANCELLED','FAILED'), unit_count int NOT NULL DEFAULT 0, failed_unit_count int NOT NULL DEFAULT 0, error text, etl_version text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, CHECK ((status='RUNNING') = (finished_at IS NULL)))`; column `public_sources.capture_runs.daily_run_id bigint NULL REFERENCES public_sources.daily_runs(id)`; `COMMENT ON` for each new object.
- Produces (Go): `normalize.Summary` gains `Failures []Failure \`json:"failures,omitempty"\``; `type Failure struct { ExternalID int64 \`json:"externalId"\`; Error string \`json:"error"\` }`.

- [ ] **Step 1: Write the failing tests** in `store_test.go`:
  - `TestNormalizeSharedCommitmentAcrossContracts`: seed listing `/api/contrato/ug/158148` with `testdata/listing_item.json` (id 13847), `fullContract()` (1057026), and `s.file("contract_commitments", "/api/contrato/13847/empenhos", "empenhos.json")`; normalize 1057026, then `Unit(ctx, "158148")` → `summary.Normalized == 1 && Failed == 0`, and `SELECT string_agg(contract_external_id::text, ',' ORDER BY contract_external_id) FROM public_sources.contract_commitments WHERE external_id = 8514191` = `"13847,1057026"`.
  - `TestNormalizeManyContinuesAfterContractDatabaseError`: listing with ids 13847 and 13848 (copy of the fixture with the id replaced); commitments of 13847 = `[{"id":1,"unidade_gestora":"158345","gestao":"26421","numero":"2022NE000001","empenhado":"1.000.000.000.000.000.000.000,00"}]` (overflows `numeric(24,6)`); `Unit` → `err == nil`, `Normalized == 1`, `Failed == 1`, `len(Failures) == 1 && Failures[0].ExternalID == 13847`; contracts table holds only `13848`.
  - `TestNormalizeHeaderUsesFreshestCapture`: capture `/api/contrato/id/1057026` first, then a listing for `158148` containing 1057026's listing-shaped header with a different `objeto`; normalize → `object` equals the listing's and `header_resource = 'contracts_active_by_unit'`. (Build the listing element from `listing_item.json` with `"id": 1057026` and `"numero"` of the `/id` fixture.)
  - `TestNormalizeNotFoundPartClearsRows`: `fullContract()`, normalize, then record a NOT_FOUND attempt for `/api/contrato/1057026/garantias` (store `Record` with `capture.Result{Status: 404, NotFound: true}`), normalize → `contract_guarantees` count `0` and part status `NOT_FOUND`, `row_count = 0`.
  - `TestNormalizeHeaderPartReflectsListingAttempt`: listing-only contract; record a FAILED attempt on the listing key after the good capture; normalize → header part `status = 'FAILED'`, `captured_at` = last good `last_seen_at`.
  - In `schema_test.go`, `TestDailyRunsSchema`: inserting `daily_runs` with `status='COMPLETED'` and `finished_at IS NULL` fails with a check violation; `capture_runs.daily_run_id` accepts NULL.

- [ ] **Step 2: Run** `cd apps/etl && ETL_TEST_DATABASE_URL=... go test -count=1 ./internal/normalize/` → the new tests FAIL (duplicate key `contract_commitments_pkey`, `numeric field overflow` aborting `Unit`, `/id` header winning, stale guarantees, header AVAILABLE, missing `daily_runs`). Tests that use the new migration must call `testdb.Isolated(t, testdb.Migration, testdb.ContractsMigration, testdb.SyncMigration)` (update the `migrated` helper).

- [ ] **Step 3: Implement.**
  - Migration as in Interfaces.
  - `many()`: when `Contract` returns an error and `ctx.Err() == nil`, record it as `failed(ContractResult{ExternalID: id}, err)` and continue; return the error only on cancellation. `Summary.add` appends to `Failures` for every FAILED result.
  - `header()`: select both the `/id` capture and the newest listing element for the id, and use the one with the greater `last_seen_at` (ties → listing). The header part's state comes from `partState` on the request key it was taken from (listing key or `/api/contrato/id/{id}`), keeping `captured_at` = the chosen capture's `last_seen_at`.
  - `partState()`: when the latest attempt is NOT_FOUND, `rows = nil` (snapshot becomes empty) even if an older capture exists.

- [ ] **Step 4: Run** the full Go suite `go test -count=1 ./...` → PASS.

- [ ] **Step 5: Commit** `fix(sources): key contract children per contract and keep normalizing after one failure`.

---

### Task 2: Refresh policy and the daily cycle

**Files:**
- Modify: `apps/etl/internal/sources/contratosgovbr/connector.go`
- Modify: `apps/etl/internal/capture/store.go` (`RunStart.DailyRunID int64`; 0 → NULL)
- Create: `apps/etl/internal/daily/cycle.go`
- Test: `apps/etl/internal/sources/contratosgovbr/connector_test.go`, `apps/etl/internal/daily/cycle_test.go`

**Interfaces:**
- Consumes: Task 1 schema; `normalize.Normalizer.Unit(ctx, unit) (Summary, error)`.
- Produces:
  - `type Listed struct { ID int64; Active bool; Element json.RawMessage }` and `type DueFunc func(ctx context.Context, c Listed) (bool, error)` in `contratosgovbr`.
  - `func (c *Connector) SyncUnitWith(ctx context.Context, runID int64, unit string, due DueFunc) (capture.RunSummary, error)`: captures active + inactive listings (active listing failure stays fatal for the unit), then `syncContractResources` only for contracts where `due` returns true. `SyncUnit(ctx, runID, unit, inactive)` keeps its behavior (it becomes `SyncUnitWith` with an always-true `due` and the `inactive` switch).
  - `func DuePolicy(db *sql.DB, source string, now func() time.Time, maxAge time.Duration) DueFunc` in `daily`: true when `c.Active`; or no row in `public_sources.contracts`; or `source_data <> c.Element::jsonb`; or any `contract_parts` row is `MISSING` or missing entirely; or `min(coalesce(last_attempt_at, captured_at)) < now - maxAge`. `const InactiveMaxAge = 30 * 24 * time.Hour`.
  - `type Cycle struct { DB *sql.DB; Store *capture.Store; Connector *contratosgovbr.Connector; Normalizer *normalize.Normalizer; Version string; Log *slog.Logger }`
  - `type UnitResult struct { Unit string \`json:"unit"\`; RunID int64 \`json:"runId"\`; Capture capture.RunSummary \`json:"capture"\`; Normalization normalize.Summary \`json:"normalization"\` }`
  - `type CycleResult struct { DailyRunID int64 \`json:"dailyRunId"\`; Status string \`json:"status"\`; Units []UnitResult \`json:"units"\`; FailedUnits int \`json:"failedUnits"\` }`
  - `func (c *Cycle) Run(ctx context.Context) (CycleResult, error)`: inserts a `daily_runs` row; units = `SELECT uasg FROM "Institution" ORDER BY uasg` filtered by `contratosgovbr.ValidUnit`; per unit: `StartRun` (trigger `SCHEDULED`, target `MANAGEMENT_UNIT`, `DailyRunID`), `SyncUnitWith(..., DuePolicy(...))`, `FinishRun`, then `Normalizer.Unit` unless the capture run FAILED; a unit counts as failed when its capture run is FAILED or its normalization has `Failed > 0`. Ends the row `COMPLETED` (even with failed units), `CANCELLED` on context cancellation (written with `context.WithoutCancel`), `FAILED` on store errors. Returns an error only for cancellation or store failure.

The connector extracts `Listed` from the canonical listing arrays (decode with `UseNumber`, `ID` from `id`, `Element` = the raw element bytes); `ContractIDs` can share that decoder.

- [ ] **Step 1: Write the failing tests.**
  - `connector_test.go` `TestSyncUnitWithSkipsNotDueContracts`: fake transport serving active listing `[{"id":1,...}]`, inactive listing `[{"id":2,...}]`, and every sub-resource as `[]`; `due` returns `c.Active`; assert the transport saw the 7 sub-resource paths for contract 1 and none for contract 2, and `due` received `Active=false` for id 2.
  - `cycle_test.go` (isolated DB with the three migrations plus the app migrations that create `"Institution"`; insert institutions `158148` and `158454`, plus one invalid `ABC`):
    - `TestCycleRunsEveryRegisteredUnit`: fake source with one active contract per unit → `Status == "COMPLETED"`, 2 units, both units' contracts in `public_sources.contracts`, two `capture_runs` with the `daily_run_id`.
    - `TestCycleContinuesAfterUnitFailure`: listing of `158148` answers HTTP 500 (all retries) → `Status == "COMPLETED"`, `FailedUnits == 1`, `158454` normalized, `daily_runs.failed_unit_count = 1`.
    - `TestDuePolicy`: inactive contract normalized with fresh parts and same element → false; element with a changed `valor_global` → true; parts' `last_attempt_at` set 31 days back → true; active → true; unknown id → true.
    - `TestCycleCancelled`: cancel the context from the fake transport on the second unit's listing → `daily_runs.status = 'CANCELLED'`, `finished_at` set.

- [ ] **Step 2: Run** `go test -count=1 ./internal/sources/... ./internal/daily/` → FAIL (undefined `SyncUnitWith`, package `daily` missing).

- [ ] **Step 3: Implement** the interfaces above.

- [ ] **Step 4: Run** `go test -count=1 ./...` → PASS.

- [ ] **Step 5: Commit** `feat(sources): refresh contracts by policy in a daily cycle over registered UASGs`.

---

### Task 3: `replicator daily` scheduler, container and compose service

**Files:**
- Create: `apps/etl/internal/daily/schedule.go`
- Modify: `apps/etl/cmd/replicator/main.go`, `apps/etl/cmd/replicator/plan.go`
- Create: `apps/etl/Dockerfile`
- Modify: `compose.yaml`, `scripts/sources-sync.cjs` (pass-through stays), root `package.json` (`"sources:daily": "node scripts/sources-sync.cjs daily"`), `apps/etl/README.md`, `.env.example`
- Test: `apps/etl/internal/daily/schedule_test.go`, `apps/etl/cmd/replicator/main_test.go`

**Interfaces:**
- Produces:
  - `func NextRun(now time.Time, at string, loc *time.Location) (time.Time, error)`: next occurrence of `HH:MM` in `loc` strictly after `now`.
  - `func RunOnStart(ctx context.Context, db *sql.DB, source string, now time.Time) (bool, error)`: true when no `daily_runs` row with `status = 'COMPLETED'` and `finished_at > now - 24h`.
  - `func (c *Cycle) RunLocked(ctx context.Context) (CycleResult, bool, error)`: takes `pg_try_advisory_lock(hashtext('public_sources.daily:' || source))` on a dedicated `*sql.Conn`, returns `ran=false` without running when the lock is held; unlocks on the same connection.
  - CLI: `replicator daily -source CONTRATOS_GOV_BR [-at 03:00] [-timezone America/Sao_Paulo] [-once] [-retries 3] [-interval 1s]`. `-once` runs one locked cycle, prints the `CycleResult` JSON, exit 1 when `Status != "COMPLETED"` or the lock was held (message `another daily run is in progress`). Without `-once`: run on start if `RunOnStart`, then loop sleeping until `NextRun`, logging each cycle as a JSON line; exits 0 on SIGTERM after recording the cancellation. The binary imports `time/tzdata`.
  - `apps/etl/Dockerfile`: multi-stage `golang:1.24-alpine` build of `./cmd/replicator` → `alpine:3.20` runtime with `ca-certificates`, non-root user, `ENTRYPOINT ["/replicator"]`, `CMD ["daily","-source","CONTRATOS_GOV_BR"]`.
  - `compose.yaml` service `replicator`: builds `apps/etl/Dockerfile`, `DATABASE_URL` like `api`, `depends_on: api: condition: service_healthy` (migrations run at API start), `restart: unless-stopped`, `profiles: ["sync"]` so local `docker compose up db gotenberg` and e2e runs never start it.

- [ ] **Step 1: Write the failing tests.**
  - `schedule_test.go`: `NextRun(2026-11-07T02:59-03:00, "03:00", SP)` = same day 03:00; at `03:00` exactly → next day; at `23:00` → next day 03:00; invalid `"25:00"` → error.
  - `TestRunOnStart`: no rows → true; COMPLETED finished 2 h ago → false; COMPLETED 25 h ago → true; only CANCELLED 1 h ago → true (`cancelled cycle is not completed`).
  - `TestRunLockedSkipsWhileHeld`: hold the advisory lock on another connection → `ran == false`, no `daily_runs` row created (`second cycle is skipped while the lock is held`).
  - `main_test.go` `TestDailyOnce`: with the test seams (`sourceBaseURL`, `sourceTransport`) and one institution, `execute(ctx, []string{"daily","-source","CONTRATOS_GOV_BR","-once"}, ...)` → exit 0, stdout contains `"status":"COMPLETED"`; `daily` without `-source` → exit 1 with usage.

- [ ] **Step 2: Run** `go test -count=1 ./internal/daily/ ./cmd/replicator/` → FAIL.

- [ ] **Step 3: Implement**, then `docker compose --profile sync config` parses and `docker build -f apps/etl/Dockerfile apps/etl` succeeds.

- [ ] **Step 4: Run** `go test -count=1 ./...` → PASS.

- [ ] **Step 5: Document** in `apps/etl/README.md` (daily mode, schedule, policy, profile `sync`, `pnpm sources:daily -- -once`) and `docs/public-sources-data-model.md` (`daily_runs`, `daily_run_id`, child keys).

- [ ] **Step 6: Commit** `feat(sources): run the contract replicator daily as a compose service`.

---

### Task 4: API reads contracts from the replica; notes; old contract code removed

**Files:**
- Create: `apps/api/migrations/202611090002_contract_notes.sql` (`CREATE TABLE "ContractNote" (source text NOT NULL, "externalId" bigint NOT NULL, notes text NOT NULL CHECK (char_length(notes) <= 10000), "updatedById" uuid REFERENCES "User"(id) ON DELETE SET NULL, "updatedAt" timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (source, "externalId"))`; `DROP TABLE "Contract"`; comments)
- Create: `apps/api/src/contracts/repository.ts`, `apps/api/src/contracts/service.ts`, `apps/api/src/contracts/controller.ts`
- Delete: `apps/api/src/contract-sources/` (folded into `contracts/`), `apps/api/src/repositories/contracts.ts`, `apps/api/src/repositories/contract-sources.ts` (move `partQueries` into `contracts/repository.ts`)
- Modify: `apps/api/src/app.ts` (remove the six old contract routes; register `registerContractRoutes`), `apps/api/src/service.ts` (remove `contracts`, `contract`, `saveContract`, `deleteContract`, `importContracts`, `presentContract`), `apps/api/src/compras.ts` (remove `contracts()` and its mapper), `apps/api/src/domain.ts` (remove `validateContract`; keep `contractStatus`), `apps/api/src/models.ts`, `apps/api/src/repositories/index.ts`, `apps/api/src/repositories/columns.ts`, `apps/api/scripts/seed.ts` (demo contracts become replica rows: `public_sources.contracts` + 8 `contract_parts` each, `ON CONFLICT DO NOTHING`), `apps/api/scripts/repair-demo-identifiers.ts` (drop the `"Contract"` part)
- Test: `apps/api/test/integration/contracts.test.ts` (replaces `contract-sources.test.ts`), `apps/api/test/integration/finance.test.ts` (drop the `"Contract"` insert/assert from the upgrade test, keep the replay assertions), unit tests in `apps/api/test/*.test.ts` that cover removed code (`service.test.ts`, `compras.test.ts`, `http.test.ts`, `domain.test.ts`: delete the contract cases, keep the rest)

**Interfaces:**
- Consumes: Task 1/2 schema (`daily_runs`, `capture_attempts`), `contractStatus`, `narrowScope`, `inScope`, `known`/`pagination` from `finance/validation.ts`, `validateFilters` from `@contracts/validation`.
- Produces (HTTP, all under `/api`, all `Cache-Control: no-store`):
  - `GET /contracts?search&status&uasg&from&to&uasgs&page&limit` → `{ data: ContractSummary[], total, page, limit, stats, sync }` where `ContractSummary = { externalId, number, object, supplierName, supplierDocument, uasg, unitName, startDate, endDate, globalValue, status }` (`uasg` = `managing_unit_code`, `unitName` = `"Institution".name`, `status` = `contractStatus`), `stats` keeps the current shape (`count`, `totalValue`, `expiringCount`, `vigency{active,expiring,ended,upcoming,unknown,activeValue}`), and `sync = { lastCompletedAt: string|null, running: boolean, staleUnits: { uasg, name, lastGoodAt: string|null }[] }` (stale = in-scope registered UASG whose newest CAPTURED/UNCHANGED attempt on `/api/contrato/ug/{uasg}` is older than the last completed run's `started_at`, or absent once a run completed). Same filter validation and error messages as today. Order: `end_date DESC NULLS LAST, external_id`.
  - `GET /contracts/:externalId` → `{ contract: ContractDetail, parts: SourcePartState[], notes: { text: string, updatedAt: string|null, updatedBy: string|null } }`; `ContractDetail` = summary fields + `originUnitCode, typeName, category, processNumber, modality, sourceStatus, signatureDate, initialValue, accumulatedValue, installmentCount, capturedAt, normalizedAt`.
  - `GET /contracts/:externalId/source/:part` → `Page` as today (parts `history|guarantees|responsibles|items|invoices|files`).
  - `PUT /contracts/:externalId/notes` body `{ notes: string }` → the `notes` object; trims; > 10000 chars → 400 `"As observações internas podem ter no máximo 10.000 caracteres."`; empty string allowed (clears).
  - Rules: `:externalId` must match `^[1-9]\d{0,18}$` and fit int64, otherwise 404 `"Contrato não encontrado."`; every read and write requires `managing_unit_code` ∈ `"Institution".uasg` and `inScope(scope, managing_unit_code)`, otherwise 404; an 11-digit `supplierDocument` is returned as `***.DDD.DDD-**` (digits 4–9 kept), 14-digit CNPJ as digits.
  - Old routes `POST /contracts`, `POST /contracts/import`, `PUT|DELETE /contracts/:id` answer 404.

- [ ] **Step 1: Write the failing tests** in `contracts.test.ts` (reuse the `setup` helper pattern of `contract-sources.test.ts`; seed institutions `158148` "IFMS Reitoria" and `158454` "IFMS Três Lagoas", replica rows and parts with SQL):
  - `lists replica contracts of registered UASGs with stats and sync state`: three contracts (two in 158148, one in `999999` not registered) → total 2, `data[0]` fields as text (`globalValue: "682318.130000"`), `stats.vigency` counts by dates, `sync.lastCompletedAt` from a seeded COMPLETED `daily_runs`, `staleUnits` lists `158454` with `lastGoodAt: null`.
  - `unrestricted viewer sees only registered UASGs`: `GESTOR_GERAL` viewer → contract of `999999` absent from the list and `GET /contracts/<its id>` → 404; delete institution `158454` → its contracts leave the list.
  - `filters by search, status, uasg and vigência`; `rejects invalid filters` (same messages as the previous contract list).
  - `restricted viewer sees only their UASG` (USUARIO with `158454`): list and detail of a `158148` contract → absent / 404; notes PUT → 404.
  - `invalid external ids are 404`: `abc`, `0`, `99999999999999999999` → 404 on detail, part and notes.
  - `detail returns header, parts and empty notes`; `serves part pages with text decimals and nulls` (port from `contract-sources.test.ts`); `responsibles expose only masked documents` (port).
  - `notes are saved with author and survive replica updates`: PUT notes → 200 with `updatedBy` = viewer name; `UPDATE public_sources.contracts SET object = 'novo'` and re-insert parts → GET still returns the notes (`notes survive replica updates`); 10001 chars → 400; empty → clears.
  - `supplier CPF is masked`: replica `supplier_document = '12345678901'` → list and detail return `***.456.789-**`.
  - `old contract write routes are gone`: POST `/contracts`, POST `/contracts/import`, PUT/DELETE `/contracts/<uuid>` → 404.

- [ ] **Step 2: Run** `pnpm --filter @contracts/api test:integration` → new tests FAIL.

- [ ] **Step 3: Implement.** The repository generalizes the current status SQL (`statusSql`) over `start_date`/`end_date`/`global_value`; the registered-UASG rule is a join on `"Institution"` inside every query, not a post-filter.

- [ ] **Step 4: Run** `pnpm --filter @contracts/api lint && pnpm --filter @contracts/api test && pnpm --filter @contracts/api test:integration` → PASS.

- [ ] **Step 5: Commit** `feat(contracts): serve contracts from the daily replica with internal notes`.

---

### Task 5: Web consults contracts; import, create and edit pages removed

**Files:**
- Create: `apps/web/lib/contracts-api.ts` (types `ContractSummary`, `ContractDetail`, `ContractNotes`, `SyncState`; `getContract(externalId)`, `saveContractNotes(externalId, notes)`; freshness copy helper), `apps/web/components/contracts/contract-list.tsx`, `apps/web/components/contracts/contract-detail.tsx`, `apps/web/components/contracts/contract-notes.tsx`, `apps/web/components/contracts/sync-notice.tsx`
- Modify: `apps/web/app/contratos/page.tsx` (renders `ContractList`), `apps/web/app/contratos/[id]/page.tsx` (validates `^[1-9]\d{0,18}$` via a new `contractId(params)` in `lib/route-params.ts`, `notFound()` otherwise; renders `ContractDetail`)
- Delete: `apps/web/app/contratos/importar/`, `apps/web/app/contratos/novo/`, `apps/web/app/contratos/[id]/editar/`
- Modify: `apps/web/components/list-page.tsx`, `detail-page.tsx`, `editor.tsx`, `import-page.tsx` (contract branches removed; atas behavior unchanged), `apps/web/components/contract-source/contract-source-panel.tsx` (takes `externalId` + `parts` from the detail response; the RESOLVED/NOT_FOUND/AMBIGUOUS states go away), `apps/web/lib/contract-source-api.ts` (part URLs `/contracts/{externalId}/source/{part}`), `apps/web/lib/api.ts` (drop the old `Contract` type)
- Test: `tests/e2e/contracts.spec.ts` (replaces `contract-source.spec.ts`; all API calls mocked with `page.route`), `tests/e2e/system.spec.ts`, `tests/e2e/forms.spec.ts`, `tests/e2e/recovery.spec.ts` (remove the contract create/edit/import/delete cases; keep atas and navigation cases, switching their contract navigation to a mocked list)

**Interfaces:**
- Consumes: Task 4 HTTP contract; `ContractsOverview`, `DataTable`, `Pager`, `Empty`, `ErrorState`, `Loading`, `PageBar`, `PageHead`, `Status`, `ReachContext`, `useReach`, `currency`, `date`, `maskDocument`, `formatSourceQuantity`.
- Copy (pt-BR, exact):
  - freshness line: `Dados do Contratos.gov.br · atualizados em {dd/mm/aaaa hh:mm}`; while no completed run exists: `A primeira atualização dos contratos está em andamento. Os contratos aparecem conforme cada UASG é concluída.`
  - stale units notice: `Não foi possível atualizar {UASG nome (código)} na última execução. Dados de {dd/mm/aaaa hh:mm}.` / `… Ainda sem dados.`
  - empty list with filters: `Nenhum contrato corresponde aos filtros.`; empty with no completed run: the first-load sentence above.
  - notes block title `Observações internas`, helper `Informações da equipe que não constam no Contratos.gov.br. A atualização diária não altera este campo.`, button `Salvar observações`, saved state `Salvo por {nome} em {data}`; vigência with both dates missing: `Vigência não informada`.
  - external links keep `(abre em nova aba)` in their accessible name.

- [ ] **Step 1: Write the failing e2e specs** in `tests/e2e/contracts.spec.ts` (mock `/api/contracts*`; reuse the scenarios of `contract-source.spec.ts` for parts):
  - list shows contracts with masked CPF, freshness line, no `Importar` / `Novo contrato` controls, links to `/contratos/13847`;
  - first-load state (no completed run, empty data) shows the first-load sentence instead of the generic empty state;
  - stale UASG notice names the unit and its last date;
  - detail shows the read-only header (no `Editar contrato`, no delete button), the part sections, and saves notes (PUT body `{ notes }`, then `Salvo por …`), with an error state and retry when saving fails;
  - `/contratos/abc` and `/contratos/novo` render the 404 page; `/contratos/importar` too;
  - widths 360, 390 and 1440: no page-level horizontal scroll, notes editor and save button visible.

- [ ] **Step 2: Run** against an isolated stack (throwaway DB migrated, API on 4200, `pnpm --filter @contracts/web build` then `next start -p 3200` with `API_INTERNAL_URL=http://localhost:4200`): `E2E_BASE_URL=http://localhost:3200 npx playwright test tests/e2e/contracts.spec.ts` → FAIL.

- [ ] **Step 3: Implement**; server components by default, client leaves only for filters, pager and the notes form.

- [ ] **Step 4: Run** `pnpm --filter @contracts/web lint`, `npx tsc --noEmit` in `apps/web`, and the whole e2e suite against the isolated stack (`E2E_BASE_URL=http://localhost:3200 npx playwright test`, finance specs per their own config) → PASS. Walk `docs/ui-rules.md` §8 and record the result in the ledger.

- [ ] **Step 5: Commit** `feat(web): consult replicated contracts without import or manual creation`.

---

### Task 6: Docs, spec alignment and end-to-end smoke

**Files:**
- Modify: `README.md` (dev flow: contracts come from `docker compose --profile sync up replicator` or `pnpm sources:daily -- -once`; import removed), `docs/superpowers/specs/2026-11-07-institutional-copilot-design.md` (§6 scope uses the managing UG; roadmap row 2/6 notes pointing to the automatic-sync design), any doc under `docs/` that describes contract import or manual contract creation.

- [ ] **Step 1:** Update the docs above.
- [ ] **Step 2: Smoke (manual, real source allowed, never the shared dev DB):** throwaway DB `contracts_sync_smoke` migrated; one institution `158148`; `DATABASE_URL=… go run ./cmd/replicator daily -source CONTRATOS_GOV_BR -once`; check `daily_runs` COMPLETED, contracts listed at `http://localhost:3200/contratos`, a contract detail with parts, notes saved and still present after a second `-once` run (which must skip inactive contracts not due).
- [ ] **Step 3: Run** all suites (`go test ./...`, API `test` + `test:integration`, web lint/tsc, e2e on the isolated stack) → PASS.
- [ ] **Step 4: Commit** `docs: describe automatic daily contract sync`.
