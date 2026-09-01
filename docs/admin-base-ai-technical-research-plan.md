# Admin Base AI 技术预研与目标架构方案

> 文档角色：AI 与业务平台后续技术选型、PoC、架构契约和升级闸门  
> 初始版本：2026-08-27  
> 上位路线图：[`admin-base-business-ai-roadmap.md`](./admin-base-business-ai-roadmap.md)  
> 注意：本文描述研究和目标设计，不代表对应代码已经实现

## 1. 预研目标

技术预研不是罗列热门框架，而是为后续实现回答四类问题：

1. 当前 Admin Base 的能力能否直接满足需求，缺口发生在哪个真实链路？
2. 缺口应通过现有 TypeScript/PostgreSQL 架构扩展，还是需要新依赖或新基础设施？
3. 新方案如何继承权限、data scope、Approval、审计、Invocation/Attempt、Worker 和费用证据？
4. 用什么可重复实验决定采用、延后或拒绝，并保留什么回滚路径？

本文优先解决来自 Novex 对照的八个方向：精确文档引用、调用级 lease/cancel、typed Turn Item、Agent
steering、AI Alert、Connector/Credential/Tool 分层、受控公开访问，以及租户/资源 ACL。外部 Broker、向量库和
插件市场只定义升级闸门，不提前建设。

## 2. 当前技术栈与目标选型

版本号在真正实现前必须从当前 `package.json`、lockfile 和官方兼容说明重新核实；下表表示架构角色，不是永久版本锁。

| 层               | 当前/默认技术                                           | 目标职责                                           | 决策                           |
| ---------------- | ------------------------------------------------------- | -------------------------------------------------- | ------------------------------ |
| Web/Application  | Next.js App Router、React、TypeScript                   | 页面、Route Handler、单应用宿主                    | 保留                           |
| Admin UI         | Ant Design、TanStack Query、Zustand、ECharts            | 治理页面、业务工作台、状态和图表                   | 保留                           |
| API              | Hono、Zod                                               | 鉴权、ability、输入输出、错误协议                  | 保留                           |
| 数据             | PostgreSQL、Drizzle、项目 migration                     | 业务事实、AI 治理、Job、Event、Alert、ACL          | 保留为 source of truth         |
| AI Model Runtime | AI SDK 7 adapter                                        | Stream、Tool、结构化输出、Embedding、Rerank、Abort | 保留                           |
| AI Orchestration | Mastra canary + Admin Base adapter                      | Agent/Workflow 编排，受迁移闸门约束                | 渐进采用，不接管治理数据       |
| 长任务           | PostgreSQL Worker/Outbox                                | 领取、lease、retry、cancel、幂等、投递             | 默认保留                       |
| 文件             | `sys_file` + Local/S3-compatible Storage                | 原件、快照、产物、下载治理                         | 保留                           |
| 文档解析         | Parser Adapter + 类型专用库/服务                        | Block/Page/BBox 归一化                             | 先预研再选库                   |
| 检索             | PostgreSQL FTS + JSON Embedding cosine + 可选 Rerank    | 权限过滤后的混合检索                               | 先保留，评估 `pgvector`        |
| 可观测性         | Pino、Run/Step/Event、Invocation/Attempt、operation log | 技术日志、产品证据、审计各自分层                   | 增加 Alert，不新建孤立观测系统 |
| 外部接入         | 受控 HTTP Connector/MCP、OAuth                          | Credential 隔离、能力同步、业务 Tool               | 按真实集成扩展                 |

### 2.1 不新增第二套 source of truth

- Mastra 不新建用户、权限、Chat、Approval、Provider、费用或业务事实表。
- Parser/OCR 服务可以是可替换计算适配器，但原件、状态、Block、Chunk 和引用事实回写 PostgreSQL。
- Broker 即使后续引入，也只负责投递和协调；Job/Run 的产品事实仍由 Admin Base 持久化。
- 向量库即使后续引入，也不是文档权限或版本事实来源，召回后必须回 PostgreSQL复核 scope 和有效版本。

