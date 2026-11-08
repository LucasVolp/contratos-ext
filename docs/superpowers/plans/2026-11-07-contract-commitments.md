# Contract ↔ Commitment Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the contract screen, list every commitment Contratos.gov.br links to the contract, with its financial-data status, a per-campus breakdown, contract totals and the remaining balance. On the commitment screen, show the contract(s) it belongs to.

**Architecture:** The links are read-only and derived at read time in SQL. They join `public_sources.contract_commitments` (the replica) to `finance.commitment_references` / `finance.commitments` / `finance.ingestion_runs` (the imported finance data) by `transparency_code = document_code`. No new tables or migrations. Two new API endpoints live in the contracts module. Two new web sections reuse the existing detail-screen primitives.

**Tech Stack:** Fastify + `pg` (`apps/api`, `node:test` integration tests on throwaway DBs), Next.js client components with shadcn/Base UI (`apps/web`), Playwright with mocked API routes (`tests/e2e`).

**Spec:** `docs/superpowers/specs/2026-11-07-contract-commitments-design.md`

## Global Constraints

- English for every technical artifact (identifiers, SQL, comments, tests, docs). The UI copy is pt-BR, and the exact strings are pinned in each task (`AGENTS.md`).
- Every change under `apps/web` follows `docs/ui-rules.md`. A UI task is done only when the §8 checklist passes:
  - fully usable at 360px with no page-level horizontal scroll;
  - WCAG 2.2 AA;
  - light, dark and system themes;
  - semantic tokens only, no hardcoded colors;
  - reuse of `components/ui.tsx`, `components/ui/` and `@contracts/validation`.
- Fabricate no data. A missing amount shows "Não informado", never 0. A total is `null` when any amount it sums is `null`, the same rule as `docs/finance-api-contract.md`.
- Amounts come from Contratos.gov.br only (spec §5). Decimals travel as strings, and sums are computed in SQL `numeric`, never in JS floats.
- LGPD: a supplier CPF (11 digits) is always masked with the existing `maskSupplierDocument` (`apps/api/src/contracts/service.ts`).
- No migration in this plan. Never run migrations against the shared dev DB `contracts`. The integration tests create their own databases.
- Do not edit `apps/api/src/finance/*`, `apps/web/components/finance/*` (except the one insertion in Task 4) or `tests/e2e/finance.spec.ts`. The main checkout has uncommitted finance work there.
- Run the API integration tests with the database up: `cd apps/api && pnpm test:integration` (uses `DATABASE_URL`, default `postgresql://contracts:contracts_local@localhost:5540/contracts`).
- Run E2E with `pnpm test:e2e tests/e2e/contract-commitments.spec.ts`. Every API call is mocked.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Null amount in one commitment.** The campus total and the contract total for that column are "Não informado", not a partial sum. The balance is also "Não informado" when total committed is null. → Task 1 `null amount nulls the totals that include it`.
2. **Contract without commitments, or commitments part never captured.** The section shows the part's freshness sentence and no totals, and does not show R$ 0,00. → Task 3 `contrato sem empenhos não inventa totais`.
3. **Header-less finance reference (pre-2026 commitment with 2026 payments).** Status is CONFIRMED, it links to the finance detail, and no disagreement is shown. → Task 1 `header-less reference is confirmed without comparison`.
4. **Restricted viewer and another campus's commitment.** The row shows the same facts with no link, and the reverse block shows contract number and supplier as text when the contract is out of scope. → Task 1 `linkable only inside the viewer scope`, Task 2 `out-of-scope contract is text only`.
5. **Issuing UG unknown to `finance.management_units`.** The campus row shows the UG code as its name and is still grouped. → Task 1 `unknown unit falls back to its code`.

---

### Task 1: API: commitments of a contract, with status, campus totals and balance

**Files:**
- Create: `apps/api/src/contracts/commitments-repository.ts`
- Create: `apps/api/src/contracts/commitments.ts` (service and presenters)
- Modify: `apps/api/src/contracts/controller.ts` (new route), `apps/api/src/app.ts` (wire the service next to `ContractService`, around line 60), `docs/api-contract.md` (Contratos section: new endpoint, fields, statuses)
- Test: `apps/api/test/integration/contract-commitments.test.ts`

