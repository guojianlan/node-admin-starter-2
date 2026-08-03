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

## Template ownership

- `*.eta` files are the active, generator-owned templates used by `pnpm generate:module` and the
  Web generator. Change these files when extending generated output.
- `*.template` files are deprecated historical examples. They are kept only for migration context;
  do not copy them into new modules and do not update them as a second generator implementation.
- Source published from a Web draft becomes repository-owned code. The generator may show a diff,
  but it must not overwrite source that differs from the draft.

The placeholders below describe only the deprecated `*.template` examples:

| Placeholder       | Meaning                  | Example           |
| ----------------- | ------------------------ | ----------------- |
| `Example`         | PascalCase feature name  | `Project`         |
| `example`         | camelCase or URL segment | `project`         |
| `sys_example`     | database table           | `sys_project`     |
| `system.example`  | permission prefix        | `system.project`  |
| `/system/example` | frontend route           | `/system/project` |

The active Eta generator produces these minimum production artifacts:

1. Schema and migration snippets.
2. Seed route/action rules and route-manifest snippets.
3. Backend CRUD route and system-route registration snippet.
4. React feature page and App Router page.
5. Focused API test.
6. API/page acceptance inventory snippets for `tests/coverage/generated-module-test-cases.ts`.

Run:

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm test:check-cases
corepack pnpm admin:check-routes
corepack pnpm build
```
