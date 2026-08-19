# Admin Base API

Admin Base serves all application APIs under `/api`. A static OpenAPI companion is published at [`public/openapi.json`](../public/openapi.json) and can be exposed as `/openapi.json` by Next.js static serving.

## Response Contract

Successful and failed JSON responses use the same envelope:

```ts
type ApiResponse<T> = {
  success: boolean;
  msg: string;
  data?: T;
};
```

Paged list APIs return the page payload in `data`:

```ts
type PageResult<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
};
```

Authenticated APIs require:

```http
Authorization: Bearer <token>
```

Common error meanings:

| Status | Meaning                                                    |
| ------ | ---------------------------------------------------------- |
| 400    | Invalid input or business rule violation                   |
| 401    | Missing, expired, revoked, or invalid token                |
| 403    | Authenticated but missing permission                       |
| 423    | Password change required before using other protected APIs |
| 500    | Unexpected server error                                    |

Sensitive values are never returned as raw secrets. Passwords and tokens are hashed; SMTP password, S3 secret key, and OAuth client secret are encrypted at rest and exposed only as boolean flags such as `hasPassword`, `hasSecretKey`, or `hasClientSecret`.

## Auth And Session

| Method | Path                                 | Description                                                            |
| ------ | ------------------------------------ | ---------------------------------------------------------------------- |
| GET    | `/api/health`                        | Basic process health                                                   |
| GET    | `/api/ready`                         | Public readiness checks for load balancers                             |
| GET    | `/api/system/login/options`          | Login policy, captcha requirement, and public OAuth providers          |
| GET    | `/api/system/login/captcha`          | Captcha SVG payload                                                    |
| POST   | `/api/system/login`                  | Password login, token creation, login log, and operation log           |
| POST   | `/api/system/logout`                 | Revoke current token and write operation log                           |
| GET    | `/api/system/info`                   | Current user, permissions, menus, data scope, and `mustChangePassword` |
| GET    | `/api/system/menu`                   | Current user menu tree                                                 |
| POST   | `/api/system/password-reset/request` | Request reset mail with anti-enumeration response                      |
| POST   | `/api/system/password-reset/confirm` | Confirm reset token, update password, revoke old tokens                |

`/api/system/info` returns `mustChangePassword: boolean`; when true, non-profile protected APIs can return `423` until the user changes password.

## CRUD Factory Contract

CRUD factory modules use the standard list/create/update/delete contract:

| Method | Path                                  | Description               |
| ------ | ------------------------------------- | ------------------------- |
| GET    | `/api/system/<resource>`              | Paged query               |
| POST   | `/api/system/<resource>`              | Create                    |
| PUT    | `/api/system/<resource>/:id`          | Update                    |
| DELETE | `/api/system/<resource>/:id`          | Delete                    |
| POST   | `/api/system/<resource>/batch-delete` | Batch delete when enabled |

Common query parameters:

```text
page=1&pageSize=20&keyword=admin&sortField=id&sortOrder=desc
```

CRUD write actions must declare `permissions.prefix`, apply `is_system` protection where relevant, and write operation logs through the shared CRUD factory integration.

## Core System Resources

| Resource         | Main API                                               | Notes                                                        |
| ---------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| User             | `/api/system/user`                                     | User CRUD, roles, departments, status, force password change |
| Role             | `/api/system/role`                                     | Role CRUD, role copy, permission assignment, data scope      |
| Rule             | `/api/system/rule`                                     | Menu and action permission source of truth                   |
| Dept             | `/api/system/dept`                                     | Department tree and data scope base                          |
| Dict             | `/api/system/dict/list`, `/api/system/dict/item`       | Dictionary groups and items                                  |
| Config           | `/api/system/config/group`, `/api/system/config/items` | Raw config item maintenance                                  |
| Notice           | `/api/system/notice`                                   | Notice CRUD, publish, revoke, read analytics                 |
| Module Generator | `/api/system/module/generator/*`                       | Development-only CRUD module draft generation                |

## Settings

System settings are a UI and API aggregation layer. They do not merge resource models.

| Method | Path                               | Description                                          |
| ------ | ---------------------------------- | ---------------------------------------------------- |
| PUT    | `/api/system/settings/config/save` | Save typed ordinary settings into `sys_config_items` |
| GET    | `/api/system/config/items`         | Raw config item list for maintenance                 |
| PUT    | `/api/system/config/items/save`    | Save config item values by key                       |

