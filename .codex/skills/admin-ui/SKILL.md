---
name: admin-ui
description: Build and refine Admin Base pages with the repository's Ant Design, shared shell, page scaffold, CRUD components, URL state, permission, responsive layout, and theme conventions. Use when creating a frontend business page, CRUD table, form, detail drawer, operational work surface, dashboard panel, navigation behavior, or fixing layout, scrolling, light-theme, or dark-theme UI issues.
---

# Admin UI

Use `AGENTS.md`, `docs/admin-ui-ux-system.md`, and the closest existing production page. Preserve
the existing visual language unless the user explicitly requests a redesign.

## Workflow

1. Inspect the shell, shared page/table/form components, route manifest, permission code, page test
   case, and the same page in light and dark theme styles.
2. Identify the user role, repeated workflow, primary action, information hierarchy, loading/empty/
   error states, and narrow-screen behavior.
3. Choose the shared page pattern before writing page-local layout code.
4. Implement stable dimensions, local scrolling, permission states, and URL-persisted list state.
5. Update the page test inventory with data, interaction, permission, desktop, narrow, light, and
   dark acceptance criteria.
6. Run `$admin-qa` with the smallest complete scope.

## Page Patterns

- Use `PageScaffold` for every admin work surface.
- Use `AdminDataTable`, `AdminSearchForm`, `AdminEntityForm`, and `AdminFieldRenderer` for standard
  CRUD. Extend shared behavior only when multiple pages need the same capability.
- Keep `src/app/**/page.tsx` as a thin shell and real page code under `src/features/**`.
- Use `src/platform/navigation.ts` and `src/lib/request.ts`; keep feature pages portable.
- Use `AuthButton` for action visibility and rely on server-side permission enforcement.

## Layout Rules

- Let primary content fill the available workspace. Apply reading-width limits only to prose or
  narrow forms that genuinely benefit from them.
- Give tables, trees, chats, split panes, toolbars, and action footers stable responsive dimensions.
- Keep header and footer actions reachable; scroll the middle work area locally when appropriate.
- Allow complex tables to scroll inside their container. Preserve key identity and action columns.
- Empty tables must retain the containing surface and bottom boundary without decorative vertical
  lines or collapsed height.
- Do not place cards inside cards or style every section as a floating card.

## Visual Rules

- Use Ant Design components, Lucide or the installed icon library, and shared theme tokens.
- Do not add page-local `ConfigProvider`, shell `Layout`, `Menu`, or independent theme systems.
- Avoid hard-coded white backgrounds, black text, and fixed light-only borders.
- Keep compact admin headings and controls proportional to their containers.
- Keep text legible without overlap or viewport-width font scaling.
- Verify hover, selected, disabled, focus, error, and destructive states in light and dark themes.

## Interaction Rules

- Persist table filters, pagination, and sorting in URL state through shared components.
- Preserve form input after validation or network failure and prevent duplicate submission.
- Provide explicit loading, empty, error, retry, and permission-denied states.
- Use drawers or modals for focused editing/details when they preserve context; use a full page for
  long, navigable, or multi-section work.
- Do not add visible tutorial copy describing controls that should be self-evident.

## Completion Gate

The page is complete only when real data, empty data, API failure, missing action permission,
narrow viewport, light theme, and dark theme have defined outcomes and the page remains usable.
