# Admin Base Repository Contract

This file is the authoritative contract for coding agents working in this repository. Keep it
short and enforceable. Detailed workflows live in `docs/ai-development-guide.md` and the
project-owned skills under `.codex/skills/`.

## Read First

Before changing framework or business code, read:

- `docs/admin-base-architecture.md`
- `docs/ai-development-guide.md`
- `docs/business-module-template.md` for module work
- The closest existing feature, route, schema, seed, and test implementation

Inspect `git status` before editing. Preserve unrelated user changes and generated acceptance
artifacts. Do not reset, clean, force-push, or rewrite work you did not create.

## Architecture Boundaries

- Keep the application PostgreSQL-first. Drizzle schema and project migrations define the
  database contract.
- Keep Next.js and Hono in one application. Do not add a second backend service for ordinary
  modules.
- Keep `src/app/**/page.tsx` as a thin route shell. Put business pages in `src/features/**`.
- Business pages must not import `next/navigation`, `next/link`, Server Actions, `cookies()`, or
  `headers()` directly. Use `src/platform/navigation.ts` and `src/lib/request.ts`.
- Treat `sys_rule` as the source of truth for menus and permissions. The route manifest only
  binds frontend routes to permission codes.
- Prefer existing shared components and services over new parallel abstractions.

## Choose The Correct Backend Pattern

Use `createCrudRoutes(...)` for ordinary relational CRUD when behavior can be expressed with:

- Drizzle table objects and Zod create/update schemas
- list selection, search, sort, joins, and soft delete
- declared data scope
- transaction-aware hooks
- supported standard create/update/delete/status/restore actions

Use explicit route/service code for authentication, passwords, tokens, OAuth, AI streaming,
external Provider calls, file bytes and physical deletion, publish/revoke workflows, connection
tests, multi-record state machines, or any operation with non-database side effects.

Do not force complex workflows into CRUD hooks. Do not introduce Repository/DAO layers unless a
real cross-route abstraction already exists and removes measurable duplication.

## Permissions, Scope, And Audit

- Every protected API must use server-side `authRequired()` and `ability(code)` as appropriate.
- Permission codes follow `<domain>.<resource>.<action>` and must exist in `sys_rule` seed data.
- Frontend action visibility uses `AuthButton`, but frontend hiding never replaces API checks.
- Every new record type must explicitly classify visibility as global system data,
  department-owned, user-owned, department-and-user-owned, or custom business scope. Omission is
  an incomplete module contract; never silently default user-generated business data to global.
- Department-owned data persists `deptId`; user-owned data persists `ownerId`. Set ownership on the
  server during create, declare the matching CRUD `dataScope`, protect explicit routes separately,
  and test cross-department reads and writes. `createdBy` is audit evidence, not a substitute for
  business ownership. Global modules must state why `dataScope: false` is intentional.
- Every material mutation must write `sys_operation_log`. High-risk actions must include an
  appropriate risk level and useful, sanitized details.
- Passwords, tokens, secrets, access keys, client secrets, and SMTP credentials must be hashed,
  encrypted, omitted, or masked. Never return stored secrets from an API or write them to logs.

## Frontend Contract

- Use `PageScaffold` for admin pages.
- Prefer `AdminDataTable`, `AdminSearchForm`, `AdminEntityForm`, and `AdminFieldRenderer` for CRUD.
- Use Ant Design and the shared theme. Do not create page-local `ConfigProvider`, `Layout.Sider`,
  `Layout.Header`, or `Menu` instances.
- Keep filtering, pagination, and sorting in URL state when the shared table supports it.
- Use stable content heights and local scroll containers for work surfaces. Do not let tables,
  chats, or tree panels grow the whole shell unexpectedly.
- Support loading, empty, error, disabled, and permission-denied states. Verify light and dark
  themes for any new hard-coded visual surface.

## Generated Code

- The module generator is appropriate for standard CRUD drafts. Automatic publish currently
  supports `domain: "system"` only.
- Review the generated draft and diff before applying or publishing it.
- Generated files are a starting implementation, not permission to overwrite handwritten code.
- Do not publish a draft when the user requested only analysis, planning, or preview.
- `schemas/admin-module.schema.json` is the shared CLI/Web/Coding Agent contract. Keep it synchronized
  with `src/shared/module-generator-contract.ts` by running `pnpm generate:module-schema`.
- Keep module names kebab-case and `query` enabled. Respect the capabilities declaration: the
  generated page directly supports query/create/update/delete; batch delete, restore, force delete,
  and status APIs require explicit UI work, and delete-family APIs share the delete ability.
- Regenerate drafts that predate the current contract instead of manually reconstructing missing
  snippets.
- Relationship-heavy, tree, workflow, master-detail, and non-system-domain modules still require
  explicit design and manual extensions until their capabilities and domain registry are available.
- Published source is repository-owned. Regeneration is diff-only; rollback must refuse files that
  were manually changed after publication.

## Tests And Validation

Register every API operation in `tests/coverage/api-test-cases.ts` and every App Router page in
`tests/coverage/page-test-cases.ts`. Regenerate derived documents with `pnpm test:docs`.

Use the smallest fitting verification while iterating:

```bash
pnpm admin:verify --quick
pnpm admin:verify --module <module-name>
pnpm admin:verify --full
pnpm admin:verify --full --smoke
```

Use `--smoke` only when a suitable application is running and smoke credentials point to a safe
environment. Browser and external-provider tests are required only when the task or risk demands
them; report any environment boundary honestly.

## Data And Git Safety

- Never run `pnpm db:reset` as part of ordinary implementation or verification.
- Never run destructive E2E against a normal development, shared, staging, or production database.
- Do not expose `.env` values, cookies, bearer tokens, Provider secrets, or production data.
- Do not commit or push unless the user asks. When asked, stage only the intended package and
  preserve unrelated dirty-worktree changes.