Configuration boundaries:

| Type                   | Storage            | Examples                                                                         |
| ---------------------- | ------------------ | -------------------------------------------------------------------------------- |
| Ordinary parameters    | `sys_config_items` | site name, security policy, login policy, upload policy, operation log retention |
| Resource configuration | Dedicated tables   | `sys_storage`, `sys_mail_account`, `sys_sms_provider`, `sys_oauth_provider`      |
| Runtime environment    | `.env`             | `DATABASE_URL`, `ADMIN_BASE_SECRET_KEY`, production-only secrets                 |

## Storage, Mail, And SMS

| Method   | Path                                   | Description                                                     |
| -------- | -------------------------------------- | --------------------------------------------------------------- |
| GET/POST | `/api/system/storage`                  | Query and create storage resources                              |
| PUT      | `/api/system/storage/:id`              | Update storage resource                                         |
| PUT      | `/api/system/storage/status/:id`       | Toggle storage status                                           |
| PUT      | `/api/system/storage/default/:id`      | Set default storage with protection                             |
| POST     | `/api/system/storage/test`             | Test storage connection                                         |
| GET/POST | `/api/system/mail/account`             | Query and create mail accounts                                  |
| PUT      | `/api/system/mail/account/:id`         | Update mail account                                             |
| PUT      | `/api/system/mail/account/status/:id`  | Toggle mail account status                                      |
| PUT      | `/api/system/mail/account/default/:id` | Set default mail account with protection                        |
| POST     | `/api/system/mail/account/test`        | Send test mail                                                  |
| GET/POST | `/api/system/sms/provider`             | Query and create SMS providers                                  |
| PUT      | `/api/system/sms/provider/:id`         | Update SMS provider                                             |
| DELETE   | `/api/system/sms/provider/:id`         | Delete SMS provider when not default/system                     |
| PUT      | `/api/system/sms/provider/status/:id`  | Toggle SMS provider status                                      |
| PUT      | `/api/system/sms/provider/default/:id` | Set default SMS provider with protection                        |
| POST     | `/api/system/sms/provider/test`        | Send test SMS through provider                                  |
| GET/POST | `/api/system/sms/template`             | Query and create SMS templates                                  |
| PUT      | `/api/system/sms/template/:id`         | Update SMS template                                             |
| DELETE   | `/api/system/sms/template/:id`         | Delete SMS template when not system protected                   |
| PUT      | `/api/system/sms/template/status/:id`  | Toggle SMS template status                                      |
| POST     | `/api/system/sms/template/test`        | Render variables and send a test SMS through the bound provider |

Default resources are unique. Disabling the active default resource is rejected. Secrets are stored encrypted and returned as boolean flags only.

SMS provider v1 supports a generic `webhook` provider. Test sending posts JSON to the configured endpoint with the target phone, content, signature, template code, and variables. Cloud-vendor SDK adapters can be added later behind the same `sys_sms_provider` model.

SMS templates are stored separately in `sys_sms_template`. They bind to a provider, keep business template content and variable metadata, and do not store provider secrets. Test sending renders `{{variable}}` placeholders from the supplied variables object before posting through the bound provider.

## AI Provider, Models, And Runtime

AI providers and models are separate resource configurations stored in `sys_ai_provider` and `sys_ai_model`. A Provider record is one connection instance describing how the application connects and authenticates to an AI service through its protocol, Base URL, and API key. The same provider type may have multiple connection instances for separate accounts, environments, or gateways. A model belongs to one Provider connection and identifies the concrete model that business features may call, such as a Chat, Agent-capable, Embedding, image, or rerank model. One Provider connection can expose many models. Provider API keys are encrypted at rest and responses only expose `hasApiKey`.

The normal setup path is `/system/ai/setup`: choose a common Provider type, give the connection a recognizable name, enter the API key, test the transient connection, select one or more synchronized models, and assign default purposes. Discovery does not persist credentials or records. Completion creates the Provider, selected models, and default-purpose flags in one database transaction. The internal provider code is generated automatically and the Base URL remains editable for proxies or compatible gateways. Advanced administrators may continue to manage every field from the separate Provider and model pages. Model display name defaults to the model ID and base capabilities are inferred from the type. `contextWindow`, `maxOutputTokens`, capability overrides, price, and currency are optional advanced metadata. The runtime uses the context window for history compaction, the output limit for generation budgeting, and capability flags to decide whether structured output, Agent tools, vision, or embedding workflows are allowed. See `docs/ai-module-boundaries.md` for the complete Provider, model, Playground, Chat, and Agent boundary.

