# Contract Derived Facts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute per-contract derived facts (current end date, time in force vs. legal maximum, estimated additions/suppressions with margin, guarantee vs. end date) during normalization, serve them with the contract, show a "Situação do contrato" summary, and add list filters.

**Architecture:** A pure Go function `normalize.ComputeFacts` turns the already-mapped header, history and guarantees into a `Facts` value; the normalizer upserts it into the new `public_sources.contract_facts` inside the same per-contract transaction. The API LEFT JOINs that table for list filters and indicators, adds time-dependent parts (days left) at read time, and the web renders codes into pt-BR copy.

**Tech Stack:** Go 1.24 (`database/sql`, `lib/pq`, `math/big`), PostgreSQL 16, Fastify + TypeScript (`tsx --test`), Next.js + shadcn/ui (Base UI), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-08-contract-derived-facts-design.md`

## Global Constraints

- English for schema, tables, columns, enum values, identifiers, comments, tests and technical docs; Portuguese only for UI copy (AGENTS.md).
- Any change under `apps/web` follows `docs/ui-rules.md`; done only when its §8 checklist passes.
- The API never calls external sources; it reads `public_sources` only. The replicator never creates schema objects (API migration only).
- Money and percentages are `numeric` in SQL and `math/big.Rat` in Go — never floats. Display rounding only in the web.
- "Ending soon" window: **90 days** everywhere (status `EXPIRING`). Amendment limit: **25%**. "Close to the limit": **additions ≥ 80% of the limit** (`limit_used_ratio >= 0.8`).
- Law cut-offs: signature before `2021-04-01` → `8666`; after `2023-12-30` → `14133`; in between → `UNKNOWN`. Caps: `8666` → 60 months, `14133` → 120 months.
- Absence in the source is said as absence in the source ("nenhuma garantia informada pelo Contratos.gov.br"), never "sem garantia". Every amendment % and the time-in-force figure is labeled "estimativa".
- No manual input, no import or recompute buttons (standing project rule: data arrives automatically).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A history term without `valor_global` (nil) in the middle of the sequence → excluded with reason `NO_GLOBAL_VALUE`, the reference value carries over, no panic. (Task 3)
2. Initial value nil or zero → amendments fact `NOT_COMPUTABLE`, never a division by zero. (Task 3)
3. A contract normalized before this release has no `contract_facts` row → list still shows it (LEFT JOIN), filters do not match it, detail returns `facts: null` and the screen says facts appear after the next sync. (Tasks 5, 6)
4. History rows without signature date → sorted last, by external id, deterministically. (Task 3)
5. History part `FAILED` with rows from the previous capture → facts still computed from those rows; `explanation.historyPart = "FAILED"` so the screen can say the data may be stale. (Task 4)

---

### Task 1: `contract_facts` table, migration wiring and data-model doc

**Files:**
- Create: `apps/api/migrations/202611100001_public_sources_contract_facts.sql`
- Modify: `apps/etl/internal/testdb/testdb.go` (add constant), every `testdb.Isolated(...)` call that lists `testdb.SyncMigration` (`apps/etl/cmd/replicator/main_test.go`, `apps/etl/internal/capture/store_test.go`, `apps/etl/internal/daily/cycle_test.go`, `apps/etl/internal/normalize/schema_test.go`)
- Modify: `apps/etl/cmd/replicator/main.go` (`requiredMigrations`)
- Modify: `docs/public-sources-data-model.md` (new "Derived facts" section)
- Test: `apps/etl/internal/normalize/schema_test.go`, `apps/etl/cmd/replicator/main_test.go`

**Interfaces:**
- Produces: table `public_sources.contract_facts`; Go constant `testdb.FactsMigration = "202611100001_public_sources_contract_facts"`.

Table (one row per contract; all names exact — later tasks use them):

| Column | Type | Notes |
|---|---|---|
| `source`, `contract_external_id` | text, bigint | PK; FK → `contracts (source, external_id)` `ON DELETE CASCADE` |
| `method_version` | integer NOT NULL | `1` |
| `current_end_date` | date | |
| `end_date_source` | text | `CHECK IN ('HEADER','TERM')`, NULL when unknown |
| `term_end_date`, `term_end_external_id` | date, bigint | only when the latest term disagrees with the header |
| `original_start_date` | date | |
| `law`, `law_source` | text NOT NULL | `law IN ('8666','14133','UNKNOWN')`; `law_source IN ('LEGAL_BASIS','SIGNATURE_DATE','NONE')` |
| `term_status`, `amendments_status` | text NOT NULL | `IN ('COMPUTED','ESTIMATED','NOT_COMPUTABLE','NOT_APPLICABLE')` |
| `term_months`, `term_cap_months` | integer | |
| `base_value`, `additions_value`, `suppressions_value`, `addition_margin` | numeric(24,6) | margin is signed (negative = excess) |
| `additions_pct`, `suppressions_pct`, `limit_used_ratio` | numeric(12,4) | |
| `guarantee_status` | text NOT NULL | `IN ('COVERS','BEFORE_END','NONE_INFORMED','NOT_CONSULTED','NOT_COMPARABLE')` |
| `guarantee_due_date` | date | latest due date among guarantee rows |
| `explanation` | jsonb NOT NULL | shape in Task 2 |
| `computed_at` | timestamptz NOT NULL DEFAULT now() | |

Indexes: `(source, guarantee_status)`, `(source, limit_used_ratio)`. Table and column comments in English.

- [ ] **Step 1: Write the failing schema test** `TestContractFactsSchema` in `schema_test.go`: insert a contract, then a facts row with `law = '9999'` → expect error; a valid row → `SELECT count(*)` = `1`; `DELETE FROM public_sources.contracts` → facts count `0` (cascade).
- [ ] **Step 2: Add `FactsMigration` to `migrated()` and to every Isolated call that lists `SyncMigration`; run** `ETL_TEST_DATABASE_URL='postgresql://contracts:contracts_local@localhost:5540/contracts?sslmode=disable' go test ./internal/normalize/ -run TestContractFactsSchema -count=1` (from `apps/etl`). Expected: FAIL (migration file not found).
- [ ] **Step 3: Write the migration** with the table above.
- [ ] **Step 4: Append `"202611100001_public_sources_contract_facts"` to `requiredMigrations` in `main.go`; add `TestExecuteRequiresFactsMigration`** (database with the three older migrations only → `normalize -all` exits 1 and stderr contains `202611100001_public_sources_contract_facts`).
- [ ] **Step 5: Run** `go test ./... -count=1` with `ETL_TEST_DATABASE_URL` set. Expected: PASS. Then `pnpm db:migrate` against the local database. Expected: the migration applies.
- [ ] **Step 6: Document the table** in `docs/public-sources-data-model.md` (purpose, columns, status values, "written by the replicator during normalization; time-dependent parts computed by the API").
- [ ] **Step 7: Commit** `feat(sources): add contract derived facts table`.

### Task 2: `ComputeFacts` — end date, law, time in force, guarantee

**Files:**
- Create: `apps/etl/internal/normalize/facts.go`
- Test: `apps/etl/internal/normalize/facts_test.go` (package `normalize_test`, no database)

**Interfaces:**
- Consumes: `Contract`, `Amendment`, `Guarantee` from `contratosgovbr.go`.
- Produces (exact):

```go
const FactsMethodVersion = 1

