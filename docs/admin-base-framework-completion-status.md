# Admin Base Framework Completion Status

Updated: 2026-06-28

This document records the final handoff status for the Admin Base backend framework completeness work. The target is 95%-100% completion for the current core backend framework mainline. Deferred plugin-scale or business-specific capabilities are listed separately and are not counted as gaps in the core mainline.

## Final Status

| Phase | Target | Final Status | Notes |
| --- | ---: | ---: | --- |
| Phase 0 Notice baseline | 100% | 100% | Notice content, publish time, message-center details, datetime handling, and baseline tests are committed. |
| Phase 1 Production readiness | 100% | 100% | CI workflow, non-destructive smoke, `db:reset` protection, production deployment docs, and doctor checks are in place. |
| Phase 2 System settings | 95%-100% | 95%-100% | `/system/settings` is a productized settings center. Storage, mail, and OAuth providers remain independent resource models. |
| Phase 3 API docs and templates | 95%-100% | 95%-100% | `docs/api.md`, `public/openapi.json`, `docs/business-module-template.md`, and `templates/module-crud` are ready for handoff. |
| Phase 4 Notice v2 | 95%-100% | 95%-100% | User, role, department scopes, pinned/priority/expiry, read stats, read detail, and message-center workflows are implemented. Scheduled visibility is query-time based. |
| Phase 5 File safety and large upload | 95% | 95% | Upload policy, MIME/magic checks, dangerous-file handling, chunk upload UI/backend, SHA-256 part validation, and file references are implemented. |
| Phase 6 OAuth lifecycle | 95% | 95% | OAuth provider resource table/API/UI, redirect/callback/state validation, profile bind/unbind, login logs, and operation logs are implemented. |
| Phase 7 Security policy | 95% | 95% | Password policy, password history, force password change, password expiry, failure lock, captcha escalation, token revocation, and sensitive confirmations are implemented. |
| Phase 8 Operation log governance | 95% | 95% | Risk level, request tracing, JSON detail viewer, changed-field summaries, CSV export, filtered cleanup, and retention setting are implemented. |
| Phase 9 Permission and data-scope governance | 90%-95% | 90%-95% | Role copy UI, permission diff preview, stricter route checks, token revocation on permission/data-scope changes, and module template guidance are implemented. |
| Phase 10 Dashboard system status | 95%-100% | 95%-100% | Dashboard uses real summary data, links metrics to owner modules, shows high-risk operations, resource state, notices, and doctor summary with loading/empty/error states. |

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
- Storage, mail, SMS, and OAuth providers remain resource configuration tables with independent APIs.
- Secrets are hashed or encrypted at rest and are always masked in responses.

## Production Readiness

The production path now has these guardrails:

- CI installs dependencies, runs migration/seed, typecheck, lint, tests, route checks, and build.
- `pnpm smoke` is non-destructive and does not call `db:reset`.
- `db:reset` refuses production environments and production-like database targets unless explicitly and dangerously confirmed.
- `/api/ready` remains public for infrastructure readiness.
- `/api/system/doctor` remains authenticated and reports environment, database, migration, admin seed state, storage, mail, upload directory, and production safety.
- Deployment documentation covers PM2, Nginx, env vars, migration/seed, upload persistence, S3, SMTP, backup, restore, rollback, and production reset restrictions.

## Product Completeness

The backend framework can now support a long-running business project baseline:

- Admin users can manage users, roles, menus, departments, dictionaries, config, storage, mail, SMS providers, OAuth providers, notices, files, login logs, online sessions, and operation logs.
- End users can manage profile data, password, avatar, login records, OAuth bindings, and message reads.
- Security policies affect real login, password, token, and forced-change behavior.
- Notifications have publish lifecycle, scoped visibility, message-center reading, and read analytics.
- File uploads enforce safety policy and support large upload sessions.
- Dashboard is a system status center rather than demo metrics.
- New business modules have a repeatable implementation template, route/permission checks, CLI draft generator, and Web draft generator.

## Deferred Scope

These capabilities remain intentionally out of the current core mainline:

| Capability | Reason |
| --- | --- |
| Multi-tenant architecture | Requires tenant isolation across auth, data scope, storage, and audit; this would change many core contracts. |
| Task scheduler center | Notice scheduled visibility currently works by query-time filtering; scheduler introduces runtime and retry semantics outside the core baseline. |
| AI provider | Provider management and quota/audit design should be handled as a separate product module. |
| Full plugin marketplace | Requires packaging, install, trust, version, and permission models that exceed the current admin framework. |
| Field-level permission UI | Data scope and action permission are complete enough for the baseline; field-level UI can be added later as an extension point. |
| Realtime WebSocket messages | Message center supports polling/read workflows; realtime delivery can be added after a runtime channel is selected. |

## Handoff Checklist

Before merging or tagging this baseline, run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm admin:check-routes
pnpm build
pnpm smoke
```

The working tree should be clean and all package commits should be pushed to `origin/codex/admin-base-migration-plan`.