| Method     | Path                                                                | Description                                                                           |
| ---------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| GET        | `/api/system/ai/setup/summary`                                      | Read guided setup readiness, counts, and default models                               |
| POST       | `/api/system/ai/setup/discover`                                     | Test a transient Provider and discover models without persistence                     |
| POST       | `/api/system/ai/setup/complete`                                     | Atomically create a Provider, selected models, and default purposes                   |
| GET/POST   | `/api/system/ai/provider`                                           | Query and create Provider connection instances; one type may have many connections    |
| PUT        | `/api/system/ai/provider/:id`                                       | Update AI provider                                                                    |
| DELETE     | `/api/system/ai/provider/:id`                                       | Delete AI provider when not default/system                                            |
| PUT        | `/api/system/ai/provider/status/:id`                                | Toggle AI provider status                                                             |
| PUT        | `/api/system/ai/provider/default/:id`                               | Set default AI provider with protection                                               |
| POST       | `/api/system/ai/provider/test`                                      | Test provider list/chat/embedding endpoint                                            |
| POST       | `/api/system/ai/provider/test/stream`                               | Stream a provider chat test through AI SDK                                            |
| GET        | `/api/system/ai/provider/:id/models`                                | Synchronize a normalized model list from one connection for interactive selection     |
| GET        | `/api/system/ai/provider/:id/test-models`                           | Synchronize candidates for Provider test dialogs with Provider test permission        |
| GET/POST   | `/api/system/ai/web-search/provider`                                | Query or create Tavily, Brave, or SearXNG search connections                          |
| PUT/DELETE | `/api/system/ai/web-search/provider/:id`                            | Update or delete a non-system Web Search Provider                                     |
| PUT        | `/api/system/ai/web-search/provider/status/:id`                     | Enable or disable a saved search connection                                           |
| POST       | `/api/system/ai/web-search/provider/test`                           | Test one connection and return normalized sources plus sanitized attempts             |
| GET/POST   | `/api/system/ai/model`                                              | Query and create AI models                                                            |
| PUT        | `/api/system/ai/model/:id`                                          | Update AI model                                                                       |
| DELETE     | `/api/system/ai/model/:id`                                          | Delete AI model when not system/default protected                                     |
| PUT        | `/api/system/ai/model/status/:id`                                   | Toggle AI model status                                                                |
| PUT        | `/api/system/ai/model/default/:id`                                  | Set default chat/structured/embedding model                                           |
| POST       | `/api/system/ai/model/test`                                         | Test a configured AI model                                                            |
| POST       | `/api/system/ai/model/test/stream`                                  | Stream a configured chat model test through AI SDK                                    |
| GET        | `/api/system/ai/runtime-config/:usage`                              | Read sanitized default runtime config for maintenance                                 |
| GET        | `/api/system/ai/playground/options`                                 | List enabled Chat models available for explicit Playground selection                  |
| GET        | `/api/system/ai/playground/runtime-config/:usage`                   | Read sanitized runtime config for Playground                                          |
| POST       | `/api/system/ai/playground/chat`                                    | Generate text with an explicitly selected or default Chat/structured model            |
| POST       | `/api/system/ai/playground/chat/stream`                             | Stream text with SSE events: `meta`, `delta`, `finish`, `error`                       |
| GET        | `/api/system/ai/chat/runtime-config`                                | Read sanitized runtime config for AI Chat                                             |
| GET        | `/api/system/ai/chat/options`                                       | List active Chat models, Agents, and each Agent's currently available Tool codes      |
| GET        | `/api/system/ai/chat/sessions`                                      | Query current user's AI Chat sessions                                                 |
| POST       | `/api/system/ai/chat/sessions`                                      | Create an AI Chat session                                                             |
| PUT        | `/api/system/ai/chat/sessions/:id`                                  | Update title, model, Agent, System Prompt, temperature, and output limit              |
| DELETE     | `/api/system/ai/chat/sessions/:id`                                  | Soft-delete current user's AI Chat session                                            |
| GET        | `/api/system/ai/chat/sessions/:id/messages`                         | List messages in current user's AI Chat session                                       |
| POST       | `/api/system/ai/chat/sessions/:id/messages/stream`                  | Append or resume a turn, stream model/Agent output, and persist status/usage          |
| POST       | `/api/system/ai/chat/sessions/:id/messages/:messageId/regenerate`   | Supersede and regenerate the latest Assistant message                                 |
| GET        | `/api/system/ai/chat/sessions/:id/export`                           | Export a conversation as Markdown or JSON                                             |
| GET        | `/api/system/ai/chat/sessions/:id/approvals`                        | List tool approvals for a chat session                                                |
| POST       | `/api/system/ai/chat/sessions/:sessionId/client-actions/:id/result` | Submit a normalized one-time browser Client Tool result and resume the same Agent run |
| GET/POST   | `/api/system/ai/agent`                                              | Query and create Agents                                                               |
| PUT/DELETE | `/api/system/ai/agent/:id`                                          | Update or soft-delete an Agent                                                        |
| GET        | `/api/system/ai/agent/options`                                      | List models, tools, and controlled handler registry options                           |
| GET/POST   | `/api/system/ai/tool`                                               | Query and create registered tools                                                     |
| PUT/DELETE | `/api/system/ai/tool/:id`                                           | Update or soft-delete a tool                                                          |
| GET        | `/api/system/ai/agent/runs`                                         | Query current user's Agent runs                                                       |
| GET        | `/api/system/ai/agent/runs/:id/steps`                               | Inspect persisted model/tool/approval steps                                           |
| POST       | `/api/system/ai/approval/:id/decision`                              | Approve or deny a pending tool execution                                              |
| GET        | `/api/system/ai/workflow/definitions`                               | List server-registered trusted Workflow definitions                                   |
| POST       | `/api/system/ai/workflow/:code/runs`                                | Execute a registered Workflow with its input schema and permission                    |
| GET        | `/api/system/ai/workflow/runs`                                      | List current user's persisted Workflow runs                                           |
| GET        | `/api/system/ai/workflow/runs/:id`                                  | Inspect one Workflow run and its persisted steps                                      |