**Interfaces:**
- Produces (exported from `commitments-repository.ts`):
  ```ts
  export type FinanceStatus = "CONFIRMED" | "NOT_FOUND" | "PENDING" | "OUT_OF_SCOPE";
  export interface Amounts {
    committed: string | null; liquidated: string | null; paid: string | null;
    rpRegistered: string | null; rpToLiquidate: string | null; rpLiquidated: string | null; rpPaid: string | null;
  }
  export interface CommitmentLinkRow extends Amounts {
    transparencyCode: string; number: string; unitCode: string; unitName: string | null;
    issueDate: string | null; creditor: string | null; expenseNature: string | null;
    financeStatus: FinanceStatus;
    financeCommitmentId: string | null;   // finance.commitment_references.id when CONFIRMED
    financeCommitted: string | null;      // finance items' committed value; only when a header exists
    lastImportedOn: string | null;        // YYYY-MM-DD, only when PENDING
  }
  export interface CampusTotalsRow extends Amounts { unitCode: string; unitName: string; count: number }
  export class ContractCommitmentRepository {
    constructor(db: SqlConnection);
    links(externalId: string): Promise<CommitmentLinkRow[]>;           // ordered by unitCode, issueDate DESC NULLS LAST, number
    campuses(externalId: string): Promise<CampusTotalsRow[]>;         // ordered by unitName, unitCode
    totals(externalId: string): Promise<Amounts & { count: number; remaining: string | null }>;
  }
  ```
- Produces (from `commitments.ts`):
  ```ts
  export class ContractCommitmentService {
    constructor(contracts: ContractService, repository: ContractCommitmentRepository, finance: FinanceService);
    forContract(externalId: string, scope: Scope): Promise<ContractCommitments>;
  }
  export interface ContractCommitments {
    commitments: (CommitmentLinkRow & { linkable: boolean })[];
    campuses: CampusTotalsRow[];
    totals: Amounts & { count: number };
    balance: { globalValue: string | null; remaining: string | null };
  }
  ```
- Route: `GET /contracts/:externalId/commitments` → `ContractCommitments`. It uses the same 404 as `GET /contracts/:externalId`. Make `ContractService.find` public, or add `ContractService.visible(externalId, scope)`, and reuse it. Do not duplicate the scope rule.

**Rules the SQL must implement (spec §4–§5):**
- **Join:** `contract_commitments.transparency_code = commitment_references.document_code`, with `references.source = 'TRANSPARENCY_PORTAL'`.
- **CONFIRMED:** a reference exists, whether or not `finance.commitments` has a header for it.
  - `financeCommitted` is the sum of `finance.commitment_items.current_value` for that reference, only when `finance.commitments` has the header. Otherwise it is `null`. This is the same value as `committedValue` in the finance detail.
- **Coverage runs:** `finance.ingestion_runs` with `type = 'DAILY_EXPENSES' AND status = 'SUCCESS'` and either of:
  - `scope_type = 'MANAGEMENT' AND management_code = ANY(scope_codes)`;
  - `scope_type = 'MANAGEMENT_UNIT' AND unit_code = ANY(scope_codes)`.
- **Status when no reference exists:**
  - **OUT_OF_SCOPE:** there are no coverage runs, or `issue_date < min(period_start)` of the coverage runs.
  - **NOT_FOUND:** `issue_date` is null, or a coverage run has `period_start <= issue_date <= period_end`.
  - **PENDING:** any other case. `lastImportedOn` is then `max(period_end)` of the coverage runs.
- **`unitName`:** `finance.management_units.name` for `(management_code, unit_code)`. Link rows keep `null` when the name is missing. Campus rows use `COALESCE(name, unit_code)` and are ordered by that value, then by `unitCode`.
- **Sums:** each column is `CASE WHEN count(*) = count(col) THEN sum(col)::text END`.
- **`remaining`:** `contracts.global_value - totals.committed`. It is `null` when either side is `null`.
- **`linkable`** (service, not SQL): `financeCommitmentId !== null && (scope === null || inScope(scope, unitCode))`.

