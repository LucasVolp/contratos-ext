# UI rules — mandatory for every contributor and agent

These rules are binding for any change under `apps/web`. They complement, and
take precedence over, the visual direction notes in
[`interface-direction.md`](interface-direction.md) and
[`catalog-interface-direction.md`](catalog-interface-direction.md) whenever they
conflict. "MUST" and "MUST NOT" are hard requirements: a change that breaks one
is not done. "SHOULD" requires a written reason to deviate (in the PR or commit).

---

## 1. Product foundation

This is a **public-management tool for Brazilian government institutions**
(federal institutes, universities, management units/UASGs). Its users are civil
servants who consult public records and prepare official documents (contracts,
atas de registro de preços, procurement records, financial consultations) that
carry legal and audit consequences.

Every screen MUST serve three natures of the product:

| Nature                           | What it means in the UI                                                                                                                                                                                                                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Affirmative**                  | The interface states facts plainly and with certainty: what a record is, what state it is in, what is missing, what to do next. Status labels are declarative (`Pronta para exportar`, `Preenchimento pendente`), never vague (`Talvez`, `Verificar`). It affirms **only what was verified**: unknown stays unknown. |
| **Consultative**                 | Public data is consulted, not invented. Every consulted value shows its origin and when it was consulted. Consultation is an explicit user action; failures keep the last saved data and offer a retry. Read-first layouts: the record is legible before it is editable.                                             |
| **Dynamic document elaboration** | Documents are built progressively: prefilled from consulted data, saved as drafts at any point, validated live, with a visible list of pending items before export. The path _consult → prepare → complete → export_ is always visible and never blocked by optional data.                                           |

### 1.1 Public-sector obligations

- **Accessibility is a legal duty** (Lei Brasileira de Inclusão, Lei 13.146/2015;
  eMAG). Target WCAG 2.2 AA. See §5.
- **Plain language** (linguagem simples): short sentences, active voice, domain
  terms the servant already uses (empenho, UASG, pregão, ata, vigência, natureza
  de despesa). No technical jargon (Prisma, DTO, snapshot, banco, API, ID
  interno) in user-facing copy.
- **Personal data (LGPD)**: CPF and other personal identifiers MUST be masked
  with `maskDocument` from `@contracts/validation` unless the user's role
  requires the full value. Never log or render personal data in error messages.
- **Traceability**: anything that affects a document (consulted data, edits,
  exports) SHOULD show date, origin and, when available, author. Never silently
  overwrite user-entered document content with consulted data.
- **Sobriety**: institutional, calm tone. No emoji, exclamation marks, marketing
  copy, gamification, confetti or playful empty states.
- **Independent identity**: MUST NOT copy logos, shells or themes from gov.br,
  SAGA, DIRAD or other official systems. Use this project's own identity.

### 1.2 Data honesty (non-negotiable)

- MUST NOT show demo, placeholder or fabricated data as a fallback for a failure.
- Null or missing values render as `Não informado`; not-yet-consulted values as
  `Não consultado`. Never as `0`, `—` that reads as zero, or "não há".
- Monetary and decimal values arrive as strings and MUST be formatted with
  `formatDecimal` / parsed with `parseDecimal` from `@contracts/validation`.
  MUST NOT convert them to JavaScript `Number`.
- Identifiers (CNPJ, UASG, process numbers, commitment numbers) stay strings.
- MUST NOT compute totals from the visible page of a paginated list; totals come
  from the API.

---

## 2. Code structure

### 2.1 Pages are thin

- Files in `app/**/page.tsx` only resolve route params (Promise in Next 16),
  read session/access and mount components. No business logic, no fetch
  orchestration, no markup beyond composition.
- Before using any Next.js API, read the matching guide in
  `apps/web/node_modules/next/dist/docs/` (see `apps/web/AGENTS.md`).

### 2.2 Reuse before you create

