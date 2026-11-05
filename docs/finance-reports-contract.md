# Financial reports

Reports use the existing `/api/finance` read-only API. Monetary values remain exact
decimal strings or null. `page` defaults to 1 and `limit` to 20 (maximum 100).
Unknown filters, duplicate query values and invalid periods return HTTP 400.
Successful responses use `Cache-Control: no-store`.

Each report contains `data`, `total`, `page`, `limit`, `summary` and `context`.
`total` counts grouped rows; `summary` covers the **entire filtered source**, not
just the visible page. Page rows, count and summary share one SQL statement snapshot.
An out-of-range page keeps the complete summary and count.

## Monthly execution by management unit and expense classification

```http
GET /api/finance/execution?managementCode=26421&fiscalYear=2026&fromMonth=1&toMonth=9
```

| Filter | Meaning |
|---|---|
| `managementCode` | Required five-digit management code |
| `fiscalYear` | Required year, 1900–9999 |
| `managementUnitCode` | Optional six-digit financial management-unit code |
| `fromMonth`, `toMonth` | Inclusive months 1–12; default 1 and 12; start cannot exceed end |
| `expenseNature` | Optional exact six-digit classification; monthly source has no subitem |
| `actionCode` | Optional exact alphanumeric source action code, up to 20 characters |
| `page`, `limit` | Pagination |

The source is exclusively `finance.monthly_execution` with
`source = TRANSPARENCY_PORTAL`. Daily documents, internal planning and other provider
copies are never added to these totals. Rows are rolled up across selected months,
actions, plans, locations and amendment authors, grouped by management unit and
the actual economic category, expense group, modality and expense element codes.

`expenseNature` is composed only when the source supplies numeric codes with the
actual expected widths (1 + 1 + 2 + 2). Missing or noncanonical components produce
null, without inserting a guessed modality. Unclassified rows remain in the report
and its totals, separated by their actual raw classification components. Optional
display names come from known labels; the report does not create classifications.

Each grouped row includes management/unit codes and known unit name; the derived
nature and raw classification codes/names; and these amounts:

- `committedValue`, `liquidatedValue`, `paidValue`;
- `registeredPayablesValue`, `canceledPayablesValue`, `priorYearPaidValue`.

The same amount fields appear in `summary`. They sum only the selected source
values; current-year and prior-year fields remain separate, and negative corrections
are preserved. Any missing contributing amount makes that field's sum null, rather
than presenting an incomplete subtotal as a complete value.

`sourceRowCount` counts underlying monthly source rows. `observedMonthCount`,
`firstMonth` and `lastMonth` describe records actually present, both per group and
across the whole filter. They do not prove that all expected imports or units are
complete. `lastImportedAt` is the latest stored fact update, not the Portal publication
timestamp. The response context identifies dataset, source, management, fiscal year
and the requested month boundaries.

If no source rows match, `data` is empty, counts are zero and amount/date summaries
are null. This distinguishes missing imported data from a recorded zero amount.
Ordering is unit, economic category, group, modality (unknown last), and element.

## Annual institutional budget (LOA)

```http
GET /api/finance/budgets?subordinateAgencyCode=26421&fiscalYear=2026
```

| Filter | Meaning |
|---|---|
| `subordinateAgencyCode` | Required five-digit institutional agency code |
| `fiscalYear` | Required fiscal year, 1900–9999 |
| `budgetaryUnitCode` | Optional five-digit budgetary-unit code; not a campus UG |
| `actionCode` | Optional exact alphanumeric source action code |
| `economicCategoryCode`, `expenseGroupCode` | Optional exact one-digit source components |
| `expenseElementCode` | Optional exact two-digit element, preserving codes such as `04` |
| `page`, `limit` | Pagination |

The source is exclusively Portal records in `finance.annual_budgets`. Rows are
grouped by year, superior organ, subordinate agency, budgetary unit, action,
economic category, expense group and element. Function, subfunction and program
rows at this grouping level are summed; `sourceRowCount` records how many imported
annual rows contributed. Display names remain optional labels, never grouping keys.

Each row and whole-filter summary includes `initialBudget`, `updatedBudget`,
`committedBudget`, `executedBudget`, `sourceRowCount` and `lastImportedAt`. Money
uses the same exact and null-propagating rules as monthly execution. Empty source
coverage produces null amounts, not a declared zero budget. Filtering or paging
does not change the distinction between initial and updated allocation.

The response context identifies `ANNUAL_BUDGET`, Portal source, agency and fiscal
year. No `managementUnitCode`, campus allocation, application modality or full
expense-nature code is inferred: those dimensions are absent from the annual file.
Such query fields are rejected rather than silently ignored. This report works
without a management-unit directory and does not join internal campus planning.
Ordering is superior organ, agency, budgetary unit, action and source classification.

## Boundaries and validation

The report does not calculate accounts payable, financial availability or an
as-of balance. It does not allocate institutional LOA to campuses or compare an
annual internal plan against a partial execution period.

```sh
pnpm --filter @contracts/api lint
pnpm --filter @contracts/api exec tsx --test test/finance-http.test.ts test/integration/finance-reports.test.ts
```

Tests use real Fastify routes and isolated PostgreSQL databases. They cover exact
large decimal sums, whole-filter summary with pagination, source/year/unit/month/
nature/action filters, unknown classifications, null amounts, signed corrections,
empty periods and separation from detailed documents and internal planning.
Annual tests also cover rollups across source function rows, institutions and years,
unknown values, exact large totals, out-of-range pages, classification filters and
operation without any imported management units.

A manual source-to-report check also imported the cached September 2026 monthly
ZIP and 2026 annual ZIP through the Go CLI into a temporary database, then queried
the compiled Fastify API. Its 404 monthly source rows produced 166 unit/classification
groups; the 100 annual source rows produced 100 budget groups. Whole-filter report
totals matched exact SQL sums of their respective source tables. No Portal downloads
or writes to the application database were needed for that check.
