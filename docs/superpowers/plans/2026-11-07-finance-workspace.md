# Finance workspace implementation plan

Approved reference: local finance preview revision D, with grouped accounting-stage
bars in the general view and hierarchical exploration. Implement inline in the
current authorized workspace; no API, migration, ETL, deployment or commit work.

## Constraints and decisions

- Preserve all authoritative server summaries, exact decimal strings, access
  scope, fiscal-year filters, cancellation signs and unavailable values.
- Replace monthly trends, unit rankings and metric-card grids with compact totals,
  a general view, an element navigator, breadcrumbs and a readable expense ledger.
- Current execution reports aggregate by six-digit nature, not subelement. Do not
  derive daily QDD totals by fetching/summing commitment pages in the browser.
- The API has no purpose classification or verified daily coverage. Offer the
  approved purpose views with explicit unavailable states. Never assign purpose
  from UASG or label institutional totals as Reitoria-only expenditure.
- The available-data scope remains usable. Element exploration links to existing
  filtered commitments; subelement consolidation remains an explicit pending state.
- Keep previous-year payables separate. Keep institutional LOA and commitments.
- Layout/view/element/purpose/search state belongs in the URL; presentation fields
  must never be forwarded as API filters. All API work stays in lib/finance-api.ts.
- New component files stay below 250 lines; use shared controls and theme tokens.

## Tasks

1. Rewrite the obsolete trend/ranking expectations and add browser regressions for
   general/explorer views, full-scope totals, saved element context, purpose and
   daily-coverage honesty, negative/null amounts, failures, retries and mobile.
   Add the chart-coordinate padding regression. Run and record RED.
2. Add an element-only breakdown loader using complete server-side nature summaries.
   Reuse cancellation and bounded concurrency. Stop fetching monthly/unit charts.
   Keep presentation URL state separate from allowed API parameters.
3. Implement the production workspace in small components: orchestrator, controls,
   compact totals, purpose/mode navigation, element navigator/ledger, source status,
   current capability notice and separate prior-year-payables view.
4. Implement grouped overview and explorer comparison charts with Recharts/shadcn
   primitives. Convert only bounded chart ratios to Number; retain exact values
   for labels, ledgers and tooltips. Null amounts must not become zeros; negative
   movements remain signed. Explain unavailable comparative balances when needed.
5. Add scoped semantic styles for both themes, 360/390/1440px, visible focus,
   keyboard drill-down and no page-level overflow. Remove unused execution-only
   chart code and its obsolete styles without affecting budget charts.
6. Run web lint/build and complete Playwright suite, inspect the real browser,
   then request an independent read-only review and resolve material findings.

## Review focus

- Missing paid totals must remain unavailable, including in charts and tooltips.
- Partial month counts must not be described as complete daily extraction.
- Query changes and delayed responses must not render values for another scope.
- Switching general/explorer views must preserve the selected element in the URL.
- Purpose views must never reuse unclassified totals under a classified heading.

## Implementation record

- Added Recharts for responsive grouped columns, signed axes, accessible chart
  navigation and exact-source tooltips. Only bounded screen coordinates use
  JavaScript numbers; financial strings remain exact in summaries and ledgers.
- Element discovery reads every report page, then requests each authoritative
  element summary with bounded concurrency. Monthly and unit breakdown queries
  were removed. No API contracts or source extraction behavior changed.
- The existing execution orchestrator composes focused leaves. The expense
  navigator retains the selected element and reading mode in the URL.
- Purpose classification, daily coverage and consolidated subelements are explicit
  unavailable states pending the next data stage. Current unit filters remain
  available without asserting that executing unit determines expense purpose.
- RED: the approved-workspace test failed against the old heading; decimal-padding
  regression failed with null coordinates. GREEN: financial browser suite passed
  after implementation. Failure/retry coverage also caught duplicate alerts;
  primary report failures now suppress the redundant breakdown failure alert.
- Independent review identified a stacked-chart legend mismatch. The legend now
  describes the actual plotted balances and uses their matching semantic colors.