## 3. 预研工作方法

每个技术研究项必须产生以下资产：

1. **现状证据**：真实入口到数据库/Provider/前端消费的调用链，不从相似接口推断。
2. **问题量化**：样本、数据规模、P50/P95、错误类型、资源消耗或安全威胁。
3. **候选方案**：至少当前方案增强与一个替代方案；列许可证、维护性、运行边界和升级风险。
4. **最小 PoC**：隔离数据、固定夹具、无生产凭据、可重复命令和预期结果。
5. **Decision Record**：采用/延后/拒绝、证据、代价、回滚和复审触发条件。
6. **实现合同**：schema、API、状态机、权限、审计、失败、测试和迁移，不只写库名。

PoC 默认不进入生产源代码。若需要临时代码，应放在明确的 spike 范围，不能通过未审查生成器发布模块，也不能
把本机成功写成跨平台或生产可用。

## 4. TR-01：Document Block/Page/BBox 与引用阅读器

### 4.1 要解决的问题

现有 RAG 引用可回到文档和 Chunk/Quote，但 Chunk 是检索单位，不是稳定的阅读定位单位。PDF 页码、DOCX
段落、标题层级、表格单元格、扫描件坐标和重新解析版本需要统一契约，否则无法做到精确引用、左右对照和历史重放。

### 4.2 目标数据层

建议先验证以下逻辑模型，最终命名以现有 schema 约定为准：

| 对象             | 关键字段                                                                                | 说明                                                          |
| ---------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Document Version | documentId、version、fileId、parserProfile、contentHash、status                         | 每次解析的不可变输入版本                                      |
| Document Page    | versionId、pageIndex、label、width、height、rotation                                    | PDF/扫描件使用；非分页文档可为空                              |
| Document Block   | versionId、stableKey、type、pageId、sectionPath、text、order、charRange、bbox、metadata | paragraph、heading、list、table、cell、code、image caption 等 |
| Chunk Block Link | chunkId、blockId、startOffset、endOffset、order                                         | Chunk 与阅读单元解耦                                          |
| Citation Anchor  | snapshotId、blockId/stableKey、page、quote、offset、bbox、parserVersion                 | 生成时不可变证据定位                                          |

`bbox` 统一使用页面归一化坐标或明确的 point 坐标，并记录坐标系、页旋转和 parser 版本；不能只存无语义的四个数字。

### 4.3 Parser Adapter 合同

```ts
type ParsedDocument = {
  metadata: DocumentMetadata;
  pages?: ParsedPage[];
  blocks: ParsedBlock[];
  warnings: ParserWarning[];
};

interface DocumentParserAdapter {
  supports(input: ParserInput): Promise<SupportResult>;
  parse(input: ParserInput, options: ParserOptions, signal: AbortSignal): Promise<ParsedDocument>;
}
```

合同要求：

- 输入来自受管 `sys_file`，不接受模型提供的任意路径或 URL。
- Adapter 只返回规范化结构，不直接写数据库；Service 在事务中校验版本并持久化。
- 解析任务携带 document version 与 lease；旧任务不能覆盖新版本。
- 输出有最大页数、最大 block、最大文本、超时和内存限制；压缩炸弹、危险嵌入和宏 fail closed。
- OCR 结果标记 engine、language、confidence 和 derived 状态，不能伪装成原生文本。
- 表格尽量保留 row/column/span/header 结构；无法可靠解析时退化为带警告的文本块。

### 4.4 候选技术与实验

需要实际调研并记录许可证和维护状态，而不是现在锁死具体库：

- PDF：比较现有解析能力、PDF.js/pdfjs-dist 文本层，以及隔离的高保真解析/OCR 服务。
- DOCX：比较当前 DOCX 提取与基于 OOXML 的标题、段落、表格和关系解析；预览库不能自动视为服务端 parser。
- HTML/Markdown/TXT：使用安全 DOM/Markdown AST 提取结构，移除脚本、样式、隐藏内容和不可信指令。
- OCR：比较本地 Tesseract 类方案和受控云 OCR Adapter，评估中英混排、表格、旋转、成本与数据出境。
- 复杂表格：先评估业务样本；不得为少量表格直接引入重量级 Python 平台或外部文档中台。

