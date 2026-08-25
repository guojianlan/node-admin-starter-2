# Admin Base Framework Completion Status

Updated: 2026-08-24

This document records the final handoff status for the Admin Base backend framework completeness work. The target is 95%-100% completion for the current core backend framework mainline. Deferred plugin-scale or business-specific capabilities are listed separately and are not counted as gaps in the core mainline.

CRM、企业知识库、Notebook/PPT、经营数据查询和供应链 Agent 如何组合使用，见
[`docs/ai-business-use-case-cookbook.md`](./ai-business-use-case-cookbook.md)。其中的 CRM 和供应链能力是
业务落地参考，不计入基础框架已经完成的通用能力。

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
- AI Runtime can be configured through providers/models and verified through AI Playground. It exposes reusable chat, structured-output, single/batch embedding services, purpose-level primary/fallback routing, immutable Invocation/Attempt cost evidence, Provider success/P50/P95 health, and linked Run/Step Trace. AI Chat supports persisted message states, CJK-aware context compaction, model-aware output budgets, per-session model/System Prompt, usage/export, regeneration, Agent selection, permission-aware tools, persisted Runs/Steps, atomic human approval, and linked continuation Runs. AI SDK 7 remains the Provider runtime; Mastra Core is available as an embedded `general-assistant` canary behind `ADMIN_BASE_AI_ORCHESTRATOR=mastra` without changing the existing Chat, Approval, permission, or audit contracts.
- Model pricing supports ordinary input, cache read, cache write and output cost evidence. The governed LiteLLM catalog adds validated snapshots, deterministic Provider/model matching, diff preview, selective application, source Hash and manual-override provenance; it never silently overwrites model prices or claims official verification.
- Knowledge/RAG v1 shares the storage layer while isolating ordinary admin files, Knowledge-owned sources, and reserved C-end user content through `general | knowledge | user_content`. Direct Knowledge uploads never appear in ordinary file groups, lists, downloads, moves, or trash; importing from the ordinary file library creates an independent Knowledge-owned physical snapshot, so deleting the original cannot break retrieval or citations. It supports scoped knowledge bases, TXT/Markdown/PDF/DOCX parsing, versioned deterministic chunks, dimension-aware Embedding, PostgreSQL full-text plus cosine retrieval, optional governed Rerank with graceful degradation, grounded answers, RAG Runs, and inspectable citations. It does not require `pgvector` in the first deployment.
- Notebook v1 organizes visible knowledge bases or ready documents into owned workspaces, supports SSRF-safe website import, governed Web Search discovery with selected-result import, and a unified bottom composer for grounded Ask or AI-planned Deep Research. Research runs persist Workflow/Step progress and cited report Artifacts, while grounded answers remain restricted to current sources and preserve historical citation/source snapshots.
- Eval/Trace v1 provides scoped Dataset/Case management, save-from-real-Run, immutable synchronous Run/Result history, deterministic text/tool/approval/latency/Token/cost assertions, and Result links to the existing Agent Run/Step/Approval and Invocation/Attempt evidence. Unattended Eval explicitly denies approval-required tools.
- AI Governance adds explicit cross-session User/Agent Memory, Runtime Skills, an Agent Knowledge Tool, controlled remote MCP Streamable HTTP/OAuth/Tool lifecycle, persistent Provider circuit breakers, PostgreSQL Worker jobs, system/department/user quotas, and estimated/adjustable/settleable billing ledger entries.
- Notebook supports owner-managed viewer/editor collaborators and optional queued Artifact generation. Eval Cases can add LLM Judge and evidence-based groundedness checks without allowing model judgement to override deterministic failures.
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
- The built-in module-development Agent reuses the same contract and publication services through
  six system-owned tools. Runs, steps, approvals, plan hashes, affected files, validation evidence,
  expiry, execution, and operation logs are visible through the existing Agent debugging workflow.

The current AI baseline includes governed Web Search, server-derived public-network sources,
purpose-level model reliability, Knowledge/RAG, document citations, Notebook workspaces,
Eval/Trace, cross-session Memory, Runtime Agent Skills, Agent Knowledge Tool, controlled MCP,
persistent circuit breakers, PostgreSQL Worker jobs, and quota/billing foundations. It does not
claim full tenant isolation, an external message broker, Provider invoice reconciliation, realtime
Notebook co-editing, or unrestricted MCP transports. The exact boundaries are recorded in
[`docs/ai-capability-evolution-roadmap.md`](ai-capability-evolution-roadmap.md).

## AI-First Framework Packages

