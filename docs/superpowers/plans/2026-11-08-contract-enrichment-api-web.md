# Contract Enrichment API and Screens Implementation Plan (Phase 1, Step 2b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- The contract detail screen shows what Contratos.gov.br knows about that contract: amendments, guarantees, responsible staff, items, invoices and files, each with origin and freshness.
- Contracts can be created from the replica for a UASG, with per-row results.

**Architecture:** The API reads the typed `public_sources` tables from step 2a and never calls the source. An app `Contract` is matched to a replica contract at read time: `managing_unit_code = Contract.uasg` and `number_key = public_sources.contract_number_key(Contract.number)`. Nothing is stored on the `Contract` row. New routes nest under `/api/contracts/:id/source`; existing UASG scoping applies through `ApplicationService.contract(id, scope)`. On the web, one new client leaf renders the sections, using a table and pager extracted from the finance screens into shared UI.

**Tech Stack:** Fastify 5, `pg` with SQL only (`apps/api`), `node:test` + `tsx`. Next.js 16 / React 19 (`apps/web`), Playwright (`tests/e2e`).

**Spec:** `docs/superpowers/specs/2026-11-07-institutional-copilot-design.md`, sections 4.2, 4.4, 4.6 and 6 (auth rules). Depends on `docs/superpowers/plans/2026-11-08-contract-normalization.md` (step 2a); run 2a first, on the same branch.

## Global Constraints

- **Language:** English identifiers, comments and tests. pt-BR user copy (`AGENTS.md`).
- **UI:** every `apps/web` change follows `docs/ui-rules.md`. A task touching the web is done only when the §8 checklist passes.
  - Shared primitives; no hardcoded colors.
  - Usable at 360px.
  - Loading, error with retry, empty and content states.
  - Nulls render as `Não informado`, never-consulted data as `Não consultado`.
  - Money through `formatDecimal`, never `Number`.
  - Components never call `fetch` directly; API access lives in `lib/*-api.ts`.
  - New files stay under 250 lines.
- **Scope:** sub-resources follow the finance child precedent. Load the parent with `this.contract(id, scope)`, which returns 404 out of scope, before reading children. Imports call `assertUasg(scope, uasg)`, which returns 403.
- **Freshness:** responses carry `capturedAt` and `lastAttemptAt` per part. The API never fetches from the network.
- **Decimals:** cast in SQL as `::text`, as `apps/api/src/finance/repository.ts` does.
- **Routes:** the global hook already UUID-checks params named `id`. The part name is validated against an allowlist and returns 400 otherwise.
- **Commits:** conventional commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Designer's calls fixed by this plan

- **Resolution states:**
  - `RESOLVED`: exactly one replica contract matches;
  - `NOT_FOUND`: none matches;
  - `AMBIGUOUS`: more than one matches. Return `candidateCount`. No part data is served, and the screen says the link needs review.
- **Parts exposed in this step:** `history`, `guarantees`, `responsibles`, `items`, `invoices`, `files`. Commitments wait for step 3, which links them to finance.
- **Part pages:** 20 rows by default, `limit` at most 100. Ordering:
  - `history`: `signature_date NULLS LAST, external_id`;
  - `invoices`: `issue_date DESC NULLS LAST, external_id`;
  - others: `external_id`.
- **Errors are not passed through.** `lastError` is not exposed. The screen says the last consultation failed and shows its date.
- **Replica import:**
  - creates `Contract` rows (`source = 'CONTRATOS_GOV_BR'`) for replica contracts of a UASG that have no row with the same `(number, uasg)`;
  - existing rows, manual or imported, are never changed and are reported as `EXISTING`;
  - the direct Dados Abertos import keeps working unchanged (spec 4.2, coexistence).
- **Supplier document of imported rows:** digits from the replica. `initialValue` falls back to `globalValue` when the replica value is null, matching `mapImportedContract`.

## Review Focus

