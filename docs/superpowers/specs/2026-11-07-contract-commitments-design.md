# Contract ↔ commitment linking with per-campus breakdown — design

Status: agreed with the user on 2026-11-07, after a builder review. Roadmap Phase 1, step 3 of
`docs/superpowers/specs/2026-11-07-institutional-copilot-design.md` (§4.3 and the
financial-totals part of §4.4). This document refines §4.3 where the user decided
differently: this step has no suggested or deduced links. Where they conflict,
this document wins.

## 1. Intent

A manager opens a contract and must understand three things on one screen:

1. **The contract itself.** Object, supplier, term, value and amendments are
   already shown, since step 2.
2. **Its link to commitments (empenhos).** Which commitments belong to the
   contract, how each link is known, and whether the commitment is already in
   the app's financial execution data.
3. **What the contract provides to each campus.** One contract of the rectorate
   (UG 158148) is executed by several campuses, and each campus issues its own
   commitments against it (real example: a contract of UG 158148 with
   commitments issued by UG 158345). The manager needs to see, per campus,
   how much was committed, liquidated, paid and carried over as restos a pagar,
   plus the contract's remaining balance.

The user confirmed there are **no per-campus quotas** in contracts (as far as
they know). "What it provides to a campus" means what each campus has used. The
balance is computed for the contract as a whole.

## 2. Goals, non-goals, anti-goals

Goals:
- Every commitment of a contract is listed with its link origin and its
  financial-data status.
- Commitments are grouped by issuing campus (UG), with per-campus and
  contract-level totals and the contract balance.
- The commitment detail screen (`/financeiro/empenhos/[id]`) shows the contract
  it belongs to, if any.

Non-goals (this step):
- Campus-first view ("which contracts serve my campus"). The user wants it later.
- Per-campus quotas or allocations.
- Derived facts of step 4: current end date and value after amendments,
  addition/suppression %, guarantee vs. end date. The step 4 list filters are
  also out.
- Reconciling disagreeing amounts between the two sources.
- Deduced or suggested links (by supplier, process or anything else); see §3.2.
- Scheduling the finance importer. The user will make it automatic later, as
  was done for contracts. Until then, "pending import" names the date of the
  last import (§4).
- Any manual action: no confirm or reject buttons, no import buttons. This
  follows the standing project rule that data arrives automatically.

Anti-goals (a failure even if it works):
- A commitment attached to the wrong contract. A link is only made when it is
  provable, and an ambiguous match is never resolved by guessing.
- A total that silently mixes sources or periods without saying so.
- "Pending import" shown for a commitment that will never arrive.

## 3. Linking rules (decided with the user)

### 3.1 The only link: informed by Contratos.gov.br

`public_sources.contract_commitments` already holds, per contract, the
commitments Contratos.gov.br lists. Its generated column `transparency_code` is
`unit_code || management_code || number`. That matches the Portal da
Transparência code in `finance.commitment_references.document_code` (for
example `158345` + `26421` + `2022NE000066`). The screen states the link origin:
**"informado pelo Contratos.gov.br"**.

### 3.2 No deduced links in this step

The user first agreed to link automatically by "same supplier CNPJ + same
process + exactly one contract". The rule was then dropped (2026-11-07) because
real data defeats it. Under a price-registration (ata) process, one campus may
sign a contract while other campuses issue commitments under the same process
and supplier without any contract. The rule would attach all of those
commitments to the single contract, and the finance data has such groups (44
commitments share process `23243.014077/2025-76` and one supplier). The finance
data model says the same: *"matching a supplier, unit or process alone does not
establish that relationship"* (`docs/finance-data-model.md`).

A future step may revisit deduced links if a stronger signal appears, for
example the contract number in the commitment's `observation`.

### 3.3 Not linked

A commitment of the financial data that no contract lists counts in no
contract's totals. On its commitment detail screen it reads "sem contrato
identificado". No candidate list is shown.

### 3.4 Same commitment on two contracts

If Contratos.gov.br lists the same commitment on two contracts, both show it.
No cross-contract total exists in this step, so nothing is counted twice.

## 4. Financial-data status of each linked commitment

- **Confirmed:** the code exists in `finance.commitment_references`, either
  with a header in `finance.commitments` or header-less. The finance importer
  covers 2026 only, so older commitments that receive 2026 liquidations or
  payments exist only as references: 1,513 of 3,895 in the dev database, all
  from before 2026. `/financeiro/empenhos/[id]` already serves header-less
  references, so these count as confirmed. The row links to that page when the
  viewer's scope allows it (§6).
- **Not found in imported data:** the code is absent, and the finance importer
  successfully imported its UG for the commitment's issue date. Waiting will
  not fix it, so it is not "pending".
