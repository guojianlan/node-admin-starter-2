# Module CRUD Template

This folder contains the CRUD generator templates for a standard Admin Base module.

Preferred usage:

```bash
corepack pnpm generate:module -- --example > tmp/sms-config.module.json
corepack pnpm generate:module -- --config tmp/sms-config.module.json
```

The CLI generator writes a reviewable draft under `tmp/generated/modules/<module>` by default. The
Web generator at `/system/module/generator` writes to `generated/module-drafts/<module>` and keeps
the module offline until you publish it from the UI.

Publishing a Web draft applies generated files and snippets into the real project source after
review. The current automatic publish path only supports `domain: "system"` because the app mounts
system routes today. For a CMS configuration CRUD module, use a system-admin route such as:

```json
{
  "name": "cms-config",
  "title": "CMS 配置",
  "domain": "system",
  "frontendPath": "/system/cms/config",
  "backendBasePath": "/cms/config"
}
```

That publishes `/system/cms/config` and `/api/system/cms/config`. A real `/api/cms/*` domain needs a
separate backend domain mount before it can be published automatically.

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