Before writing a new component, search for an existing one. Shared domain
primitives live in `components/ui.tsx` and MUST be used for their purpose. They compose shadcn/ui primitives from `components/ui/`:

| Need                      | Use                                         |
| ------------------------- | ------------------------------------------- |
| Record or form header     | `PageHead`                                  |
| Listing top bar           | `PageBar`                                   |
| Labelled input with error | `Field` + `FormValidation` / `focusInvalid` |
| Record status             | `Status`                                    |
| Pagination                | `Pager`                                     |
| Loading / failure / empty | `Loading`, `ErrorState`, `Empty`            |
| Institution scope         | `ReachContext`, `ReachSelect`               |

Rules:

- A UI pattern used by **two or more domains** (contracts, catalog, finance,
  admin) MUST live in a shared module (`components/ui.tsx` or a new file under
  `components/ui/`), not be duplicated per domain. When you touch a duplicated
  pattern (e.g. a domain-specific pager or table that mirrors a shared one),
  consolidate it instead of adding a third copy.
- Domain components live in `components/<domain>/`. API access lives in
  `lib/*-api.ts`; components MUST NOT call `fetch` directly.
- Formatting, masking and validation come from `@contracts/validation`. MUST NOT
  reimplement CPF/CNPJ/UASG/date/decimal logic in the web app.

### 2.3 Component hygiene

- One responsibility per component. A component that renders a list, its
  filters and its detail is three components.
- New component files MUST stay under **250 lines**. Existing files over 300
  lines SHOULD be split when you make a substantial change to them.
- Props are typed explicitly; no `any`. Prefer narrow props over passing whole
  API payloads down several levels.
- Add `"use client"` only to the smallest leaf that needs state, effects or
  browser APIs. Server components are the default.
- Code identifiers, comments and tests in English; user-facing copy in pt-BR
  (see root `AGENTS.md`).
- No dead code, commented-out blocks or unused exports left behind.

---

## 3. Styling

- The shared component foundation is **shadcn/ui with Base UI**, adopted on
  2026-11-07 after visual review. Component sources live in `components/ui/`;
  configuration lives in `components.json`. Reuse these before adding primitives.
- Domain layouts use **semantic classes** in `app/globals.css`. Generated shadcn
  primitives may use Tailwind utilities, isolated inside `components/ui/`.
  All colors resolve through semantic tokens in `:root` and `:root.dark`.
  Existing domain tokens (`--canvas`, `--paper`, `--ink`, `--muted`, `--line`,
  `--green`, `--accent`, `--tint`, `--danger`) map to the shared theme.
- MUST NOT hardcode colors outside `:root`. A new color needs a new token with a
  verified contrast ratio.
- MUST reuse existing classes before creating new ones: `button`,
  `button secondary`, `field`, `form-grid`, `form-section`, `table-scroll`,
  `detail-section`, `section-heading`, `eyebrow`, `muted`, `empty`, `sr-only`.
- New CSS goes in a block headed by a comment naming the component it serves.
  No styles for components that no longer exist.
- MUST NOT use inline `style={{}}` except for genuinely dynamic values (e.g. a
  computed width). Domain components MUST NOT mix Tailwind utility classes with
  semantic layout classes. Shadcn primitive internals are the explicit exception.
- Typography: DM Sans for interface titles, controls and body, as approved in
  the shadcn preview. Fraunces may be used for document-oriented typography.
  Fonts are loaded locally from `public/fonts`. No runtime font CDNs.
- Both light and dark modes MUST be supported. Offer `Claro`, `Escuro` and
  `Sistema`, persist the preference, follow OS changes in system mode and apply
  the theme before first paint. Test every new state in both modes.
- Shape: 8px maximum radius on containers, no generic drop shadows, no
  gradients. Hierarchy comes from spacing, rules (lines) and type.
- Numbers in tables and figures use `font-variant-numeric: tabular-nums`.
- Motion is functional only (state feedback, ≤ 200ms) and MUST respect
  `prefers-reduced-motion`.

---

## 4. Small screens (mobile)