固定夹具至少包括：文本 PDF、扫描 PDF、中英混排、双栏、跨页表格、旋转页、DOCX 标题/列表/表格、
Markdown 代码/表格、恶意 HTML、空文档、超大文档和损坏文件。测量文本完整率、阅读顺序、页码、bbox
IoU/高亮命中、耗时、峰值内存和失败可解释性。

### 4.5 引用与前端合同

- 模型继续只接收紧凑候选编号，不把内部 file path、敏感 metadata 或完整无关正文放入 Prompt。
- Citation Snapshot 固定 document version、Block anchor 和 quote；重新解析后历史回答不静默漂移。
- 引用详情 API 先校验 Notebook/Knowledge/业务资源可见范围，再返回最小上下文。
- 阅读器默认显示来源、版本、页/章节、引用原文和前后 Block；诊断分数放折叠区。
- PDF 高亮失败时显示页码和快照 quote，不伪造坐标；DOCX/HTML 以 Block/section 定位。
- 删除/撤权后保留审计所需最小快照，但普通用户不再通过旧引用访问已撤权全文。

### 4.6 采用闸门

只有候选方案在真实业务夹具上达到批准的定位准确率、资源上限和安全要求，才进入 `design-approved`。如果本地
库只能完成文本顺序而无法稳定 bbox，v1 可以采用“Block + Page + quote”并将 bbox 标为可选，不得伪造精度。

## 5. TR-02：PostgreSQL JSON Embedding 与 `pgvector`

### 5.1 当前假设

当前 PostgreSQL 全文 + JSON 向量 + TypeScript cosine 适合早期规模和可复现测试。它的问题可能出现在候选集
传输、进程内计算、索引能力和 P95，而不是“技术看起来不够先进”。

### 5.2 基准矩阵

使用隔离数据库和去敏/合成向量，至少测试：

| 维度           | 档位示例                                                            |
| -------------- | ------------------------------------------------------------------- |
| Chunk 数       | 10k、100k、1m，并按真实增长率补充                                   |
| Embedding 维度 | 当前实际模型维度，不用固定 64 维假数据代替全部结论                  |
| Scope 选择性   | 全局、部门、用户、Notebook 小集合                                   |
| 写入           | 单文档重建、批量导入、版本切换                                      |
| 查询           | topK、混合检索、可选 Rerank、冷/热缓存                              |
| 指标           | P50/P95/P99、DB CPU/IO、应用内存、索引大小、构建/迁移时间、召回质量 |

### 5.3 `pgvector` 采用条件

满足以下任一并有复现实验时进入迁移设计：

- 当前检索 P95 超出产品 SLO，瓶颈明确在 JSON 传输或应用 cosine。
- 单实例应用内存/CPU 随候选规模不可接受，且 scope 前置过滤不能解决。
- 文档规模与并发达到当前方案无法稳定服务的阈值。
- 原生索引在相同权限过滤和召回质量下有显著、可维护的收益。

迁移必须包含 extension 可用性检查、双写/回填、维度一致性、索引参数、降级、备份恢复、回滚和 CI/部署文档。
`pgvector` 仍需在查询中前置 data scope；不能先全库召回再在应用层过滤敏感结果。

### 5.4 外部向量库闸门

只有 `pgvector` 在容量、隔离、吞吐或 SLA 上有量化不足，且团队接受新的备份、监控、网络、权限和一致性成本
时，才评估 Milvus 等外部系统。外部向量 ID 必须映射 PostgreSQL 的有效 document version/chunk，检索结果
回表复核权限；向量库不可成为来源权限事实。

## 6. TR-03：Invocation Attempt Lease、Fencing 与原生取消

### 6.1 问题边界

Run lease 防止旧 Worker 写业务运行结果，但一次外部 Provider 调用可能继续占用连接、产生费用或迟到返回。
需要把“请求已取消”“Provider 是否真的停止”“迟到响应能否写入”拆开处理。