type FactStatus string // "COMPUTED" | "ESTIMATED" | "NOT_COMPUTABLE" | "NOT_APPLICABLE"

// PartStatuses are the contract_parts statuses of the parts facts depend on.
type PartStatuses struct{ History, Guarantees string }

type Facts struct {
	CurrentEndDate    *time.Time
	EndDateSource     string // "HEADER" | "TERM" | ""
	TermEndDate       *time.Time
	TermEndExternalID *int64
	OriginalStartDate *time.Time
	Law, LawSource    string
	TermStatus        FactStatus
	TermMonths, TermCapMonths *int64
	AmendmentsStatus  FactStatus
	BaseValue, AdditionsValue, SuppressionsValue, AdditionMargin *string // FloatString(6)
	AdditionsPct, SuppressionsPct, LimitUsedRatio                *string // FloatString(4)
	GuaranteeStatus   string
	GuaranteeDueDate  *time.Time
	Explanation       Explanation
}

type Explanation struct {
	Terms          []TermFact `json:"terms"`
	HistoryPart    string     `json:"historyPart"`
	GuaranteesPart string     `json:"guaranteesPart"`
	GuaranteeCount int        `json:"guaranteeCount"`
}

type TermFact struct {
	ExternalID    string   `json:"externalId"`
	Number        *string  `json:"number"`
	TypeName      *string  `json:"typeName"`
	SignatureDate *string  `json:"signatureDate"` // YYYY-MM-DD
	GlobalValue   *string  `json:"globalValue"`
	Delta         *string  `json:"delta"`
	Counted       string   `json:"counted,omitempty"` // "ADDITION" | "SUPPRESSION"
	Reason        string   `json:"reason,omitempty"`  // see Task 3
	Flags         []string `json:"flags"`
}

