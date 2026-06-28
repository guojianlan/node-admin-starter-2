# Business Module Template

This guide is the delivery checklist for every new Admin Base backend module. A module is not complete when only the page renders; it must be connected to schema, migration, seed permissions, route manifest, backend ability checks, data scope, operation logs, and tests.

Starter files live in [`templates/module-crud`](../templates/module-crud).

## 80% CRUD Generator

Use the project-local generator for ordinary CRUD modules before writing files by hand:

```bash
corepack pnpm generate:module -- --example > tmp/example.module.json
corepack pnpm generate:module -- --config tmp/example.module.json
```

The generator is intentionally conservative. It renders a draft under
`tmp/generated/modules/<module>` and leaves shared files for manual review:

- `src/server/db/schema/index.ts`
- `src/server/db/migrations.ts`
- `src/server/db/seed/default-data.ts`
- `src/router/route-manifest.ts`
- `src/server/routes/system/index.ts`

This keeps route IDs, permission grouping, migrations, and route registration explicit. After the
draft is reviewed, copy the generated backend route, feature page, app route page, and test into the
target paths, then apply the snippets in the generated README order.

Secret fields need manual handling. Use `select: false` in the generator config so the field is not
returned by the CRUD list, then add encryption, masking, and "configured" booleans in custom hooks or
explicit routes.

## Required Pieces

1. Schema: add the table to `src/server/db/schema` and export it from `src/server/db/schema/index.ts`.
2. Migration: add a non-destructive migration in `src/server/db/migrations.ts`.
3. Seed permissions: add route and action rules in `src/server/db/seed/default-data.ts`.
4. Backend route: use `createCrudRoutes` for ordinary CRUD, or explicit routes for side effects.
5. Ability checks: every protected API write and action must have a `sys_rule` permission code.
6. Operation log: every high-risk write action must be auditable.
7. Data scope: apply the shared data-scope helper when records are user-owned or department-owned.
8. Route manifest: add the frontend page route in `src/router/route-manifest.ts`.
9. App Router page: create the page under `src/app/(admin)`.
10. React feature page: build the page under `src/features`.
11. Tests: cover permissions, list filters, writes, data scope, and side effects.
12. Docs: update API docs when the module exposes non-standard actions.

## Naming

Use stable, predictable names:

| Layer | Pattern | Example |
| --- | --- | --- |
| Table | `sys_<resource>` or business prefix | `sys_example` |
| Permission prefix | `<domain>.<resource>` | `system.example` |
| Route path | `/api/system/<resource>` | `/api/system/example` |
| Frontend route | `/system/<resource>` | `/system/example` |
| Feature component | `<Resource>Page` | `ExamplePage` |

Action permissions should use the standard suffixes where possible:

```text
query
create
update
delete
batchDelete
export
import
status
publish
revoke
```

## Schema

Use the shared timestamp, soft-delete, and audit helpers unless the table is intentionally immutable:

```ts
export const sysExample = pgTable("sys_example", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  status: integer("status").notNull().default(1),
  sort: integer("sort").notNull().default(0),
  deptId: integer("dept_id").references(() => sysDept.id, { onDelete: "set null" }),
  ownerId: integer("owner_id").references(() => sysUser.id, { onDelete: "set null" }),
  isSystem: boolean("is_system").notNull().default(false),
  ...timestamps,
  ...softDelete,
  ...auditUsers,
});
```

Rules:

- Add indexes for search fields, foreign keys, and soft-delete query patterns.
- Use `is_system` when seed data must be protected.
- Store secrets encrypted and passwords/tokens hashed.
- Return secret state through booleans only.

## Migration

Migrations must be safe to run more than once where possible:

```sql
CREATE TABLE IF NOT EXISTS sys_example (...);
CREATE UNIQUE INDEX IF NOT EXISTS sys_example_code_uidx ON sys_example(code) WHERE deleted_at IS NULL;
```

Avoid destructive migrations in normal product work. If a destructive migration is unavoidable, document rollback and data migration steps in the same pull request.

## Seed Rule And Action