1. **A viewer whose scope excludes the contract's UASG** gets 404 on `/source` and `/source/:part`, and 403 on importing that UASG. Tests in Tasks 1 and 4.
2. **Contract numbers written differently**: an app row `4/2017` against the replica's `00004/2017`, or lowercase `2026ne000234`. They still resolve. Test in Task 1.
3. **A part whose last consultation failed but has older rows** shows the rows plus "A última consulta falhou em …; exibindo dados de …", and never an empty table. E2E test in Task 3.
4. **A replica contract with null dates, values or supplier document** renders `Não informado`, not `0`, `—` or `Invalid Date`. E2E test in Task 3; the API null-passthrough test is in Task 1.
5. **Running the replica import twice** creates nothing the second time and reports every row as `EXISTING`. Test in Task 4.

---

## File Structure

| Path | Responsibility |
|---|---|
| `apps/api/src/repositories/contract-sources.ts` | SQL reads of `public_sources` typed tables and the replica import insert |
| `apps/api/src/repositories/index.ts` | Register `contractSources` |
| `apps/api/src/contract-sources/service.ts` | Resolution, scope checks, part pages, import |
| `apps/api/src/contract-sources/controller.ts` | `registerContractSourceRoutes(api, service)` |
| `apps/api/src/app.ts` | Construct the service, register the routes |
| `apps/api/test/integration/contract-sources.test.ts` | API integration tests |
| `apps/web/components/ui/data-table.tsx` | Shared `DataTable`, `DataPager`, `Column` (extracted from finance) |
| `apps/web/components/finance/shared.tsx` | Re-export or consume the shared table and pager |
| `apps/web/lib/contract-source-api.ts` | Types, fetchers, pt-BR labels, freshness text |
| `apps/web/components/contract-source/*.tsx` | `ContractSourcePanel`, `SourcePartSection` |
| `apps/web/components/detail-page.tsx` | Render `<ContractSourcePanel>` in the contract branch (one import, one element) |
| `apps/web/app/contratos/importar/*`, `apps/web/components/import-page.tsx` | Replica import option |
| `tests/e2e/contract-source.spec.ts` | Mocked-API end-to-end specs |

---

### Task 1: Replica read API

**Files:**
- Create: `apps/api/src/repositories/contract-sources.ts`, `apps/api/src/contract-sources/service.ts`, `apps/api/src/contract-sources/controller.ts`, `apps/api/test/integration/contract-sources.test.ts`
- Modify: `apps/api/src/repositories/index.ts`, `apps/api/src/app.ts`

**Interfaces:**
- Consumes:
  - Step 2a tables: `public_sources.contracts`, `contract_parts`, `contract_amendments`, `contract_guarantees`, `contract_responsibles`, `contract_items`, `contract_invoices`, `contract_files`;
  - the function `public_sources.contract_number_key(text)`;
  - `ApplicationService.contract(id, scope)` (`apps/api/src/service.ts:78`);
  - `Conditions` and the `collectionPage` pattern (`apps/api/src/finance/repository.ts:162`).
- Produces:
  - `type SourcePart = "history" | "guarantees" | "responsibles" | "items" | "invoices" | "files"` and `const SOURCE_PARTS: readonly SourcePart[]`.
  - Repository: `class ContractSourceRepository(db: SqlConnection)` with:
    - `matches(number: string, uasg: string): Promise<SourceContract[]>`
    - `parts(externalId: string): Promise<SourcePartState[]>`
    - `page(externalId: string, part: SourcePart, page: number, limit: number): Promise<Page<Data>>`
    - `importable(uasg: string): Promise<SourceContract[]>`
  - Types:
    - `SourceContract`:
      - `externalId`, `number`, `managingUnitCode`, `originUnitCode`, `typeName`, `category`, `processNumber`, `object`, `modality`, `status`, `supplierName`, `supplierDocument`;
      - `signatureDate`, `startDate`, `endDate` (text or null);
      - `initialValue`, `globalValue`, `accumulatedValue` (text or null);
      - `installmentCount` (number or null);
      - `capturedAt`, `normalizedAt` (ISO strings).
    - `SourcePartState`: `part`, `status` (`AVAILABLE | NOT_FOUND | FAILED | MISSING`), `capturedAt` and `lastAttemptAt` (ISO or null), `rowCount` (number).
  - Service: `class ContractSourceService(repositories: Repositories, contracts: ApplicationService)` with:
    - `summary(id: string, scope: Scope): Promise<{ resolution: "RESOLVED"|"NOT_FOUND"|"AMBIGUOUS"; candidateCount: number; source: SourceContract | null; parts: SourcePartState[] }>`
    - `part(id: string, part: string, query: Data, scope: Scope): Promise<Page<Data>>`. An unknown part → `BadRequestException("Parte inválida.")`. Unresolved or ambiguous → `NotFoundException("Dados do Contratos.gov.br não encontrados para este contrato.")`.
  - Routes in `registerContractSourceRoutes(api, service)`, with an `onSend` hook adding `Cache-Control: no-store`:
    - `GET /api/contracts/:id/source`
    - `GET /api/contracts/:id/source/:part?page=&limit=`
  - Row DTOs, in camelCase with decimals and dates as text:
    - **history:** `externalId, number, typeName, qualifications: string[], observation, signatureDate, publicationDate, startDate, endDate, initialValue, globalValue, newGlobalValue, contractStatus`.
    - **guarantees:** `externalId, guaranteeType, amount, dueDate`.
    - **responsibles:** `externalId, name, maskedDocument, role, ordinance, status, startDate, endDate`.
    - **items:** `externalId, purchaseItemNumber, itemType, catalogItem, description, quantity, unitValue, totalValue, startDate`.
    - **invoices:** `externalId, number, series, invoiceType, billingInstrument, issueDate, dueDate, amount, netAmount, disallowance, liquidationDate, status, referenceMonth, referenceYear`.
    - **files:** `externalId, fileType, description, url, seiLink, origin`.

