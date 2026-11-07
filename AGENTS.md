# Project conventions

Use English for all new technical artifacts: database schemas, tables, columns,
constraints, indexes, enum/status values, code identifiers, comments, tests, and
technical documentation. This is an explicit user preference, recorded on
2026-11-05. Preserve Portuguese user-facing product copy and respond in the
language used by the user unless asked otherwise.

# UI rules (mandatory)

Any change under `apps/web` MUST follow [`docs/ui-rules.md`](docs/ui-rules.md).
Read it before touching UI code. Non-negotiable summary:

- This is a public-management tool for Brazilian government institutions. The
  UI is affirmative (states verified facts plainly), consultative (public data
  is consulted with origin and date, never invented) and supports dynamic
  document elaboration (prefill, drafts, live validation, pending items, export).
- Reuse shared primitives (`components/ui.tsx`) and `@contracts/validation`
  before creating anything; patterns used by two domains become shared.
- Semantic classes on `:root` tokens in `app/globals.css`; no hardcoded colors.
- Fully usable at 360px width, no page-level horizontal scroll, essential
  actions always visible.
- WCAG 2.2 AA, plain pt-BR copy, LGPD-aware masking, no fabricated data.
- Thin pages, small single-purpose components, server components by default.
- A UI change is done only when the checklist in `docs/ui-rules.md` §8 passes.
