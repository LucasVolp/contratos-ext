# Automatic contract sync — design

Status: draft for user review (2026-11-07).
Builds on: `docs/superpowers/specs/2026-11-07-institutional-copilot-design.md`
(Phase 1, steps 1 and 2) and the unmerged branch `feat/contract-normalization`
(step 2: normalized contract tables, `/contracts/:id/source` API, contract
detail panel).

## 1. Intent

Today contracts reach the app only when a person opens **Contratos → Importar**,
picks a UASG and a period, and the API pulls rows from the Compras.gov.br Dados
Abertos API into the `Contract` table. Anything not imported does not exist in
the app, and the user called this import "ruim".

The user's direction, in their words: the import screen "não deveria existir";
"a importação deveria rodar em background, o banco seria consultivo, o ETL
rodaria automaticamente todos os dias pra ter novas informações sobre
contratos. Ao acessar a página todos os contratos devem estar disponíveis."

So the app stops being a place where contracts are brought in and becomes a
place where they are consulted: the Go replicator keeps every contract of every
registered institution up to date on its own, and the contract screens read
that replica.

## 2. Decisions made by the user

1. **Scope of "all contracts":** the contracts of the UASGs of the
   institutions registered in the app (`"Institution".uasg`, 24 today).
2. **No import in the UI.** The contract import screen and its "Importar"
   button are removed. Import runs in the background.
3. **Daily automatic run.** The ETL runs by itself every day and brings new
   information about contracts.
4. **People can still edit**, but only to **add information the source does
   not have**. Source data is not corrected in the app.
5. **"Novo contrato" is removed for now.** No manual contract creation.
6. **Start from zero.** The environment is development; the 295 contracts
   imported from Dados Abertos and any edits to them can be discarded.

## 3. Goals, non-goals, anti-goals

### Goals

- Opening **Contratos** lists every contract of the UASGs in the viewer's
  scope, without anyone having triggered anything.
- Source data is refreshed daily with no human action, and the screens show
  how fresh it is.
- Each contract has an editable layer for information the source lacks
  (internal notes to start), which the daily run never overwrites.
- One failing UASG or contract never stops the others, and never erases the
  last good data.

### Non-goals (for now)

- "Atualizar agora" buttons or on-demand sync requests (roadmap step 6). The
  daily run is the only trigger, besides the existing CLI for operators.
- Manual contract creation, or editing source fields.
- The price-record (ata) import at **Atas → Importar**. It drafts an editable
  document from one ata; it is not a sync and stays as is.
- Contract ↔ commitment linking, derived facts, document download (roadmap
  steps 3–5).
- PNCP or any second source.
- Structured local fields beyond free-text notes (they can be added later on
  the same table).

### Anti-goals (a failure even if it technically works)

- A button, form or screen that a person must use before contracts appear.
- The daily run overwriting or deleting what a person added.
- The screens presenting source data as editable, or inventing values the
  source did not publish (no fabricated data, `docs/ui-rules.md`).
- A run that hammers Contratos.gov.br into blocking us: pacing, cooldown and
  backoff from the replicator foundation apply to every request.
- A user seeing contracts of a UASG outside their scope.

## 4. Design

### 4.1 Source of truth

- **Contract data:** `public_sources.contracts` and its child tables, written
  only by the replicator's normalizer (step 2). The API never calls the source.