func ComputeFacts(c Contract, history []Amendment, guarantees []Guarantee, parts PartStatuses) Facts
```

Rules for this task (spec §4 intro, §4.1, §4.3, §4.5):
- **Original row:** earliest history row by `(SignatureDate nil-last, ExternalID)` whose `TypeName` is not `Termo Aditivo`, `Termo de Apostilamento` or `Termo de Rescisão`.
- **Current end date:** header `EndDate` → source `HEADER`. "Latest term" = the history row with the greatest `(SignatureDate, ExternalID)` among non-apostille rows with an `EndDate`. Header nil → use latest term, source `TERM`. Header set and latest term's end differs → fill `TermEndDate`/`TermEndExternalID`.
- **Law:** `LegalBasis` matching `14\.?133` → `14133`, `8\.?666` → `8666` (source `LEGAL_BASIS`); else by header `SignatureDate` with the Global Constraints cut-offs (source `SIGNATURE_DATE`); else `UNKNOWN`/`NONE`.
- **Time in force:** `NOT_APPLICABLE` when `TypeName` ≠ `Contrato` or `Category` ∈ {`Compras`, `Obras`}; `NOT_COMPUTABLE` without start (`original.StartDate`, else header `StartDate`) or current end; else `ESTIMATED`, `TermMonths` = whole months from start to current end (a month counts when the end day ≥ start day), `TermCapMonths` 60/120, nil for `UNKNOWN`.
- **Guarantee:** no rows → `NOT_CONSULTED` when `parts.Guarantees` ∈ {`MISSING`,`FAILED`}, else `NONE_INFORMED`. Rows but all due dates nil → `NONE_INFORMED`. Current end nil → `NOT_COMPARABLE`. Coverage = max due date; `< CurrentEndDate` → `BEFORE_END`, else `COVERS`.
- Amendment fields stay zero-valued in this task except `AmendmentsStatus` (Task 3 fills them; return `NOT_APPLICABLE` for non-`Contrato` already here).

- [ ] **Step 1: Write failing tests** (helpers `d("2026-06-06") *time.Time`, `s("x") *string`):
  - `TestFactsEndDateHeaderWinsAndShowsDivergence`: header end `2026-06-06`; history Contrato (sig `2021-12-06`, end `2024-06-06`), Termo Aditivo id 2 (sig `2024-05-13`, end `2026-12-06`) → `CurrentEndDate` `2026-06-06`, `EndDateSource` `HEADER`, `TermEndDate` `2026-12-06`, `*TermEndExternalID == 2`.
  - `TestFactsEndDateFallsBackToLatestTerm`: header end nil; aditivo end `2027-05-01` → `2027-05-01`, `TERM`, no divergence.
  - `TestFactsRescissionMatchesHeader`: header end `2025-08-22`; Termo de Rescisão end `2025-08-22` later than Contrato end `2025-12-17` → no divergence.
  - `TestFactsApostilleEndIgnored`: latest row is an apostille with a different end → no divergence.
  - `TestFactsLaw` table: `"LEI 14.133/2021 - Artigo: 74"` → `14133/LEGAL_BASIS`; `"Lei nº 8.666/1993"` → `8666/LEGAL_BASIS`; nil basis + sig `2019-01-31` → `8666/SIGNATURE_DATE`; sig `2022-06-01` → `UNKNOWN/SIGNATURE_DATE`; sig `2024-01-02` → `14133/SIGNATURE_DATE`; both nil → `UNKNOWN/NONE`.
  - `TestFactsTermInForce`: Contrato, `Serviços`, 14.133, start `2021-12-06`, end `2026-06-06` → `ESTIMATED`, months `54`, cap `120`; same with end `2026-06-05` → `53`; category `Compras` → `NOT_APPLICABLE`; `TypeName` `Empenho` → `NOT_APPLICABLE` (and `AmendmentsStatus` `NOT_APPLICABLE`); law `UNKNOWN` → cap nil.
  - `TestFactsGuarantee` table with end `2026-06-06`: dues `2025-01-01`,`2027-01-01` → `COVERS`, due `2027-01-01`; only `2025-01-01` → `BEFORE_END`; no rows + `NOT_FOUND` → `NONE_INFORMED`; no rows + `AVAILABLE` → `NONE_INFORMED`; no rows + `MISSING` → `NOT_CONSULTED`; no rows + `FAILED` → `NOT_CONSULTED`; rows + end nil → `NOT_COMPARABLE`.
- [ ] **Step 2: Run** `go test ./internal/normalize/ -run TestFacts -count=1`. Expected: FAIL (undefined `ComputeFacts`).
- [ ] **Step 3: Implement** the types and `ComputeFacts` in `facts.go` per the rules above.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sources): compute contract end date, law, term and guarantee facts`.