| Package                                               | Status | Delivered scope                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------- | -----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package A: agent-ready development contract           |   100% | Repository `AGENTS.md`, AI development lifecycle, project-owned `admin-module`/`admin-ui`/`admin-qa` skills, risk-based `admin:verify` command, and module handoff guidance are implemented.                                                                                                                   |
| Package B: governed module generation and publication |   100% | CLI/Web/Coding Agent share one strict schema; the generator declares supported capabilities; publication has per-file diffs, identity/conflict checks, immutable plan hashes, isolated preflight, serialized source mutation, publish journals/backups, partial-failure recovery, and guarded source rollback. |
| Package C: constrained in-product development Agent   |   100% | `module_design`, draft, diff, validation, publication, and rollback tools reuse Package B services; system identity, permissions, production rejection, Approval, expiry, replay protection, Run/Step visibility, and operation logs are enforced.                                                             |
| AI Pricing Catalog v1                                 |   100% | A validated, hashed LiteLLM snapshot is paged and matched by Provider/model identity; administrators preview field-level differences and explicitly apply selected values while manual edits reset catalog provenance.                                                                                         |

Package B ownership is explicit: a draft is generator-owned, while published files become normal
repository-owned source. Regeneration is diff-only and cannot overwrite a handwritten target.
Rollback verifies published after-hashes before restoring files and does not attempt to reverse an
already executed database migration.

Package C keeps the runtime trust boundary narrow. The development Agent has no arbitrary shell,
filesystem, Git, SQL, route, or tool-name input. Draft and diff operations do not activate source;
publish and rollback require a non-expired human Approval plus
`system.moduleGenerator.publish`. Approval evidence stores the exact plan hash, affected files, and
validation output, and publication still re-runs Package B preflight and stale-plan checks.

## Mastra M0/M1 Canary

The first orchestration package is implemented with a deliberately narrow blast radius:

- Fixed dependencies: `@mastra/core 1.59.0` and `@mastra/pg 1.20.0`.
- Default `legacy` behavior is unchanged; `mastra` routes only `general-assistant` through Mastra.
- `module-development-agent` and every non-migrated Agent remain on the existing runtime.
- Existing AI SDK Provider/Model adapters, server-owned Tool Registry, Approval service, Run/Step
  persistence, data scope, operation log, SSE events, and Streamdown UI remain authoritative.
- RequestContext carries user identity, permission abilities, request ID, and resolved data scope.
- Mastra stream events are normalized to the existing Chat contract; a failed Mastra request never
  silently retries through legacy.
- PostgreSQL storage is reserved under `mastra_runtime` with `disableInit: true`; M0/M1 creates no
  Mastra tables and performs no runtime DDL.
- Mastra-owned Memory, Studio, MCP storage, and full Agent migration remain outside the current
  boundary. Admin Base Memory, MCP, Knowledge/RAG, Notebook, Eval/Trace, Worker, and billing use the
  existing PostgreSQL, AI SDK, permission, approval, and audit contracts rather than Mastra-owned storage.

Automated M0/M1 acceptance covers runtime selection, invalid configuration, PostgreSQL isolation,
RequestContext propagation, Tool approval/execution mapping, real Mastra stream normalization, and
the persistent AI Chat route including Run/Step persistence, Approval continuation, regeneration,
usage, and SSE compatibility.

## Mastra M2 Workflow Foundation

M2 introduces the first deterministic Workflow without handing runtime ownership to Mastra:

- A server-side static registry is the only source of executable Workflow definitions; API input
  cannot inject steps, handlers, code, or arbitrary network access.
- `ai-runtime-preflight` checks Agent status, Provider credentials, Chat model readiness, Tool
  Registry identity, high-risk Approval policy, orchestrator selection, RequestContext, and data
  scope without calling the external model or mutating configuration.
- `sys_ai_workflow_run` and `sys_ai_workflow_run_step` persist user ownership, Request ID, status,
  sanitized input/output, errors, duration, and deterministic step evidence.
- The Workflows tab in AI Agent supports selecting an Agent, executing the preflight, reviewing its
  report, and expanding every persisted step.
- Execution requires `system.aiAgent.executeWorkflow` and writes `system.aiWorkflow.execute` to the
  operation log.
- Mastra PostgreSQL automatic initialization remains disabled. M2 uses Admin Base migrations and
  does not create Mastra Storage tables.

## AI Web Search M3

M3 adds a source-aware public-network search capability without opening arbitrary HTTP access:

- `sys_ai_web_search_provider` stores independent Tavily, Brave, and SearXNG connections, encrypted
  API keys, timeouts, result limits, status, and priority.