### 6.2 目标状态机

建议 Invocation Attempt 至少区分：

```text
queued -> starting -> streaming -> completed
                    -> cancel_requested -> cancelled
                    -> timed_out
                    -> lease_lost
                    -> failed
                    -> orphaned/late_response
```

需要评估的字段包括 attempt version、lease owner/until、heartbeat、fencing token、abort requested/reason/time、
provider request id、response started、last chunk time、terminal reason 和 usage confirmation 状态。

### 6.3 运行合同

- API/Worker 创建 Run-scoped `AbortController`，并把 `signal` 传到 Purpose Resolver 后的具体 Provider adapter。
- 用户停止、服务超时、Run 租约丢失、管理员取消和应用优雅停机使用不同 reason。
- 每个 chunk、usage、Tool proposal 和终态写入前校验 attempt/fencing；旧 owner 只能记录受限诊断，不能写正文。
- Provider 原生取消 API 只有在官方能力和 request id 可用时调用；没有时执行本地 abort + fencing。
- 取消后的费用先标 estimated/pending；只有 Provider 可确认 usage 时 confirmed，不能假设取消等于零费用。
- response 已开始后不切换 fallback；fallback 仅发生在没有用户可见输出且副作用未开始时。
- Tool side effect 使用 `runId + attempt + toolCallId` 幂等，不因模型重试重复执行。

### 6.4 验证矩阵

- 用户在首 token 前/后停止。
- 网络半开、连接超时、读超时和 Provider 429/5xx。
- Worker 强杀、租约过期、新 Worker 接管、旧响应迟到。
- 支持和不支持原生 cancel 的 Provider。
- 流开始后错误、usage 缺失、重复终态和多标签页重复取消。
- Mastra 与 legacy adapter 的取消语义一致性。

完成指标不是“AbortController 被调用”，而是数据库、页面、费用、Alert 和 Provider 证据呈现一致终态，且旧
attempt 无法覆盖新结果。

## 7. TR-04：Typed Turn Item 与 Replay Projection

### 7.1 为什么需要

Chat Message、Run Event、Step、Approval 和 Artifact 各自有事实，但模型的一轮输入输出缺少统一的有序语义。
直接把所有 SSE event 当长期协议会把传输细节固化，另建一套消息表又会产生双重事实。

### 7.2 目标契约

先定义 TypeScript discriminated union 和 JSON Schema 版本：

```text
Turn
  sequence
  user_message
  assistant_text (delta projection + final snapshot)
  reasoning_summary (可选、非隐藏思维链)
  tool_call / tool_result
  approval_request / approval_result
  citation / artifact
  steering / follow_up
  system_notice / error / finish
```

每个 Item 需要 `itemId`、runId、attempt、turnId、sequence、type、schemaVersion、visibility、status、timestamps
和类型 payload。严禁持久化模型隐藏思维链；只保存用户可见或系统生成的简短 reasoning summary、结构化决策
证据和必要诊断。

### 7.3 需要先决定的持久化策略

候选 A：Run Event 是不可变 ledger，Turn Item 是 event payload 的稳定业务子集；Chat Message/Step 是 projection。  
候选 B：Turn Item 独立不可变表，SSE Event 是传输 projection，现有 Message/Step 保持业务索引。

决策标准：事务一致性、重放性能、现有迁移成本、查询需求、兼容 API、数据保留和删除语义。禁止没有 ADR 就
同时新增 ledger 和复制全部 message/event 内容。

### 7.4 重放不变量

- 相同持久事实和 schema version 产生相同 Item 顺序、可见正文、Tool/Approval 状态和终态。
- delta 可压缩，但 final snapshot 与 usage/finish 必须确定。
- Tool 结果按模型所见顺序持久化，即使执行并行。
- schema 升级提供 upcaster 或版本化 renderer，历史 Run 不依赖当前 Prompt 重跑。
- replay 只读取，不重新调用 Model、Tool、Connector 或 Approval。