Every screen MUST be fully usable at **360px** width. Design the narrow layout
first, then widen.

- No horizontal scroll of the page at 360px. Wide tables scroll inside
  `.table-scroll` (positioned ancestor for `sr-only` labels) or collapse into
  stacked rows that keep every field.
- Reuse the existing breakpoints only: `700px` (phone), `950px` (tablet),
  `1100px` / `1200px` (narrow desktop). Do not invent new ones without reason.
- Essential actions (save, export, consult, retry) MUST remain visible and
  reachable on mobile. MUST NOT hide them behind hover, invisible menus or
  desktop-only toolbars. Long forms keep the sticky save/back bar.
- Touch targets MUST be at least 44×44px on touch layouts.
- Form fields stack to one column under 700px. Labels stay visible above inputs;
  no placeholder-as-label.
- Long identifiers (process numbers, CNPJ, e-mails) MUST wrap or truncate with
  the full value accessible; they never push the layout wider.
- Navigation stays visible as a compact top bar; no oversized drawers.

---

## 5. Accessibility

- Every input has a visible `<label>`; errors are shown next to the field and
  summarized, and focus moves to the first invalid field (`focusInvalid`).
- Results of user actions are announced with `aria-live`.
- Visible focus on every interactive element; the skip-link is preserved.
- Full keyboard operability. Native elements first (`button`, `a`, `select`,
  `dialog`); ARIA only when no native element fits.
- Text contrast ≥ 4.5:1 (≥ 3:1 for large text and UI boundaries).
- Status is never conveyed by color alone: dot + text.
- MUST NOT use modals for primary forms or flows; each form has its own page.
  Destructive confirmation may use a native accessible `dialog`.
- Searches have an exact accessible label (`Buscar contratos`, `Buscar atas`, …);
  E2E tests depend on them.

---

## 6. States and feedback

Every data-driven view MUST implement all four states:

1. **Loading** — `Loading`, sized to avoid layout shift.
2. **Failure** — `ErrorState` with a clear pt-BR message and a retry. Previously
   loaded data stays on screen.
3. **Empty** — `Empty` with the next useful action (register, import, consult).
4. **Content.**

Plus:

- Consultation results distinguish _failure_, _last saved data_ and _confirmed
  absence_.
- Draft saving never requires fields that are only mandatory for export.
- Export actions use the exact labels `Baixar DOCX` and `Baixar PDF` and list
  pending items when the document is not ready.

---

## 7. Performance

- Server components by default; minimal client bundles.
- MUST NOT add a runtime dependency without stating why in the PR/commit. Icons
  come only from `lucide-react`. Domain class composition uses `clsx`; shadcn
  primitives may use their generated `cn` helper and `class-variance-authority`.
- Pagination and filtering happen on the server (SQL). Filters and page live in
  the URL so views are shareable and restorable.
- Client requests use `AbortController`; stale responses are never rendered
  under new filters.
- No external network calls on page load; external public-data consultation is
  always a user action routed through the API.
- Avoid layout shift: reserve space for async content and tables.

---

## 8. Definition of done (UI changes)

A UI change is complete only when all of these hold:

- [ ] Uses shared shadcn/domain primitives and tokens; no duplicated component
      or hardcoded color introduced. Light, dark and system modes verified.
- [ ] Works at 360px and 1440px without page-level horizontal scroll; essential
      actions visible on both.
- [ ] Loading, failure (with retry), empty and content states implemented.
- [ ] Keyboard navigation and visible focus verified; labels and `aria-live`
      in place.
- [ ] No fabricated data; nulls and unknowns rendered as specified in §1.2.
- [ ] Copy in pt-BR, plain language, no technical jargon.
- [ ] `pnpm --filter @contracts/web lint` and `pnpm --filter @contracts/web build`
      pass.
- [ ] Relevant Playwright specs pass (`pnpm test:e2e`); new flows add a spec,
      including a 390px viewport check when layout is affected.