- The system-owned `web-search` Tool accepts only `query` and `limit`, is attached to the general
  assistant, and is omitted from the runtime Tool set when no Provider is active.
- The highest-priority enabled connection is the primary connection. Provider attempts fail over by
  priority on timeout, failure, or empty results. Errors are sanitized and results are normalized
  and URL-deduplicated.
- Agent Step output persists attempts and sources; the search operation log keeps the Chat Request
  ID; Chat SSE emits `sources`; Assistant metadata persists the same server-derived source list.
- `/system/ai/web-search` manages, tests, enables, and orders connections. AI Chat displays clickable
  sources separately from model-authored Markdown links.
- Local SearXNG compose files and production configuration boundaries are documented in
  `docs/ai-web-search.md`.

M3 automated acceptance on 2026-08-14:

- `pnpm admin:verify --full` passed TypeScript, full-repository ESLint, all Vitest suites, API/page
  inventory, route/permission consistency, and the Next.js production build.
- 20 test files and 354 tests passed, including Provider masking, activation protection, priority
  failover, runtime Tool availability, a two-stage model/Tool/model stream, Run Step persistence,
  source SSE/message metadata, and Request ID audit correlation.
- Machine-readable coverage passed for 238/238 API operations and 29/29 pages; the build generated
  all 31 application pages including `/system/ai/web-search`.
- Real Tavily/Brave credentials and browser visual acceptance remain environment/manual boundaries;
  they are not represented as automated passes.

## AI Reliability And Knowledge/RAG

The current AI reliability and grounded-knowledge package adds:

- Shared `chat | structured | embedding | rerank | agent | ragAnswer | evalJudge` purpose routes,
  with one primary model and an ordered candidate list.
- Immutable logical Invocation and per-Provider/Model Attempt evidence with tokens, estimated cost,
  first response/total latency, sanitized errors, Request ID, Session, Run, and Step links.
- Provider business success rate, P50/P95 latency, latest success/failure, and separate health-test
  counts. Fallback stops once streamed output begins so different model answers are never joined.
- `/system/ai/runtime` for routing, health, cost ledger, Invocation/Attempt Trace, and Agent Run links.
- `/system/ai/knowledge` for scoped knowledge bases, existing-file sources, indexing, retrieval,
  grounded answers, RAG Runs, and citation inspection.
- PostgreSQL generated `tsvector`/GIN keyword candidates plus JSON Embedding cosine scoring. This
  keeps v1 PostgreSQL-first without claiming `pgvector` is installed.
- Authorized hybrid candidates can pass through the ordered `rerank` purpose route. The adapter
  caps candidates and text, records Invocation/Attempt health evidence, and degrades to hybrid
  ordering without persisting the query, candidate text, or Provider credentials.
- Global, department, and user knowledge visibility enforced on list, command, direct-ID retrieval,
  search, and Ask paths; operation logs never store the raw question.

Automated acceptance on 2026-08-20:

- `pnpm admin:verify --full` passed TypeScript, ESLint, 406/406 Vitest tests in 26 files,
  260/260 API and 32/32 page inventories, route/permission consistency, and the Next.js production
  build including `/system/ai/runtime` and `/system/ai/knowledge`.
- After final source-reference and lexical-fallback hardening, the focused Reliability/Knowledge/
  Agent tests and `pnpm admin:verify --quick` passed again.
- After the governed DashScope Rerank integration, `pnpm test` passed 407/407 tests in 26 files;
  `pnpm admin:verify --quick`, focused ESLint, and `git diff --check` also passed. A real encrypted
  local DashScope configuration returned a 1024-dimensional `text-embedding-v4` vector and a
  successful `qwen3-rerank` result. Browser visual QA remains deferred.
- Browser visual QA and additional production Provider environments remain manual/environment
  boundaries by current project decision.

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

Package C automated acceptance on 2026-08-03:

- `pnpm typecheck` and `pnpm lint` passed.
- `pnpm test` passed 313/313 tests in 15 test files.
- The 10 focused development-Agent tests cover all six tools, real draft/diff/isolated validation,
  system-tool identity, permissions, production rejection, approval evidence, denial, expiry,
  replay protection, stale plans, conflicts, and operation logs.
- `pnpm test:check-cases` passed 224/224 API operations and 28/28 pages.
- `pnpm admin:check-routes` passed route, manifest, seed, and permission consistency checks.
- `pnpm build` passed the Next.js production build and generated all 30 application pages.
- Browser visual QA remains deferred to the project owner's manual test, as requested for this
  package.