## 8. TR-05：Agent Steering、Follow-up 与 Mailbox

### 8.1 产品语义

- **steering**：用户希望当前 Run 在下一个安全边界吸收新约束，例如“不要继续分析价格，先比较风险”。
- **follow-up**：当前 Run 完成/停止后，按顺序开始下一轮，例如“完成后再给英文版”。
- **cancel**：请求终止当前 Run，不代表删除已有内容或自动执行 follow-up。

### 8.2 Mailbox 合同

建议持久化：messageId、session/thread、runId、targetAttempt、kind、payload、createdBy、scopeVersion、status、
sequence、idempotencyKey、claimedAt、consumedAt、resultRunId。状态可为 pending、claimed、consumed、expired、
cancelled、rejected。

不变量：

- FIFO 与幂等由数据库唯一约束和事务领取保证，多进程不能重复消费。
- 接收时和消费时都检查用户、会话、数据范围和 target attempt；权限变化后旧 steering 失效。
- 只有编排器明确暴露的安全边界可注入；Tool 执行和外部副作用中途不能修改参数。
- Provider/编排器不支持即时 steering 时，自动转换为 follow-up，UI 明确显示“将在当前任务后处理”。
- Approval 等待时，新输入不能隐式批准、修改指纹或替换审批人选择。
- mailbox 有大小、频率、过期和敏感信息限制；所有状态变化有审计但不泄露正文到普通日志。

### 8.3 实验

覆盖 streaming 中、Tool 前后、并行 Tool、等待 Approval、Worker 重启、两标签页同时提交、权限撤销、重复
idempotency key、取消后 follow-up 和 steering 不被 Provider 支持的退化路径。比较 Mastra 和 legacy 的安全
注入点，不能为了统一 API 假装底层具备同等能力。

## 9. TR-06：AI Alert 生命周期与投递

### 9.1 Alert 与日志/通知的区别

- 日志记录发生过的技术事实。
- `sys_operation_log` 记录用户/管理员重要操作。
- Alert 表示需要某个责任人关注并完成处置的持续状态。
- Notification 是 Alert 或业务事件的一次投递，不是 Alert 本身。

### 9.2 建议模型

| 对象           | 关键职责                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------- |
| Alert Rule     | code、source、condition、window、severity、dedupe、owner policy、enabled                        |
| Alert          | fingerprint、status、severity、first/last seen、occurrence count、resource ref、evidence、owner |
| Alert Event    | opened、repeated、acknowledged、silenced、resolved、reopened、closed 的不可变历史               |
| Alert Silence  | rule/resource scope、start/end、reason、createdBy                                               |
| Alert Delivery | channel、recipient、attempt、status、provider ref、next retry、error summary                    |

状态建议：

```text
open -> acknowledged -> resolved -> closed
  |          |             |
  +------ silenced --------+
resolved --same fingerprint recurs--> reopened
```

### 9.3 第一批来源

- Worker queue depth、oldest age、lease expired、retry exhausted、dead letter。
- Provider circuit open、error rate、P95/P99、连续超时、cancel 失败或 orphan response。
- 预算接近/超过、usage 长期 pending、账本差异。
- 文档解析失败率、OCR 低置信度、引用 anchor 失效。
- Connector sync 失败、credential 即将过期、webhook 验签失败。

### 9.4 安全与运营

- fingerprint 使用规则 code + 受控 resource id，不把 Prompt、正文、Token 或 URL query 放进去。
- evidence 只保存 Run/Attempt/Job/Provider 等引用和脱敏摘要。
- acknowledge/silence/close 都是物质写操作，有 ability 和 operation log；silence 必须过期。
- Email/SMS/IM 投递走 Outbox，失败不改变 Alert 事实；页面始终可查看。
- 先用确定性规则，不让 LLM 直接决定严重度或自动关闭生产告警。

采用闸门：用回放数据证明 dedupe、reopen、silence 和投递重试不会形成告警风暴；定义 owner 和响应 SLO 后才
开启外部通知。

