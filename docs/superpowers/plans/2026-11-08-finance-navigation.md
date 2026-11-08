# Financial navigation implementation plan

**Goal:** Unify expense execution, integrate paid payables beside current payments, default the element navigator to collapsed, and preserve the financial content position during navigation and pagination.

**Architecture:** Keep one execution workspace for overview and element details. Reuse the existing query scope isolation, domain tables and sidebar preference hook. A shared financial content region reserves its observed height and provides a short opacity transition that respects reduced motion.

**Constraints:** Follow `docs/ui-rules.md`; preserve pt-BR product copy, English identifiers, exact source amounts, unknown values, abortable requests, accessible controls and existing user changes. No new dependencies.

**Source semantics:** R.P. is `priorYearPaidValue`, reflecting the user’s updated emphasis on paid payables. Show registered and canceled values in expandable detail. Daily subelement data does not expose registered payables; do not substitute unrelated figures.

## Tasks

- [ ] Update browser tests to specify a unified workspace, closed default navigator, registered payables and stable content geometry. Observe the new regression fail.
- [ ] Remove view tabs and obsolete view branching; keep old view URLs usable. Preserve one canvas width and origin for overview and element detail.
- [ ] Default only the financial navigator to collapsed while preserving explicit saved preferences and the main navigation's behavior.
- [ ] Add paid R.P. to execution totals and element rows; retain registered and canceled payables as accessible details with explicit labels.
- [ ] Add the shared stable content region and use it for financial result transitions. Retain previously loaded pages only within identical filters; preserve cancellation and retry behavior.
- [ ] Run web lint/build, financial browser tests, and relevant existing tests. Review desktop/mobile, themes, reduced motion, delayed requests, failures and scoped-data isolation.

## Review focus

- Saved expanded/collapsed preferences and unavailable storage.
- Legacy `view=overview`, `view=explore`, `view=payables` URLs.
- Null payables and the daily/monthly source boundary.
- Short final pages and delayed or failed pagination responses.
- Narrow screens, keyboard focus and reduced-motion settings.
