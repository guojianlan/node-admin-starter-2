# Business Module Template

This guide is the delivery checklist for every new Admin Base backend module. A module is not complete when only the page renders; it must be connected to schema, migration, seed permissions, route manifest, backend ability checks, data scope, operation logs, and tests.

Starter files live in [`templates/module-crud`](../templates/module-crud).

## 80% CRUD Generator

Use the project-local generator for ordinary CRUD modules before writing files by hand:

```bash
corepack pnpm generate:module -- --example > tmp/example.module.json
corepack pnpm generate:module -- --config tmp/example.module.json
```

The same draft-generation flow is available in the admin UI at `/system/module/generator`. The Web page opens a generation window, writes the draft to `generated/module-drafts/<module>`, previews generated files, and tracks whether the module is still a draft or has been published. Production environments reject generation, source diff preview, publish, and rollback requests.

CLI, Web, and Coding Agent inputs share [`schemas/admin-module.schema.json`](../schemas/admin-module.schema.json), generated from `src/shared/module-generator-contract.ts`. After changing the contract, run:

```bash
corepack pnpm generate:module-schema
```

The generator is intentionally conservative. It renders a draft under
`generated/module-drafts/<module>`. Before publish, the Web UI builds a deterministic plan with a
plan hash and per-file before/after diff. The framework applies that plan in an isolated project
copy and runs module verification. Only a successful preflight can write the generated schema,
migration, seed rule, route manifest, route registration, feature page, App Router page, backend
route, machine-readable test cases, and API test into the real project.

- `src/server/db/schema/index.ts`
- `src/server/db/migrations.ts`
- `src/server/db/seed/default-data.ts`
- `src/router/route-manifest.ts`
- `src/server/routes/system/index.ts`
- `tests/coverage/generated-module-test-cases.ts`

Each successful publish stores rollback metadata inside the ignored draft directory. Source files
become repository-owned after publication. Regeneration cannot silently overwrite different files,
and rollback refuses files changed by a developer after publication. Source rollback does not
reverse database migrations that have already run. Source publication and rollback share one
filesystem lock so two modules cannot concurrently rewrite the common schema, migration, seed,
route-manifest, and test-inventory files.

The shared contract is strict: module names use kebab-case, `query` is mandatory, field names and
database columns must be unique, generated system fields are reserved, `status` requires an integer
status field, and `restore` requires soft delete. Delete-family routes (`batchDelete`, `restore`,
`forceDelete`) share the `<permission>.delete` ability. The generated table page has built-in UI for
query/create/update/delete; batch delete, restore, force delete, and status routes require a module-
specific UI extension. These limits are also returned by the capabilities endpoint.

Drafts created before the current contract may not contain machine-readable API/page acceptance
snippets. The diff endpoint rejects those drafts with a clear version error; regenerate them before
publication instead of manually filling only the missing files.

Automatic publish currently supports `domain: "system"` only. This matches the mounted backend route
tree (`/api/system/*`) and avoids generating unreachable business-domain APIs. For example, a CMS
configuration CRUD module should be generated as a system-admin page:

```json
{
  "name": "cms-config",
  "title": "CMS 配置",
  "description": "维护 CMS 业务配置",
  "domain": "system",
  "frontendPath": "/system/cms/config",
  "backendBasePath": "/cms/config",
  "parentId": 180,
  "parentKey": "system.settingsGroup",
  "fields": [
    { "name": "name", "label": "名称", "type": "text", "required": true, "search": true },
    {
      "name": "code",
      "label": "编码",
      "type": "text",
      "required": true,
      "unique": true,
      "search": true
    },
    { "name": "value", "label": "配置值", "type": "textarea", "required": true },
    {
      "name": "status",
      "label": "状态",
      "type": "integer",
      "valueType": "select",
      "required": true,
      "default": 1
    }
  ]
}
```

This produces `/system/cms/config` and `/api/system/cms/config`. A future real CMS backend domain such
as `/api/cms/*` needs a domain mount contract first, then the generator can safely publish
`domain: "cms"` modules.

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
12. Test manifests: register every API operation in `tests/coverage/api-test-cases.ts` and every page in `tests/coverage/page-test-cases.ts`.
13. Docs: update API docs when the module exposes non-standard actions, then run `pnpm test:docs` to regenerate acceptance documents.