Supported provider types include OpenAI, Anthropic, Google Gemini, OpenAI-compatible gateways, DeepSeek, Qwen/DashScope, Moonshot/Kimi, Zhipu, SiliconFlow, OpenRouter, Ollama, and custom compatible endpoints.

Runtime calls use the configured default model for `chat`, `structured`, or `embedding` and return provider/model metadata without secrets. The reusable service APIs are `generateAiStructured`, `embedAiText`, and `embedAiTexts`; they resolve the configured Provider/model and call AI SDK 7. Playground calls write operation logs under `system.aiPlayground`; AI Chat calls write operation logs under `system.aiChat`. Playground remains the explicit parameter-debugging surface. Formal AI Chat turns do not accept per-message or per-session output-token/timeout overrides: they use the selected model's configured `maxOutputTokens`, fall back to 16384 when the model has no declared limit, apply the 131072-token system safety ceiling, and inherit the selected model's Provider `timeoutMs` while retaining manual stop. `contextWindow` is the total request capacity rather than the answer length: for a 1M-context model configure `contextWindow = 1000000`, then configure `maxOutputTokens` separately from the Provider's documented single-response output limit. Model synchronization reads common upstream capacity aliases when available; because `/models` has no universal capacity schema, missing values remain editable through common presets or direct numeric input. If `finishReason = length`, the response was stopped by the effective model output limit.

AI Chat stores sessions in `sys_ai_chat_session` and messages in `sys_ai_chat_message`. Sessions are scoped to the current user. Assistant messages transition through `streaming`, `completed`, `stopped`, or `failed`; stale streaming records are recovered as failed. Context governance uses a CJK-aware conservative estimate, reserves output tokens, keeps a recent-message window, and stores a deterministic summary of compacted history. Agent execution persists `sys_ai_agent_run`, `sys_ai_agent_run_step`, and `sys_ai_tool_approval` records. Approval decisions are claimed atomically; duplicates return HTTP 409 and cannot execute a tool twice. An approved tool produces a linked continuation Run (`parentRunId` and `sourceApprovalId`), so refresh/retry can recover the chain without presenting it as an unrelated Run. Approval records can include `planHash`, affected files, validation output, expiry, approver, decision time, and execution time. Expired, denied, or replayed approvals do not execute their tool. Server-side tools are selected from one fixed handler registry that owns input schema, risk, approval defaults, and execution dispatch; configuration cannot inject executable code.

