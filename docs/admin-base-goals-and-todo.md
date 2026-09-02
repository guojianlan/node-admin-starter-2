# Admin Base 目标与 TODO 总览

更新时间：2026-08-26  
审计分支：`codex/upgrade-next-16-3-1`  
审计方式：以当前源码、数据库 schema、路由、测试清单和现有设计文档为准；本文件不把历史计划或设计讨论当成已交付代码。
本轮实现核对：`pnpm typecheck`、`pnpm test`、`pnpm test:check-cases`、`pnpm admin:check-routes` 和 AI 专项测试已重新执行。

业务与 AI 的长期实施顺序、技术预研和完整业务需求见
[`admin-base-business-ai-roadmap.md`](./admin-base-business-ai-roadmap.md)。本文件继续作为当前能力审计与近期
P0/P1/P2 TODO 来源；长期路线图不会把本文的待验收项自动视为已完成。

架构决策（已确认）：

- **AI SDK 7**：保留，作为默认 Model Runtime。
- **Mastra**：提升为默认编排层候选，先完成 M3-M7 迁移闸门，再决定是否默认启用。
- **Admin Base**：始终保留权限、数据范围、审批、审计、Provider/Model 配置和费用账本控制权。

## 1. 这份文档解决什么问题

Admin Base 当前已经不是“只有用户、角色和菜单的后台模板”，而是一个 PostgreSQL-first、Next.js + Hono
单应用、Ant Design 管理端、带 AI 运行治理的业务开发基础框架。本文件固定三件事：

1. 记录长期目标，避免后续开发只追逐单个页面或单个 AI Demo。
2. 区分已经在当前代码中存在的能力、已经实现但缺少真实环境验收的能力，以及尚未实现的能力。
3. 为下一轮开发提供按优先级排序的 TODO。TODO 的优先级不等于“越复杂越先做”，而是按生产风险、数据安全和对主链路的阻塞程度排序。

当前结论：

> Admin Base 的后台主线和 AI 基础主线已经达到可继续承载业务开发的阶段；但“生产闭环”和“高级平台能力”还没有全部完成。当前不能把所有技术设想都称为 100% 完成，也不能把真实外部凭据、浏览器视觉和生产部署验证的缺失隐藏在自动化测试通过之后。

这项架构决策意味着 Mastra 是编排层的升级方向，不是对 AI SDK 或 Admin Base 的整体替换。业务模块应依赖 Admin Base 的统一 AI Runtime/Orchestrator 接口，不应在业务代码中同时直接耦合 AI SDK 和 Mastra。

## 2. 长期目标

### 2.1 基础后台目标

- 使用 PostgreSQL 作为业务事实和迁移事实来源，Drizzle schema 与项目 migration 保持一致。
- 使用 Next.js + Hono 单应用承载页面和 API；普通业务模块不拆第二个后端服务。
- 使用 `sys_rule` 作为菜单、页面权限和 API ability 的 source of truth；route manifest 只负责前端路由绑定。
- 普通关系型 CRUD 使用 CRUD Factory；认证、密码、Token、OAuth、AI 流式调用、文件物理操作、发布和连接测试使用显式 service/route。
- 每种业务数据必须声明全局、部门、用户、部门与用户或自定义归属；服务端执行 data scope，不能只依赖前端隐藏。
- 所有重要写操作有 `sys_operation_log` 证据；高风险动作有风险等级、requestId、脱敏详情和可追溯结果。
- 管理端页面具有稳定的 Shell 高度、内部滚动、URL 查询状态、页签/缓存策略、浅色/暗色主题和可用的 loading/empty/error/denied 状态。
- 代码生成器生成的是待审查草稿；只有经过 diff、权限、路由、测试和人工审批的发布才会成为真实项目源代码。

### 2.2 AI 平台目标

统一链路应保持为：

```text
业务页面 / Chat / Agent / Notebook / Eval
  -> Purpose Resolver
  -> AI Model
  -> AI Provider（Base URL、密钥、网络超时、Provider 能力）
  -> AI SDK adapter
  -> Invocation / Attempt / Usage / Health / Trace
```

目标能力：

- Provider、Model、用途级主模型和有序候选模型统一治理。
- Chat、Agent、RAG、Eval 共用模型选择、费用账本、Provider 健康和失败回退。
- Agent 使用受控 Tool、Knowledge Tool、Runtime Skill、MCP Tool 和 Approval，不允许任意代码执行。
- Run、Step、Approval、Invocation、Attempt 可审计、可恢复、可诊断。
- Knowledge/RAG 提供权限过滤、版本化文档、语义/关键词检索、Rerank、Grounded Answer 和引用。
- Notebook 组织长期来源、基于来源的问答、联网研究和可保存 Artifact。
- Eval 固化真实 Run，支持确定性断言、LLM Judge 和 groundedness 辅助指标。
- Worker、Outbox、熔断、配额和账本为长任务与成本治理提供基础，但不提前引入不必要的外部基础设施。

### 2.3 业务落地目标

框架要能快速承载以下业务，而不是只展示 AI 能力：

- CRM：客户、联系人、跟进记录、标签、兴趣、唤醒任务和触达记录；业务数据按组织或负责人隔离。
- 企业知识库：制度、产品、项目和技术文档的上传、版本、检索、引用和问答。
- Notebook/PPT：从受控知识来源生成摘要、提纲、FAQ、简报和后续演示文稿素材。
- 数据后台：常规增删改查与权限控制；AI 通过只读 Schema/Query Tool 查询业务数据，输出可解释结果，不绕过业务权限直接执行 SQL。
- 供应链：供应商、采购、库存、订单和异常数据的常规管理，以及基于数据范围的问答和分析。

