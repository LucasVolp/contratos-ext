# Financial consultations

The financial workspace is available from the main navigation at `/financeiro`.
It redirects to `/financeiro/empenhos`.

- `/financeiro/empenhos`: whole commitments filtered by management agency,
  management unit, year, nature, beneficiary, document/process search and emission
  date. Nature matches select whole commitments, including movements in other
  natures. No totals are calculated from the visible page.
- `/financeiro/empenhos/[id]`: identification, current item amounts and separate
  prior-year movements, plus independently paginated items, history, liquidation
  allocations and payment allocations. Headerless references remain accessible.
- `/financeiro/execucao`: monthly execution grouped by management unit and source
  expense classification. Whole-filter totals, prior-year amounts and observed
  coverage are supplied by the report API.
- `/financeiro/loa`: annual institutional budget grouped by budgetary unit, action
  and source classification. It does not infer campus allocations or a complete
  six-digit expense nature.

Filters and pagination live in the URL. Commitment details retain a local return
URL to restore the list filters and page. Switching report tabs carries only the
agency code and year; dataset-specific filters are reset. Agency/year selection
is explicit, with no hardcoded institution or fiscal year. The initial directory
is a limited aid based on the first 100 known management units; annual budget
queries also work without that directory.

All requests use the existing runtime Next.js API proxy. Requests are canceled
when their scope changes, and stale results are not rendered under new filters.
Missing values remain unknown; signed decimal amounts are formatted directly
from strings without conversion to JavaScript numbers. Identifiers remain strings.
No accounts-payable balance or availability is derived in this stage.

## Validation

After building the web application, run:

```sh
pnpm --filter @contracts/web build
pnpm exec playwright test tests/e2e/finance.spec.ts
```

The financial browser suite creates and migrates an isolated temporary PostgreSQL
database, starts a real API with that connection and a production web server,
then removes both processes and the database. PostgreSQL must permit temporary
database creation. The web port defaults to `3140` and can be overridden with
`FINANCE_E2E_PORT`. The API uses an ephemeral port. The suite exercises persisted
financial values, large identifiers, headerless documents, filters, pagination,
whole-filter report totals, linked movements, mobile layout, validation, empty
results, missing documents and retry after a simulated service failure.