`browser-location` is a Client Tool rather than a server-side location lookup. The Agent may request it only when a task needs the user's current area and no city or region was supplied. Chat displays an explicit one-time permission action before calling `navigator.geolocation`; denial, unsupported browsers, and timeout are submitted as valid results so the same Agent run can ask for a city instead of failing. Coordinates are rounded in the browser and again on the server before persistence. Operation logs record only the capability and result status, never coordinates.

Web Search connections are independent resource records in `sys_ai_web_search_provider`. API keys
are encrypted and list responses expose only `hasApiKey`. The built-in `web-search` Tool accepts
only `query` and `limit`; Provider endpoint, authentication, timeout, and result ceiling always come
from server-owned configuration. Active Providers run by ascending `sort`, falling through on
timeout, error, or empty results. Tool output stores normalized `title`, `url`, `snippet`, optional
`publishedAt`, `source`, and sanitized attempts in the Agent Step. Chat SSE emits a separate
`sources` event, and the Assistant message persists the same server-derived sources in
`metadataJson`; the source panel never treats model-authored links as verified citations. When no
search Provider is active, the Tool is not exposed to the Agent.

Mastra Workflows are selected from a server-side static registry and persist governance records in
`sys_ai_workflow_run` and `sys_ai_workflow_run_step`. The first registered Workflow,
`ai-runtime-preflight`, deterministically checks Agent, Provider, Model, Tool Registry, approval
policy, RequestContext, and data-scope readiness. It does not call the external model and does not
change configuration. Mastra runtime DDL remains disabled; these tables are owned by the Admin Base
migration chain.

The built-in module-development Agent exposes only `module_design`, `module_generate_draft`,
`module_preview_diff`, `module_validate`, `module_publish`, and `module_rollback` through the existing
AI Chat/Agent streaming and approval APIs. It does not expose shell, raw filesystem, or Git APIs.
`module_publish` and `module_rollback` always require a human approval and the
`system.moduleGenerator.publish` permission.

## OAuth

OAuth providers are resource configurations stored in `sys_oauth_provider`.

| Method | Path                                    | Description                                                   |
| ------ | --------------------------------------- | ------------------------------------------------------------- |
| GET    | `/api/system/oauth/provider`            | Provider paged query                                          |
| POST   | `/api/system/oauth/provider`            | Create provider                                               |
| PUT    | `/api/system/oauth/provider/:id`        | Update provider                                               |
| DELETE | `/api/system/oauth/provider/:id`        | Delete provider when allowed                                  |
| PUT    | `/api/system/oauth/provider/status/:id` | Toggle provider status                                        |
| POST   | `/api/system/oauth/provider/test`       | Validate provider configuration shape                         |
| GET    | `/api/system/oauth/:provider/redirect`  | Start OAuth login, generate state, redirect to provider       |
| GET    | `/api/system/oauth/:provider/callback`  | Validate state, exchange token, load user info, login or bind |

Login options only expose enabled providers and always return the local redirect endpoint, not the third-party `authUrl`.

Profile OAuth account APIs:

| Method | Path                                         | Description                                        |
| ------ | -------------------------------------------- | -------------------------------------------------- |
| GET    | `/api/system/profile/oauth/accounts`         | My bound OAuth accounts                            |
| POST   | `/api/system/profile/oauth/:provider/bind`   | Start binding flow                                 |
| DELETE | `/api/system/profile/oauth/:provider/unbind` | Unbind provider, with last-login-method protection |

OAuth login writes `sys_login_record` with `loginMethod = oauth:<provider>` and writes operation logs for successful login, bind, and unbind. Failed redirect/callback paths write failed login records without exposing sensitive provider errors to the browser.

## Profile

| Method | Path                                | Description                                   |
| ------ | ----------------------------------- | --------------------------------------------- |
| GET    | `/api/system/profile`               | Current user profile                          |
| PUT    | `/api/system/profile`               | Update allowed self-service fields            |
| PUT    | `/api/system/profile/password`      | Change password after old password validation |
| POST   | `/api/system/profile/avatar`        | Upload avatar image through file module       |
| GET    | `/api/system/profile/login-records` | My login history                              |

Users cannot self-edit username, role, department, status, or data scope.

## Notice And Message Center