- **Identity:** a contract is identified by `(source, external_id)`, the
  Contratos.gov.br id. App URLs use the external id
  (`/contratos/13847`). Since Contratos.gov.br is the only source now, the
  source does not appear in the URL (designer's call).
- **Scope:** a contract belongs to its managing UG
  (`managing_unit_code`), which is what institutions register as UASG
  (corrected in spec §4.2 during step 2). The existing scope rules apply:
  out-of-scope reads return 404, lists are filtered to the viewer's UASGs.
  This supersedes spec §6, which still says "origin UG".
- **Registered UASGs only:** lists show contracts of registered institutions'
  UASGs only, even for roles with unrestricted scope (`GESTOR_GERAL`).
- **Local additions:** a new app table keyed by `(source, external_id)` holding
  free-text internal notes, with who last changed them and when. Anyone who
  can see the contract can edit its notes (no route checks roles today). The replicator
  never writes it. Notes survive any number of daily runs; if a contract stops
  appearing in the source, its notes are kept.

### 4.2 What is removed

- Web: `/contratos/importar`, `/contratos/novo`, `/contratos/[id]/editar` (for
  source fields), the "Importar" and "Novo contrato" buttons on the contract
  list. Shared components (`list-page`, `detail-page`, `editor`,
  `import-page`) currently serve contracts and atas together; the atas side
  keeps working unchanged.
- API: `POST /contracts/import`, `POST /contracts`, contract update/delete
  routes, `importContracts`, and the Dados Abertos `contracts()` client call.
  The ata import (`POST /records/import`, `record()` client call) stays.
- Data: the `"Contract"` table and its rows (user decision 6). The read-time
  resolution between `"Contract"` and the replica built in step 2
  (RESOLVED / NOT_FOUND / AMBIGUOUS) is no longer needed: the detail page reads
  the replica directly by external id. The unused `importable()` query from
  the cancelled step 2 task goes too.

### 4.3 Daily run

A new long-running mode of the replicator (the Go ETL in `apps/etl`), deployed
as a service in `compose.yaml` next to `db`, `api` and `web`.

- **Units:** read at the start of each run from `"Institution".uasg`. A UASG
  added to the app is picked up on the next run.
- **Schedule:** once a day at 03:00 America/Sao_Paulo (designer's call;
  configurable). On start, if there is no completed daily run in the last 24
  hours, it runs right away; this covers the first load on an empty database
  and restarts after downtime.
- **Each run:**
  1. For every UASG, capture the active and inactive contract listings.
     Listings carry the full contract header, so every listed contract gets
     an up-to-date header every day.
  2. Refresh sub-resources (history, commitments, guarantees, responsibles,
     items, invoices, files) by the policy in 4.4.
  3. Normalize every touched contract into the typed tables.
  4. Record the run (per-unit status, counts, failures) in
     `public_sources.capture_runs`, as the replicator already does, plus a
     run-level record that groups the per-unit runs of one daily run. A daily
     run counts as **completed** when it ends without being cancelled, even if
     some units failed; that is what the 24-hour run-on-start rule and the
     freshness line use.
- **Normalize per unit:** contracts are normalized as each UASG finishes, not
  at the end of the whole run, so the list fills in during a long first load.
- **Failure handling:** a failed listing fails that UASG only; a failed
  sub-resource keeps the last good capture and marks the part FAILED (step 2
  behavior); a contract the database rejects is recorded as failed and the
  run continues. Only cancellation stops a run. A run never deletes a
  contract that disappeared from the listings; it simply stops being
  refreshed (its `captured_at` ages).
- **Concurrency:** one run at a time across processes (database advisory
  lock), so the service and an operator running the CLI cannot overlap. The
  existing `sources:sync` / `sources:normalize` CLI commands keep working.
- **Pacing:** the shared per-host pacing gate and cooldown from step 1. The
  run is allowed to take hours; it must not speed up by relaxing pacing.

### 4.4 Refresh policy (designer's call)

Refreshing all sub-resources of every contract daily would be tens of
thousands of requests at the source's safe pace (≈ 8 requests per contract,
≥ 1 s apart). The policy keeps daily freshness where things change:

- **Active contracts** (in the active listing): all sub-resources daily.
- **Inactive contracts:** sub-resources when first seen, when their listing
  entry changed since the last run, or when the last refresh is older than 30
  days.
- **Never captured parts** (MISSING) are always fetched.

The builder may refine the thresholds; the guarantees in §3 are what matter.

### 4.5 Screens

All copy in Portuguese, following `docs/ui-rules.md` (affirmative,
consultative: origin and date shown; 360 px usable; WCAG 2.2 AA).

- **Contract list (`/contratos`):** server-paginated list from the replica,
  filtered to the viewer's scope, with the existing search (number, object,
  supplier), status (active/inactive), UASG and vigência filters. No import or
  create actions. A line states the source and the time of the last completed
  daily run, e.g. "Dados do Contratos.gov.br · atualizados em 07/11/2026 03:42".
  When an in-scope UASG's last good listing is older than that run (its
  listing failed), the screen names that UASG and the date of its last good
  data, so freshness is never overstated.
  Empty states distinguish "the first load is still running" from "no
  contract matches the filters".