- [ ] **Step 1: Write the failing tests** in `contract-commitments.test.ts`.
  - **Setup:** reuse the `setup` / `replica` pattern from `test/integration/contracts.test.ts`, copied locally, not imported.
  - **Seed:** contract 13847 (UG 158148, `global_value` 1000.00) with six commitments in `public_sources.contract_commitments`, plus finance data:

  | number | unit_code | issue_date | committed | finance seed | expected status |
  |---|---|---|---|---|---|
  | 2026NE000001 | 158345 | 2026-03-10 | 300.00 | reference + header + item current_value 310.00 | CONFIRMED, financeCommitted "310.000000" |
  | 2024NE000002 | 158345 | 2024-05-02 | 100.00 | reference only, no header | CONFIRMED, financeCommitted null |
  | 2026NE000003 | 158148 | 2026-09-30 | 50.00 | none (run SUCCESS 2026-09-30 covers it) | NOT_FOUND |
  | 2026NE000004 | 158148 | 2026-11-01 | 25.00 | none (last run ends 2026-10-23) | PENDING, lastImportedOn "2026-10-23" |
  | 2026NE000005 | 999999 (management `99999`) | 2026-02-01 | 10.00 | none, never covered | OUT_OF_SCOPE |
  | 2025NE000006 | 158148 | 2025-06-01 | 5.00 | none, before the first imported day | OUT_OF_SCOPE |

  - **Ingestion runs:** `DAILY_EXPENSES`, `SUCCESS`, `MANAGEMENT` `{26421}`, with periods 2026-01-02→2026-01-02, 2026-09-30→2026-09-30 and 2026-10-23→2026-10-23. Every commitment except 2026NE000005 uses management code `26421`.
  - **Management units:** `(26421,158345,'CAMPUS A')` and `(26421,158148,'REITORIA')`. There is no row for `(99999,999999)`.

  Tests and their assertions:
  - `lists commitments with their finance status`: the six statuses, `financeCommitted` and `lastImportedOn` exactly as in the table.
  - `groups by issuing campus with totals and balance`:
    - campuses `[{unitCode:"999999",unitName:"999999",count:1}, {unitCode:"158345",unitName:"CAMPUS A",committed:"400.000000",count:2}, {unitCode:"158148",unitName:"REITORIA",committed:"80.000000",count:3}]`, ordered by unitName (`"999999"` sorts first);
    - `totals.committed` = `"490.000000"`;
    - `balance` = `{ globalValue: "1000.000000", remaining: "510.000000" }`.
  - `null amount nulls the totals that include it`: set `liquidated` NULL on 2026NE000003. Then `campuses[REITORIA].liquidated === null`, `totals.liquidated === null`, and `campuses[CAMPUS A].liquidated` is not null.
  - `header-less reference is confirmed without comparison`: 2024NE000002 has `financeStatus === "CONFIRMED"`, `financeCommitted === null` and `linkable === true` (unrestricted viewer).
  - `linkable only inside the viewer scope`: a restricted viewer with institutions `[158148]`. The contract stays visible (managing UG 158148). 2026NE000001 (UG 158345) has `linkable === false`, and no other row with `financeCommitmentId === null` is linkable.
  - `unknown unit falls back to its code`: covered by the 999999 campus row above.
  - `same 404 as the contract`: an unknown id and an out-of-scope contract (restricted viewer with institutions `[158454]`) both answer 404 with body message `"Contrato não encontrado."`.
- [ ] **Step 2: Run** `cd apps/api && pnpm test:integration`. Expected: the new tests FAIL with 404 (route missing), and all existing tests pass.
- [ ] **Step 3: Implement** the repository, service, route and wiring described above. Each repository method is one SQL statement. Put the status logic in one CTE shared by `links`, `campuses` and `totals`, and keep the coverage-run predicate in one place.
- [ ] **Step 4: Run** `pnpm test:integration`, then `pnpm --filter @contracts/api test`. Expected: all PASS.
- [ ] **Step 5: Document** `GET /contracts/:externalId/commitments` in `docs/api-contract.md`: fields, the four statuses with their rules, the null-sum rule, and that amounts are Contratos.gov.br's.
- [ ] **Step 6: Commit** `feat(contracts): list contract commitments with finance status and per-campus totals`.

### Task 2: API: contracts of a commitment

**Files:**
- Modify: `apps/api/src/contracts/commitments-repository.ts`, `apps/api/src/contracts/commitments.ts`, `apps/api/src/contracts/controller.ts`, `docs/api-contract.md`
- Test: `apps/api/test/integration/contract-commitments.test.ts`

**Interfaces:**
- Consumes: Task 1's classes, and `FinanceService.commitment(id, {}, scope)`, which throws the finance 404 when the commitment is unknown or out of scope.
- Produces:
  ```ts
  // repository
  contractsOf(commitmentId: string): Promise<{ externalId: string; number: string; supplierName: string | null;
    supplierDocument: string | null; uasg: string; unitName: string | null; registered: boolean }[]>;
  // service
  forCommitment(commitmentId: string, scope: Scope): Promise<{ contracts: CommitmentContract[] }>;
  export interface CommitmentContract {
    externalId: string | null;   // null when the viewer cannot open the contract
    number: string; supplierName: string | null; supplierDocument: string | null; // masked CPF
    uasg: string; unitName: string | null;
  }
  ```