## 10. TR-07：Connector、Credential、Connection 与 Tool 分层

### 10.1 分层模型

```text
Identity Provider
  登录、用户映射、组织身份

Connector Definition
  某类外部系统的协议、能力和版本
    -> Credential
       加密 OAuth/token/key，前端和模型不可读
    -> Connection
       某租户/部门/用户连接、状态和配置
    -> Sync Cursor / Webhook / Dataset
       同步事实和运行状态
    -> Governed Tool
       Agent 可调用的最小业务能力
```

身份登录与业务连接可以使用同一外部厂商，但不能因此复用同一 Token 或权限模型。

### 10.2 技术合同

- Definition 由服务端代码/受审查 registry 提供，不允许用户上传可执行 connector 代码。
- Credential 使用现有加密服务并支持版本、轮换、revoke、last used；API 永不返回密文或可恢复值。
- OAuth 使用 state、PKCE、严格 redirect allowlist；refresh 并发有锁，失败进入 connection 状态和 Alert。
- Sync Job 带 connection version、cursor、lease、幂等和速率限制；旧 credential/version 不能写新数据。
- Webhook 有签名、重放窗口、事件唯一键、源 IP/网络策略（厂商支持时）和异步处理。
- Tool 输入只暴露业务参数，服务端选择 connection 并重新校验 data scope；模型不能选择 credentialId 或任意 endpoint。
- Connector 数据要决定 snapshot、mirror、reference 或 on-demand 四种模式及删除/撤权传播语义。

### 10.3 MCP 的位置

远程 MCP 可作为某些 Connector 的 Tool 协议，但仍要经过 Admin Base Server/Tool allowlist、OAuth、风险、审批和
schema stale 生命周期。MCP 不自动等于可信 Connector，也不开放 resources/prompts/stdio/Shell。

## 11. TR-08：公开链接与受限 API Key

### 11.1 公开/外部分享

分享链接对象需要 resource type/id、token hash、scope、expiresAt、password/OTP policy（按需要）、max uses、
revokedAt、createdBy、lastAccessAt。URL 只出现一次原始随机 token，数据库仅存 hash；访问使用独立限流和审计。

默认仅支持只读 Artifact/Notebook 快照，不暴露 Admin API、成员列表、内部引用诊断、Prompt、Tool 或源文件下载。
若允许来源查看，必须逐来源定义 share scope，不能因分享 Artifact 自动公开整个 Knowledge Base。

### 11.2 API Key

API Key 需要主体、名称、prefix/hash、abilities/scopes、resource constraints、IP/时间限制（可选）、rate limit、
expiresAt、last used、rotation parent 和 revokedAt。Key 与后台用户 Token 使用不同认证路径；不能获得未声明的菜单
权限，不能模拟任意用户，不能读取 Credential。

高风险写 API 默认不对 API Key 开放。若业务要求，必须加入 idempotency、签名/nonce、Approval 策略和更严格
审计。公开链接/API Key 都要进入 threat model：枚举、泄露、referer、缓存、搜索引擎、重放和撤销延迟。

## 12. TR-09：tenant 与 Resource ACL

### 12.1 触发前不实施

当前 department/user scope 不能靠新增一个 nullable `tenantId` 就变成多租户。只有真实客户、隔离边界、身份
来源、部署模式和账单主体明确后，才进入设计。

### 12.2 必须覆盖的资源图

tenant 必须贯穿 user/membership、department、business record、file/storage key、Knowledge/Document/Chunk、
Notebook/Artifact、Agent/Tool/Skill/Workflow、Run/Event/Invocation、Job/Outbox、Alert、operation log、quota/ledger
和 Connector。任何全局资源都要解释为何跨 tenant 以及谁能管理。

Resource ACL 候选主体包括 user、role、department、team、service principal 和 share link；权限包括 owner、manage、
edit、use、view、share。ACL 必须与 `sys_rule` 的操作 ability 分层：ability 决定能做某类动作，ACL/data scope
决定能对哪个实例做。

### 12.3 预研内容