## v0.1.0 Release Acceptance

The consolidated release candidate was verified on 2026-08-19 with the current source worktree:

- `pnpm admin:verify --full` passed TypeScript, full-repository ESLint, all Vitest suites, API/page
  inventory, route/permission consistency, and the Next.js production build.
- 24 test files and 383 tests passed.
- Machine-readable coverage passed for 242/242 API operations and 30/30 App Router pages.
- The production build generated all 32 application pages, including AI Setup and governed Web
  Search.
- Non-destructive production smoke passed against an isolated migrated and seeded PostgreSQL
  database; the temporary server and database were removed after acceptance.
- Real external Provider credentials and browser visual acceptance remain environment/manual
  boundaries and are not represented as automated passes.

## AI Governance Foundation Acceptance

Automated code-level acceptance on 2026-08-24:

- Migration `0043_ai_governance_foundation` was applied successfully to the current development database.
- `pnpm lint` passed with zero warnings.
- `pnpm test` passed 500/500 tests in 30 files.
- Focused Memory/Skill/MCP/Circuit/Worker/Quota, Notebook collaboration, and Eval Judge tests passed 13/13 in 3 files.
- `pnpm typecheck`, `pnpm test:check-cases`, `pnpm admin:check-routes`, and `git diff --check` passed.
- Machine-readable coverage is 334/334 API operations and 35/35 App Router pages.
- Browser visual QA, real third-party MCP OAuth/Tool execution, external Provider Judge/RAG execution, production Worker deployment, and formal invoice reconciliation remain environment/manual acceptance boundaries. They are not represented as automated passes.

## Notebook Web Research And File Isolation Acceptance

Automated code-level acceptance on 2026-08-24:

- Migration `0046_ai_research_and_file_usage` was applied successfully to the current development database.
- Focused Notebook, Website Source, Web Search, Knowledge/RAG, Citation, Deep Research, cancellation, partial-import, and file-isolation regression passed 28/28 tests in 5 files.
- `pnpm admin:verify --full` passed TypeScript, full-repository ESLint, 525/525 Vitest tests in 33 files, 342/342 API operations, 35/35 App Router pages, route/permission consistency, and the Next.js 16.3.1 production build.
- The production build generated the Notebook, Knowledge, Eval, Governance, Runtime, Chat, Agent, Provider, Model, Playground, Setup, and Web Search pages together with the existing system routes.
- Search snippets are never persisted as source text; selected URLs are refetched through Website Source security. Deep Research reports are restricted to documents imported by their Workflow Run, and partial failures remain inspectable.
- Direct Knowledge upload stores `usage_type = knowledge`; automated acceptance proves it is visible in Knowledge documents but hidden from ordinary file listing and ordinary file download. Ordinary-library import creates a second `knowledge` file record and physical path, records provenance and survives force deletion of the original.
- Real external Tavily/Brave calls, long-running production Worker deployment, browser visual acceptance, and production smoke remain environment/manual boundaries and are not represented as automated passes.

## Deferred Scope

These capabilities remain intentionally out of the current core mainline:

| Capability                               | Reason                                                                                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-tenant architecture                | Requires tenant isolation across auth, data scope, storage, and audit; this would change many core contracts.                                                                                                 |
| Task scheduler center                    | Notice scheduled visibility currently works by query-time filtering; scheduler introduces runtime and retry semantics outside the core baseline.                                                              |
| Formal tenant billing and reconciliation | system/department/user quota and estimated ledger settlement exist, but tenant isolation, invoice cycles, payment, tax and Provider statement reconciliation remain separate layers.                          |
| Advanced Notebook collaboration          | viewer/editor collaboration and queued Artifact generation exist; realtime co-editing, comments, public sharing, schedules and cross-node progress push remain separate product work.                         |
| External brokers and unrestricted MCP    | PostgreSQL Worker and controlled remote Streamable HTTP MCP exist; Redis/Kafka/RabbitMQ, scheduler-center UI, stdio/Shell/script transports, arbitrary URLs and long-lived MCP Session pools remain deferred. |
| Full plugin marketplace                  | Requires packaging, install, trust, version, and permission models that exceed the current admin framework.                                                                                                   |
| Field-level permission UI                | Data scope and action permission are complete enough for the baseline; field-level UI can be added later as an extension point.                                                                               |
| Realtime WebSocket messages              | Message center supports polling/read workflows; realtime delivery can be added after a runtime channel is selected.                                                                                           |

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

The working tree should be clean and the intended package commits should be pushed to the current release branch before merge or tagging.