### Task 3: `ComputeFacts` — cumulative additions and suppressions

**Files:**
- Modify: `apps/etl/internal/normalize/facts.go`
- Test: `apps/etl/internal/normalize/facts_test.go`

**Interfaces:**
- Consumes/produces: `ComputeFacts`, `Facts`, `TermFact` from Task 2 (fills the amendment fields and `Explanation.Terms`).
- Reasons (exact): `ORIGINAL`, `APOSTILLE`, `RESCISSION`, `OTHER_TYPE`, `NO_GLOBAL_VALUE`, `NO_VALUE_CHANGE`, `EXTENSION_ONLY`, `PRICE_ADJUSTMENT_ONLY`.
- Flags (exact): `NO_QUALIFICATION`, `INCLUDES_PRICE_ADJUSTMENT`, `MIGRATED_RECORD`, `TEXT_MENTIONS_ADJUSTMENT`, `APOSTILLE_TEXT_MENTIONS_ADDITION`.

Algorithm (spec §4.4, decided with the user: when in doubt, count):

```
status: NOT_APPLICABLE if TypeName != "Contrato";
        NOT_COMPUTABLE if len(history) == 0 or base (header InitialValue) nil or 0;
        else ESTIMATED.
rows sorted by (SignatureDate nil-last, ExternalID); ref := nil
for each row:
  vg := row.GlobalValue
  switch type:
    original row          -> reason ORIGINAL
    Termo de Apostilamento-> reason APOSTILLE; flag APOSTILLE_TEXT_MENTIONS_ADDITION if obs ~* acr[eé]scimo
    Termo de Rescisão     -> reason RESCISSION
    Termo Aditivo:
      if vg nil            -> reason NO_GLOBAL_VALUE (ref unchanged; continue)
      prev := ref ?? base;  delta := vg - prev
      Q := set(qualifications)
      if delta == 0                                   -> NO_VALUE_CHANGE
      elif Q == {VIGÊNCIA}                            -> EXTENSION_ONLY
      elif Q == {REAJUSTE} or Q == {REAJUSTE,VIGÊNCIA} -> PRICE_ADJUSTMENT_ONLY
      else counted ADDITION (delta>0) / SUPPRESSION (delta<0); flags:
           NO_QUALIFICATION if Q empty; INCLUDES_PRICE_ADJUSTMENT if REAJUSTE in Q;
           MIGRATED_RECORD if Q == {ACRÉSCIMO / SUPRESSÃO, INFORMATIVO, VIGÊNCIA};
           TEXT_MENTIONS_ADJUSTMENT if obs ~* (reajust|repactua|prorroga|renova)
    other types           -> reason OTHER_TYPE
  if vg != nil: ref = vg            (every row with a value moves the reference)
additions = Σ delta (ADDITION); suppressions = Σ |delta| (SUPPRESSION)
additionsPct = additions/base*100; suppressionsPct = suppressions/base*100
margin = base*25/100 - additions; limitUsedRatio = additionsPct/25
```

Every history row appears in `Explanation.Terms` (with `Delta` only for `Termo Aditivo` rows that had a value), in the sorted order.

