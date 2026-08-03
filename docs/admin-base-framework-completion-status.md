# Admin Base Framework Completion Status

Updated: 2026-08-03

This document records the final handoff status for the Admin Base backend framework completeness work. The target is 95%-100% completion for the current core backend framework mainline. Deferred plugin-scale or business-specific capabilities are listed separately and are not counted as gaps in the core mainline.

## Final Status

| Phase                                        |   Target | Final Status | Notes                                                                                                                                                                                                       |
| -------------------------------------------- | -------: | -----------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 Notice baseline                      |     100% |         100% | Notice content, publish time, message-center details, datetime handling, and baseline tests are committed.                                                                                                  |
| Phase 1 Production readiness                 |     100% |         100% | CI workflow, non-destructive smoke, `db:reset` protection, production deployment docs, and doctor checks are in place.                                                                                      |
| Phase 2 System settings                      | 95%-100% |     95%-100% | `/system/settings` is a productized settings center. Storage, mail, and OAuth providers remain independent resource models.                                                                                 |
| Phase 3 API docs and templates               | 95%-100% |     95%-100% | `docs/api.md`, `public/openapi.json`, `docs/business-module-template.md`, and `templates/module-crud` are ready for handoff.                                                                                |
| Phase 4 Notice v2                            | 95%-100% |     95%-100% | User, role, department scopes, pinned/priority/expiry, read stats, read detail, and message-center workflows are implemented. Scheduled visibility is query-time based.                                     |
| Phase 5 File safety and large upload         |      95% |          95% | Upload policy, MIME/magic checks, safe direct downloads, chunk upload UI/backend, SHA-256 validation, file references, dedicated force-delete permission, and removable website seed files are implemented. |
| Phase 6 OAuth lifecycle                      |      95% |          95% | OAuth provider resource table/API/UI, redirect/callback/state validation, profile bind/unbind, login logs, and operation logs are implemented.                                                              |
| Phase 7 Security policy                      |      95% |          95% | Password policy, password history, force password change, password expiry, failure lock, captcha escalation, token revocation, and sensitive confirmations are implemented.                                 |
| Phase 8 Operation log governance             |      95% |          95% | Risk level, request tracing, JSON detail viewer, changed-field summaries, CSV export, filtered cleanup, and retention setting are implemented.                                                              |
| Phase 9 Permission and data-scope governance |  90%-95% |      90%-95% | Role copy UI, permission diff preview, stricter route checks, token revocation on permission/data-scope changes, and module template guidance are implemented.                                              |
| Phase 10 Dashboard system status             | 95%-100% |     95%-100% | Dashboard uses real summary data, links metrics to owner modules, shows high-risk operations, resource state, notices, and doctor summary with loading/empty/error states.                                  |

## Stable Core Decisions

- Next.js + Hono remains a single application.
- PostgreSQL remains the primary database target.
- Drizzle schema and project migrations remain the database source.
- Ant Design + React Query remain the admin UI foundation.
- `sys_rule` remains the source of truth for menus and permissions.
- Route manifest only describes frontend routing and permission binding.
- CRUD factory remains the default for ordinary modules.
- Password, token, OAuth, file physical operations, publish/revoke, and connection tests remain explicit route/service workflows.
- `sys_config_items` stores ordinary parameters and policy parameters only.
- Storage, mail, SMS providers/templates, OAuth providers, and AI providers/models remain resource configuration tables with independent APIs.
- Secrets are hashed or encrypted at rest and are always masked in responses.

## Production Readiness

The production path now has these guardrails:

- CI installs dependencies, runs migration/seed, typecheck, lint, tests, API/page test-case completeness checks, route checks, and build.
- `pnpm smoke` is non-destructive and does not call `db:reset`.
- `db:reset` refuses production environments and production-like database targets unless explicitly and dangerously confirmed.
- `/api/ready` remains public for infrastructure readiness.
- `/api/system/doctor` remains authenticated and reports environment, database, migration, admin seed state, storage, mail, upload directory, and production safety.
- Deployment documentation covers PM2, Nginx, env vars, migration/seed, upload persistence, S3, SMTP, backup, restore, rollback, and production reset restrictions.

## Product Completeness

The backend framework can now support a long-running business project baseline:

- Admin users can manage users, roles, menus, departments, dictionaries, config, storage, mail, SMS providers/templates, OAuth providers, AI providers/models, notices, files, login logs, online sessions, and operation logs.
- End users can manage profile data, password, avatar, login records, OAuth bindings, and message reads.
- Security policies affect real login, password, token, and forced-change behavior.
- Notifications have publish lifecycle, scoped visibility, message-center reading, and read analytics.
- File uploads enforce safety policy and support large upload sessions.
- AI Runtime can be configured through providers/models and verified through AI Playground. AI Chat now supports persisted message states, context compaction, per-session model/System Prompt, usage/export, regeneration, Agent selection, permission-aware tool calls, persisted Runs/Steps, and human approval records.
- The admin shell supports visited-page tabs and optional in-memory page retention. `ADMIN_PAGE_PERSISTENCE_MODE` in `src/config/admin-navigation.ts` selects `disabled`, `tabs`, or `tabs-cache` behavior.
- Dashboard is a system status center rather than demo metrics.
- New business modules have a repeatable implementation template, route/permission checks, CLI draft generator, and Web draft/publish generator.
- Coding agents now have a repository-level contract in `AGENTS.md`, an AI development lifecycle in
  `docs/ai-development-guide.md`, and project-owned `admin-module`, `admin-ui`, and `admin-qa`
  skills. `pnpm admin:verify` provides quick, module, full, and optional smoke verification scopes.
- The CLI, Web generator, and Coding Agent workflow share `schemas/admin-module.schema.json`.
  Module publishing now requires a per-file diff and plan hash, runs verification in an isolated
  source copy, records backups and hashes, and supports guarded source rollback without overwriting
  later manual edits.

## AI-First Framework Packages

| Package                                               | Status | Delivered scope                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------- | -----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package A: agent-ready development contract           |   100% | Repository `AGENTS.md`, AI development lifecycle, project-owned `admin-module`/`admin-ui`/`admin-qa` skills, risk-based `admin:verify` command, and module handoff guidance are implemented.                                                                                                                   |
| Package B: governed module generation and publication |   100% | CLI/Web/Coding Agent share one strict schema; the generator declares supported capabilities; publication has per-file diffs, identity/conflict checks, immutable plan hashes, isolated preflight, serialized source mutation, publish journals/backups, partial-failure recovery, and guarded source rollback. |

Package B ownership is explicit: a draft is generator-owned, while published files become normal
repository-owned source. Regeneration is diff-only and cannot overwrite a handwritten target.
Rollback verifies published after-hashes before restoring files and does not attempt to reverse an
already executed database migration.

Package B automated acceptance on 2026-08-03:

- `pnpm generate:module-schema` synchronized the published JSON Schema.
- `pnpm typecheck` and `pnpm lint` passed.
- `pnpm test` passed 303/303 tests in 13 test files.
- `pnpm admin:verify --module module-generator` passed 22/22 focused tests in 2 test files.
- `pnpm test:check-cases` passed 224/224 API operations and 28/28 pages.
- `pnpm admin:check-routes` passed route, manifest, seed, and permission consistency checks.
- `pnpm build` passed the Next.js production build and generated all 30 application pages.

The Package B browser visual pass remains a manual acceptance boundary by project decision. It does
not weaken source publication safety: API workflows, generated source, failed preflight isolation,
stale-plan rejection, rollback protection, route generation, type validation, and production build
are automated.

## Deferred Scope

These capabilities remain intentionally out of the current core mainline:

| Capability                               | Reason                                                                                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-tenant architecture                | Requires tenant isolation across auth, data scope, storage, and audit; this would change many core contracts.                                                               |
| Task scheduler center                    | Notice scheduled visibility currently works by query-time filtering; scheduler introduces runtime and retry semantics outside the core baseline.                            |
| Advanced AI evaluation and quota billing | Agent/Tool/Run/Step/Approval foundations are implemented; automated eval suites, budget enforcement, distributed run recovery, and billing remain a separate product layer. |
| Full plugin marketplace                  | Requires packaging, install, trust, version, and permission models that exceed the current admin framework.                                                                 |
| Field-level permission UI                | Data scope and action permission are complete enough for the baseline; field-level UI can be added later as an extension point.                                             |
| Realtime WebSocket messages              | Message center supports polling/read workflows; realtime delivery can be added after a runtime channel is selected.                                                         |

## Handoff Checklist

功能回归范围、P0/P1 优先级、现有自动化追踪和环境测试要求见 [`docs/admin-base-functional-test-cases.md`](admin-base-functional-test-cases.md)。逐接口契约见 [`docs/admin-base-api-test-cases.md`](admin-base-api-test-cases.md)，逐页面数据、交互和视觉验收见 [`docs/admin-base-page-test-cases.md`](admin-base-page-test-cases.md)。每次新增或修改接口、页面时必须同步更新机器可读测试清单，并通过 `pnpm test:check-cases`。

Before merging or tagging this baseline, run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:check-cases
pnpm admin:check-routes
pnpm build
pnpm smoke
```

The working tree should be clean and all package commits should be pushed to `origin/codex/admin-base-migration-plan`.
