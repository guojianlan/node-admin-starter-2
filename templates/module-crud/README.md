# Module CRUD Template

This folder contains the CRUD generator templates for a standard Admin Base module.

Preferred usage:

```bash
corepack pnpm generate:module -- --example > tmp/sms-config.module.json
corepack pnpm generate:module -- --config tmp/sms-config.module.json
```

The generator writes a reviewable draft under `tmp/generated/modules/<module>`. It does not edit
`src/server/db/schema/index.ts`, migrations, seed rules, or the route manifest automatically.
Apply the generated snippets after review.

For secret fields, set `select: false` in the config and add encryption/masking hooks by hand.
The generator deliberately does not implement module-specific secret handling.

Use `--force` to replace an existing generated draft:

```bash
corepack pnpm generate:module -- --config tmp/sms-config.module.json --force
```

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
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm admin:check-routes
corepack pnpm build
```