这些是框架的验证场景，不代表当前仓库已经包含完整 CRM、供应链或财务业务模型。

## 3. 当前已完成基线

以下内容在当前源码/迁移/路由中已有实现基础，不列为立即重做项：

### 3.1 后台和生产基础

- 用户、角色、菜单/规则、部门、字典、配置、存储、邮件、短信、OAuth、公告、文件、登录日志、在线会话和操作日志管理。
- 密码复杂度、历史密码、强制改密、密码过期、失败锁定、验证码升级、Token 撤销和敏感操作确认。
- 公告的用户/角色/部门范围、发布时间、有效期、撤回、已读、全部已读和阅读统计。
- 文件类型/MIME/魔数校验、上传策略、大文件分片、取消/清理、引用保护、安全下载响应头和 Knowledge 文件隔离。
- 系统设置聚合页与资源型配置分离；存储、邮件、OAuth、SMS、AI Provider 不合并进普通 `sys_config_items`。
- Dashboard 真实系统状态、doctor、health/ready、生产 `db:reset` 防护、CI 基础和非破坏性 smoke 脚本。
- 页签、页签右键操作和 `disabled | tabs | tabs-cache` 页面持久化模式基础。
- CLI/Web/Coding Agent 共用模块生成契约、草稿、diff、发布、回滚、权限和路由检查基础。

### 3.2 AI 运行与治理基础

- AI Provider 密钥加密、启停、连接测试、模型同步和模型能力/上下文/输出上限配置。
- AI SDK 7 的 Chat、结构化输出、Embedding、Rerank 和流式测试适配；不支持的 Provider 能力会 fail closed。
- AI Chat 会话、System Prompt、会话模型、上下文压缩、消息状态、停止、重新生成、使用量和导出。
- Agent、Tool、Run、Step、Approval，以及批准后的 continuation Run。
- Web Search Provider chain、按优先级失败回退、来源持久化、来源 SSE 和 Tool Step 审计。
- purpose-level 主模型/有序候选、响应开始前回退、Invocation/Attempt 费用证据、Provider 成功率和 P50/P95。
- LiteLLM 价格目录的 HTTPS 获取、Hash 快照、差异预览、显式应用和手工覆盖 provenance。
- Knowledge/RAG v1：TXT/Markdown/PDF/DOCX、版本化 chunk、Embedding、PostgreSQL 全文 + cosine 混合检索、可选 Rerank、Grounded Ask、RAG Run、Citation 和 Agent Knowledge Tool。
- Notebook v1：知识库/文档来源、网站安全抓取、搜索结果选择导入、Deep Research、引用快照、Artifact、viewer/editor 协作和 PostgreSQL Worker。
- Eval/Trace v1：Dataset/Case/Run/Result、真实 Run 固化、确定性断言、LLM Judge/groundedness 辅助指标和 Trace 回链。
- User/Agent Memory 的手工或确认写入、Runtime Skill 的受控指令与 Tool 绑定、受控远程 MCP、Provider 持久熔断、PostgreSQL Worker、配额和估算账本。

### 3.3 当前机器可验证基线

本次审计已执行：

```bash
pnpm admin:check-routes
pnpm test:check-cases
```

结果为：

```text
Route consistency check passed
Test-case coverage check passed: 364/364 API operations, 36/36 pages
```

这只证明路由/权限和机器可读测试清单完整，不等于所有业务断言、浏览器视觉和外部 Provider 已通过。
2026-09-01 已执行 `pnpm admin:verify --full`：typecheck、全仓 ESLint、37 个 Test Files/598 个 tests、
364/364 API、36/36 页面清单、route check 和 Next.js 16.3.1 Turbopack build 全部通过。Workflow 页面另已
完成人工浏览器验收；`pnpm smoke`、其余页面和成功的真实外部 Provider 验收仍是发布前门禁，不能被自动化
测试结果替代。

## 4. P0：必须收口后才能宣称生产闭环

P0 是当前最重要的 TODO。它们不是都要在同一个提交完成，但在正式发布前必须有代码、测试和环境证据。

### P0-1 Agent Run 运行权和租约 fencing

历史现状：`sys_ai_job` 有 `FOR UPDATE SKIP LOCKED`、`lease_until`、`locked_by`、attempt、heartbeat 和重试；早期
`sys_ai_agent_run` 只有状态、步骤统计和时间字段。当前实现已经由常驻 Worker 接管 queued/过期 Run。

TODO：

- 给长时间 `Agent Run` 增加 `attempt`、`lease_owner`、`lease_until`、`heartbeat_at` 和必要的 scope/capability 版本字段。
- Worker 接管后，旧 attempt 不能继续写 Step、Run 结果、续租，不能继续调用 Tool、MCP、Knowledge 或 Model。
- Tool、MCP、Knowledge 和 Model 调用统一执行 Run 级实时授权，而不是只在 Run 开始时检查一次。
- 外部副作用 Tool 使用 `runId + attempt + toolCallId` 做幂等去重，防止租约超时后重复发送。
- 增加并发接管、旧 attempt 写入、续租失败、停止和恢复的自动化测试。

当前实施记录（2026-08-25）：