- Route: `GET /contracts/by-commitment/:commitmentId`. It is registered before `/contracts/:externalId` so Fastify does not confuse the two; the static segment wins anyway, so confirm with a test. The query matches `contract_commitments.transparency_code` to the reference's `document_code`, across all contracts. `unitName` comes from `"Institution".name` when registered, otherwise from `finance.management_units`. `externalId` is non-null only when `registered && (scope === null || inScope(scope, uasg))`. Order by `number`.

- [ ] **Step 1: Failing tests:**
  - `returns the contracts that list a commitment`: the reference of 2026NE000001 also appears on a second contract, 20001 (UG 158454). An unrestricted viewer gets 2 contracts with non-null `externalId`.
  - `out-of-scope contract is text only`: a viewer restricted to `[158345]` asks for 2026NE000001 (in scope, UG 158345). They get both contracts with `externalId === null`, and `number` and `supplierName` are present.
  - `CPF supplier is masked`: set contract 20001's `supplier_document` to `12345678901`. Expect `"***.456.789-**"`.
  - `commitment without contract`: a finance reference listed by no contract returns `{ contracts: [] }`.
  - `unknown or out-of-scope commitment is 404`: an unknown id, and a viewer restricted to `[158454]` asking for the UG 158345 commitment. Both return 404 with message `"Empenho não encontrado."`.
- [ ] **Step 2: Run** `pnpm test:integration`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the repository method, service method and route above.
- [ ] **Step 4: Run** `pnpm test:integration && pnpm --filter @contracts/api test`. Expected: PASS.
- [ ] **Step 5: Document** the endpoint in `docs/api-contract.md`.
- [ ] **Step 6: Commit** `feat(contracts): find the contracts that list a commitment`.

### Task 3: Web: "Empenhos por campus" on the contract screen

**Files:**
- Create: `apps/web/lib/contract-commitments-api.ts` (types mirroring Task 1 and 2 responses, fetchers, status copy)
- Create: `apps/web/components/contract-commitments/contract-commitments-section.tsx` (fetch, loading, error and retry states)
- Create: `apps/web/components/contract-commitments/campus-totals.tsx` (campus rows, contract totals, balance)
- Create: `apps/web/components/contract-commitments/commitment-links.tsx` (list with a campus filter)
- Modify: `apps/web/components/contracts/contract-detail.tsx` (render the section after `ContractHeader`; pass `parts.find(p => p.part === "commitments")`)
- Test: `tests/e2e/contract-commitments.spec.ts` (new file; copy the mock helpers from `tests/e2e/contracts.spec.ts`)

**Interfaces:**
- Consumes: `GET /api/contracts/:externalId/commitments` (Task 1). Uses `freshness()` and `SourcePartState` from `lib/contract-source-api.ts`, `currency`/`date` from `lib/api.ts`, `ErrorState`/`Loading` from `components/ui.tsx`, and the data table from `components/ui/data-table`.
- Produces: `getContractCommitments(externalId, signal)` and `getCommitmentContracts(commitmentId, signal)` (the latter is used by Task 4), `financeStatusLabel(link): string`, and the type `CommitmentContract`.

**Copy (exact):**
- Section eyebrow `EXECUÇÃO`, heading `Empenhos por campus`, with the freshness sentence of the `commitments` part below it.
- Origin line: `Empenhos informados pelo Contratos.gov.br. Valores do Contratos.gov.br, incluindo restos a pagar.`
- Campus table columns: `Campus`, `Empenhos`, `Empenhado`, `Liquidado`, `Pago`, `RP inscrito`, `RP a liquidar`, `RP liquidado`, `RP pago`. The last row is `Total do contrato`.
- Balance card: label `SALDO DO CONTRATO`, value `currency(remaining)`, hint `Valor global informado pelo Contratos.gov.br (R$ X) menos o total empenhado.`
- `financeStatusLabel`:
  - CONFIRMED → `Na execução financeira`
  - NOT_FOUND → `Não encontrado nos dados importados`
  - PENDING → `Aguardando importação — última importação em DD/MM/AAAA`
  - OUT_OF_SCOPE → `Fora do escopo da importação financeira`