- **Pending import:** the code is absent, and the issue date falls after the
  last successful import of its UG or on a day whose import failed or was
  never run. The label names the last successful import of that UG ("aguardando
  importação — última importação em 23/10/2026"), because finance imports are
  not scheduled yet. The link resolves itself when the commitment arrives. The
  amounts shown are Contratos.gov.br's, labeled with that source.
- **Outside import scope:** the finance importer has never covered the UG, or
  the issue date is before the earliest period imported for that UG, and the
  code is absent. The commitment will never arrive, so it is shown apart from
  "pending" so nobody waits for it.

Coverage comes from successful `finance.ingestion_runs` (`scope_type`,
`scope_codes`, `period_start`, `period_end`). The exact query is left to the
builder, as long as the anti-goal holds: never "pending" for something that
cannot arrive.

## 5. Per-campus breakdown and totals

- **Grouping:** by the commitment's issuing UG (`unit_code`). Campus names come from
  `finance.management_units` (for example 158342 → "INST.FED.RONDONIA/CAMPUS
  VILHENA"). A UG without a name shows its code.
- **Per campus and for the contract:** committed, liquidated, paid, and restos a
  pagar (registered, to liquidate, liquidated, paid), plus the commitment count.
- **Source of amounts (designer's call, carried from copilot spec §4.4):**
  every amount and total uses the Contratos.gov.br figures per commitment,
  because only they include restos a pagar. Totals say so, with the capture
  date.
- **Disagreement:** when a confirmed informed commitment has a header in the
  financial data and its committed amount differs, both values are shown with
  source labels. No reconciliation. Header-less references have no committed
  amount to compare, so only the Contratos.gov.br amounts are shown for them.
- **Contract balance:** the contract's `global_value`, as reported in the
  Contratos.gov.br header, minus total committed across all campuses. It is
  labeled with its base ("valor global informado pelo Contratos.gov.br em
  <data>"). Recomputing the value after amendments is step 4.

## 6. Screens

- **Contract detail (`/contratos/[id]`):**
  - a "Empenhos por campus" section with per-campus rows and totals, and the
    contract balance;
  - the commitments list, with origin and status per row, filterable by
    campus;
  - the source and capture date shown next to the numbers.

  It extends the existing contract source panel (`components/contract-source/`).
  It does not duplicate it.
- **Commitment detail (`/financeiro/empenhos/[id]`):** a short "Contrato" block
  with the contract number, supplier and link origin, linking to the contract.
  If several contracts list the commitment, all are shown.
  It shows "sem contrato identificado" when none is linked.
- **Access (designer's call):** whoever can see a contract sees all of its
  commitments and per-campus rows, as copilot spec §4.3 already implies. A row
  links to the finance detail only when the commitment's UG is in the viewer's
  scope; otherwise it shows the same facts without a link. A campus viewer whose
  commitment belongs to a contract outside their scope sees the contract number,
  supplier and link origin as plain text without a link. These facts are public
  on Contratos.gov.br, and the contract screen itself keeps its 404 rule.
- Copy is plain pt-BR and follows `docs/ui-rules.md`. The UI is affirmative:
  facts are stated with origin and date, and uncertainty is stated as such.

## 7. Constraints

- English for technical artifacts, Portuguese UI copy (`AGENTS.md`).
- `docs/ui-rules.md` §8 checklist for every UI change: 360px, WCAG 2.2 AA,
  light/dark, shadcn/Base UI and existing primitives, LGPD masking.
- Schema changes only in new migrations. Never migrate the shared dev database
  `contracts`, only throwaway databases.
- The finance schema is imported data. The ETL owns it, so this step adds
  nothing the ETL would have to write. Links are derived from both schemas,
  and they recompute when either side changes (new captures, new finance
  imports).
- Lists show registered UASGs only, as today. A contract's per-campus rows may
  show UGs that are not registered, because those commitments belong to a
  visible contract.
- Coordination: uncommitted financial-execution work exists in the main checkout
  (`apps/api/src/finance/*`, `apps/web/components/finance/*`, plan
  `docs/superpowers/plans/2026-11-07-finance-workspace.md`). The commitment
  detail change touches that area, so check it before editing to avoid
  conflicts.

## 8. Left to the builder

- Whether links are a SQL view computed at read time or a table maintained by
  the replicator or API. The constraints in §7 apply either way.
- API shape (new endpoint vs. extending the contract parts endpoint) and the
  exact coverage query of §4.
- Layout within the UI rules.

## 9. Calls made by the designer (not discussed with the user)

- All amounts and totals come from Contratos.gov.br.
- Balance base is the header `global_value` from Contratos.gov.br.
- "Outside scope" includes issue dates before the earliest imported period.
- "Pending import" names the date of the last successful import.
- Header-less finance references count as confirmed. "Not found in imported
  data" is a fourth status (§4).
- Access rules for cross-UG rows and the commitment-side "Contrato" block (§6).
