# Business Module Template

Use this checklist for every new backend module.

## Required Pieces

1. Database schema in `src/server/db/schema`.
2. Migration in `src/server/db/migrations.ts`.
3. Seed route and action rules in `src/server/db/seed/default-data.ts`.
4. Backend route under `src/server/routes/system` or a business route namespace.
5. Frontend page under `src/features`.
6. Route manifest entry in `src/router/route-manifest.ts`.
7. App Router page file under `src/app/(admin)`.
8. Operation log integration for every high-risk write action.
9. Tests for permissions, list query, writes, and important side effects.

## CRUD Defaults

- Prefer `createCrudRoutes` for ordinary list/create/update/delete modules.
- Use explicit route handlers for passwords, tokens, files, publishing, connection tests, and physical side effects.
- Use `sys_rule` action keys with the pattern `<module>.<action>`.
- Use soft delete when the record may be restored or audited.

## Data And Security

- Hash passwords and tokens.
- Encrypt resource secrets such as SMTP passwords and S3 secret keys.
- Return boolean flags such as `hasPassword` or `hasSecretKey`; never return encrypted secret values.
- Apply data scope to user-facing list queries when the module contains user-owned or department-owned data.
- Protect system records with `is_system`; allow display fields to change, but prevent key/code deletion or destructive status changes.

## Acceptance

Before a module is considered complete, run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm admin:check-routes
pnpm build
```

If the module changes browser workflows, also run:

```bash
pnpm smoke
```
