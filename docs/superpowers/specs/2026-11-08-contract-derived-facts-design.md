# Contract derived facts — design

Status: agreed with the user on 2026-11-08, after a builder review.
Roadmap Phase 1, step 4 of
`docs/superpowers/specs/2026-11-07-institutional-copilot-design.md` (§4.4).
This document refines §4.4 with what the replicated data actually contains;
where they conflict, this document wins.

## 1. Intent

The contracts sector has to act on two moments of a contract's life, and today
it finds out by reading the amendment history term by term:

1. **The contract is about to end.** Can it still be extended, and is there
   time to do it? The person needs the current end date (after amendments), how
   many days are left, how long the contract has already run against the legal
   maximum, whether the guarantee expires before the contract, and how much of
   the contract is still uncommitted.
2. **The contract is close to the amendment limit.** Can it still be increased,
   and by how much? The person needs the cumulative additions and suppressions,
   each as a percentage of the initial value and kept separate, the legal limit,
   and — the number actually used — **the margin left in reais**.

Step 4 computes these facts deterministically from the replica, shows them as a
summary at the top of the contract screen, each one explainable (which records
it came from and how), and adds list filters for contracts ending soon and
guarantees expiring before the contract. The same facts feed the copilot later
(Phase 2), so each fact keeps its inputs and method.

## 2. Goals, non-goals, anti-goals

Goals:
- Current end date and current global value, with their origin.
- Situation with a **90-day "ending soon" window** (decided with the user; the
  sector has no fixed practice, 90 days is the starting value and may change).
- Total time in force since the start, against the legal maximum for
  continuing services.
- Cumulative additions % and cumulative suppressions %, separately, against the
  limit, with the **margin in reais**; always labeled as an estimate with its
  method.
- Guarantee expiring before the current end date.
- Remaining contract value (already computed in step 3; reused, not duplicated).
- Contract list filters: ending within 90 days, guarantee expires before the
  contract.

Non-goals (this step):
- **"Close to the amendment limit" list filter and list indicator.** Deferred
  by the user on 2026-11-08 ("não é importante"). It is the only feature that
  needs the amendment rule evaluated for every contract at list time; without
  it no stored facts table is needed (§5). Revisit when it is wanted.
- Notifications, e-mails or a dashboard of alerts (Phase 4).
- Reading amendment PDFs to classify terms (Phase 4).
- Per-unit configuration of the 90-day window or of the "close to limit"
  threshold.
- Reconciling the two sources when they disagree (shown side by side only).
- Any manual input: no field for a person to mark a term as addition or
  suppression, or a contract as renovation. Data arrives automatically (standing
  project rule).

Anti-goals (a failure even if it works):
- A percentage shown as if it were a verified fact. Every amendment % and the
  term-cap figure carry "estimativa" and a visible method.
- A contract shown as "without guarantee" when the source simply returned no
  guarantee data. Absence in the source is said as absence in the source.
- Two different meanings of "vence em breve" in the app.
- Netting additions against suppressions.

## 3. What the replica actually contains (checked 2026-11-08)

Checked on the local replica (UG 154502, about 280 contracts with history
captured, 812 history terms). This drives the method in §4.

- **History term types:** `Contrato` (the original), `Termo Aditivo`,
  `Termo de Apostilamento`, rarely `Termo de Rescisão`, `Outros`.
- **Qualifications (`qualificacao_termo`) are not reliable.** 166 of 489
  amendments carry `ACRÉSCIMO / SUPRESSÃO + INFORMATIVO + VIGÊNCIA` although
  most of them (103) change no value: they are records migrated in 2020 from the
  older system, mostly pure extensions under Law 8.666 art. 57 II. 21
  amendments have no qualification at all. Apostilles carry none.
- **Value per term:** each history row has `valor_global` = the contract's
  global value after that term; `novo_valor_global` is filled only on
  apostilles, and there it always equals `valor_global` (113 of 113 checked), so
  `valor_global` is the single reference field. The value change of a term is therefore the difference between
  its `valor_global` and the previous term's (in signature order).