- **Contract detail (`/contratos/[externalId]`):** the source header (number,
  object, supplier, vigência, values, status) read-only, with origin and
  capture date, followed by the step 2 sections (history, items, invoices,
  guarantees, responsibles, files). An **Observações internas** block is the
  only editable area: view, edit, save, with who and when last saved. The
  existing PDF/export actions for contracts, if any, keep working from the
  replica data.
- **Navigation and home:** links to the removed pages disappear; anything
  that counted `"Contract"` rows counts replica rows in scope.

### 4.6 Data model changes

- Child tables of `public_sources.contracts` are keyed by
  `(source, contract_external_id, external_id)`: one commitment (or other
  child) can be linked to several contracts. This fixes the final-review
  finding on step 2 that would otherwise break the multi-UASG run.
- The normalizer takes the header from the freshest capture between the
  `/api/contrato/id/{id}` payload and the listings, so a stale one-off `/id`
  capture never masks daily listing updates.
- New app table for notes (name per `AGENTS.md`, English).
- Drop `"Contract"` and its indexes.
- These changes go in a **new** migration; `202611080001` is not edited, since
  the checksum guard in `apps/api/src/migrate.ts` stops the API on any database
  where it already ran. Finance data is untouched.

## 5. Constraints

- Everything in `AGENTS.md`: English technical artifacts, Portuguese
  user-facing copy, mandatory `docs/ui-rules.md` for `apps/web`.
- Stack as in the main spec §6: Next.js 16 / React 19 / Tailwind 4, Fastify 5
  with raw SQL via `pg`, PostgreSQL 16, Go 1.24 ETL.
- Automated tests never call real external sources.
- Built on `feat/contract-normalization`, which must first be rebased on the
  current `main` (it now has migrations up to `202611070003` and a duplicated
  `202611070001` prefix to keep in mind for ordering and for the hard-coded
  migration count in `apps/api/test/integration/finance.test.ts`).
- The other step 2 final-review findings are folded in where the code they
  touch is rewritten here (decimal formatting through `@contracts/validation`
  per ui-rules §2.2, stale rows on NOT_FOUND parts, header part status,
  "Não informada a Não informada" vigência copy, new-tab link hint); the rest
  stay deferred.

## 6. Calls made by the designer (not decided by the user)

- Free-text internal notes as the first and only local field.
- External id in contract URLs; no source segment.
- 03:00 America/Sao_Paulo daily schedule, run-on-start when the last completed
  run is older than 24 hours.
- Refresh policy in 4.4 (active daily, inactive on change or every 30 days).
- Contracts that vanish from listings are kept and age, never deleted.
- Unit list read straight from `"Institution"` by the ETL.
- A daily run is "completed" when not cancelled, even with failed units;
  stale UASGs are named on screen with their last good date.
- Contracts are normalized per unit as the run progresses.
- Lists show registered UASGs only, also for unrestricted roles.
- Anyone who can see a contract can edit its notes.
- Schema changes in a new migration, not by editing `202611080001`.
- Roadmap impact: this replaces the "UG import with per-row conflicts" part of
  step 2 and the "scheduling in compose" part of step 6; on-demand refresh
  buttons stay in step 6, still unscheduled.

## 7. Left to the builder

- Names of the new ETL command/flags and the notes table.
- How the daily mode schedules itself (in-process loop vs. container cron),
  as long as the behavior in 4.3 holds and it runs under `compose.yaml`.
- How "listing entry changed" is detected (e.g. comparing the canonical hash
  of the listing element).
- Splitting the shared contract/ata web components.
- Exact list filters and columns, within `docs/ui-rules.md`.

## 8. Notes for the builder (from the design review)

- The global hook in `apps/api/src/app.ts` rejects any `id` route param that is
  not a UUID; contract routes keyed by external id need another param name.
- The README dev flow starts only `db` and `gotenberg` before `pnpm dev`, and
  e2e tests use the compose database on port 5540: the daily service must be
  opt-in locally (e.g. a compose profile) and never touch test databases.