- shared database + tenant column、schema-per-tenant、database-per-tenant 的成本与迁移路径。
- PostgreSQL RLS 是否作为 defense-in-depth；即使采用也不能代替应用 ability、审计和测试。
- 唯一键、外键、缓存键、对象存储前缀、Job claim、全文/向量索引和备份恢复的 tenant 边界。
- tenant move/merge/export/delete、数据保留、法律留存和 Provider 数据驻留。
- 跨 tenant 运维访问的 break-glass、审批和追加审计。

采用前必须有跨租户读取/写入/Tool/引用/Worker/导出测试矩阵和数据迁移演练。

## 13. TR-10：外部 Broker、调度、插件市场升级闸门

### 13.1 Broker/调度

先为 PostgreSQL Worker 建立指标：queue depth、oldest age、claim latency、throughput、retry、lease churn、DB lock
wait、CPU/IO 和业务 SLA。只有持续超过批准阈值且索引/批量/优先级优化无法解决，才做 Broker ADR。

外部 Broker 候选评估必须包括：投递语义、重复处理、顺序、延迟/定时、死信、跨区、监控、备份、开发环境、
运维成本和 PostgreSQL 事实一致性。不能以 Broker ack 代替业务完成状态。

### 13.2 插件市场

在以下能力全部 `design-approved` 前保持 `rejected/deferred`：

- 发布者身份、签名和供应链扫描。
- manifest、版本、依赖、兼容、权限/能力声明。
- 进程/网络/文件/Secret/数据库沙箱。
- 安装审批、租户/管理员信任、更新和回滚。
- 数据访问审计、kill switch、恶意包响应和许可证治理。

当前 Runtime Skill 是受控指令 + allowlisted Tool，不是插件代码；远程 MCP 是受治理协议连接，也不是插件安装。

## 14. AI 安全不变量

1. Prompt、RAG、网页、Connector 和 Tool 返回都视为不可信数据，不能覆盖系统规则。
2. 模型不能读取 Provider、OAuth、SMTP、S3 或 Connector 密钥；密钥不进入 Prompt、Trace、Alert 或 operation log。
3. Agent 不获得任意 SQL、Shell、Git、文件系统、脚本、本地二进制或任意 HTTP。
4. Tool schema 只接受业务参数，服务端解析主体、scope、connection 和资源版本。
5. 高风险副作用需 Approval、参数指纹、幂等、Outbox/补偿和审计。
6. 文档/网页解析隔离资源并限制大小、时间、重定向、MIME、私网地址和危险内容。
7. reasoning 只保存公开的短摘要，不保存或展示隐藏思维链。
8. 所有历史重放都是只读，不能重新触发外部调用。
9. 删除、撤权、Credential 轮换和 tenant 变化必须使未消费 capability/steering/job 失效。
10. Eval 数据集使用脱敏或授权样本，Judge 不能代替权限、安全和人工业务验收。

## 15. 明确不引入的技术和原因

| 项目                           | 当前决定           | 原因/复审条件                                                      |
| ------------------------------ | ------------------ | ------------------------------------------------------------------ |
| Rust/Go 全量重写               | `rejected`         | 破坏单应用与团队栈；只有独立高风险计算服务有测量需求时评估 adapter |
| Repository/DAO 通用层          | `rejected`         | 与现有 CRUD Factory/Drizzle/Service 重复；真实跨路由复用再抽象     |
| Redis/RabbitMQ/Kafka           | `deferred`         | PostgreSQL Worker 先满足需求；按 TR-10 指标触发                    |
| Milvus/Neo4j                   | `deferred`         | 未证明向量/图规模；先做 TR-02                                      |
| 独立 Mastra Server             | `rejected`         | 不新增第二套应用和治理边界                                         |
| 第二套 Provider/Model Registry | `rejected`         | Admin Base 继续拥有配置、密钥、费用和健康事实                      |
| stdio MCP/Shell/本地 binary    | `rejected`         | 无法满足当前沙箱、权限和运维安全                                   |
| 任意 SQL/Text-to-SQL           | `rejected`（当前） | 先用语义数据集；只有独立高风险闸门通过才复审                       |
| 任意 URL Tool                  | `rejected`         | 只开放受控 Search/Fetch/Connector，保持 SSRF 和 allowlist          |
| 插件市场                       | `deferred`         | 信任、签名、沙箱、权限和回滚未成熟                                 |
| Novex 代码复制/依赖            | `rejected`         | 架构不匹配且未确认整体许可证；只参考思想                           |