## Naming

Use stable, predictable names:

| Layer             | Pattern                             | Example               |
| ----------------- | ----------------------------------- | --------------------- |
| Table             | `sys_<resource>` or business prefix | `sys_example`         |
| Permission prefix | `<domain>.<resource>`               | `system.example`      |
| Route path        | `/api/system/<resource>`            | `/api/system/example` |
| Frontend route    | `/system/<resource>`                | `/system/example`     |
| Feature component | `<Resource>Page`                    | `ExamplePage`         |

Action permissions should use the standard suffixes where possible:

```text
query
create
update
delete
export
import
status
publish
revoke
```

For CRUD Factory routes, batch delete, restore, and force delete use the `delete` ability rather than
creating separate authorization semantics. Custom business actions still require their own explicit
permission.

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
  dataScope: {
    deptId: sysExample.deptId,
    ownerId: sysExample.ownerId,
  },
  list: {
    select: {...},
    searchable: { name: "like", code: "like", status: "=" },
    quickSearchFields: ["name", "code"],
    sortableFields: ["id", "sort", "createdAt"],
    defaultSort: { field: "sort", order: "asc" },
  },
});
```

`dataScope` applies to both list and mutation routes. Update, delete, batch delete, restore, force
delete, and status changes first resolve the target through the current user's data scope. A target
outside that scope is treated as missing and hooks are not executed. A batch containing any
out-of-scope ID is rejected as a whole.

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

The generator emits `dataScope` automatically when the module contract contains a `deptId` or
`ownerId` field. A generated module without either field is intentionally not assumed to be
department-scoped. Add an explicit ownership design before publishing it if ordinary users create
its records.

For declared `deptId` and `ownerId` columns, CRUD Factory also rejects create/update assignments
outside the current user's resolved scope. Hooks may still overwrite omitted values with the
current user's department and user ID before that validation runs. More complex delegation rules,
such as which roles a department administrator may assign, remain explicit module policy and must
not be inferred from list filtering.

Data-scope changes must revoke affected token snapshots when those tokens contain stale abilities or data-scope claims.

### Prompt Contract

When requesting a module, always state one of these visibility models:

```text
global system data
department-owned
user-owned
department-and-user-owned
custom business scope
```

For example:

```text
Create an order module with $admin-module.
Visibility model: department-and-user-owned.
Store non-null deptId and ownerId. Fill both on the server from the authenticated user when creating
a record. Current-department users cannot read or mutate other departments' orders; department-tree
users include child departments; self users only see ownerId = current user. Reassignment must stay
inside the operator's resolved scope. Cover list, detail, export, update, delete, batch operations,
direct-ID attacks, operation logs, and data-scope tests.
```

If the module is intentionally shared, say so explicitly:

```text
Visibility model: global system data. Use dataScope: false because the records are shared system
configuration, not department business data.
```

If a request describes user-generated records but omits visibility, stop the module design at that
decision and surface it for confirmation. Do not publish a globally visible draft by default.

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
changedFields: [{ field: "name", before: "Old", after: "New" }];
```

Mask sensitive fields such as `password`, `token`, `secret`, `accessKey`, `clientSecret`, and SMTP credentials.

Risk levels:

| Level    | Typical actions                                                                     |
| -------- | ----------------------------------------------------------------------------------- |
| low      | low-risk saves and routine system actions                                           |
| medium   | create, update, upload, test connection                                             |
| high     | delete, batch delete, reset password, force offline, publish, permission assignment |
| critical | clear logs, force physical delete, destructive system-record attempts               |

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
- API success, failure, data, security, and audit criteria in `tests/coverage/api-test-cases.ts`.
- Page loading, empty, error, interaction, permission, desktop, narrow, light, and dark criteria in `tests/coverage/page-test-cases.ts`.

If the page changes a browser workflow, add or update smoke coverage without using `db:reset`.

`pnpm test:check-cases` discovers explicit Hono routes, CRUD factory routes, Next route handlers, and App Router pages from source. It fails for missing or stale test entries and for empty acceptance criteria. After editing either machine-readable manifest, run `pnpm test:docs`; generated Markdown must remain synchronized.

## Acceptance

Run these commands before the module is considered complete:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:check-cases
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