| Method | Path                                 | Description                                            |
| ------ | ------------------------------------ | ------------------------------------------------------ |
| PUT    | `/api/system/notice/publish/:id`     | Publish notice                                         |
| PUT    | `/api/system/notice/revoke/:id`      | Revoke notice                                          |
| GET    | `/api/system/notice/:id/read-stats`  | Read stats: `targetTotal`, `readTotal`, `unreadTotal`  |
| GET    | `/api/system/notice/:id/read-users`  | Paged read detail by user, department, and read status |
| GET    | `/api/system/notice/my`              | Current user's visible notices                         |
| GET    | `/api/system/notice/my/unread-count` | Current unread count                                   |
| POST   | `/api/system/notice/my/:id/read`     | Mark one notice read                                   |
| POST   | `/api/system/notice/my/read-all`     | Mark all visible notices read                          |

Supported notice scopes are all users, selected users, selected roles, and selected departments. Scheduled publish uses query-time visibility: a future `publishedAt` notice becomes visible after that time without a queue worker. `expiresAt` removes it from user visibility after expiration.

## File

| Method | Path                                 | Description                                                                       |
| ------ | ------------------------------------ | --------------------------------------------------------------------------------- |
| POST   | `/api/system/file/list/upload`       | Normal upload with upload policy validation                                       |
| GET    | `/api/system/file/list/download/:id` | Download with safe response headers                                               |
| GET    | `/api/system/file/list/preview/:id`  | Preview when policy allows inline rendering                                       |
| GET    | `/api/system/file/list/trash`        | Trash list                                                                        |
| PUT    | `/api/system/file/list/rename/:id`   | Rename file                                                                       |
| PUT    | `/api/system/file/list/move`         | Move files                                                                        |
| POST   | `/api/system/file/list/copy`         | Copy files                                                                        |
| DELETE | `/api/system/file/list/clean-trash`  | Physically clean trash when not referenced                                        |
| DELETE | `/api/system/file/list/force/:id`    | Permanently delete a file and its references; requires `system.file.forceDelete`  |
| POST   | `/api/system/file/list/batch-force`  | Permanently delete files and their references; requires `system.file.forceDelete` |

Chunk upload APIs:

| Method | Path                                   | Description                                                       |
| ------ | -------------------------------------- | ----------------------------------------------------------------- |
| POST   | `/api/system/file/chunk/init`          | Initialize upload session                                         |
| POST   | `/api/system/file/chunk/part`          | Upload one part with optional client `sha256`                     |
| POST   | `/api/system/file/chunk/complete`      | Validate sequence, size, part hash, policy, and create final file |
| DELETE | `/api/system/file/chunk/:uploadId`     | Cancel session and remove temporary files                         |
| DELETE | `/api/system/file/chunk/clean-expired` | Mark expired sessions and remove temporary files                  |

File reference APIs:

| Method | Path                              | Description                  |
| ------ | --------------------------------- | ---------------------------- |
| POST   | `/api/system/file/reference`      | Register business reference  |
| DELETE | `/api/system/file/reference`      | Remove business reference    |
| GET    | `/api/system/file/:id/references` | List references for one file |

Upload policy includes `maxUploadSizeMb`, extension allow/deny lists, MIME check, magic-byte check, and `dangerousFileStrategy = reject | isolated-download | force-download`. Denied extensions override allowed extensions. Dangerous inline rendering is blocked by policy and `X-Content-Type-Options: nosniff`.

## Logs And Online Users

Login logs:

| Method | Path                          | Description                               |
| ------ | ----------------------------- | ----------------------------------------- |
| GET    | `/api/system/login/log`       | Query login logs                          |
| DELETE | `/api/system/login/log/clean` | Clean login logs with operation log audit |

Online sessions:

| Method | Path                                    | Description             |
| ------ | --------------------------------------- | ----------------------- |
| GET    | `/api/system/online/user`               | Query online sessions   |
| DELETE | `/api/system/online/user/:id`           | Force one token offline |
| DELETE | `/api/system/online/user/clean-expired` | Clean expired tokens    |

Operation logs:

| Method | Path                               | Description                                             |
| ------ | ---------------------------------- | ------------------------------------------------------- |
| GET    | `/api/system/operation/log`        | Query operation logs                                    |
| GET    | `/api/system/operation/log/stats`  | Module stats and filter labels resolved from `sys_rule` |
| GET    | `/api/system/operation/log/export` | Export CSV using current filters                        |
| DELETE | `/api/system/operation/log/clean`  | Clean logs by filters with critical audit log           |

Operation log query supports:

```text
module=system.user&action=delete&success=false&requestId=...&ip=...&riskLevel=high&createdAtRange=...
```