- [ ] **Step 1: Write failing tests**
  - `TestFactsAmendmentsWhenInDoubtCount`: base `100000`; rows in signature order: Contrato vg `100000`; apostille vg `110000` obs `"ACRÉSCIMO DE R$ 10.000,00"`; aditivo `[ACRÉSCIMO / SUPRESSÃO]` vg `130000`; aditivo `[ACRÉSCIMO / SUPRESSÃO, INFORMATIVO, VIGÊNCIA]` vg `125000`; aditivo `[VIGÊNCIA]` vg `125000`; aditivo `[REAJUSTE, VIGÊNCIA]` vg `131250`; aditivo `[]` vg `133250` obs `"REPACTUAÇÃO ..."`. Assert: `AmendmentsStatus` `ESTIMATED`; `AdditionsValue` `"22000.000000"`; `SuppressionsValue` `"5000.000000"`; `AdditionsPct` `"22.0000"`; `SuppressionsPct` `"5.0000"`; `AdditionMargin` `"3000.000000"`; `LimitUsedRatio` `"0.8800"`; reasons/counted per row = `ORIGINAL`, `APOSTILLE`(flag `APOSTILLE_TEXT_MENTIONS_ADDITION`), `ADDITION`, `SUPPRESSION`(flag `MIGRATED_RECORD`), `NO_VALUE_CHANGE`, `PRICE_ADJUSTMENT_ONLY`, `ADDITION`(flags `NO_QUALIFICATION`,`TEXT_MENTIONS_ADJUSTMENT`).
  - `TestFactsAmendmentsMigratedExtensionWithoutValueChange`: Contrato `71352.36` + four `[ACRÉSCIMO / SUPRESSÃO, INFORMATIVO, VIGÊNCIA]` at `71352.36` → all `NO_VALUE_CHANGE`, `AdditionsPct` `"0.0000"`, `ESTIMATED`.
  - `TestFactsAmendmentsOverLimit`: base `100000`, one addition to `130000` → margin `"-5000.000000"`, ratio `"1.2000"`.
  - `TestFactsAmendmentsNilGlobalValue`: aditivo with nil vg between two valued aditivos → `NO_GLOBAL_VALUE`, next delta measured from the last valued row.
  - `TestFactsAmendmentsNotComputable`: no history → `NOT_COMPUTABLE`; base `"0"` → `NOT_COMPUTABLE`; base nil → `NOT_COMPUTABLE`.
  - `TestFactsAmendmentsOrderNilSignatureLast`: two aditivos, one without signature date → it is last in `Explanation.Terms`; ties broken by external id.
- [ ] **Step 2: Run** `go test ./internal/normalize/ -run TestFactsAmendments -count=1`. Expected: FAIL.
- [ ] **Step 3: Implement** with `math/big.Rat` (parse the `*string` decimals with `SetString`).
- [ ] **Step 4: Run** `go test ./internal/normalize/ -count=1`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sources): estimate contract additions and suppressions with method`.

### Task 4: Persist facts during normalization

**Files:**
- Modify: `apps/etl/internal/normalize/store.go` (`contract()` and a new `writeFacts`)
- Test: `apps/etl/internal/normalize/store_test.go`
- Modify: `apps/etl/README.md` (normalize writes facts; run `pnpm sources:normalize -- -all` once after deploying)

**Interfaces:**
- Consumes: `ComputeFacts`, `PartStatuses`, `FactsMethodVersion` (Tasks 2–3); `parts` order in `store.go` (`history`, `commitments`, `guarantees`, …).
- Produces: `func (n *Normalizer) writeFacts(ctx context.Context, tx *sql.Tx, externalID int64, f Facts) error` — `INSERT … ON CONFLICT (source, contract_external_id) DO UPDATE` of every column, `computed_at = now()`.

In `contract()`, after child rows are written and before `tx.Commit()`: collect the typed `[]Amendment` and `[]Guarantee` from `states` (type-assert the `row` values) and the two part statuses, call `ComputeFacts(header, …)`, then `writeFacts`.

- [ ] **Step 1: Write failing tests**
  - `TestNormalizeWritesFacts`: `fullContract()` seeding → after `Contract(ctx, 13847)` there is one `contract_facts` row with `method_version = 1`, `end_date_source = 'HEADER'` and `explanation->>'historyPart' = 'AVAILABLE'`.
  - `TestNormalizeFactsFromLastGoodHistory`: good history capture, then `failed("contract_history", …)` → facts row exists, `explanation->>'historyPart' = 'FAILED'`, `jsonb_array_length(explanation->'terms') > 0`.
  - `TestNormalizeFactsReplacedOnRenormalize`: normalize twice with a changed header end date → still one row, new `current_end_date`.
- [ ] **Step 2: Run** `go test ./internal/normalize/ -run TestNormalize -count=1` (with `ETL_TEST_DATABASE_URL`). Expected: the three new tests FAIL.
- [ ] **Step 3: Implement** `writeFacts` and the call in `contract()`.
- [ ] **Step 4: Run** `go test ./... -count=1`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sources): store derived facts when normalizing a contract`.

### Task 5: API — 90-day window, facts on detail, list filters and indicators