- **Mixed terms exist:** `REAJUSTE + VIGÊNCIA` (52) raise the value through a
  price adjustment, not a quantitative addition. At least one apostille
  declares a quantitative addition in its observation ("ACRÉSCIMO DE
  R$ 100.000,00 AO VALOR GLOBAL"), which an apostille legally cannot do.
- **Header end date** (`contracts.end_date`) matches the latest history end date
  in 220 of 227 contracts. The differences are real events the header already
  reflects (a rescission ending the contract early, a term reducing the
  period) and a few cases where the header is behind a later extension, or has
  no end date while a term has one.
- **Guarantees:** the source returned no guarantee row for any captured
  contract. The fact must work, but will mostly read "no guarantee informed by
  the source".
- **Instrument types:** the replica holds more than `Contrato` rows: about a
  third of the UG 154502 headers are `Empenho` (a commitment note used as the
  contract instrument), plus `Outros` and `Convênio`. The original history row
  has the instrument's own type (`Empenho` for those), not always `Contrato`.
- **Observation text of value-changing amendments:** among the 63 migrated
  `ACRÉSCIMO / SUPRESSÃO + INFORMATIVO + VIGÊNCIA` terms that change the value,
  34 mention extension, 23 price adjustment (reajuste), 14 repactuação and only
  18 an addition or suppression. Terms qualified `ACRÉSCIMO / SUPRESSÃO` alone
  or with `VIGÊNCIA` almost always mention an addition or suppression.
- **No "continuing service" flag and no "renovation" flag.** `category`
  (Serviços, Mão de Obra, Informática (TIC), Obras, Serviços de Engenharia,
  Compras, A definir…) is the closest hint.

## 4. Facts and methods

All facts are computed from `public_sources` only (contract header, history,
guarantees, part statuses). Each fact carries: value, status (`COMPUTED`,
`ESTIMATED`, `NOT_COMPUTABLE`, `NOT_APPLICABLE`), the ids of the records used,
and a short method text in Portuguese for the screen.

**Which instruments get which facts** *(designer's call)*: end date,
situation, guarantee and remaining value apply to every instrument. The
amendment-limit fact (§4.4) and the time-in-force fact (§4.3) apply only when
the header type is `Contrato`; other types (`Empenho`, `Outros`, `Convênio`, …)
show "não se aplica a este tipo de instrumento".

**Original row:** the earliest history row by signature date whose type is not
`Termo Aditivo`, `Termo de Apostilamento` or `Termo de Rescisão` (its type is
the instrument's own type).

### 4.1 Current end date

- **Value:** the header `end_date` (the source's own current value).
- **Fallback:** when the header has no end date, the end date of the latest
  `Contrato` / `Termo Aditivo` / `Termo de Rescisão` by signature date that has
  one.
- **Divergence:** when the latest such term (by signature date) states a
  different end date than the header, both are shown with source labels
  ("cabeçalho do Contratos.gov.br: X · termo aditivo 00001/2024: Y"). No
  reconciliation. The header value still drives the situation and filters.
- Not computable when neither exists.

### 4.2 Situation and the 90-day window

- `UPCOMING`, `ACTIVE`, `EXPIRING`, `EXPIRED`, `UNKNOWN`, as today, computed on
  the current end date.
- **`EXPIRING` changes from 30 to 90 days** everywhere (API `contractStatus`,
  list stats, filter). Label stays "Vence em breve"; the screen says "vence em
  N dias". One constant shared by API and web.
- Days left are computed at read time (depend on today), never stored.

### 4.3 Time in force against the legal maximum

- **Value:** time from the original contract's start (`Contrato` history row,
  or header `start_date`) to the current end date, in years and months.
- **Maximum assumed:** Law 14.133 → 10 years (art. 107, continuing services
  and supplies); Law 8.666 → 60 months (art. 57 II), with the exceptional 12
  months mentioned in the method text.
- **Law:** taken from the header `legal_basis` text when it names 14.133 or
  8.666; otherwise inferred from the signature date (before 2021-04-01 → 8.666;
  after 2023-12-30 → 14.133; in between → "não identificada", both maxima
  shown).
- **Always `ESTIMATED`**: the source does not say whether the object is a
  continuing service. The method says so, and names the category as context.
  The fact is `NOT_APPLICABLE` for categories `Compras` and `Obras` (supplies
  and works are scope contracts, extended under other rules). *(Designer's
  call.)*

### 4.4 Cumulative additions and suppressions

- **Base:** header `initial_value` (initial value as registered in the source).
- **Terms counted:** `Termo Aditivo` rows, in signature order, whose value
  change (Δ = `valor_global` − previous row's `valor_global`, the previous row
  including apostilles so price adjustments are absorbed into the reference)
  is non-zero, **unless** the term is qualified only as `VIGÊNCIA`, only as
  `REAJUSTE`, or `REAJUSTE + VIGÊNCIA` without `ACRÉSCIMO / SUPRESSÃO`.
  Δ > 0 → addition; Δ < 0 → suppression. Additions and suppressions are summed
  separately, never netted.
- **When in doubt, count (decided with the user, 2026-11-08).** Any other
  qualification (`ACRÉSCIMO / SUPRESSÃO` in any combination, `INFORMATIVO`,
  `FORNECEDOR`, none) with Δ ≠ 0 is counted, even when the observation text
  mentions reajuste, repactuação or prorrogação. Rationale: an overstated
  percentage only causes a manual check; an understated one can show margin
  that was already used. Such terms get the flag "texto menciona
  reajuste/repactuação/prorrogação — pode não ser acréscimo quantitativo".
- **Excluded and listed as excluded, with reason:** apostilles (reajuste,
  repactuação — even if their text says "acréscimo"; the method notes it),
  terms with Δ = 0, pure extensions, pure price adjustments, rescissions.
- **Flags shown next to counted terms:** "sem qualificação na fonte";
  "qualificação inclui reajuste — pode conter reajuste"; "registro migrado
  (ACRÉSCIMO / SUPRESSÃO + INFORMATIVO + VIGÊNCIA)".
- **Limit:** 25% (Law 8.666 art. 65 §1; Law 14.133 art. 125) for both
  additions and suppressions. The 50% renovation limit is never assumed: the
  method says "50% para reforma de edifício ou equipamento não identificado na
  fonte". Law identified as in §4.3.
- **Outputs:** additions % and R$, suppressions % and R$, limit %, **margin in
  reais = 25% × base − additions R$** (never negative; above the limit shows
  the excess), share of the limit used (additions % ÷ 25%).
- **Status:** `ESTIMATED` whenever at least one history term exists;
  `NOT_COMPUTABLE` only when there is no history data at all (part `MISSING`,
  `FAILED` without previous capture, or `NOT_FOUND`) or no initial value.
  A contract with history and no counted term reads "0% — nenhum termo de
  acréscimo ou supressão identificado".

### 4.5 Guarantee vs. current end date

- Coverage = the **latest due date among the guarantee rows** (a renewal or
  endorsement usually adds a row; older rows are replaced policies). Coverage
  before the current end date → "vence antes do contrato" (with the gap in
  days); every row is still listed in the disclosure. *(Designer's call.)*
- Guarantees part `NOT_FOUND` or zero rows → "nenhuma garantia informada pelo
  Contratos.gov.br" (not "sem garantia").
- Part `MISSING` / `FAILED` → "garantias não consultadas" with the part status.

### 4.6 Current value and remaining value

- **Current global value:** header `global_value`, labeled with the source
  and capture date (already shown). Initial value next to it.
- **Remaining value:** exactly step 3's "saldo do contrato" (global value −
  committed as reported by Contratos.gov.br). The summary shows it and links
  to the commitments section; no second computation.

## 5. Where facts are computed

**No new table (decided with the user, 2026-11-08).** The API computes the
facts when a contract is opened, from the replica tables it already reads
(header, `contract_amendments`, `contract_guarantees`, `contract_parts`), in a
pure TypeScript function, and returns them with the contract detail together
with their explanation (counted and excluded terms with reasons and flags).
Nothing is stored, so there is no backfill and no schema change.

The list needs no amendment computation, because the "close to the limit"
filter is deferred:

- "Ending within 90 days" is the existing `EXPIRING` situation, widened to 90
  days, on the header end date (as today). The term fallback of §4.1 is shown
  on the detail only *(designer's call: the header lacks an end date in about
  1 of 227 contracts)*.
- "Guarantee expires before the contract" is a plain SQL condition: the latest
  guarantee due date is before the header end date. It is the same rule as
  §4.5 and shows as a row indicator.

If the "close to the limit" filter comes back, the stored table is the
recommended route (one implementation of the rule, read by list and detail).

## 6. Screens

Follow `docs/ui-rules.md`; reuse domain primitives and shadcn components.

**Contract detail (`/contratos/[id]`)** — a "Situação do contrato" summary
right below the header, before the existing sections:

- Vigência: current end date, "vence em N dias" / "encerrado há N dias",
  badge for the situation; divergence note when §4.1 applies.
- Tempo de vigência: "X anos e Y meses de 10 anos (estimativa)".
- Aditivos: two bars or meters, additions and suppressions, each "N% de 25%",
  plus "ainda cabe acrescer R$ X (estimativa)".
- Garantia: "vence antes do contrato" warning or the absence text.
- Saldo: remaining value, link to the commitments section.
- Each line has a "Como calculamos" disclosure listing counted and excluded
  terms (number, date, Δ, reason/flag) and the method text.

**Contract list (`/contratos`)** — new filters in the advanced filters:

- "Vence em até 90 dias" (same as situation `EXPIRING`, now 90 days).
- "Garantia vence antes do contrato".

List rows gain a compact "garantia vence antes" indicator; the existing
situation badge already covers expiry. On the detail, additions at 80% of the
limit or more are highlighted as "perto do limite" *(designer's call)*.

## 7. Constraints

- English for schema, code, tests, docs; Portuguese UI copy (AGENTS.md).
- API never calls external sources; reads the replica only.
- Facts computed by the API from the replica; a failed part keeps the
  previous capture, and facts say which parts were stale.
- Money with `numeric`, never floats; percentages rounded for display only.
- 360px usable, WCAG 2.2 AA, no fabricated data (ui-rules).

## 8. Left to the builder

- The exact shape of the explanation in the API response.
- Visual form of the meters and the disclosure, within ui-rules.
- Test fixtures: build them from the real cases cited in §3 (migrated
  `ACRÉSCIMO / SUPRESSÃO + INFORMATIVO + VIGÊNCIA` extension, `REAJUSTE +
  VIGÊNCIA`, apostille with "acréscimo" text, rescission, header behind a later
  extension, header without end date).

## 9. Calls made by the designer (not discussed with the user)

- `EXPIRING` widened from 30 to 90 days app-wide, to avoid two meanings.
- Header end date wins over terms; divergence shown, not resolved.
- Change of value per term derived from consecutive `valor_global`, not from
  qualifications, because qualifications are unreliable in the data.
- Apostilles never count, even when their text says "acréscimo".
- Base = initial value as registered (not updated by price adjustments).
- 25% always; 50% renovation never assumed.
- Term-cap fact not applicable for categories `Compras` and `Obras`.
- Amendment-limit and term-cap facts only for instruments of type `Contrato`.
- Guarantee coverage = latest due date among the guarantee rows.
- "Close to the limit" (detail highlight only) = 80% of the limit or more.
- List situation and filters keep using the header end date; the term
  fallback is detail-only.