- 已完成 Agent Run 的 `attempt`、`lease_owner`、`lease_until`、`heartbeat_at` schema/migration，
  并在 legacy Agent、Mastra Agent、Chat SSE 和 Eval Runtime 接入租约 owner、续租和过期拒绝。
- Step、Tool、Approval 和终态更新在带 owner 的执行路径中都会校验当前 Run 的有效租约；旧 owner
  不能继续执行受控 Tool、创建审批、追加 Step 或覆盖终态结果。
- 审批续跑会在原 Run 上切换到新的 attempt 和 lease owner，避免唯一审批记录产生并行续跑。
- 已补充 `tests/api/ai-agent-approval.test.ts`，覆盖正确/错误 owner、过期、工具执行阻断、审批阻断、
  完成后租约清理和审批续跑 attempt 递增；legacy/Mastra/Eval 相关专项测试已通过。
- 已增加 `sys_ai_tool_execution`（迁移 `0049_ai_tool_execution_idempotency`）。带 Run 租约的 Tool
  执行会记录 `runId + attempt + toolCallId`；同一完成记录返回已保存结果，并发执行或失败调用拒绝复用，
  审批执行也使用同一记录，避免外部副作用重复提交。
- 尚未完成的边界：真实多节点长时间 Provider 调用、进程强杀恢复和生产压力证据仍属于 P0-3；代码路径和
  跨 attempt 专项测试已经接入，不能把测试通过误写成生产环境已经验收。

本轮收口（2026-08-26）：常驻 `runAiWorker` 已先领取 Agent Run，再领取普通 `sys_ai_job`；Worker
执行使用同一 Run/Attempt/Lease、重建 Chat 上下文并写入 Run Event。接管后的每个事件、Step、Tool、
终态和消息写入都会再次验证 lease；旧 attempt 不能覆盖新 attempt。`tests/api/ai-agent-approval.test.ts`
已覆盖两个 Worker 并发 claim、过期接管、旧 owner heartbeat/write/tool 阻断、审批续跑和幂等 Tool。

### P0-2 流式事件持久化和断线恢复

现状：Chat/Agent 主要在请求内向浏览器发送 SSE；没有统一的 `agent_run_event`、事件 sequence 和 `Last-Event-ID` 回放协议。

TODO：

- 增加统一 Run Event 表或等价事件存储：`eventId/runId/attempt/sequence/type/payload/createdAt`。
- SSE 支持 `Last-Event-ID`，浏览器刷新、网络断开、睡眠恢复后从持久事件重建状态。
- 前端用数据库 Run/Step/Event 恢复 loading、thinking、approval、completed、stopped、failed 和 truncated 状态。
- 流式输出已经开始后，不能切换到候选模型；断线重连也不能重复写 Assistant 正文或重复计费。
- 增加事件顺序、重复事件、断线续传和客户端取消测试。

当前实施记录（2026-08-25）：

- 已增加 `sys_ai_agent_run_event` 及迁移 `0048_ai_agent_run_events`，事件按 Run、attempt、sequence
  持久化；Agent Chat 的 `meta`、delta、Tool、来源、Approval、finish 和 error 事件会先落库再发送，
  SSE 同时带有数据库事件 ID。
- 已增加 `/api/system/ai/chat/sessions/{id}/runs/{runId}/events` 回放 API，支持
  `Last-Event-ID` 或 `afterEventId`，并将事件纳入 Trace/Latest Run 查询。
- 已完成浏览器端的回放恢复基础：SSE 解析器保留事件 ID；Chat 断流后从 `run/latest` 和事件接口恢复
  Assistant delta、来源、Tool、审批和终态，不重新提交用户消息；运行仍为 `running` 时继续轮询，终态
  以持久化消息为准，避免重复正文和重复计费。
- 当前尚未完成：多标签页/跨进程的端到端断线测试、事件乱序模拟、真实浏览器睡眠恢复和客户端取消的
  生产环境验证。因此本项仍是“客户端恢复已实现，生产恢复证据未完成”。

### P0-3 发布前完整验收

TODO：