`sys_rule` is the permission source of truth. Add one route rule and all action rules:

```ts
{
  key: "system.example",
  type: "route",
  title: "示例模块",
  path: "/system/example",
  icon: "appstore",
  sort: 100,
  status: 1,
  isSystem: true,
}
```

Then seed action rules such as:

```text
system.example.query
system.example.create
system.example.update
system.example.delete
system.example.export
```

Run `pnpm admin:check-routes` after adding rules. The check must fail if a page has no manifest entry, a manifest permission is missing from seed rules, or a CRUD route lacks permissions.

## Backend Route

Prefer `createCrudRoutes` for ordinary modules:

```ts
export const exampleCrud = createCrudRoutes({
  basePath: "/example",
  table: sysExample,
  idColumn: sysExample.id,
  createSchema,
  updateSchema,
  permissions: { prefix: "system.example" },
  operationLog: { module: "system.example" },
  list: {
    select: {...},
    searchable: { name: "like", code: "like", status: "=" },
    quickSearchFields: ["name", "code"],
    sortableFields: ["id", "sort", "createdAt"],
    defaultSort: { field: "sort", order: "asc" },
  },
});
```

Use explicit routes instead of CRUD factory for:

- Passwords and token changes.
- OAuth redirect/callback or account binding.
- File physical operations.
- Publish/revoke workflows.
- Connection tests.
- Batch operations with special business rules.

Explicit routes must use `authRequired()`, `ability(...)`, validation, and operation log recording.

## Data Scope

Apply data scope when a module has an owner, creator, department, or business visibility rule. The default data scopes are:

- Current user.
- Current department.
- Current department and child departments.
- Custom departments.
- All data.

For business modules, provide an extension point that maps the current user's data scope to the module's ownership columns, for example `deptId`, `ownerId`, or `createdBy`.

Data-scope changes must revoke affected token snapshots when those tokens contain stale abilities or data-scope claims.

## Operation Log

Every high-risk action must be logged:

- Create, edit, delete, batch delete.
- Status changes.
- Default switches.
- Publish and revoke.
- Import/export.
- Password, token, and permission changes.
- Physical file operations.

For updates, record a changed-field summary where possible:

```ts
changedFields: [
  { field: "name", before: "Old", after: "New" },
]
```

Mask sensitive fields such as `password`, `token`, `secret`, `accessKey`, `clientSecret`, and SMTP credentials.

Risk levels:

| Level | Typical actions |
| --- | --- |
| low | low-risk saves and routine system actions |
| medium | create, update, upload, test connection |
| high | delete, batch delete, reset password, force offline, publish, permission assignment |
| critical | clear logs, force physical delete, destructive system-record attempts |

## Frontend Page

Use the existing admin UI primitives:

- `PageScaffold` for page framing.
- `AdminDataTable` for CRUD tables.
- Ant Design `Drawer` or `Modal` for secondary forms and details.
- Existing request and navigation adapters.

Required page behavior:

- Loading, empty, and error states.
- Permission-bound action buttons.
- Clear confirmation for high-risk actions.
- Query cache invalidation after writes.
- No raw JSON editing for normal administrators when a structured form is possible.

## Route Manifest

Add a manifest entry for the page:

```ts
{
  path: "/system/example",
  title: "示例模块",
  auth: "system.example.query",
}
```

Keep manifest auth aligned with seed rules. `sys_rule` remains the source of truth; the manifest only describes frontend routing and rendering.

## Tests

Minimum test coverage:

- Permission rejected without ability.
- List query with pagination and filters.
- Create/update/delete success paths.
- System-record protection when applicable.
- Data-scope isolation when applicable.
- Operation log for high-risk actions.
- Side effects such as token revocation, publish visibility, or file cleanup.

If the page changes a browser workflow, add or update smoke coverage without using `db:reset`.

## Acceptance

Run these commands before the module is considered complete:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm admin:check-routes
```

When a frontend page, route, App Router entry, or layout changes, also run:

```bash
pnpm build
```

When the module affects login, production readiness, dashboard, settings, or browser workflows, also run:

```bash
pnpm smoke
```