- [ ] **Step 1: Write the failing tests** in `contract-sources.test.ts`. Set up as in `finance-api.test.ts:11-19`: `createTestDatabase`, `migrate`, then `createApplication({ db: appDb, auth: testAuth })`. Seed fixtures with raw `INSERT`s into `public_sources.contracts` / `contract_parts` / child tables (`source = 'CONTRATOS_GOV_BR'`) and `"Contract"`.
  - `test("resolves a contract by managing UASG and normalized number")`: app contract `number '4/2017', uasg '158148'`; replica `00004/2017` with `managing_unit_code '158148'` → `resolution RESOLVED`, `source.externalId '13847'`, and `parts` lists 8 entries with statuses as seeded. A second app contract `2026ne000234` resolves to `2026NE000234`. (Review Focus 2.)
  - `test("reports NOT_FOUND and AMBIGUOUS")`: no replica row → `NOT_FOUND`, `source null`. Two replica rows with the same key and UASG → `AMBIGUOUS` with `candidateCount 2`, and `GET …/source/items` → 404.
  - `test("matches only the managing unit")`: a replica row with `origin_unit_code '158148'` but `managing_unit_code '158533'` does not resolve an app contract with uasg `158148`.
  - `test("serves part pages with text decimals and nulls")`:
    - 25 items → page 1 has 20 rows, `total "25"`;
    - `quantity "750.625000"` (the numeric scale renders 6 places), `unitValue` NULL → `null`;
    - `limit=101` → 400;
    - `/source/payments` → 400. (Review Focus 4, API half.)
  - `test("out-of-scope viewer gets 404")`: `createApplication({ db: appDb, auth: { viewer: async () => restricted } })`, where `restricted` is USUARIO with institutions uasg `158454`. Both routes → 404. (Review Focus 1, read half.)
  - `test("responsibles expose only masked documents")`: the response body for `/source/responsibles` contains `"***.456.789-**"` and does not contain the key `supplierDocument`.

- [ ] **Step 2: Run them to verify they fail**, with `pnpm --filter @contracts/api exec tsx --test test/integration/contract-sources.test.ts`. Expected: FAIL (404 on unknown routes).

- [ ] **Step 3: Implement the repository, service, controller and wiring.**
  - Matching SQL: `WHERE source = 'CONTRATOS_GOV_BR' AND managing_unit_code = $2 AND number_key = public_sources.contract_number_key($1)`.
  - Construct `new ContractSourceService(repositories, service)` in `createApplication` beside `FinanceService`. Register inside the authenticated `/api` plugin next to `registerFinanceRoutes`.