- 运行当前发布门禁：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:check-cases`、`pnpm admin:check-routes`、`pnpm build`、`pnpm smoke`。
- 在隔离 PostgreSQL 空库验证 migration/seed/test/build/route check 的 CI 全链路。
- 启动并验证长期 AI Worker、heartbeat、重试、取消、故障恢复和监控；不能只验证 `--once`。
- 依次用本地 Docker 验收 MinIO、Mailpit、Keycloak、SMS Mock 和 AI Mock；保留成功证据，完成后关闭容器。
- 在独立 staging 使用最小权限真实凭据验证 S3、SMTP、OAuth、SMS、AI Provider；明确云服务能力不能由 Mock 结果替代。
- 执行真实 Provider Chat/Embedding/Rerank、Web Search、Judge/RAG 和 fallback 验收，并记录 Provider/Model/网络限制。
- 浏览器手工验收所有 36 个页面的核心路径、浅色/暗色、窄屏、内部滚动、页签/缓存、表格和错误态；这仍是环境/手工边界。

2026-09-01 验收记录：

- 完整自动门禁和生产 build 已通过；本轮没有运行需要安全 smoke 凭据的 `pnpm smoke`。
- `acceptance:workflow-recovery` 在本机隔离 `admin_base_test` 中以两个真实 Node 进程验证 `SIGKILL`、租约
  过期、第二 Worker 接管、Timer 长等待、Child Human Input 暂停和 Parent 恢复。Timer 与父子 Job 均
  `attempts=2`，没有重复 Step 或遗留 owner。
- Workflow 页面已人工验证桌面/390px、浅色/暗色、两侧面板、Schema 表单、父子 Run 导航和运行抽屉；
  修复了无 edge id、已弃用 InputNumber 属性、窄屏三栏挤压、React Flow 零高度及暗色控件白底。
- 真实 Chat Provider 压测已通过受费用确认的 `acceptance:ai-provider-pressure` 执行。当前 `chat` 用途只有
  一个候选模型，5 并发和冷却后的 half-open 单请求都被上游 `Too Many Requests` 拒绝；调用无 stuck，
  Invocation/Attempt 正常落库并归类为 `rate_limit`，但没有成功请求，也无法验证 fallback。因此真实
  Provider 验收状态仍为失败，必须在恢复配额并配置至少一个候选模型后重跑。
- 尚未完成的是全站 36 页人工浏览器、真实多主机/网络分区/数小时运行、外部 S3/SMTP/OAuth/SMS、
  smoke 和成功的 Provider Chat/Embedding/Rerank/Web Search/Judge/RAG/fallback 环境证据。

### P0-4 关键测试缺口

现有功能测试清单中仍需补齐或实际执行：

- `AUTH-015`：SMTP 失败时忘记密码仍防枚举，后台可追踪失败。
- `CHAT-005`：完成、失败、停止、`length` 四种流结束状态都不残留 loading。
- `PROFILE-002`：头像上传后 Profile、Header、AI Chat 三处同步。
- `AGENT-004`：模型回复完成后 Run/Step 是 completed，不残留 spinner。
- `APPROVAL-002/003/005`：审批批准/拒绝/结果在聊天窗口内按紧凑信息展示，完整 JSON 只在检查器查看。
- `PLAY-001/002/003` 和 `AIP-004`：Provider/Playground 弹窗流式 Markdown、截断提示、主动停止和错误恢复。
- `CHUNK-007`：前端分片上传单片重试、取消、过期清理和刷新恢复。
- `SEARCH-005/007`：搜索来源 UI，以及本地 SearXNG 启停和 Provider 回退。
- `GEN-006`：CMS 配置 CRUD 的文本、数字、开关、富文本、图片字段真实生成和发布。
- `PROD-007/009/010/011`：非破坏 smoke、上传持久化、备份恢复、Nginx/PM2 下 SSE/大文件/下载。

这些条目有些是代码已经存在但尚未自动化，有些需要浏览器或外部环境；验收时必须按测试文档的状态更新，而不是直接把状态改成 automated。

### P0-5 危险文件和下载安全

`.exe` 可以通过文件策略开放上传，但不应进入 Knowledge/RAG；当前 Knowledge 只支持 TXT、Markdown、PDF、DOCX。

TODO：

- 为 `.exe`、安装包、脚本和二进制建立明确的文件分类和管理员提示。
- 默认保持 `file.dangerous_file_strategy` 的拒绝或隔离下载；若开放，必须使用 `isolated-download` 或 `force-download`。
- 补齐危险文件下载响应头、`Content-Disposition`、`X-Content-Type-Options: nosniff` 和禁止 inline 执行测试。
- 评估并接入病毒扫描/恶意文件检测；没有 AV 集成前，不要把“上传成功”解释为“文件安全”。
- 保持文件管理、C 端用户文件和 Knowledge 文件的 `usage_type` 隔离。

### P0-6 正式版本前的 Mastra 编排架构评估

用户提出在第一个正式版本前把 Mastra 提上日程，这个方向纳入正式 TODO，但采用“先证明边界、再逐步迁移”的方式。当前仓库已经有 `@mastra/core`、`@mastra/pg`、`legacy|mastra` 运行开关、`general-assistant` canary 和静态 Workflow Registry；这说明 Mastra 已经进入代码，但还不是完整 Agent Runtime 的替代品。

当前收口结果：`general-assistant` 已可走 Mastra Agent；可视化 Workflow 已提供草稿、版本、发布、运行和
Run/Step 记录，线性图由真实 Mastra Workflow Runtime 执行，非线性图保留 Admin Base 图执行器并按依赖拓扑
执行，明确了当前 Mastra 动态图能力尚未完全替换的边界。
画布支持输入、文本转换、模型、条件、输出节点、连线、节点配置和删除，后续可在不改变治理边界的前提下扩展
并行、循环和 Suspend/Resume 节点。

本轮补充（2026-08-26）：画布已增加 Agent、Tool、Mapping、Parallel、Branch/Conditional、Foreach、Loop、
Sleep、Sleep Until 和子 Workflow 节点；草稿保存时生成 Mastra `WorkflowBuilderDefinition`，发布时执行
Mastra preflight、Agent/Tool/子 Workflow Registry 引用校验和 schema 兼容校验。Mapping 只允许 JSON-safe
声明式来源，审批型 Tool 不能被 Workflow 绕过。旧版 Model 节点仍可暂存历史草稿，但发布会要求迁移到
Agent 节点。复杂节点由 Admin Base 受治理执行入口运行；动态子 Workflow 和持久暂停恢复的当前状态见下方
最新实施记录。把全部节点切换到 Mastra Dynamic Workflow runtime 仍是后续闸门，不能把画布节点增加误写成
Mastra Studio 已嵌入。

P0/P1 节点收口（2026-08-27）：画布和受治理执行器已经增加 LLM、Aggregate、Retry、Approval、Event Wait、
Knowledge、State、Terminate、Memory Read/Candidate、Human Input 和 Document Parser。超过 30 秒的 Sleep、
Sleep Until、Approval、Event 和 Human Input 会持久化 Wait/continuation，并由审批、精确 correlation key 或
PostgreSQL `workflow_resume` Job 恢复同一个 Run；Document Parser 只提交常驻 Worker Job。发布的子 Workflow
已经可以动态执行并限制最大 8 层。自定义治理节点目前仍以 JSON-safe 占位合同进入 Mastra Builder 预检，
实际语义由 Admin Base executor 执行，不能标记为 Mastra 原生节点。

后续收口（2026-09-01）：父子 Workflow 已保存 parent Run/node/call depth。子 Run 持久暂停时父 Run 创建
`child_workflow` Wait；子流程完成或失败后解析父 Wait，并由 PostgreSQL Worker 恢复父流程。Human Input
运行抽屉已经按 Schema 渲染文本、数字、布尔、枚举和结构化字段，服务端再次校验 Schema，不能通过直接调用
API 绕过必填和类型约束。

本机多进程强杀、租约过期、长 Timer、父子暂停接管、Workflow 浏览器和生产 build 已有 2026-09-01
验收证据。真实 Provider 压测也已执行，但上游 429 导致零成功，且当前没有第二候选模型可验证 fallback。
剩余闸门是实际多主机/网络分区/数小时运行、成功 Provider/fallback、全站浏览器和 smoke；在这些环境证据
完成前，不能宣称 Mastra M3/M4 生产迁移全部完成。

#### 目标架构

```text
Admin Base 产品/治理层
  -> Mastra Agent / Workflow / Memory / Eval 编排层
  -> AI SDK 7 Model / Tool / Stream / Embedding 运行时
  -> Provider adapter（OpenAI、Anthropic、Google、Compatible）
