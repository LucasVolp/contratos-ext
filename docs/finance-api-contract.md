# Financial read API

Base path: `/api/finance`. This slice provides read-only access to imported
commitments and their related documents. It uses PostgreSQL directly through the
existing Fastify API, with no runtime dependency on Go, SAGA or envelopa.

All endpoints require a valid session. Management-unit directories, commitment lists,
monthly reports, details and child collections are restricted to the viewer's
linked UASGs. General managers have unrestricted scope. Out-of-scope details
return 404. Institutional annual budget reports require a general manager because
the source has no campus allocation. Client query parameters cannot widen access.

## Endpoints

| Method | Path | Result |
|---|---|---|
| GET | `/units` | Paginated management-unit directory |
| GET | `/commitments` | Paginated commitment summaries, including references without headers |
| GET | `/commitments/:commitmentId` | Summary and optional imported header |
| GET | `/commitments/:commitmentId/items` | Paginated current commitment items |
| GET | `/commitments/:commitmentId/history` | Paginated source item operations |
| GET | `/commitments/:commitmentId/liquidations` | Paginated liquidation allocations affecting the commitment |
| GET | `/commitments/:commitmentId/payments` | Paginated payment allocations affecting the commitment |
| GET | `/execution` | Monthly execution report by unit and classification; see [Financial reports](finance-reports-contract.md) |
| GET | `/budgets` | Annual institutional budget by agency/action/source classification; see [Financial reports](finance-reports-contract.md) |

All successful responses use `Cache-Control: no-store`. A list response is:

```json
{
  "data": [],
  "total": 0,
  "page": 1,
  "limit": 20
}
```

`page` is a positive integer, default 1. `limit` is 1–100, default 20. Counts and
rows are read in one SQL statement, so an import committing between separate HTTP
calls cannot produce a mismatched count and page within the same response. A page
beyond the end returns empty data with the complete filtered total.

## Filters

`GET /units` accepts `managementCode` (five digits), `search`, `page` and `limit`.
The directory uses the financial management-unit identity, not an assumed match
to a purchasing-catalog UASG. Unit codes retain leading zeros. Ordering is by
management code and unit code ascending.

`GET /commitments` accepts:

| Query field | Meaning |
|---|---|
| `managementCode` | Required five-digit management code |
| `managementUnitCode` | Optional six-digit financial management-unit code |
| `fiscalYear` | Commitment fiscal year, 1900–9999 |
| `expenseNature` | Six-digit nature prefix or exact eight-digit classification |
| `favoredCode` | Exact source supplier/beneficiary code; masked source codes remain valid |
| `search` | Literal text in full/short code, supplier name or process number |
| `from`, `to` | Inclusive commitment-header emission dates, `YYYY-MM-DD` |
| `page`, `limit` | Pagination |

Dates must be real calendar dates and `from <= to`. Header-less references have
an unknown emission date and therefore do not match emission-date filters. Their
fiscal year and unit/management scope are decoded only from a valid full Portal
identity (`UG + management + year + document type + number`). No metadata is
inferred from the dates or beneficiary of a later payment.

The nature filter checks header, items and both impact tables. Six digits match
that nature and its eight-digit subelements. Filters **select whole commitments**;
reported amounts remain the commitment's full imported totals across all natures
and all movement dates. These endpoints are not a nature-level execution report
or a financial position as of `to`.

Ordering is fiscal year descending, header emission date descending (unknown last),
then numeric identity descending. Unknown references remain visible within their
known source scope/year. Search treats `%`, `_` and backslash literally; input is
always parameterized.

Only `/history` accepts an additional `itemSequential` positive integer filter.
All other related lists accept only `page`/`limit`; the detail endpoint accepts no
query fields. Unknown fields and repeated/non-string query values return HTTP 400.

## Identity and precision

All database identities are **decimal strings**, including `commitmentId`, item,
allocation, document and ingestion-run IDs. They must not pass through JavaScript
`Number`. Path IDs accept canonical positive PostgreSQL bigint values up to
`9223372036854775807`; UUID validation in the existing modules is unchanged.