- Final verification: web lint and production build passed. Lint retains three
  pre-existing internal-navigation warnings outside this change. All 46 Playwright
  tests passed, including 12 financial checks. Browser checks cover light, dark
  and system appearance at 360/390/1440px, source disclosure, purpose notices,
  payables, keyboard navigation, retries and stale-response cancellation.
- The real development app at port 3101 rendered authoritative totals without
  request errors or page overflow. Preview files remain ignored by Git.

## Follow-up: bounded exploration and collapsible navigation

- Element navigation has a bounded scroll region, explicit scroll instruction,
  element count, visible directional controls and end-of-list feedback. Searching
  a short result set removes unnecessary scroll cues.
- Ruling: six-element presentation pages reuse the complete classification index
  already loaded for navigation, preserving the user's UI-only scope. This is a
  presentation-only exception to server pagination; financial amounts remain
  authoritative complete summaries. All new document and source-record pages
  are paginated by the existing server endpoints, five records at a time.
- Selecting an element now offers inline document evidence with source subitem
  codes, descriptions and exact current-item/liquidation/payment values. These
  records are explicitly separate from a consolidated annual QDD. The source
  documents cover the selected fiscal year/unit, independent of monthly filters.
- Source selection and pages persist in the URL and reset on financial scope
  changes. Panel refresh propagates to the document and source-record queries.
- Both sidebars collapse independently. The main desktop rail retains named links
  and account actions; mobile navigation can be expanded from its visible toggle.
  The financial rail preserves the selected detail. Separate browser preferences
  persist across reloads; toggle focus and accessible names remain available.
- Verification: new navigation/subitem and collapse tests failed against the
  preceding build, then passed after implementation. Web lint/build and all 48
  Playwright tests pass, including 14 financial tests. Manual browser checks
  confirm expanded/collapsed dark states at 360/1440px without page overflow.
- Independent follow-up review has no remaining material findings. Three existing
  internal-navigation lint warnings remain outside this task's behavior changes.

## Approved follow-up: composition, top five and daily consolidation

- The user approved a disjoint execution donut and a top-five list defaulting to
  committed value, with liquidated/paid switching. Ranking stage persists in the
  URL and sorting keeps arbitrary decimal precision. Donuts show paid, liquidated
  awaiting payment and committed awaiting liquidation only for valid known balances.
- The user subsequently authorized API changes for consolidated subelement spending.
  Added read-only `/api/finance/subelements` with independent daily-source aggregation,
  strict null propagation, signed values, full-scope summaries, paginated details,
  and a bounded server-computed chart. No schema or extraction changes were needed.
- Daily spending is the primary element detail; document evidence is secondary.
  Coverage remains unverified and daily/monthly sources stay separate. The report
  contract documents current-item/issue-date semantics and excluded RP/extra-budget
  fields. Stage and page changes never sum visible records in the browser.
- Independent review caught a negative subelement hidden inside a positive net
  remainder. A regression now checks this case; full-scope `chartEligible` prevents
  such an invalid donut. Another existing integration check assumed nine migrations;
  it now verifies the exact applied migration names against the actual source files.
- Local API runs on port 4101; the existing web development server on port 3101 was
  restarted against it so the new endpoint is usable in the application.

## Final visual adjustment

- User feedback removed the duplicate daily totals strip and replaced the large
  subelement donut with compact horizontal bars. The overall execution donut and
  switchable top-five list remain. Method details are available on demand; source
  and coverage remain visible. Signed bars retain negative/null amounts faithfully.
- A mobile regression exposed an existing width transition on the navigator's
  collapse button while the picker appeared. Scoped color-only button transitions
  eliminate the temporary overflow. Tests retain layout diagnostics for future
  responsive regressions.
- Final compact UI: web build/lint and all 16 finance browser tests passed.
  Earlier complete suite passed all 50 tests. API unit/production suites passed
  81 and 2 tests; all 12 finance integration tests passed after the safety fix.
  Manual checks cover 360/390/1440px in light/dark modes, including method disclosure.
  Independent final review has no remaining material findings.
