# Management dashboard implementation plan

## Approved scope

Apply the approved React preview to the authenticated home page. Keep the
continuous green financial, contractual and process panorama, compact filters,
and independent scrolling for the attention queue and notifications. The page
itself must not scroll at the validated desktop and mobile viewports. Do not add
route links inside dashboard content.

The user authorized mock data while the process, notification and signature
workflows await broader design. This delivery preserves the approved local
demonstration, explicitly marked as fictional; it does not consult sources or
write signature/notification state to a backend. Fixture scope selectors must
identify their illustrative nature and never imply account access.

## Implementation

- [ ] Add Playwright coverage for the home page, explicit demonstration notice,
  scoped fixtures, local signature simulation, notification read state, empty
  queues, reset on reload and no domain mutations. Run before implementation
  and confirm that the home page still redirects instead of showing the panel.
- [ ] Move the approved view into focused `components/dashboard/` components,
  using existing shared primitives, decimal formatting, theme tokens and
  accessible scroll regions. Keep demo data in a dedicated module.
- [ ] Mount the component from `app/page.tsx`; add a home navigation entry,
  update the brand link and default login destination, and isolate viewport
  sizing to the dashboard workspace. Keep all other route layouts unchanged.
- [ ] Verify all three appearance modes at 360, 390, 1366 and 1440 widths,
  scroll confinement, keyboard use and action visibility; verify that leaving
  the dashboard restores document scrolling. Run web lint, web build and
  relevant Playwright specs, then review the diff.

## Review focus

- Demonstration content must never look like current institutional data.
- Session loading, retry and access behavior stay in the existing session gate.
- A real signature must never be inferred from a simulated action.
- Fixed-height sizing must not leak to finance, contracts or document editors.
- Scroll containers must stay keyboard accessible and keep primary actions
  reachable, including after expanding a document review.

## Execution notes

User approval to apply the preview covers implementation; execute inline without
another design approval. Preserve unrelated ETL and briefing edits. No runtime
dependency, backend schema, external communication or deployment is required.