**Files:**
- Modify: `packages/validation/index.js`, `packages/validation/index.d.ts` (export `EXPIRING_WINDOW_DAYS = 90`, `NEAR_LIMIT_RATIO = 0.8`)
- Modify: `apps/api/src/domain.ts` (`contractStatus` uses `EXPIRING_WINDOW_DAYS`)
- Modify: `apps/api/src/contracts/repository.ts`, `apps/api/src/contracts/service.ts`, `apps/api/src/app.ts`
- Create: `apps/api/src/contracts/facts.ts` (row type + `presentFacts`)
- Modify: `docs/api-contract.md` (§ contracts: 90 days, new filters, `facts`, summary fields)
- Test: `apps/api/test/domain.test.ts`, `apps/api/test/integration/contracts.test.ts`

**Interfaces:**
- Consumes: `public_sources.contract_facts` (Task 1); `ContractCommitmentRepository.totals(externalId)` (existing, step 3) for `remaining`.
- Produces (web relies on these exact names):
  - `GET /contracts` accepts `guaranteeBeforeEnd=true` and `nearLimit=true` (any other value → 400 `Filtro inválido.`). `ContractSummary` gains `nearLimit: boolean`, `guaranteeBeforeEnd: boolean`; `endDate` becomes `COALESCE(c.end_date, f.current_end_date)` and status/period filters use that same expression.
  - `GET /contracts/:externalId` returns `{contract, parts, notes, facts: ContractFacts | null}`:

```ts
export interface ContractFacts {
  methodVersion: number;
  computedAt: string;
  endDate: { value: string | null; source: "HEADER" | "TERM" | null; daysLeft: number | null;
             divergence: { termEndDate: string; termExternalId: string } | null };
  term: { status: FactStatus; startDate: string | null; months: number | null; capMonths: number | null;
          law: "8666" | "14133" | "UNKNOWN"; lawSource: "LEGAL_BASIS" | "SIGNATURE_DATE" | "NONE" };
  amendments: { status: FactStatus; base: string | null; additions: string | null; suppressions: string | null;
                additionsPct: string | null; suppressionsPct: string | null; limitPct: "25";
                margin: string | null; limitUsedRatio: string | null; nearLimit: boolean; terms: TermFact[] };
  guarantee: { status: "COVERS" | "BEFORE_END" | "NONE_INFORMED" | "NOT_CONSULTED" | "NOT_COMPARABLE";
               dueDate: string | null; daysBeforeEnd: number | null };
  remaining: string | null; // ContractCommitmentRepository.totals().remaining
  historyPart: string; guaranteesPart: string;
}
```

  `daysLeft` = calendar days (UTC) from today to `endDate.value` (negative after the end). `daysBeforeEnd` = days from `dueDate` to `endDate.value` when `BEFORE_END`. `ContractService` constructor becomes `(contracts: ContractRepository, commitments: Pick<ContractCommitmentRepository, "totals">)`.

Repository: `registered` becomes `public_sources.contracts c JOIN "Institution" i ON i.uasg = c.managing_unit_code LEFT JOIN public_sources.contract_facts f ON f.source = c.source AND f.contract_external_id = c.external_id`; `nearLimit` SQL = `(f.amendments_status = 'ESTIMATED' AND f.limit_used_ratio >= 0.8) IS TRUE`; `guaranteeBeforeEnd` SQL = `(f.guarantee_status = 'BEFORE_END') IS TRUE`; new `facts(externalId)` method. Update the `statusSql` comment to say 90 days.

- [ ] **Step 1: Write failing tests**
  - `domain.test.ts`: rename to `"calendar statuses honor inclusive end and 90-day boundary"`; today `2026-10-30`: end `2027-01-28` → `EXPIRING`; end `2027-01-29` → `ACTIVE`; keep the existing inclusive-end and unknown cases.
  - `contracts.test.ts` (seed facts rows with a helper `facts(db, externalId, fields)`):
    - `"list marks and filters contracts close to the amendment limit"`: ratios `0.8000`, `0.7999`, none → `nearLimit=true` returns only the first; summaries carry `nearLimit` `true`/`false`/`false`.
    - `"list filters guarantees expiring before the contract"`: `BEFORE_END`, `COVERS`, no facts row → only the first.
    - `"list rejects unknown fact filter values"`: `nearLimit=yes` → 400 `Filtro inválido.`
    - `"expiring uses 90 days and the fallback end date"`: header end null + facts `current_end_date` = `day(60)` → listed under `status=EXPIRING` with `endDate` = `day(60)`.
    - `"detail returns facts with days left and remaining value"`: header end `day(10)`, guarantee due `day(3)` `BEFORE_END` → `facts.endDate.daysLeft === 10`, `facts.guarantee.daysBeforeEnd === 7`, `facts.amendments.limitPct === "25"`, `facts.remaining` equals the commitments endpoint `balance.remaining`.
    - `"detail returns null facts before the first computation"`: no facts row → `facts === null`, `200`.