## 16. 技术预研交付顺序

| 顺序 | 研究项                         | 对应路线图 | 主要产出                                                  |
| ---- | ------------------------------ | ---------- | --------------------------------------------------------- |
| 0    | 当前生产与 Mastra 闸门         | Phase 0    | 验收报告、Runtime ADR、回滚手册                           |
| 1A   | TR-01 文档解析/引用            | Phase 1    | Parser benchmark、Block schema ADR、reader prototype      |
| 1B   | TR-03 调用取消/fencing         | Phase 2    | Provider capability matrix、failure injection、状态机 ADR |
| 2    | TR-06 Alert                    | Phase 2    | 规则/状态/去重 PoC 和运维责任模型                         |
| 3    | TR-04/TR-05 Turn Item/Steering | Phase 3    | ledger ADR、replay test、mailbox PoC                      |
| 4    | TR-02 检索规模                 | Phase 1/10 | benchmark 与 `pgvector` 决策                              |
| 5    | TR-07/TR-08 Connector/开放     | Phase 8    | threat model、credential/share/API key ADR                |
| 6    | TR-09 tenant/ACL               | Phase 9    | 隔离架构、迁移和商业触发决策                              |
| 7    | TR-10 基础设施/插件            | Phase 10   | 量化升级 ADR                                              |

1A 与 1B 可以并行调研；任何涉及现有 Run/Event/Invocation schema 的实现必须先统一 migration 顺序和兼容策略。

## 17. 单个技术研究项完成模板

```markdown
### [编号] [名称]

- 状态：research / design-approved / deferred / rejected
- 日期、分支、commit：
- 用户问题与 SLO：
- 当前调用链和证据：
- 数据规模/安全假设：
- 候选 A/B/C：
- 许可证与供应链检查：
- PoC 夹具和命令：
- 结果（正确性、P50/P95、资源、失败）：
- 决策和理由：
- schema/API/权限/审计影响：
- 迁移与回滚：
- 实施前待确认：
- 复审触发条件：
```

## 18. 进入实现的统一闸门

技术项只有在以下条件满足后才能从 `research` 变为 `design-approved`：

- 现状与瓶颈有当前源码或可重复实验，不依赖历史印象。
- 候选依赖的许可证、维护、Node/Next.js/PostgreSQL 兼容和安全边界已核实。
- 已定义数据模型、版本、迁移、回滚和旧数据兼容。
- 已定义 ability、data scope、Secret、operation log 和高风险 Approval。
- 已定义失败/取消/重试/幂等/告警和运维责任。
- 已列 API/page coverage、单元/集成/浏览器/环境测试。
- 明确不在本次实施的能力和未来复审阈值。
- 方案不会暗中引入第二套用户、权限、Provider、Job、费用或业务 source of truth。

满足闸门只代表可以实现；只有上位路线图的交付定义满足后才可标记 `delivered`。

## 19. 相关实现边界文档

- [`ai-runtime-framework-comparison.md`](./ai-runtime-framework-comparison.md)
- [`ai-capability-evolution-roadmap.md`](./ai-capability-evolution-roadmap.md)
- [`ai-notebook-citation-experience.md`](./ai-notebook-citation-experience.md)
- [`ai-worker-and-outbox.md`](./ai-worker-and-outbox.md)
- [`ai-mcp-governance.md`](./ai-mcp-governance.md)
- [`ai-memory-and-skills.md`](./ai-memory-and-skills.md)
- [`ai-quota-and-billing.md`](./ai-quota-and-billing.md)
- [`ai-visual-workflow.md`](./ai-visual-workflow.md)