```

职责必须保持清晰：

- Mastra 负责 Agent Loop、Workflow、Suspend/Resume、编排、Memory、Eval、MCP 和可观测性适配。
- AI SDK 7 继续负责 Provider/Model、`streamText`、结构化输出、Tool Calling、Embedding、Rerank 和流协议适配。
- Admin Base 继续拥有 `sys_rule`、data scope、Approval、`sys_operation_log`、Invocation/Attempt、账本、业务数据和页面。
- Mastra 不得建立第二套用户、权限、Provider、Chat、审批、费用或业务数据库 source of truth。
- Mastra Storage 不得在运行时自动 DDL；数据库结构必须由 Admin Base migration 管理。

#### TODO：Mastra M3/M4 评估和迁移闸门

- 锁定 Mastra Core/PG 版本、许可证、Node/Next.js 兼容性和升级策略；禁止直接跟随 alpha/nightly。
- 建立最小 PoC：确定性 Workflow、长步骤、暂停/恢复、取消、超时、失败重试和人工 Approval。
- 建立 Agent PoC：流式输出、Tool Calling、并行 Tool、Tool 失败、候选模型回退、Run/Step 持久化和 SSE 事件归一化。
- 将当前 `RequestContext`（userId、abilities、requestId、dataScope、runId、attempt、scopeVersion）完整传入 Mastra Agent/Workflow，验证不会丢失权限上下文。
- 验证 Mastra Memory 与当前 User/Agent Memory 的边界；短期上下文、跨会话 Memory 和用户确认写入不能产生两套冲突数据。
- 验证 Mastra MCP、Knowledge/RAG Tool、Eval Judge 和 Trace 是否能复用现有 Tool Registry、审批、引用、账本和审计。
- 对比 AI SDK legacy 与 Mastra canary 的首字时间、总耗时、Token、费用、Tool 顺序、错误类型、取消和流结束状态。
- 验证持久化恢复：进程重启、Worker 接管、网络断开、Approval 等待、重复事件和幂等 Tool 调用。
- 保留 `legacy|mastra` 灰度开关和按 Agent/Workflow 迁移能力，Mastra 失败不能静默切回 legacy 造成重复副作用。
- 建立 Mastra 版本升级回归集，覆盖 Chat、Agent、Workflow、Knowledge/RAG、Notebook、Eval、MCP 和 Billing。

#### 正式版本前的迁移顺序

1. **M3：编排 PoC**：只迁移 `general-assistant` 和一个无副作用 Workflow，验证事件、权限和数据库边界。
2. **M4：受控 Workflow**：迁移可暂停、可恢复、需要 Approval 的 Workflow；先不迁移模块开发 Agent。
3. **M5：Agent Runtime 灰度**：选择一个低风险 Agent，验证 Tool、Fallback、Trace、Usage 和停止恢复。
4. **M6：Knowledge/Notebook/Eval 接入**：只在 RAG 引用、来源 scope、Judge 和账本证据不退化后推进。
5. **M7：正式版本决策**：根据 PoC 证据决定“Mastra 作为默认编排层”或“保留双运行时”，并记录回滚方案。

#### Mastra 迁移完成定义

在下列条件全部满足前，不能宣布“已完成 Mastra 升级”：

- 现有 Chat、Agent、Approval、Workflow、Knowledge、Notebook、Eval、MCP 和 Worker 用例全部通过。
- 权限、数据范围、Approval、审计、Usage、费用、Provider 健康和 fallback 的语义与 legacy 等价或更强。
- Agent Run 有独立 attempt/lease/fencing；Workflow 和 Stream 支持持久事件恢复。
- Mastra 不创建未审查的表、不绕过 Admin Base migration、不输出未脱敏的 Prompt、Token 或业务数据。
- 旧 Agent 可以按配置回滚到 legacy，回滚不会重复调用外部副作用 Tool。
- 有真实 Provider、长任务 Worker、浏览器 Chat/Agent 和生产构建/smoke 证据。
- 版本升级有锁定版本、变更审查、迁移说明和可执行回滚方案。

#### 参考项目的采用决策

- **Mastra**：正式评估和渐进迁移的主参考，重点吸收 Workflow、Suspend/Resume、Memory、Eval、MCP 和 Trace。
- **AI SDK 7**：继续保留为 Provider/Model/Stream 基础，不因为引入 Mastra 就重复实现模型调用层。
- **DeepSeek Harness / Novex**：参考 Agent 生命周期、事件回放、权限 fencing、审批和 Worker 恢复，不直接引入其产品壳或任意插件执行模型。
- **Pi / pi-agent-core**：参考轻量 Agent Loop、steering/follow-up、Tool hook 和事件顺序；暂不替换 AI SDK Provider 层。
- **LangGraph 等其他 Workflow 框架**：只有 Mastra PoC 无法满足持久恢复、可观测性或业务隔离时再做对照，不同时引入多套编排框架。

详细对比和当前采用理由见 [`ai-runtime-framework-comparison.md`](./ai-runtime-framework-comparison.md)。

## 5. P1：建议在基础框架下一轮完成

### P1-0 SaaS Tenant/Workspace、成员与 Entitlement 控制面基础

- 2026-09-01 已接受共享数据库 + 强制 Tenant/Workspace 业务列的 ADR，创建系统默认 Tenant/Workspace，
  并为现有单组织用户建立幂等兼容成员关系。
- 已实现 `/api/saas/context`、Tenant/Workspace 查询/创建/更新、成员自定义范围、权限种子、操作日志以及
  `/saas/tenants`、`/saas/workspaces` 页面。
- 自动化覆盖默认上下文、Tenant + 默认 Workspace 原子创建、审计和跨 Tenant 列表/直接 ID 写入阻断。
- 2026-09-01 第二切片已实现 Tenant/Workspace 成员管理、邀请创建/接受/撤销/过期、Token Hash、邮箱绑定，
  模块目录、模块上架前 route/ability/依赖检查、Tenant Entitlement 和有效模块解析合同。
- 已增加 `/saas/members`、`/saas/modules` 和邀请自服务页；成员、邀请和 Entitlement 的跨 Tenant 直接 ID
  攻击、owner 保护、Token 重放以及未交付模块提前开通由自动化测试阻断。
- 2026-09-02 基座切片已增加 `saas_user_context`、服务端校验的 Tenant/Workspace 当前上下文、后台 Header
  切换器、请求 Header 传递和已上架产品的有效 Entitlement 菜单裁剪；上下文 Header 不作为授权证据。
- 2026-09-02 Foundation F2 已增加统一 `SaaSResourceScope`、新 SaaS 文件对象前缀与 `saas_file_binding`、
  Job/Tool/Export/Callback 的 `saas_async_operation` 运行封套、结构化 Tenant 审计和两个 Tenant 攻击矩阵。
- 尚未完成 Team、Studio Kernel、历史文件/Knowledge/AI Job/Tool 逐域迁移、用量和真实 S3/Worker/Provider 验收；
  本项状态为 `implemented-unverified`，不是完整多租户交付。

### P1-1 Notebook 来源版本与研究候选状态

当前进度：来源版本、研究候选生命周期和 Knowledge 可见范围的跨 Notebook 失效通知已落地；常驻
Worker Parser Job 和管理员候选审核 UI 已接入，仍需真实长期 Worker/大规模文件环境验收。

- 已给 Notebook 增加 `source_scope_version`；新建从 `1` 开始。
- 添加/删除来源、修改 Notebook 成员或 Notebook 配置时递增版本；Knowledge Base 更新/删除、Document 状态变化
  和 Document 删除也会递增所有关联 Notebook 的 `source_scope_version`。
- Notebook Ask、Artifact 和 Deep Research Artifact 都携带创建时的来源版本；模型调用返回后再次校验版本，来源或协作权限在生成期间变化时拒绝写入旧结果。
- Artifact 表保存 `source_scope_version` 与已有 `source_snapshot_json`，历史产物可以解释“基于哪一版来源生成”。
- 已增加 `sys_ai_notebook_research_candidate`；联网搜索结果先以 `candidate` 保存，用户导入或 Deep Research 选择后依次进入 `accepted -> pending -> parsing -> ready | failed`，并记录查询、Provider 来源、URL、文档、Notebook 来源和错误。
- 新增候选列表 API；搜索结果返回 `candidateId`，客户端可以用它显示生命周期并进行后续导入。兼容旧客户端直接提交 URL，但不会绕过网站导入和 Knowledge 索引流程。
- Notebook Inspector 增加“候选审核”列表：管理员可以逐条采纳或拒绝；采纳才会抓取正文并进入受管来源，拒绝会留下审计状态。
- 候选未经过用户确认或研究流程选择，不得进入正式 RAG 来源；搜索摘要仍然不是知识正文。

### P1-2 Web Fetch/SSRF 逐项回归

继续验证和固化：

- DNS rebinding、IPv6 私网、loopback/private/link-local/multicast、云元数据地址。
- 重定向到内网、危险端口、非 HTML/文本 MIME、超大响应和超时。
- 代理、TUN、fake-IP DNS 等本机网络环境下的二次解析校验。
- Provider endpoint 安全校验和出站网络 allowlist。

不要为了让某个网站可抓取而扩大网络允许范围。

### P1-3 AI 安全审计增强

- 将 AI Gateway 授权决策单独记录为安全事件，不和普通 CRUD 操作日志混为一谈。
- 安全事件至少包含 `runId`、`attempt`、`scopeVersion`、capability jti、Tool、来源和 allow/deny/error reason。
- 对关键 AI 安全审计增加 append-only 约束，数据库层拒绝 UPDATE/DELETE。
- 继续保证 Prompt、回答正文、API Key、Provider Token、Query 和候选正文不进入普通账本或日志。

### P1-4 Memory 和 Runtime Skill

- Memory 自动候选提取，但必须逐条展示并由用户确认；不能静默保存整段聊天。当前治理页已提供候选保存/忽略。
- Memory 冲突合并、重要度衰减、过期策略和 Embedding 召回已接入；常驻 Worker 每分钟维护过期候选和长期重要度衰减。
- Runtime Skill 的版本、发布、回滚、兼容 Agent/Tool 校验和变更审计已接入治理页；运行时优先读取已发布版本。
- Skill 的模板/目录管理和管理员预览；继续禁止任意 JavaScript、Shell、Python、二进制和文件系统脚本执行。

### P1-5 MCP 生命周期

- 远端 MCP OAuth revoke endpoint，而不仅是撤销本地加密 Token，已接入断开连接流程。
- 长连接 Session Pool、连接复用和 session 失效后一次性重新 initialize 已接入；跨节点健康探测仍需环境验收。
- MCP initialize 的 capabilities 已持久化；当前只消费受治理的 tools，resources/prompts 仍保持 fail closed。
- 出站代理、DNS rebinding 防护和生产网络 allowlist仍属于部署边界。
- 对每个同步 Tool 的 schema 变化、风险、审批、启停和删除建立可追溯生命周期；schema 变化会进入 stale，不能直接启用。
- 继续拒绝 stdio、Shell、本地脚本、本地二进制、任意 URL Tool 和未经治理的旧 SSE 执行。

### P1-6 Knowledge/RAG

- Parser Job 已接入常驻 Worker；任务携带文档版本，旧版本任务不能覆盖新索引。解析失败继承队列重试，取消/大规模吞吐仍需环境验收。
- OCR、音视频转录、复杂表格结构化解析按业务场景逐步接入。
- 网页站点批量同步和外部 Drive/企业连接器同步。
- 评估从 JSON Embedding + TypeScript cosine 迁移到 `pgvector` 原生索引的规模阈值、迁移脚本和回滚方案。
- 扩充引用阅读器：从 Chunk/Quote 定位升级为带页码、段落和全文上下文的安全阅读体验。

### P1-7 Notebook 协作和长任务

- 跨节点进度事件已持久化，PostgreSQL `LISTEN/NOTIFY` 作为实时唤醒，SSE 同时保留按事件 ID 回放和 polling
  fallback；真实跨节点压力、网络分区和长时间连接验收仍是环境门禁。
- Notebook 公开分享链接和分享权限审计。
- 定时研究/Artifact 任务，但不把定时任务中心提前做成全局调度平台。
- 评论、协作操作记录和冲突处理。
- 音频概览/播客生成应在音频存储、异步任务和内容安全边界明确后再做。

### P1-8 生产运维

- Worker 常驻部署的 PM2/systemd 选型、健康检查、优雅停止、日志轮转和告警。
- 队列积压、租约过期、重试耗尽、熔断打开、Provider 延迟异常和费用超额的 Dashboard/告警。
- 上传目录和 PostgreSQL 的备份恢复演练；对象存储版本/生命周期策略。
- 密钥轮换脚本和轮换后的 Provider/OAuth/SMTP/S3 回归。
- 不清库的长期 E2E 流程，避免把正常开发库当作 destructive E2E 目标。

## 6. P2：业务触发后再做，不阻塞当前框架

### 6.1 正式租户和商业化

当前 system/department/user 配额和 estimated/confirmed/void ledger 是治理基础，不是正式财务系统。

后续需要：

- `tenant_id` 跨认证、数据范围、存储、审计和 AI 资源统一落地。
- tenant、billing account、period、invoice、invoice line、payment、refund、tax 和 invoice number。
- Provider 官方账单/发票导入、对账、差异处理和多币种汇率。
- 预付余额、信用额度、硬性扣款和关账流程。

在没有这些模型前，不要把部门配额对外称为租户计费。

### 6.2 外部基础设施和调度

- Redis/Kafka/RabbitMQ 等外部 Broker，以及独立调度中心。
- 延迟队列、优先级调度、跨节点任务编排和更复杂的 Outbox 投递。
- 只有当 PostgreSQL Worker 的吞吐、锁竞争或 SLA 不能满足业务时才升级，不为“看起来更专业”提前引入。

### 6.3 产品扩展

- 字段级权限 UI。
- 实时 WebSocket 消息。
- 邮件模板中心和邮件队列。
- 插件市场、插件安装/信任/版本/权限/回滚模型。
- Notebook 多人实时共同编辑、公开协作空间和复杂分享权限。
- 完整 CRM、供应链、客户触达和行业业务模型。

## 7. 明确不是 TODO 的代码分支

源码中少量“尚未实现/暂不支持”信息不应直接改成伪完成：

- `src/server/services/ai-tool-registry.ts` 在 Tool 没有注册 `execute` 时拒绝执行，这是 fail closed；只有新增具体受控 Tool 时才需要实现 handler、schema、ability、审计和测试。
- `src/features/system/file/FilePreviewModal.tsx` 对部分二进制/危险类型不预览，这是安全边界；`.exe` 等文件应下载或隔离，不应内联执行。
- `src/server/services/ai-sdk-runtime.ts` 对 Provider 不支持流式或 Embedding 时拒绝调用，这是 adapter 能力矩阵差异；需要增加 Provider adapter 或可读的能力提示，不应绕过检查。
- MCP 的 stdio/Shell/脚本/本地二进制/任意 URL 执行当前明确禁止，不是遗漏功能。
- 普通文件导入 Knowledge 会创建独立快照，不是重复存储 bug；原文件删除不应破坏知识库引用。

## 8. 测试与文档维护 TODO

- 每个新增/修改 API 继续登记到 `tests/coverage/api-test-cases.ts`，每个 App Router 页面登记到 `tests/coverage/page-test-cases.ts`。
- API、页面、功能三份测试文档必须保持同一套路由和能力边界；通过 `pnpm test:docs` 生成派生文档。
- `automated`、`manual`、`environment`、`planned` 必须按证据更新，不能因接口存在就标记为自动通过。
- 先补 P0 自动化和环境测试，再做页面视觉基线；浏览器截图用于人工复核，不等同于像素级审美通过。
- 统一当前覆盖数字：本次 `test:check-cases` 是 364 个 API 操作、36 个页面；历史完成状态文档中的 242/334/342/345/360 等数字是不同日期的快照，需要在下一次正式验收后更新，不能混用。
- 将 `docs/local-external-services-acceptance.md` 的 Docker 服务逐项验收结果写入测试报告，并记录关闭服务后的状态。
- 为高风险 AI、文件、OAuth、密码、发布、账本和 MCP 操作保留 requestId、审计和不泄密断言。
- 发布前必须确认工作区没有把用户未提交的源码、部署文件、上传目录或生成产物误纳入当前 package；文档审计本身不应触碰这些变更。

## 9. 推荐执行顺序

1. P0 发布闭环：完整质量门禁、空库 CI、Worker 常驻、外部 Mock/真实环境边界和浏览器手工验收。
2. P0 Mastra M3/M4 编排 PoC，先验证 Workflow、Approval、事件和恢复边界。
3. P0 Agent Run fencing 与持久 SSE 事件，解决长任务接管、断线和重复执行的可靠性问题。
4. P1 SSRF/安全审计和危险文件回归，确保联网搜索、文件下载和 MCP 出站边界可证明。
5. P1 Knowledge Parser/OCR/`pgvector` 评估和 Notebook 来源版本，提升知识库可维护性。
6. P1 Memory、Runtime Skill、MCP session/capability 生命周期。
7. P1 Worker 运维、告警和跨节点 Notebook 进度。
8. 由真实 CRM、供应链或企业知识库业务驱动 P2 的租户、计费、调度、协作和插件能力。

## 10. 每个 TODO 的完成定义

一个 TODO 只有同时满足以下条件才可以从本文件移除：

- 源码实现完成，且没有绕过现有权限、数据范围、审计、密钥和安全边界。
- schema/migration、route manifest、`sys_rule`、API 文档和页面行为同步。
- 至少有成功、失败、越权/不支持和数据一致性测试；高风险动作还要有幂等/审计测试。
- 浏览器或外部环境需要参与时，测试报告明确记录环境、凭据类型、服务状态和未覆盖边界。
- 通过适用的 `pnpm admin:verify` 范围，并在需要时通过 build/smoke。
- 目标分支提交只包含对应 package；不能把后续 TODO 或无关 dirty worktree 变更混进提交。

## 11. 参考文档

- [`admin-base-business-ai-roadmap.md`](./admin-base-business-ai-roadmap.md)：业务与 AI 长期实施的总入口、阶段依赖和完成闸门。
- [`admin-base-ai-technical-research-plan.md`](./admin-base-ai-technical-research-plan.md)：技术栈、预研实验、目标架构和升级条件。
- [`admin-base-business-product-plan.md`](./admin-base-business-product-plan.md)：CRM、方案/PPT、经营查询、供应链和开放能力的产品合同。
- [`admin-base-framework-completion-status.md`](./admin-base-framework-completion-status.md)：阶段完成状态和当前边界。
- [`ai-capability-evolution-roadmap.md`](./ai-capability-evolution-roadmap.md)：AI 能力路线和 Novex/Mastra 边界。
- [`admin-base-functional-test-cases.md`](./admin-base-functional-test-cases.md)：功能验收与 P0/P1 用例。
- [`admin-base-api-test-cases.md`](./admin-base-api-test-cases.md)：逐接口成功、失败、数据、权限和审计标准。
- [`admin-base-page-test-cases.md`](./admin-base-page-test-cases.md)：逐页面数据、交互和视觉标准。
- [`local-external-services-acceptance.md`](./local-external-services-acceptance.md)：MinIO、Mailpit、Keycloak、SMS Mock 和 AI Mock。
- [`ai-mcp-governance.md`](./ai-mcp-governance.md)：MCP 传输、OAuth、Tool allowlist 和安全边界。
- [`ai-worker-and-outbox.md`](./ai-worker-and-outbox.md)：PostgreSQL Worker、Outbox、租约、重试和取消。
- [`ai-quota-and-billing.md`](./ai-quota-and-billing.md)：配额与费用账本的非正式计费边界。
