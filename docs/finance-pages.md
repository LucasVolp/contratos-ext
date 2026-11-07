# Financial panels

The Financial workspace opens a unit-filtered overview at `/financeiro`.
`/financeiro/execucao` retains the same overview for existing links.
All changes in this delivery are frontend code, frontend tests and this guide.

## Overview

The primary controls select a management unit by name, fiscal year and period.
All units are selected initially. The first available management agency is resolved
from the authenticated financial unit directory; no institution code is hardcoded.
The institution selector and manual code entry remain under an expandable control.

The overview presents committed, liquidated and paid amounts, monthly evolution,
unit comparisons and expense-nature comparisons. Selecting a comparison updates
the URL and filters the entire panel. The comparison metric can be changed without
changing the dataset. Prior-year movements remain in a separate section.

The Portal source, last import date and consultation time accompany the figures.
Observed-month coverage describes available records, not completeness of imports.
Unknown amounts stay unknown. Missing months are gaps rather than zeroes.
Signed corrections remain visible, including amounts smaller than one cent.
Compact figures always accompany exact source values. Decimal parsing and formatting
reuse `@contracts/validation`; monetary values never become JavaScript numbers.
Only dimensionless chart coordinates are converted to bounded numbers.

## Existing API integration

`lib/finance-api.ts` reads the existing `units`, `execution`, `budgets` and commitment
endpoints through the runtime proxy. No new backend endpoint is required.
The adapter enumerates complete paginated classifications to discover comparison
keys, then requests whole-filter server summaries for each month, unit, nature,
action or expense group. It does not calculate financial totals from page rows.
At most four discovery/comparison requests run concurrently. Comparisons consist
of separate API snapshots and can reflect imports made between requests.

Requests are canceled when filters change. A late response cannot replace a newer
scope. A failed refresh preserves the last successful data only for the same scope,
with an explicit error and retry. A new scope never displays old figures under
its new labels. No public external source is called automatically by these panels.

## LOA and documents

`/financeiro/loa` presents institutional annual budget figures, action comparisons
and expense-group composition. Its unit selector uses budgetary units from the
annual report, not campus management units. The source does not identify campus
allocations. Access follows the current API's general-manager restriction.

`/financeiro/empenhos` offers unit/year selection, document search, optional filters
and server pagination. A commitment detail starts with figures and identification,
then opens one collection at a time: items, item history, liquidations or payments.
Headerless references remain accessible. The return URL restores the list scope
and page. Individual beneficiary documents are masked for restricted viewers.

Detailed report tables are opened explicitly. They use the shared pager and keep
whole-filter panel values unchanged while navigating table pages. No accounts-
payable balance, campus LOA allocation or financial availability is inferred.

## Validation

```sh
pnpm --filter @contracts/web lint
pnpm --filter @contracts/web build
pnpm exec playwright test --config playwright.finance.config.ts
```

The browser suite provisions a temporary PostgreSQL database, API, production web
server and real authenticated sessions. It verifies unit filtering, keyboard
controls, null amounts, signed values, large identifiers, monthly gaps, report
pagination, scoped viewers, refresh failures and delayed responses. Layout is
checked at 360, 390 and 1440 pixels without page-level horizontal overflow.
The web port defaults to `3140`; `FINANCE_E2E_PORT` overrides it.

The existing source data in the local main services was also checked in the
browser, including unit selection, institutional budget and commitment details.
The new chart palette has contrast ratios of 5.38:1, 4.59:1 and 5.51:1 against the
paper token. Series use labels and distinct stroke patterns as well as color.