- Disagreement, under the committed amount when `financeCommitted !== null && financeCommitted !== committed`: `Execução financeira: R$ X`.
- Commitment list columns: `Empenho` (the number, linking to `/financeiro/empenhos/{financeCommitmentId}` when `linkable`), `Campus`, `Emissão`, `Natureza`, `Empenhado`, `Liquidado`, `Pago`, `Situação`. Above the list sits a campus select, `Todos os campi` plus one option per campus, reusing the shared select primitive used by `contract-filters.tsx`.
- Empty state, when the part is AVAILABLE with 0 rows or NOT_FOUND: `O Contratos.gov.br não informa empenhos para este contrato.` In that case the campus table and balance are not rendered.
- When the part is MISSING or FAILED with no rows, show only the freshness sentence.

- [ ] **Step 1: Failing E2E tests** (all API mocked):
  - `mostra empenhos por campus com totais, saldo e origem`: the campus rows and `Total do contrato` show the formatted values from a fixture shaped like Task 1's seed; the balance shows `R$ 510,00`; the origin line is visible.
  - `situação de cada empenho é explícita`: all four status labels are visible, PENDING includes `23/10/2026`, and the disagreement line `Execução financeira: R$ 310,00` is visible.
  - `empenho fora do escopo do usuário não vira link`: the `linkable: false` row has no link; the `linkable: true` row links to `/financeiro/empenhos/{id}`.
  - `filtra a lista por campus`: selecting `CAMPUS A` leaves only its 2 rows.
  - `contrato sem empenhos não inventa totais`: with the empty state text, there is no `R$ 0,00` and no `SALDO DO CONTRATO`.
  - `valor ausente aparece como Não informado`: a fixture with `liquidated: null` in a campus row shows `Não informado` in that cell.
  - `falha ao carregar empenhos oferece nova tentativa`: a 500 response, then retry succeeds.
  - `cabe em 360px sem rolagem horizontal da página`: use the same assertion as the existing 360px test in `contracts.spec.ts`.
- [ ] **Step 2: Run** `pnpm test:e2e tests/e2e/contract-commitments.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the lib and components, then insert the section in `contract-detail.tsx`. Tables scroll inside their own container at narrow widths. Use semantic classes and tokens only.
- [ ] **Step 4: Run** the new spec plus `tests/e2e/contracts.spec.ts` and `tests/e2e/appearance.spec.ts`. Expected: PASS. Then go through the `docs/ui-rules.md` §8 checklist and note the result in the commit body.
- [ ] **Step 5: Commit** `feat(web): show contract commitments by campus with totals and balance`.

### Task 4: Web: "Contrato" block on the commitment screen, and roadmap note

**Files:**
- Create: `apps/web/components/contract-commitments/commitment-contract.tsx`
- Modify: `apps/web/components/finance/commitment-page.tsx`. This is a single insertion: render `<CommitmentContract commitmentId={id} />` after the header warning, with no other change in that file.
- Modify: `docs/superpowers/specs/2026-11-07-institutional-copilot-design.md`, roadmap step 3. Add a note pointing to the contract-commitments design, saying deduced links were dropped and finance-import scheduling is a later step.
- Test: `tests/e2e/contract-commitments.spec.ts`

**Interfaces:**
- Consumes: `getCommitmentContracts` and `CommitmentContract` (Task 3), and `GET /api/contracts/by-commitment/:id` (Task 2).

**Copy (exact):**
- Section eyebrow `CONTRATO`.
- One item per contract:
  - the number, linked to `/contratos/{externalId}` when `externalId` is non-null, otherwise plain text;
  - the supplier name and document, the document passed through `maskDocument` from `@contracts/validation`;
  - the line `Informado pelo Contratos.gov.br`.
- Empty: `Sem contrato identificado.`
- On a load failure, show `ErrorState` with retry, scoped to this block. The rest of the commitment page keeps working.

- [ ] **Step 1: Failing E2E tests** (mock `/api/finance/commitments/{id}` plus the new endpoint; reuse a minimal commitment fixture written in this file):
  - `empenho mostra o contrato que o lista`: one contract with `externalId` links to `/contratos/13847`.
  - `contrato fora do escopo aparece sem link`: `externalId: null` renders the number as text with no link.
  - `empenho sem contrato informa que não há contrato identificado`.
  - `falha no bloco de contrato não derruba a página do empenho`: the new endpoint returns 500, the commitment title is still visible, and the block offers retry.
- [ ] **Step 2: Run** the spec. Expected: FAIL.
- [ ] **Step 3: Implement** the component, the one-line insertion and the roadmap note.
- [ ] **Step 4: Run** `pnpm test:e2e tests/e2e/contract-commitments.spec.ts tests/e2e/finance.spec.ts`. Expected: PASS. Go through the §8 checklist.
- [ ] **Step 5: Commit** `feat(web): show the contract of a commitment`.