- [ ] **Step 4: Run the tests**, plus `pnpm --filter @contracts/api lint` and `pnpm --filter @contracts/api test`. Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(contracts): expose Contratos.gov.br replica data per contract`.

---

### Task 2: Shared data table extracted from finance

**Files:**
- Create: `apps/web/components/ui/data-table.tsx`
- Modify: `apps/web/components/finance/shared.tsx`, finance components importing `FinanceTable` / `FinancePager` / `Column`

**Interfaces:**
- Consumes: `FinanceTable` (`components/finance/shared.tsx:126`), `FinancePager` (:181), `Column` (:9), `money` (:16), `calendar` (:28).
- Produces:
  - `export type Column = { key: string; label: string; money?: boolean; date?: boolean; link?: (row: Data) => string | null }`. Keep the finance semantics exactly, and add `link` only if finance already has it.
  - `export function DataTable({ rows, columns, caption }: { rows: Data[]; columns: Column[]; caption: string })`. Null values render `Não informado`.
  - `export function DataPager({ total, page, limit, onChange }: { total: number; page: number; limit: number; onChange: (page: number) => void })`. URL-agnostic; finance keeps its URL handling in a thin wrapper.
  - Finance re-exports or wraps these, so no finance screen changes behavior or markup classes.

- [ ] **Step 1: Run the finance e2e specs as the baseline**, with `pnpm test:e2e tests/e2e/finance.spec.ts` against the step 2b dev stack described in Task 3, Step 5. Expected: PASS. This refactor has no new behavior; the existing specs are its regression test.

- [ ] **Step 2: Move the table and pager into `components/ui/data-table.tsx`, and point finance at them.**

- [ ] **Step 3: Verify:**
  - Run `pnpm --filter @contracts/web lint && pnpm --filter @contracts/web build`. Expected: PASS.
  - Run `pnpm test:e2e tests/e2e/finance.spec.ts`. Expected: the same pass count as Step 1.

- [ ] **Step 4: Commit.** Message: `refactor(web): share data table and pager between domains`.

---

### Task 3: Contract detail sections

**Files:**
- Create: `apps/web/lib/contract-source-api.ts`, `apps/web/components/contract-source/contract-source-panel.tsx`, `apps/web/components/contract-source/source-part-section.tsx`, `tests/e2e/contract-source.spec.ts`
- Modify: `apps/web/components/detail-page.tsx` (contract branch only: one import, plus `<ContractSourcePanel contractId={id} />` after the value summary section at about line 359)

**Interfaces:**
- Consumes: the Task 1 routes and DTOs; Task 2 `DataTable` / `DataPager` / `Column`; `api<T>` (`lib/api.ts:81`); `ErrorState`, `Loading` (`components/ui.tsx`); `formatDecimal`.
- Produces:
  - `lib/contract-source-api.ts`:
    - types `SourceSummary`, `SourcePartState`, `SourcePart`;
    - `getContractSource(id, signal): Promise<SourceSummary>`;
    - `getContractSourcePart(id, part, page, signal): Promise<Page<Data>>`;
    - `partTitles: Record<SourcePart, string>`;
    - `partColumns: Record<SourcePart, Column[]>`;
    - `freshness(state: SourcePartState): string`.
  - `ContractSourcePanel({ contractId })`, a client leaf. It fetches the summary with an `AbortController`. It renders:
    - the resolution message;
    - a header facts list (status, current end date and global value as the source reports them, labeled with the source);
    - one `SourcePartSection` per exposed part, in the order history, items, invoices, guarantees, responsibles, files.
  - `SourcePartSection({ contractId, part, state })`, a client leaf. It has its own fetch, page state, and loading/error/empty/content states.

  Exact pt-BR copy:

  | Key | Copy |
  |---|---|
  | panel heading | `Dados do Contratos.gov.br` |
  | eyebrow | `Consulta pública` |
  | `NOT_FOUND` | `Este contrato ainda não foi encontrado nos dados do Contratos.gov.br para a UASG informada.` |
  | `AMBIGUOUS` | `Há {n} contratos com este número e UASG no Contratos.gov.br. A vinculação precisa de revisão.` |
  | part titles | history `Termos e aditivos`; items `Itens`; invoices `Faturas`; guarantees `Garantias`; responsibles `Gestores e fiscais`; files `Arquivos` |
  | `AVAILABLE` | `Atualizado em {lastAttemptAt}` |
  | `FAILED` with rows | `A última consulta falhou em {lastAttemptAt}; exibindo dados de {capturedAt}.` |
  | `FAILED` without capture | `A última consulta falhou em {lastAttemptAt}.` |
  | `NOT_FOUND` part | `O Contratos.gov.br não possui registros desta parte.` |
  | `MISSING` | `Não consultado` |
  | empty available part | `Nenhum registro informado pela fonte.` |
  | file link text | the file's description, or `Abrir arquivo` |

  File links open the original URL (`target="_blank" rel="noopener noreferrer"`). Dates use `toLocaleString("pt-BR")` for timestamps and `toLocaleDateString("pt-BR")` for dates. Money columns use `formatDecimal(value, true)`.

- [ ] **Step 1: Write the failing e2e specs** in `tests/e2e/contract-source.spec.ts`. Mock with `page.route` as in `tests/e2e/recovery.spec.ts:56`: `**/api/contracts/{id}`, `**/api/contracts/{id}/source` and `**/api/contracts/{id}/source/*`.
  - `test('contrato vinculado mostra termos, itens e atualização da fonte')`: `RESOLVED` with history (1 "Termo Aditivo", `newGlobalValue "682318.13"`) and items → the headings `Termos e aditivos` and `Itens` are visible, `R$ 682.318,13` is visible, and `Atualizado em` is visible.
  - `test('parte com falha exibe os últimos dados salvos')`: guarantees `FAILED` with `capturedAt` 05/11/2026 and 1 row → the text `A última consulta falhou em` and `exibindo dados de 05/11/2026` are visible, and the row is visible. (Review Focus 3.)
  - `test('valores ausentes aparecem como Não informado')`: an item with `unitValue null` and `startDate null` → the row shows `Não informado` and no `Invalid Date` or `R$ 0,00`. (Review Focus 4.)
  - `test('contrato sem correspondência informa ausência sem tabelas')`: `NOT_FOUND` → the exact `NOT_FOUND` copy is visible and there is no `table`.
  - `test('seções cabem em 390px sem rolagem horizontal da página')`: viewport 390×844 → `document.documentElement.scrollWidth <= 390`.

- [ ] **Step 2: Run them to verify they fail**, with `E2E_BASE_URL=http://localhost:3200 pnpm test:e2e tests/e2e/contract-source.spec.ts`. Expected: FAIL (headings absent).

- [ ] **Step 3: Implement the lib file and the two components, and render the panel in `detail-page.tsx`.** Use only existing semantic classes (`detail-section`, `section-heading`, `eyebrow`, `metadata`, `muted`, `empty`, `table-scroll`); add new classes to `app/globals.css` with tokens only if needed.

- [ ] **Step 4: Run the specs.** Expected: PASS.

- [ ] **Step 5: Use this dev stack for every e2e run in this plan.** Never use the shared dev database.
  1. Create `contracts_e2e_step2` in the Compose PostgreSQL.
  2. Run `DATABASE_URL=…/contracts_e2e_step2 pnpm db:migrate`.
  3. Run `ADMIN_EMAIL=gestor@contratos.local ADMIN_PASSWORD=troque-esta-senha ADMIN_NAME=Gestor pnpm --filter @contracts/api exec tsx scripts/create-manager.ts`.
  4. Start the API: `PORT=4200 DATABASE_URL=… pnpm --filter @contracts/api dev`.
  5. Start the web: `API_INTERNAL_URL=http://localhost:4200 pnpm --filter @contracts/web exec next dev --port 3200`.
  6. Drop the database when the plan is finished.

- [ ] **Step 6: Run the §8 checklist from `docs/ui-rules.md`:**
  - `pnpm --filter @contracts/web lint && pnpm --filter @contracts/web build` pass;
  - keyboard focus works across section pagers;
  - nothing is hardcoded;
  - 360px and 1440px have no page scroll.

  Record each item as checked in the commit body.

- [ ] **Step 7: Commit.** Message: `feat(web): show Contratos.gov.br data on the contract detail page`.

---

### Task 4: Import contracts from the replica

**Files:**
- Modify: `apps/api/src/repositories/contract-sources.ts`, `apps/api/src/contract-sources/service.ts`, `apps/api/src/contract-sources/controller.ts`, `apps/api/test/integration/contract-sources.test.ts`, `apps/web/lib/contract-source-api.ts`, `apps/web/components/import-page.tsx` (or the contract import page component it renders), `tests/e2e/contract-source.spec.ts`

**Interfaces:**
- Consumes: `ContractSourceRepository.importable(uasg)` (Task 1); `assertUasg` (`apps/api/src/auth/access.ts:64`); the `"Contract"` identity `(number, uasg)` unique index.
- Produces:
  - `POST /api/contracts/import-replica` with body `{ uasg: string }`. It returns 200 with:
    - `{ uasg, total: number, created: number, existing: number, results: { externalId, number, outcome: "CREATED" | "EXISTING", contractId: string | null }[] }`;
    - `contractId` is the new or existing app row id.
  - An invalid UASG (not six digits) → 400 with `fieldErrors.uasg`, reusing `@contracts/validation` like `importContracts`.
  - Out of scope → 403 via `assertUasg`.
  - Insert columns: `number`, `object` (`object ?? ''`), `supplierName` (`?? ''`), `supplierDocument` (digits `?? ''`), `uasg`, `unitName` (`''`; the replica has no unit name), `startDate`, `endDate`, `initialValue` (`initialValue ?? globalValue ?? '0'`), `globalValue` (`?? '0'`), `source 'CONTRATOS_GOV_BR'`, `externalId null`, `lastSyncedAt` = the replica `capturedAt`.
  - One transaction with `INSERT … ON CONFLICT ("number","uasg") DO NOTHING RETURNING id` per row. A conflict looks up the existing id.
  - `ContractSourceService.importReplica(body: Data, scope: Scope)`.
  - Web: on the contract import page, add a second mode `Importar da réplica do Contratos.gov.br`. It takes the same UASG field, calls the endpoint and shows `{created} criados, {existing} já cadastrados`, plus the list of results linking to `/contratos/{contractId}`. When the replica is empty, it shows `Ainda não há dados do Contratos.gov.br para esta UASG.`

  In `apps/web/components/detail-page.tsx`, the Origem metadata maps `CONTRATOS_GOV_BR` → `Contratos.gov.br`. This is a one-line addition next to the `COMPRAS_GOV` case.

- [ ] **Step 1: Write the failing tests:**
  - API, `test("imports replica contracts once and never touches existing rows")`:
    - seed 3 replica contracts for UASG `158148`, one of which already exists as a MANUAL app row with a different object;
    - the first call → `created 2, existing 1`, and the manual row is unchanged;
    - the second call → `created 0, existing 3`. (Review Focus 5.)
  - API, `test("replica import rejects out-of-scope and invalid UASG")`: the restricted viewer → 403; `uasg "12"` → 400 with `fieldErrors.uasg`. (Review Focus 1, write half.)
  - E2E, `test('importação da réplica informa criados e já cadastrados')`: mock `POST **/api/contracts/import-replica` → the text `2 criados, 1 já cadastrados` is visible, and the result links point to `/contratos/`.

- [ ] **Step 2: Run them to verify they fail.** Run the integration test file and the spec. Expected: FAIL.

- [ ] **Step 3: Implement the endpoint, the import mode and the Origem label.**

- [ ] **Step 4: Run everything:**
  - `pnpm --filter @contracts/api lint && pnpm --filter @contracts/api test && pnpm --filter @contracts/api test:integration`;
  - `pnpm --filter @contracts/web lint && pnpm --filter @contracts/web build`;
  - `E2E_BASE_URL=http://localhost:3200 pnpm test:e2e`.

  Expected: PASS. Run the §8 checklist again for the import page.

- [ ] **Step 5: Commit.** Message: `feat(contracts): import contracts from the Contratos.gov.br replica`.

---

## Out of scope (later steps)

- Commitments on the contract screen, the link to finance, and totals (step 3); derived facts such as amendment percentage and current end date (step 4); file download (step 5); a "refresh now" button (step 6).
- Fixing the unmasked supplier document on the existing detail page. `maskDocument` only formats; LGPD masking for supplier CPFs needs its own decision.
- Splitting `detail-page.tsx` (476 lines). This plan adds two lines to it and puts the new UI in new files.