All amounts, quantities, rates and prices are decimal strings or null. This applies
inside JSON SQL aggregates too: numeric fields are cast to text before JSON is
built, preventing loss of precision in the PostgreSQL driver's JSON decoder. Dates
are `YYYY-MM-DD` strings and audit timestamps are ISO timestamps. Decimal output
does not promise a fixed number of trailing zeros.

## Summary and header

Each summary exposes identity/source, `documentCode`, `resumedCode`,
`headerAvailable`, `fiscalYear`, management/unit codes and known unit name,
`emissionDate`, beneficiary fields, `processNumber`, header `expenseNature`,
`itemCount`, `historyCount`, `liquidationCount`, `paymentCount` and the amounts below.

| Amount | Source |
|---|---|
| `committedValue` | Sum of current item values, without adding item history |
| `liquidatedValue` | Sum of liquidation-impact `liquidated_value_brl` |
| `liquidationPriorYearMovementValue` | Sum of liquidation-impact `outstanding_value_liquidated_brl`, retaining the reference source mapping |
| `paidValue` | Sum of payment-impact `paid_value_brl` |
| `priorYearPaidValue` | Sum of payment-impact `outstanding_value_paid_brl` |

Each child dataset is aggregated independently. Three payment allocations and two
items do not multiply a commitment's values through a raw join. Document counts
count distinct liquidation/payment headers; allocation lists count impact rows,
so their `total` can exceed the overview's document count.

`committedValue` is null when there are no current items or any item value is
unknown. The original/converted header values are not substituted for the current
commitment total. Each movement sum is null when any contributing amount is null;
no imported allocations produce zero observed activity. Negative corrections remain
signed. These figures cover imported data and do not certify complete source coverage.

The reference mapper labels a prior-year movement column in liquidation CSVs
`Valor Restos a Pagar Pagos (R$)` while storing it as
`outstanding_value_liquidated_brl`. The API names it as a **movement**, preserving
the raw mapping without asserting that it is an independently verified liquidated
balance. Current-year and prior-year fields are not combined into a new measure.

The detail response adds `header`, null when not yet imported. A known header
contains type/document type, budget plan, observation, `originalValue`, `valueBrl`,
`conversionRate`, `ingestionRunId` and `updatedAt`. The full source identity and
related documents remain available before the header arrives and keep the same
commitment ID afterward.

## Related records

- Items expose sequence, nature/subitem, description, exact quantity/prices/current
  value, import ID and update timestamp. Sort: sequence, then numeric item ID.
- History exposes `sourceKey`, `itemSequential`, source operation type/date and
  exact quantity/prices/value. It includes operations for an item no longer in the
  current snapshot. Sort: operation date, sequence and numeric operation ID.
- Liquidation/payment pages expose `allocationId`, `documentId`, full/short code,
  movement-document fiscal year/date/scope/beneficiary, allocation classification,
  exact amounts, import ID and update timestamp. Sort: movement date descending,
  then numeric allocation ID descending. A 2026 payment may affect a 2025 commitment.
- Liquidations expose `liquidatedValue`, `priorYearMovementValue`,
  `registeredPayablesValue` and `canceledPayablesValue`. Payments expose `paidValue`,
  `priorYearPaidValue`, registration/cancellation fields, process and extra-budgetary
  flag. Do not add registration/cancellation columns across both source datasets:
  they may describe the same underlying prior-year obligations.

Malformed identities/filters return HTTP 400 with Portuguese messages and field
errors. A well-formed unknown commitment returns HTTP 404, including on related
list routes. A known reference with no related rows returns HTTP 200 and an empty
page. Read routes do not accept POST/PUT/DELETE.

## Boundaries and verification

This slice does not calculate accounts payable, join official LOA to campuses,
or combine monthly aggregates with daily documents. The separate
[execution and budget reports](finance-reports-contract.md) each use their own
source. Remaining features need source-specific queries and agreed business rules.

```sh
pnpm --filter @contracts/api lint
pnpm test
pnpm --filter @contracts/api exec tsx --test test/integration/finance-api.test.ts
```

The integration tests use isolated databases and the real Fastify application,
covering bigint/decimal precision, independent aggregates, filtering and pagination,
cross-year and header-less references, later header resolution, nullable amounts,
unknown references and existing UUID-route validation.