- [ ] **Step 2: Run** `pnpm --filter @contracts/api exec tsx --test test/domain.test.ts` and `pnpm --filter @contracts/api test:integration`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** constants, `contractStatus`, repository, `facts.ts` (`presentFacts(row, today): ContractFacts`), service and `app.ts` wiring.
- [ ] **Step 4: Run** `pnpm test` and `pnpm --filter @contracts/api test:integration`. Expected: PASS. `pnpm --filter @contracts/api lint`. Expected: no errors.
- [ ] **Step 5: Update `docs/api-contract.md`** (window 90 days; filters; `facts`; summary fields).
- [ ] **Step 6: Commit** `feat(contracts): serve derived facts, 90-day window and fact filters`.

### Task 6: Web — "Situação do contrato" summary with method disclosure

**Files:**
- Modify: `apps/web/lib/contracts-api.ts` (types `ContractFacts`, `TermFact`, `FactStatus`; `ContractRecord.facts`)
- Create: `apps/web/lib/contract-facts.ts` (pt-BR copy from codes)
- Create: `apps/web/components/contract-facts/contract-facts-summary.tsx`, `amendment-meter.tsx`, `fact-method.tsx`
- Modify: `apps/web/components/contracts/contract-detail.tsx` (render the summary right after `PageHead`, before `ContractHeader`)
- Modify: `apps/web/app/globals.css` only for semantic classes on existing tokens, if needed
- Test: `tests/e2e/contracts.spec.ts`

**Interfaces:**
- Consumes: `ContractFacts` (Task 5).
- Produces (`contract-facts.ts`): `reasonLabels: Record<string,string>`, `flagLabels: Record<string,string>`, `lawLabel(law, lawSource): string`, `daysLine(daysLeft: number | null): string`, `termLine(term): string`, `guaranteeLine(guarantee): string`.

Exact copy (pt-BR, spec §4–§6):
- Section title `Situação do contrato`; each estimate shows the `Estimativa` badge.
- `daysLine`: `> 0` → `Vence em N dias` (`1` → `Vence amanhã`); `0` → `Vence hoje`; `< 0` → `Encerrado há N dias`; null → `Vigência não informada`.
- Divergence: `Cabeçalho do Contratos.gov.br: {data} · termo {número}: {data}`.
- Term: `{X anos e Y meses} de {10 anos | 60 meses} (estimativa)`; law `UNKNOWN` → `… de 60 meses (Lei 8.666) ou 10 anos (Lei 14.133)`; `NOT_APPLICABLE` → `Não se aplica a este tipo de instrumento`.
- Amendments: `Acréscimos: N% de 25%`, `Supressões: N% de 25%`, margin ≥ 0 → `Ainda cabe acrescer {R$}`, < 0 → `Acréscimos excedem o limite em {R$}`; zero counted terms → `0% — nenhum termo de acréscimo ou supressão identificado`; `NOT_COMPUTABLE` → `Não calculável: o histórico do contrato não foi informado`.
- Guarantee: `BEFORE_END` → `A garantia vence em {data}, N dias antes do contrato`; `COVERS` → `Garantia válida até {data}`; `NONE_INFORMED` → `Nenhuma garantia informada pelo Contratos.gov.br`; `NOT_CONSULTED` → `Garantias não consultadas no Contratos.gov.br`; `NOT_COMPARABLE` → `Sem data de fim para comparar com a garantia`.
- Remaining: `Saldo do contrato {R$}` linking to the commitments section anchor.
- `historyPart`/`guaranteesPart` `FAILED` → `Pode estar desatualizado: a última consulta falhou` next to the fact.
- `facts === null` → `Os fatos do contrato aparecem após a próxima sincronização diária.`
- Disclosure `Como calculamos` (native `<details>`/`<summary>` or the shadcn equivalent): method text naming base (`valor inicial registrado`), limit 25% and law, the 50% renovation note (`50% para reforma de edifício ou equipamento não é identificado na fonte`), then a table of terms (número, tipo, data, valor global, variação, contado como / motivo, avisos) using `reasonLabels`/`flagLabels`.

