# Contract Derived Facts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute per-contract derived facts (current end date, time in force vs. legal maximum, estimated additions/suppressions with margin, guarantee vs. end date) when a contract is opened, show a "Situação do contrato" summary that explains each fact, widen "Vence em breve" to 90 days and add a "garantia vence antes do contrato" list filter.

**Architecture:** A pure TypeScript function `computeFacts` in the API turns the replica rows it already reads (header, `contract_amendments`, `contract_guarantees`, `contract_parts`) into a `ContractFacts` object returned with `GET /contracts/:externalId`. Nothing is stored: no migration, no ETL change, no backfill. The list uses only plain SQL conditions on the header end date and the guarantees table.

**Tech Stack:** Fastify + TypeScript (`tsx --test`, `decimal.js` already a dependency), PostgreSQL 16, Next.js + shadcn/ui (Base UI), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-08-contract-derived-facts-design.md`

## Global Constraints

- English for identifiers, enum values, comments, tests and technical docs; Portuguese only for UI copy (AGENTS.md).
- Any change under `apps/web` follows `docs/ui-rules.md`; done only when its §8 checklist passes.
- The API never calls external sources; it reads `public_sources` only. No schema change in this step.
- Money and percentages with `decimal.js`, never JS `number` arithmetic. Money results `toFixed(2)`, percentages and ratios `toFixed(4)`; display rounding only in the web.
- "Ending soon" window: **90 days** everywhere (status `EXPIRING`). Amendment limit: **25%**. Detail highlight "perto do limite": additions ≥ **80%** of the limit.
- Law cut-offs: signature before `2021-04-01` → `8666`; after `2023-12-30` → `14133`; in between → `UNKNOWN`. Caps: `8666` → 60 months, `14133` → 120 months.
- Absence in the source is said as absence in the source ("Nenhuma garantia informada pelo Contratos.gov.br"), never "sem garantia". Every amendment % and the time-in-force figure is labeled "estimativa".
- Out of scope (deferred by the user): the "perto do limite de aditivos" list filter and list indicator.
- No manual input, no recompute buttons.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A history term without global value in the middle of the sequence → excluded with reason `NO_GLOBAL_VALUE`, the reference value carries over, no exception. (Task 2)
2. Initial value null or zero → amendments `NOT_COMPUTABLE`, never a division by zero. (Task 2)
3. History rows without signature date → sorted last, then by external id, deterministically. (Task 2)
4. History part `FAILED` with rows from the previous capture → facts still computed; `historyPart: "FAILED"` so the screen says the data may be stale. (Tasks 3, 4)
5. Header without end date but a term with one → detail shows the term date (`source: "TERM"`), while the list keeps it under "Sem vigência" as today (designer's call in the spec). (Tasks 1, 3)

---

### Task 1: `computeFacts` — end date, law, time in force, guarantee

**Files:**
- Create: `apps/api/src/contracts/facts.ts`
- Test: `apps/api/test/contract-facts.test.ts` (unit, no database; picked up by `tsx --test test/*.test.ts`)

**Interfaces (exact; later tasks use these names):**

```ts
export type FactStatus = "COMPUTED" | "ESTIMATED" | "NOT_COMPUTABLE" | "NOT_APPLICABLE";
export type GuaranteeStatus = "COVERS" | "BEFORE_END" | "NONE_INFORMED" | "NOT_CONSULTED" | "NOT_COMPARABLE";

export interface FactHeader {
  typeName: string | null; category: string | null; legalBasis: string | null;
  signatureDate: string | null; startDate: string | null; endDate: string | null; initialValue: string | null;
}
export interface FactTerm {
  externalId: string; number: string | null; typeName: string | null; qualifications: string[];
  observation: string | null; signatureDate: string | null; startDate: string | null;
  endDate: string | null; globalValue: string | null;
}
export interface FactGuarantee { externalId: string; dueDate: string | null }
export interface FactInput {
  header: FactHeader; history: FactTerm[]; guarantees: FactGuarantee[];
  parts: { history: string; guarantees: string }; // contract_parts status, "MISSING" when absent
}
export interface TermFact {
  externalId: string; number: string | null; typeName: string | null; signatureDate: string | null;
  globalValue: string | null; delta: string | null;
  counted: "ADDITION" | "SUPPRESSION" | null; reason: string | null; flags: string[];
}
export interface ContractFacts {
  endDate: { value: string | null; source: "HEADER" | "TERM" | null; daysLeft: number | null;
             divergence: { termEndDate: string; termExternalId: string; termNumber: string | null } | null };
  term: { status: FactStatus; startDate: string | null; months: number | null; capMonths: number | null;
          law: "8666" | "14133" | "UNKNOWN"; lawSource: "LEGAL_BASIS" | "SIGNATURE_DATE" | "NONE" };
  amendments: { status: FactStatus; base: string | null; additions: string | null; suppressions: string | null;
                additionsPct: string | null; suppressionsPct: string | null; limitPct: "25";
                margin: string | null; limitUsedRatio: string | null; nearLimit: boolean; terms: TermFact[] };
  guarantee: { status: GuaranteeStatus; dueDate: string | null; daysBeforeEnd: number | null; count: number };
  remaining: string | null; // filled by the service (Task 3), computeFacts returns null
  historyPart: string; guaranteesPart: string;
}
export function computeFacts(input: FactInput, today: string): ContractFacts
```

Rules for this task (spec §4 intro, §4.1–§4.3, §4.5). Dates are `YYYY-MM-DD` strings; day counts are UTC calendar days.
- **Original row:** earliest history row by `(signatureDate null-last, externalId numeric)` whose `typeName` is not `Termo Aditivo`, `Termo de Apostilamento` or `Termo de Rescisão`.
- **Current end date:** header `endDate` → `HEADER`. "Latest term" = the non-apostille history row with an `endDate` and the greatest `(signatureDate, externalId)`. Header null → latest term, `TERM`. Header set and latest term's end differs → `divergence`. `daysLeft` = days from `today` to the value (negative after the end).
- **Law:** `legalBasis` matching `/14\.?133/` → `14133`, `/8\.?666/` → `8666` (`LEGAL_BASIS`); else header `signatureDate` with the cut-offs (`SIGNATURE_DATE`); else `UNKNOWN`/`NONE`.
- **Time in force:** `NOT_APPLICABLE` when `typeName !== "Contrato"` or `category` ∈ {`Compras`, `Obras`}; `NOT_COMPUTABLE` without start (original row `startDate`, else header `startDate`) or end; else `ESTIMATED`, `months` = whole months from start to end (the last month counts when end day ≥ start day), `capMonths` 60 / 120 / `null` for `UNKNOWN`.
- **Guarantee:** no rows → `NOT_CONSULTED` when `parts.guarantees` ∈ {`MISSING`, `FAILED`}, else `NONE_INFORMED`; rows but all due dates null → `NONE_INFORMED`; end null → `NOT_COMPARABLE`; coverage = max due date; `< end` → `BEFORE_END` with `daysBeforeEnd`, else `COVERS`.
- `amendments.status` is `NOT_APPLICABLE` when `typeName !== "Contrato"`; the remaining amendment fields are filled in Task 2 (return nulls, `terms: []`, `nearLimit: false` for now).

- [ ] **Step 1: Write the failing tests** in `contract-facts.test.ts` (helper `input(overrides)` building a `Contrato`/`Serviços` header):
  - `"header end date wins and shows a later term as divergence"`: header end `2026-06-06`; Contrato (sig `2021-12-06`, end `2024-06-06`), Termo Aditivo id `2` number `00001/2024` (sig `2024-05-13`, end `2026-12-06`); today `2026-05-07` → `endDate` `{value: "2026-06-06", source: "HEADER", daysLeft: 30, divergence: {termEndDate: "2026-12-06", termExternalId: "2", termNumber: "00001/2024"}}`.
  - `"end date falls back to the latest term"`: header end null; aditivo end `2027-05-01` → `"2027-05-01"`, `"TERM"`, divergence `null`.
  - `"rescission matching the header is not a divergence"`: header end `2025-08-22`; Contrato end `2025-12-17`; Termo de Rescisão (later) end `2025-08-22` → divergence `null`.
  - `"apostille end dates are ignored"`: latest row is an apostille with another end → divergence `null`.
  - `"law from legal basis or signature date"` (table): `"LEI 14.133/2021 - Artigo: 74"` → `14133/LEGAL_BASIS`; `"Lei nº 8.666/1993"` → `8666/LEGAL_BASIS`; null + sig `2019-01-31` → `8666/SIGNATURE_DATE`; `2022-06-01` → `UNKNOWN/SIGNATURE_DATE`; `2024-01-02` → `14133/SIGNATURE_DATE`; both null → `UNKNOWN/NONE`.
  - `"time in force against the legal maximum"`: 14.133, start `2021-12-06`, end `2026-06-06` → `ESTIMATED`, `54`, `120`; end `2026-06-05` → `53`; category `Compras` → `NOT_APPLICABLE`; typeName `Empenho` → term and amendments `NOT_APPLICABLE`; law `UNKNOWN` → `capMonths: null`.
  - `"guarantee coverage"` (table, end `2026-06-06`): dues `2025-01-01`,`2027-01-01` → `COVERS`, `2027-01-01`; only `2026-05-30` → `BEFORE_END`, `daysBeforeEnd: 7`; no rows + `NOT_FOUND` → `NONE_INFORMED`; + `AVAILABLE` → `NONE_INFORMED`; + `MISSING` → `NOT_CONSULTED`; + `FAILED` → `NOT_CONSULTED`; rows + end null → `NOT_COMPARABLE`.
- [ ] **Step 2: Run** `pnpm --filter @contracts/api exec tsx --test test/contract-facts.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the types and `computeFacts` in `facts.ts` per the rules above.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(contracts): compute end date, law, term and guarantee facts`.

### Task 2: `computeFacts` — cumulative additions and suppressions

**Files:**
- Modify: `apps/api/src/contracts/facts.ts`
- Test: `apps/api/test/contract-facts.test.ts`

**Interfaces:**
- Fills `amendments` of `ContractFacts` (Task 1).
- Reasons (exact): `ORIGINAL`, `APOSTILLE`, `RESCISSION`, `OTHER_TYPE`, `NO_GLOBAL_VALUE`, `NO_VALUE_CHANGE`, `EXTENSION_ONLY`, `PRICE_ADJUSTMENT_ONLY`.
- Flags (exact): `NO_QUALIFICATION`, `INCLUDES_PRICE_ADJUSTMENT`, `MIGRATED_RECORD`, `TEXT_MENTIONS_ADJUSTMENT`, `APOSTILLE_TEXT_MENTIONS_ADDITION`.

Algorithm (spec §4.4; "when in doubt, count" decided with the user):

```
status: NOT_APPLICABLE if typeName != "Contrato";
        NOT_COMPUTABLE if history empty or base (header initialValue) null or 0;
        else ESTIMATED.
rows sorted by (signatureDate null-last, externalId numeric); ref := null
for each row:
  vg := row.globalValue
  original row             -> reason ORIGINAL
  Termo de Apostilamento   -> reason APOSTILLE; flag APOSTILLE_TEXT_MENTIONS_ADDITION if /acr[eé]scimo/i on observation
  Termo de Rescisão        -> reason RESCISSION
  Termo Aditivo:
    vg null                -> reason NO_GLOBAL_VALUE (ref unchanged)
    delta := vg - (ref ?? base);  Q := set(qualifications)
    delta == 0                                      -> NO_VALUE_CHANGE
    Q == {VIGÊNCIA}                                 -> EXTENSION_ONLY
    Q == {REAJUSTE} or Q == {REAJUSTE, VIGÊNCIA}    -> PRICE_ADJUSTMENT_ONLY
    otherwise counted ADDITION (delta > 0) / SUPPRESSION (delta < 0), flags:
      NO_QUALIFICATION if Q empty; INCLUDES_PRICE_ADJUSTMENT if REAJUSTE ∈ Q;
      MIGRATED_RECORD if Q == {ACRÉSCIMO / SUPRESSÃO, INFORMATIVO, VIGÊNCIA};
      TEXT_MENTIONS_ADJUSTMENT if /reajust|repactua|prorroga|renova/i on observation
  any other type           -> reason OTHER_TYPE
  if vg != null: ref := vg  (every valued row moves the reference)
additions = Σ delta of ADDITION; suppressions = Σ |delta| of SUPPRESSION
additionsPct = additions / base * 100; suppressionsPct = suppressions / base * 100
margin = base * 25 / 100 - additions (signed); limitUsedRatio = additionsPct / 25
nearLimit = status == ESTIMATED and limitUsedRatio >= 0.8
```

Every history row appears in `terms` in sorted order; `delta` only for `Termo Aditivo` rows with a value.

- [ ] **Step 1: Write the failing tests**
  - `"amendments: when in doubt, count"`: base `"100000"`; rows: Contrato `100000`; apostille `110000` obs `"ACRÉSCIMO DE R$ 10.000,00"`; aditivo `[ACRÉSCIMO / SUPRESSÃO]` `130000`; aditivo `[ACRÉSCIMO / SUPRESSÃO, INFORMATIVO, VIGÊNCIA]` `125000`; aditivo `[VIGÊNCIA]` `125000`; aditivo `[REAJUSTE, VIGÊNCIA]` `131250`; aditivo `[]` `133250` obs `"REPACTUAÇÃO CONFORME CCT"`. Expect `status "ESTIMATED"`, `additions "22000.00"`, `suppressions "5000.00"`, `additionsPct "22.0000"`, `suppressionsPct "5.0000"`, `margin "3000.00"`, `limitUsedRatio "0.8800"`, `nearLimit true`; per row (reason or counted): `ORIGINAL`; `APOSTILLE` + `APOSTILLE_TEXT_MENTIONS_ADDITION`; `ADDITION`; `SUPPRESSION` + `MIGRATED_RECORD`; `NO_VALUE_CHANGE`; `PRICE_ADJUSTMENT_ONLY`; `ADDITION` + `NO_QUALIFICATION`, `TEXT_MENTIONS_ADJUSTMENT`.
  - `"amendments: migrated extensions without value change count nothing"`: Contrato `71352.36` + four `[ACRÉSCIMO / SUPRESSÃO, INFORMATIVO, VIGÊNCIA]` at `71352.36` → all `NO_VALUE_CHANGE`, `additionsPct "0.0000"`, `ESTIMATED`, `nearLimit false`.
  - `"amendments: over the limit gives a negative margin"`: base `100000`, aditivo `[ACRÉSCIMO / SUPRESSÃO]` to `130000` → `margin "-5000.00"`, `limitUsedRatio "1.2000"`.
  - `"amendments: a term without value keeps the reference"`: aditivos `110000`, `null`, `120000` → middle `NO_GLOBAL_VALUE`, last `delta "10000.00"`.
  - `"amendments: not computable without history or base"`: no history; base `"0"`; base `null` → `NOT_COMPUTABLE`.
  - `"amendments: rows without signature date go last"`: two aditivos, one undated → undated is last in `terms`; equal dates ordered by external id.
- [ ] **Step 2: Run** `pnpm --filter @contracts/api exec tsx --test test/contract-facts.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** with `decimal.js`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(contracts): estimate additions and suppressions with method`.

### Task 3: API — facts on the detail, 90-day window, guarantee filter

**Files:**
- Modify: `packages/validation/index.js`, `packages/validation/index.d.ts` (export `EXPIRING_WINDOW_DAYS = 90`)
- Modify: `apps/api/src/domain.ts` (`contractStatus` uses `EXPIRING_WINDOW_DAYS`)
- Modify: `apps/api/src/contracts/repository.ts`, `apps/api/src/contracts/service.ts`, `apps/api/src/app.ts`
- Modify: `docs/api-contract.md` (contracts section)
- Test: `apps/api/test/domain.test.ts`, `apps/api/test/integration/contracts.test.ts`

**Interfaces:**
- Consumes: `computeFacts`, `FactInput` (Tasks 1–2); `ContractCommitmentRepository.totals(externalId)` (existing, step 3).
- Produces (the web relies on these):
  - `GET /contracts/:externalId` → `{contract, parts, notes, facts: ContractFacts}`; `facts.remaining` = `totals().remaining`.
  - `GET /contracts` accepts `guaranteeBeforeEnd=true` (any other non-empty value → 400 `Filtro inválido.`); `ContractSummary` gains `guaranteeBeforeEnd: boolean`.
  - `ContractRepository.factInput(externalId: string): Promise<Omit<FactInput, "parts">>` — header fields incl. `legal_basis` and `initial_value`, all `contract_amendments` rows (dates and decimals as text), `contract_guarantees` (`external_id::text`, `due_date::text`).
  - `ContractService` constructor `(contracts: ContractRepository, commitments: Pick<ContractCommitmentRepository, "totals">)`; `parts` statuses come from the existing `parts()` call (`"MISSING"` when a part row is absent).
- Guarantee SQL (filter and projection): `COALESCE((SELECT max(g.due_date) FROM public_sources.contract_guarantees g WHERE g.source = c.source AND g.contract_external_id = c.external_id) < c.end_date, false)`. Update the `statusSql` comment to 90 days. The list keeps the header `end_date`.

- [ ] **Step 1: Write the failing tests**
  - `domain.test.ts`: rename to `"calendar statuses honor inclusive end and 90-day boundary"`; today `2026-10-30`: end `2027-01-28` → `EXPIRING`, end `2027-01-29` → `ACTIVE`; keep the other cases.
  - `contracts.test.ts`:
    - `"list filters guarantees expiring before the contract"`: contracts with max due `day(5)` & end `day(30)`, max due `day(60)` & end `day(30)`, no guarantees → `guaranteeBeforeEnd=true` returns only the first; summaries carry `true`/`false`/`false`.
    - `"list rejects unknown fact filter values"`: `guaranteeBeforeEnd=yes` → 400 `Filtro inválido.`
    - `"expiring uses a 90-day window"`: end `day(60)` → listed under `status=EXPIRING`; `stats.expiringCount` counts it.
    - `"detail returns facts with days left and remaining value"`: header end `day(10)`, guarantee due `day(3)` → `facts.endDate.daysLeft === 10`, `facts.guarantee.status === "BEFORE_END"`, `facts.guarantee.daysBeforeEnd === 7`, `facts.amendments.limitPct === "25"`, `facts.remaining` equals `balance.remaining` of `GET /contracts/:id/commitments`.
    - `"detail facts report a failed history part"`: history part `FAILED` with amendment rows → `facts.historyPart === "FAILED"` and `facts.amendments.terms.length > 0`.
- [ ] **Step 2: Run** `pnpm --filter @contracts/api exec tsx --test test/domain.test.ts` and `pnpm --filter @contracts/api test:integration`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** the constant, `contractStatus`, repository (`factInput`, guarantee condition/projection, `guaranteeBeforeEnd` in `ContractFilters`), service validation and detail, `app.ts` wiring.
- [ ] **Step 4: Run** `pnpm test`, `pnpm --filter @contracts/api test:integration`, `pnpm --filter @contracts/api lint`. Expected: PASS, no lint errors.
- [ ] **Step 5: Update `docs/api-contract.md`**: window 90 days; `guaranteeBeforeEnd` filter and summary field; `facts` shape, reasons and flags.
- [ ] **Step 6: Commit** `feat(contracts): serve derived facts, 90-day window and guarantee filter`.

### Task 4: Web — "Situação do contrato" summary with method disclosure

**Files:**
- Modify: `apps/web/lib/contracts-api.ts` (types `ContractFacts`, `TermFact`, `FactStatus`; `ContractRecord.facts`)
- Create: `apps/web/lib/contract-facts.ts` (pt-BR copy from codes)
- Create: `apps/web/components/contract-facts/contract-facts-summary.tsx`, `amendment-meter.tsx`, `fact-method.tsx`
- Modify: `apps/web/components/contracts/contract-detail.tsx` (summary right after `PageHead`, before `ContractHeader`)
- Modify: `apps/web/app/globals.css` only for semantic classes on existing tokens, if needed
- Test: `tests/e2e/contracts.spec.ts`

**Interfaces:**
- Consumes: `ContractFacts` (Task 3).
- Produces (`contract-facts.ts`): `reasonLabels: Record<string, string>`, `flagLabels: Record<string, string>`, `lawLabel(law, lawSource): string`, `daysLine(daysLeft: number | null): string`, `termLine(term): string`, `guaranteeLine(guarantee): string`.

Exact copy (pt-BR):
- Section title `Situação do contrato`; each estimate carries an `Estimativa` badge.
- `daysLine`: `> 1` → `Vence em N dias`; `1` → `Vence amanhã`; `0` → `Vence hoje`; `< 0` → `Encerrado há N dias`; null → `Vigência não informada`.
- Divergence: `Cabeçalho do Contratos.gov.br: {data} · termo {número}: {data}`.
- Term: `{X anos e Y meses} de {10 anos | 60 meses}`; law `UNKNOWN` → `… de 60 meses (Lei 8.666) ou 10 anos (Lei 14.133)`; `NOT_APPLICABLE` → `Não se aplica a este tipo de instrumento`.
- Amendments: `Acréscimos: N% de 25%`, `Supressões: N% de 25%`; margin ≥ 0 → `Ainda cabe acrescer {R$}`, < 0 → `Acréscimos excedem o limite em {R$}`; `nearLimit` → `Perto do limite` highlight; no counted term → `0% — nenhum termo de acréscimo ou supressão identificado`; `NOT_COMPUTABLE` → `Não calculável: o histórico do contrato não foi informado`; `NOT_APPLICABLE` → `Não se aplica a este tipo de instrumento`.
- Guarantee: `BEFORE_END` → `A garantia vence em {data}, N dias antes do contrato`; `COVERS` → `Garantia válida até {data}`; `NONE_INFORMED` → `Nenhuma garantia informada pelo Contratos.gov.br`; `NOT_CONSULTED` → `Garantias não consultadas no Contratos.gov.br`; `NOT_COMPARABLE` → `Sem data de fim para comparar com a garantia`.
- Remaining: `Saldo do contrato {R$}`, linking to the commitments section.
- Part `FAILED` → `Pode estar desatualizado: a última consulta ao Contratos.gov.br falhou` next to the fact.
- Disclosure `Como calculamos` (native `<details>`/`<summary>`): base `valor inicial registrado`, limit 25% and law, `50% para reforma de edifício ou equipamento não é identificado na fonte`, then a table of terms (número, tipo, data, valor global, variação, contado como / motivo, avisos) using `reasonLabels`/`flagLabels`.

- [ ] **Step 1: Write the failing Playwright tests** (mock `facts` on the detail route):
  - `"contract summary shows end date, estimates and margin"`: `daysLeft: 45`, `additionsPct "22.0000"`, `margin "3000.00"`, `nearLimit true` → `Vence em 45 dias`, `Acréscimos: 22% de 25%`, `Ainda cabe acrescer R$ 3.000,00`, `Perto do limite`, an `Estimativa` badge; opening `Como calculamos` shows the label of `MIGRATED_RECORD`.
  - `"contract summary says absence in the source"`: guarantee `NONE_INFORMED` → `Nenhuma garantia informada pelo Contratos.gov.br`; page has no `Sem garantia`.
  - `"contract summary for an instrument that is not a contract"`: term and amendments `NOT_APPLICABLE` → `Não se aplica a este tipo de instrumento`.
  - `"contract summary fits 390px"`: viewport 390 → `document.documentElement.scrollWidth <= 390`.
- [ ] **Step 2: Run** `pnpm test:e2e tests/e2e/contracts.spec.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** types, `contract-facts.ts`, the three components (reuse `Badge`, domain primitives, tokens) and the wiring.
- [ ] **Step 4: Run** the Playwright file, `pnpm --filter @contracts/web lint`, `pnpm --filter @contracts/web build`. Expected: PASS. Check light/dark/system and keyboard focus (ui-rules §8).
- [ ] **Step 5: Commit** `feat(web): show contract situation with explained estimates`.

### Task 5: Web — guarantee filter, row indicator and 90-day hint

**Files:**
- Modify: `apps/web/components/contracts/contract-filters.tsx` (`ContractFilterValues.guaranteeBeforeEnd: "" | "true"`)
- Modify: `apps/web/components/contracts/contract-list.tsx` (query param; row badge)
- Modify: `apps/web/lib/contracts-api.ts` (`ContractSummary.guaranteeBeforeEnd`)
- Test: `tests/e2e/contracts.spec.ts`

**Interfaces:**
- Consumes: `guaranteeBeforeEnd` param and field (Task 3); `EXPIRING_WINDOW_DAYS` from `@contracts/validation`.

Copy: advanced filters gain the checkbox `Garantia vence antes do contrato`; the situation option `Vence em breve` shows `(até 90 dias)` built from `EXPIRING_WINDOW_DAYS`; row badge `Garantia vence antes`.

- [ ] **Step 1: Write the failing Playwright tests**
  - `"list filters guarantees expiring before the contract"`: checking the box sends `guaranteeBeforeEnd=true`; clearing filters removes it.
  - `"list rows show the guarantee indicator"`: summary with `guaranteeBeforeEnd: true` → the row shows `Garantia vence antes`.
  - `"situation filter names the 90-day window"`: the option text contains `até 90 dias`.
- [ ] **Step 2: Run** `pnpm test:e2e tests/e2e/contracts.spec.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** the filter, param and badge.
- [ ] **Step 4: Run** the Playwright file, `pnpm test:e2e tests/e2e/appearance.spec.ts`, `pnpm --filter @contracts/web lint`, `pnpm --filter @contracts/web build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): filter contracts whose guarantee expires before the end`.

### Task 6: Verification on real data

**Files:** none (fix in the owning task's files if something fails).

- [ ] **Step 1: Open** `/contratos` against the local replica (UG 154502 once the daily run has normalized it) and three contracts: `125621` (end-date divergence), `100274` (apostilles plus extensions) and one `Empenho` instrument. Expected: copy as in Task 4; the explanation of `100274` counts no apostille.
- [ ] **Step 2: Check** at 390px and 1440px, light and dark. Expected: no horizontal scroll; essential information visible.
- [ ] **Step 3: Run the full suites** `pnpm test`, `pnpm --filter @contracts/api test:integration`, `pnpm test:e2e`. Expected: all PASS.
