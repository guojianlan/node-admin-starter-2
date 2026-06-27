# Module CRUD Template

This folder contains copy-and-adapt templates for a standard Admin Base CRUD module.

Replace these placeholders before use:

| Placeholder | Meaning | Example |
| --- | --- | --- |
| `Example` | PascalCase feature name | `Project` |
| `example` | camelCase or URL segment | `project` |
| `sys_example` | database table | `sys_project` |
| `system.example` | permission prefix | `system.project` |
| `/system/example` | frontend route | `/system/project` |

Minimum files to add for a production module:

1. `schema.ts.template` -> schema export.
2. `migration.sql.template` -> migration entry.
3. `seed-rule.ts.template` -> route and action rules.
4. `route.ts.template` -> backend CRUD route.
5. `route-manifest.ts.template` -> frontend route manifest.
6. `page.tsx.template` -> React feature page.
7. `test.ts.template` -> API and permission tests.

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm admin:check-routes
pnpm build
```