- [ ] **Step 1: Write failing Playwright tests** in `contracts.spec.ts` (mock `facts` on the detail route):
  - `"contract summary shows end date, estimates and margin"`: `daysLeft: 45`, additions `22.0000`, margin `3000.000000` → page shows `Vence em 45 dias`, `Acréscimos: 22% de 25%`, `Ainda cabe acrescer R$ 3.000,00`, an `Estimativa` badge; opening `Como calculamos` shows a row with `Registro migrado`.
  - `"contract summary says absence in the source"`: guarantee `NONE_INFORMED` → `Nenhuma garantia informada pelo Contratos.gov.br`; no text `Sem garantia`.
  - `"contract summary before the first computation"`: `facts: null` → the null-facts copy.
  - `"contract summary fits 390px"`: viewport 390 → no horizontal scroll (`document.documentElement.scrollWidth <= 390`).
- [ ] **Step 2: Run** `pnpm test:e2e tests/e2e/contracts.spec.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** types, `contract-facts.ts`, the three components (server-safe where possible; reuse `Badge`, `Status`, domain primitives; tokens only) and the wiring in `contract-detail.tsx`.
- [ ] **Step 4: Run** the Playwright file, then `pnpm --filter @contracts/web lint` and `pnpm --filter @contracts/web build`. Expected: PASS. Check light/dark/system and keyboard focus manually (ui-rules §8).
- [ ] **Step 5: Commit** `feat(web): show contract situation with explained estimates`.

### Task 7: Web — list filters and indicators

**Files:**
- Modify: `apps/web/components/contracts/contract-filters.tsx` (`ContractFilterValues` gains `nearLimit: "" | "true"`, `guaranteeBeforeEnd: "" | "true"`)
- Modify: `apps/web/components/contracts/contract-list.tsx` (query params; row indicators)
- Modify: `apps/web/lib/contracts-api.ts` (`ContractSummary.nearLimit`, `guaranteeBeforeEnd`), `apps/web/lib/api.ts` (status hint)
- Test: `tests/e2e/contracts.spec.ts`

**Interfaces:**
- Consumes: query params and summary fields from Task 5; `EXPIRING_WINDOW_DAYS` from `@contracts/validation`.

Copy: advanced filters gain two checkboxes `Perto do limite de aditivos` and `Garantia vence antes do contrato`; the situation option `Vence em breve` gets the hint `até 90 dias` (built from `EXPIRING_WINDOW_DAYS`). Row indicators: badges `Perto do limite de aditivos` and `Garantia vence antes`, next to the existing situation badge.

- [ ] **Step 1: Write failing Playwright tests**
  - `"list filters contracts close to the amendment limit"`: check the box → the captured request URL has `nearLimit=true`; clear filters removes it.
  - `"list filters guarantees expiring before the contract"`: same for `guaranteeBeforeEnd=true`.
  - `"list rows show fact indicators"`: summary with `nearLimit: true` → row shows `Perto do limite de aditivos`.
- [ ] **Step 2: Run** `pnpm test:e2e tests/e2e/contracts.spec.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** filters, params and badges.
- [ ] **Step 4: Run** the Playwright file, `pnpm --filter @contracts/web lint`, `pnpm --filter @contracts/web build`, and `pnpm test:e2e tests/e2e/appearance.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): filter contracts by amendment limit and guarantee`.

### Task 8: Backfill and verification on real data

**Files:** none (verification only; fix in the owning task's files if something fails).

- [ ] **Step 1: Run** `pnpm db:migrate`, then `pnpm sources:normalize -- -all`. Expected: JSON summary with `failed: 0`.
- [ ] **Step 2: Check counts** with `psql`: every row of `public_sources.contracts` has a `contract_facts` row; `SELECT amendments_status, count(*) … GROUP BY 1` shows `NOT_APPLICABLE` for the `Empenho` instruments; list the 10 highest `limit_used_ratio` with their counted terms and confirm by reading two of them in `explanation` that the counting matches §4.4.
- [ ] **Step 3: Open** `/contratos` and two contracts (one with a divergence, one near the limit) at 390px and 1440px, light and dark. Expected: copy as in Task 6; no horizontal scroll.
- [ ] **Step 4: Run the full suites** `pnpm test`, `pnpm --filter @contracts/api test:integration`, `go test ./... -count=1` (with `ETL_TEST_DATABASE_URL`), `pnpm test:e2e`. Expected: all PASS.