`riskLevel` is `low | medium | high | critical`. Details JSON includes request/response/error context where available, and update actions can include `changedFields` with sensitive values masked.

The stats response keeps `module` as the stable audit code and returns `label` from the matching
active `sys_rule` record. The operation-log UI uses the modules that actually exist in the audit
table, so new permission-backed modules become filterable without adding page-local options.

## Dashboard And Doctor

| Method | Path                            | Description                          |
| ------ | ------------------------------- | ------------------------------------ |
| GET    | `/api/system/dashboard/summary` | Real system status summary           |
| GET    | `/api/system/doctor`            | Authenticated production diagnostics |

Dashboard summary includes today's successful and failed logins, current online users, today's operation log count, recent high-risk operations, file storage usage, default storage and mail status, recent notices, and doctor summary. The page links each actionable metric to the owning module.

Doctor checks include environment, database, migration, admin user, admin role, default storage, storage connection, upload directory, default mail, and production safety. `/api/ready` remains unauthenticated for infrastructure readiness.

## Permission Rules

- `sys_rule` is the source of truth for menu and action permissions.
- `src/router/route-manifest.ts` binds frontend pages to permission codes.
- CRUD routes must declare permissions through the CRUD factory config.
- Explicit side-effect routes must use `ability("<permission>")`.
- `pnpm admin:check-routes` fails when route manifest, seed rules, API ability codes, or CRUD permissions diverge.
- Role, user-role, and data-scope changes revoke affected token snapshots so stale permissions cannot continue indefinitely.

## Module Generator

The module generator is exposed as a Web development tool and keeps the same conservative boundary as the CLI generator.

| Method | Path                                             | Description                                                                                |
| ------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| GET    | `/api/system/module/generator/example`           | Return the example CRUD generator config                                                   |
| GET    | `/api/system/module/generator/drafts`            | List generated modules and whether each is draft or published                              |
| GET    | `/api/system/module/generator/capabilities`      | Return generator features, supported publish domains, ownership, and rollback capabilities |
| GET    | `/api/system/module/generator/schema`            | Return the shared Admin Module JSON Schema used by CLI/Web/Agent callers                   |
| GET    | `/api/system/module/generator/drafts/:name/diff` | Build a non-writing publish plan with plan hash, conflicts, and per-file before/after diff |
| POST   | `/api/system/module/generator/generate`          | Generate a reviewable module draft under `generated/module-drafts`                         |
| POST   | `/api/system/module/generator/publish`           | Verify the reviewed plan in an isolated source copy, snapshot targets, and publish it      |
| POST   | `/api/system/module/generator/rollback`          | Roll back a recorded source publish when no published file has been manually changed       |

`publish` accepts `{ name, planHash }`. The server recomputes the plan and rejects a stale hash.
Successful publication stores before/after hashes, backups, validation output, and applied paths in
the ignored draft directory. `rollback` restores source only; it does not reverse migrations that
have already executed. Publish and rollback operations are serialized by a filesystem lock because
all modules modify shared integration files.

The capabilities response distinguishes built-in generated page actions from API actions that need
custom UI, and declares the delete-family ability aliases. Module input is strict: unknown keys,
non-kebab module names, duplicate fields/columns, missing `query`, invalid status fields, and restore
without soft delete are rejected by both CLI and Web callers. Drafts missing current contract
snippets must be regenerated before diff or publish.

The Agent validation path additionally stores the exact plan hash, affected files, and isolated
validation output. An Agent publication approval cannot be created until the current plan has passed
`module_validate`; a stale plan or changed file set invalidates that evidence. Production rejects
Agent design/generation/diff/validation/publication/rollback execution as a development-only
capability.

Generation and publish are rejected in production. Generate writes to `generated/module-drafts` and does not go live. Publish applies the reviewed draft to real source files and should be followed by `typecheck`, `lint`, `test`, `admin:check-routes`, and `build`.

Automatic publish currently supports `domain: "system"` only. For a CMS configuration CRUD page, use
`domain: "system"`, `frontendPath: "/system/cms/config"`, and
`backendBasePath: "/cms/config"`; the resulting API is `/api/system/cms/config`. Publishing real
`/api/cms/*` modules requires adding a CMS backend domain mount first.

Required permissions:

```text
system.moduleGenerator.query
system.moduleGenerator.generate
system.moduleGenerator.publish
```
