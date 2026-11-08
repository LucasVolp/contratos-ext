# Shared interface foundation

The shadcn/ui preview was accepted for application adoption on 2026-11-07.
The implementation uses the `base-nova` registry with Base UI. Project-wide
requirements remain in [ui-rules.md](ui-rules.md).

## Component ownership

`apps/web/components.json` configures the official CLI. Generated, editable
primitives live in `apps/web/components/ui/`. Domain composition continues to
use `components/ui.tsx`: `PageHead`, `PageBar`, `Field`, `FormValidation`,
`Status`, `Pager`, feedback states and institution reach retain their contracts.
Field masking, caret handling and decimal validation remain unchanged.

The table primitive deliberately renders a native table without adding another
scroll container. Existing `.table-scroll` ancestors own overflow and accessible
captions. Do not reintroduce nested scrolling when regenerating this component.

Domain components keep semantic classes; utility classes belong to the shadcn
primitive sources. Generated control sizes are adjusted by the shared primitive
CSS block, including 44px minimum interactive controls. Main forms remain pages.

## Appearance

`next-themes` provides light, dark and system modes, initial theme application,
OS preference changes and synchronization across tabs. The preference is stored
under `contracts:appearance:v1`; it contains no personal data. The selector is
available both before sign-in and throughout the authenticated workspace.
`suppressHydrationWarning` is limited to the root HTML element that the theme
initializer updates before hydration.

Existing domain tokens are retained and mapped into shadcn's Tailwind theme.
In particular, legacy `--muted` remains a text color; `bg-muted` resolves to
`--tint`. Use `text-muted-foreground` for secondary text inside primitives.
All literal colors live in `:root` / `:root.dark`; charts use theme tokens too.

The base token pairs were checked using the WCAG relative-luminance formula:

| Pair                           | Light   | Dark    |
| ------------------------------ | ------- | ------- |
| Body text / paper              | 14.32:1 | 13.71:1 |
| Secondary text / paper         | 5.48:1  | 7.37:1  |
| Primary action text / fill     | 7.10:1  | 9.10:1  |
| Success text / tinted surface  | 5.26:1  | 7.05:1  |
| Warning text / warning surface | 5.36:1  | 8.03:1  |
| Error text / error surface     | 5.48:1  | 7.96:1  |
| Input boundary / paper         | 3.64:1  | 4.27:1  |

Container separator tokens are decorative; interactive fields use `--boundary`.
These token checks complement keyboard and layout verification, rather than
constituting a complete accessibility audit.

## Added runtime dependencies

- `@base-ui/react`: interaction primitives used by shadcn controls and badges.
- `class-variance-authority`: the generated button and badge variant APIs.
- `cn`: the generated shadcn class composition helper.
- `next-themes`: appearance persistence and early theme initialization.

No additional form or data-table state library is required by this migration.
Existing API access, sessions, route authorization and validation are preserved.
Preview fixtures remain isolated in `docs/prototypes`; none are imported by the
application.

## Verification

Run `pnpm --filter @contracts/web lint`, `pnpm --filter @contracts/web build`
and the Playwright suite. Appearance coverage includes navigation, reload,
cross-tab updates, OS theme changes, login and 360px/390px/1440px layouts.
Existing suites cover form validation, exact decimal values, draft readiness,
DOCX/PDF generation, consultations, financial scopes and retries.
