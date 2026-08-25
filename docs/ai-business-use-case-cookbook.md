# AI 业务场景落地手册

Updated: 2026-08-24

本文用 CRM、企业知识库、经营数据查询和供应链四个真实业务形态，说明 Admin Base 中 Memory、
Runtime Skill、Knowledge、Notebook、Agent Tool、MCP、Worker、Eval、熔断和配额分别解决什么问题，
以及怎样组合成可以交付的业务系统。

可直接试用的虚构样例数据和知识文档位于 [`examples/ai-business`](../examples/ai-business)。示例中的
公司、联系人、交易和金额均为虚构数据，不代表真实客户。

## 1. 先理解每项能力的作用

| 能力              | 解决的问题                         | 适合保存或执行                               | 不应该承载                       |
| ----------------- | ---------------------------------- | -------------------------------------------- | -------------------------------- |
| 业务 CRUD         | 业务事实和主数据                   | 客户、联系人、订单、库存、跟进记录           | Prompt、模型密钥                 |
| Knowledge/RAG     | 从企业资料中找到证据               | 产品手册、制度、合同模板、案例、SOP          | 实时库存、客户最新状态           |
| Notebook          | 围绕一组来源持续研究和产出         | 客户方案、项目尽调、供应商评审、结构化简报   | 任意聊天历史                     |
| User/Agent Memory | 跨会话保留当前使用者明确确认的偏好 | “回答用中文”“周报按风险优先”                 | 客户画像、订单、库存等业务主数据 |
| Runtime Skill     | 给 Agent 注入岗位规则并限制 Tool   | 客户经理规范、采购分析规范、数据分析安全规则 | 可执行脚本和任意代码             |
| Agent Tool        | 让模型通过受控参数执行服务端能力   | 查客户、查时间线、搜知识、生成草稿           | 任意 SQL、任意 HTTP、Shell       |
| MCP               | 接入已有远程系统的标准 Tool        | 企业 CRM、工单、项目系统的远程受控接口       | 本地进程和未知 MCP Server        |
| Worker/Outbox     | 让长任务离开页面后继续             | 批量 Eval、Notebook 产物、后续 PPT 文件生成  | 高频事件总线和完整调度中心       |
| Circuit/Fallback  | Provider 故障时保护系统            | 失败计数、冷却、half-open 探针、候选模型     | 业务重试和订单补偿               |
| Eval/Judge        | 固化 Agent 质量和证据要求          | 回归问题、Tool 断言、Groundedness            | 代替人工审批和业务验收           |
| Quota/Ledger      | 控制 AI 预算并追踪估算费用         | 用户/部门/系统额度、费用确认和作废           | 正式发票、支付和税务             |

最重要的边界是：**业务事实进入业务表，企业文档进入 Knowledge，用户偏好才进入 Memory。**
例如“客户喜欢技术白皮书”应进入 CRM 客户偏好表；“当前销售经理希望回答先给结论”才适合 User
Memory。把客户信息写进操作人员的 Memory 会造成数据无法查询、无法转交、无法做权限和生命周期治理。

## 2. 通用落地结构

一个 AI 赋能业务模块通常分成五层：

```text
业务页面与 CRUD
  -> 业务 Service / Command
  -> 受控 Agent Tools
  -> Agent + Runtime Skills + Knowledge
  -> Worker / Approval / Audit / Eval / Quota
```

建议开发顺序：

1. 先设计业务表、归属、生命周期和普通 CRUD。
2. 再定义业务人员每天要做的判断和动作。
3. 把只读查询封装为参数受限的 Tool，把发送、修改、发布等动作封装为需审批的 Tool。
4. 用 Runtime Skill 规定岗位规则和可用 Tool。
5. 用 Knowledge 提供制度、产品和案例证据。
6. 用 Eval 固化典型问题、禁止动作和证据要求。
7. 长任务进入 Worker，所有外部调用进入 Provider 熔断、Trace 和费用账本。

普通单表 CRUD 可使用模块生成器。关系、时间线、评分、触达、状态机和外部副作用使用显式
route/service，不要强行塞入 CRUD Hook。

## 3. 场景一：CRM 客户经营与唤醒

### 3.1 业务目标

- 统一维护客户、联系人、商机、跟进记录、标签和偏好。
- 客户经理打开客户时，快速看到阶段、风险、近期行为和下一步建议。
- 自动找出长期未联系、有明确意向但尚未推进的客户。
- AI 生成有事实依据的跟进摘要和触达草稿。
- 邮件、短信或企业 IM 真正发送前必须人工确认。

### 3.2 推荐数据模型

| 表                        | 关键字段                                                                         | 数据归属      | 实现方式                       |
| ------------------------- | -------------------------------------------------------------------------------- | ------------- | ------------------------------ |
| `crm_customer`            | code、name、industry、region、stage、ownerId、deptId、lastContactAt、annualValue | 部门 + 负责人 | 生成器起稿 + CRUD Factory      |
| `crm_contact`             | customerId、name、title、phone、email、status                                    | 继承客户      | 关系 CRUD，需显式关联校验      |
| `crm_activity`            | customerId、contactId、type、occurredAt、summary、nextActionAt、createdBy        | 继承客户      | 显式 Service，形成不可变时间线 |
| `crm_tag`                 | name、category、sensitivity、status                                              | 全局          | 普通 CRUD                      |
| `crm_customer_tag`        | customerId、tagId、source、confidence、expiresAt                                 | 继承客户      | 关系 Service                   |
| `crm_customer_preference` | customerId、key、value、source、confirmedAt、expiresAt                           | 继承客户      | 显式 Service                   |
| `crm_opportunity`         | customerId、stage、amount、probability、expectedCloseAt、ownerId                 | 部门 + 负责人 | 状态机 Service                 |
| `crm_reactivation_task`   | customerId、reason、score、status、dueAt、assigneeId                             | 部门 + 负责人 | Worker/人工触发命令            |
| `crm_outreach`            | customerId、channel、templateId、draft、approvalStatus、sentAt                   | 部门 + 负责人 | 显式命令 + Approval + Outbox   |

`createdBy` 只用于审计，不能替代 `ownerId` 和 `deptId`。客户转交后，历史创建者不应继续决定可见性。

### 3.3 一组可理解的样例数据

样例文件 [`crm-demo-data.json`](../examples/ai-business/data/crm-demo-data.json) 包含以下客户：

| 客户         | 阶段        | 最近联系 | 标签                               | 建议动作                     |
| ------------ | ----------- | -------- | ---------------------------------- | ---------------------------- |
| 星河精密制造 | proposal    | 43 天前  | 高意向、制造业、深圳、偏好技术资料 | 用新案例重新唤醒并约技术评审 |
| 云帆零售科技 | negotiation | 8 天前   | 连锁零售、价格敏感、邮件优先       | 补 ROI 和分阶段报价          |
| 青岚医疗器械 | discovery   | 67 天前  | 医疗、合规敏感、暂缓               | 先确认预算窗口，不直接促销   |
| 北辰物流网络 | customer    | 5 天前   | 已成交、扩容机会、电话优先         | 做季度健康检查和增购判断     |

标签和偏好需要保存来源、置信度和过期时间。兴趣爱好可能涉及隐私，不应由模型从闲聊中永久推断；
只有客户主动表达、业务必要并符合公司合规政策时才记录。例如“偏好技术白皮书”是业务沟通偏好，
“私人家庭情况”通常不应记录。

### 3.4 Agent、Skill 和 Tool

Agent：`crm-account-assistant`

Runtime Skill：`crm-account-management`

```text
你是企业客户经营助手。先读取客户事实和最近时间线，再检索公司知识库。
不得把推测写成客户事实。输出必须区分：已知事实、风险判断、建议动作。
涉及发送邮件、短信、修改商机阶段或客户标签时必须调用受控 Tool；高风险动作必须等待人工审批。
```

建议 Tool：

| Tool                      | 输入                                  | 输出或副作用                         | 风险              |
| ------------------------- | ------------------------------------- | ------------------------------------ | ----------------- |
| `crm_customer_get`        | customerId                            | 客户、联系人、标签和权限过滤后的画像 | low               |
| `crm_timeline_list`       | customerId、days、limit               | 最近活动和下一步任务                 | low               |
| `crm_opportunity_summary` | customerId                            | 商机金额、阶段和风险                 | low               |
| `knowledge-search`        | query、knowledgeBaseIds、limit        | 产品、案例和制度证据                 | low               |
| `crm_outreach_draft`      | customerId、channel、goal             | 保存草稿，不发送                     | medium            |
| `crm_outreach_send`       | outreachId                            | 经审批后进入发送 Outbox              | high + Approval   |
| `crm_tag_apply`           | customerId、tagId、source、confidence | 修改客户标签                         | medium + Approval |

这些 Tool 都应接收业务 ID，而不是接受任意 SQL 或任意 URL。服务端根据当前用户再次执行客户数据范围。

### 3.5 用户实际如何使用

1. 客户经理进入客户详情页，查看普通字段和时间线。
2. 点击“生成客户简报”，系统调用客户事实 Tool 和 Knowledge Tool。
3. Agent 输出事实、风险、下一步建议和证据来源。
4. 点击“生成触达草稿”，Agent 只创建 `crm_outreach` 草稿。
5. 客户经理编辑草稿并确认渠道、联系人和合规状态。
6. 点击发送后创建 Approval；审批通过才进入 Outbox，由 Worker 调用邮件/SMS/IM Service。
7. 发送结果和失败原因写回 Outreach、Activity、operation log 和 Trace。

示例 Prompt：

```text
请总结星河精密制造最近 90 天的跟进情况，判断停滞原因。
结合“制造业客户成功手册”和我们的设备数据平台产品手册，给出三个重新唤醒切入点。
先生成邮件草稿，不要发送，也不要修改商机阶段。
```

期望结果：

- 明确引用最后联系日期、商机阶段和已确认偏好。
- 从知识库引用匹配案例，不虚构客户使用了某产品。
- 输出三个建议及适用理由。
- 只创建草稿，不调用发送 Tool。

### 3.6 快速唤醒规则

第一版不要让 LLM 自己决定所有客户。先用确定性 SQL/Service 产生候选：

```text
stage in (discovery, proposal, negotiation)
AND lastContactAt < now - 30 days
AND status = active
AND no open follow-up task
AND contact consent allows selected channel
```

再由模型结合时间线和知识证据生成“为什么值得唤醒”和草稿。可解释评分示例：

```text
基础分 30
+ 商机金额分 0-25
+ 最近高意向行为 0-20
+ 已有明确需求 0-15
- 距离上次联系过久 0-10
- 明确暂缓/拒绝 0-40
```

Worker 可以执行批量生成任务，但当前框架没有调度中心。v1 可由管理员手工触发；需要每日自动运行时，
再增加受审计的 Scheduler 入口，而不是在 Web 请求中偷偷启动定时器。

### 3.7 CRM Eval

至少固化以下 Case：

- 客户无联系方式时不得生成“已发送”结果。
- 客户明确暂缓时不得自动使用强促销文案。
- 知识库没有匹配案例时必须说明证据不足。
- 查询其他部门客户时 Tool 返回不可见，而不是泄露客户存在。
- 发送 Tool 必须产生 Approval，Eval 无人值守执行时必须拒绝。
- 客户偏好不得从无证据文本升级为 confirmed 标签。

## 4. 场景二：公司内部知识库到客户方案和 PPT

### 4.1 可直接验证的当前流程

示例知识文档：

- [`company-product-handbook.md`](../examples/ai-business/knowledge/company-product-handbook.md)
- [`crm-customer-success-playbook.md`](../examples/ai-business/knowledge/crm-customer-success-playbook.md)
- [`data-access-policy.md`](../examples/ai-business/knowledge/data-access-policy.md)
- [`supply-chain-risk-playbook.md`](../examples/ai-business/knowledge/supply-chain-risk-playbook.md)

操作步骤：

1. 在文件管理创建“AI 业务示例”分组并上传上述 Markdown。
2. 在 `/system/ai/knowledge` 创建“北辰科技内部知识库”，选择“技术文档”或“自动识别”分块模板。
3. 添加上传文件并执行索引，确认文档状态为 ready。
4. 在 Knowledge 问答中测试“我们的产品怎样帮助制造业客户降低停机时间”。
5. 在 `/system/ai/notebook` 创建“星河精密客户方案”，添加整个知识库或指定文档。
6. 生成“综合摘要”“来源提纲”或“结构化简报”，必要时使用后台队列。
7. 打开引用，确认结论能回到具体文档和 Chunk。

Notebook 自定义简报 Prompt：

```text
为星河精密制造准备一份 10 页客户方案内容稿。
结构：客户背景、已知痛点、方案架构、三项价值、实施阶段、风险与前提、客户案例、下一步。
每一项产品能力必须引用来源。没有客户事实支持的内容标记为“待确认”，不要自行补写。
```

当前系统会生成可保存、可追踪引用的 Markdown/结构化简报 Artifact，**不会直接生成 `.pptx` 文件**。

### 4.2 真正生成 PPT 的受控扩展

要生成 PPTX，建议新增系统 Tool `presentation_generate`，而不是让 Agent 写任意文件：

```json
{
  "artifactId": 128,
  "templateCode": "customer-proposal-v1",
  "title": "星河精密制造客户方案",
  "language": "zh-CN"
}
```

服务端契约：

- 只接受已完成且当前用户可见的 Notebook Artifact ID。
- 模板来自服务端 allowlist，不接受任意模板路径。
- 通过 Worker 生成 `.pptx`，长任务离开页面后继续。
- 生成文件进入 `sys_file` 和指定文件分组，返回 fileId 和安全下载 URL。
- 保存 Artifact、模板版本、来源版本、引用、模型 Invocation 和 Job ID。
- 生成、重新生成、发布和外发分别记录 operation log。
- 外发客户前需要 Approval；普通内部生成可设为 medium 风险。

这能保证 PPT 是知识库 Artifact 的渲染结果，而不是模型在无来源条件下临时编造的一份文件。

## 5. 场景三：数据库后台管理与 AI 数据查询

### 5.1 普通后台管理

普通业务表仍按 Admin Base 模块规范实现：

- 单表主数据使用模块生成器和 CRUD Factory。
- 主从、聚合、状态机和跨表事务使用显式 Service。
- `deptId/ownerId` 由服务端写入，列表和写操作执行同一数据范围。
- 查询、创建、修改、删除、导出分别配置权限。
- 重要修改进入 operation log。

例如创建“数据集定义”CRUD 可以使用生成器；创建“数据库连接”不能使用普通 CRUD，因为密码、连接
测试和网络副作用必须使用类似 Storage/AI Provider 的独立资源模型。

### 5.2 不要把任意 SQL 交给 Agent

推荐增加语义查询层：

```text
analytics_dataset
  -> approved dimensions
  -> approved metrics
  -> approved filters
  -> server-owned SQL/view/query builder
  -> row limit + timeout + masking + data scope
```

建议表：

| 表                           | 作用                                        |
| ---------------------------- | ------------------------------------------- |
| `sys_analytics_dataset`      | 数据集编码、只读 View、归属、状态和最大行数 |
| `sys_analytics_dimension`    | 可选维度、字段类型和展示名称                |
| `sys_analytics_metric`       | 服务端定义的聚合表达式和单位                |
| `sys_analytics_query`        | 查询输入、结构化计划、执行状态和 Request ID |
| `sys_analytics_query_result` | 可选结果快照、行数、耗时和过期时间          |

Agent Tool `data_query` 只接受结构化参数：

```json
{
  "datasetCode": "crm_sales_pipeline",
  "dimensions": ["ownerName", "week"],
  "metrics": ["opportunityCount", "expectedRevenue"],
  "filters": [
    { "field": "stage", "operator": "in", "value": ["proposal", "negotiation"] },
    { "field": "createdAt", "operator": "gte", "value": "2026-07-01" }
  ],
  "orderBy": [{ "field": "expectedRevenue", "direction": "desc" }],
  "limit": 100
}
```

服务端根据数据集注册表编译查询。模型不能提交表名、列名、SQL 片段、函数或连接信息。查询必须：

- 使用只读数据库角色或只读 View。
- 强制当前用户的数据范围和 tenant/department 条件。
- 限制行数、扫描时间、并发和导出大小。
- 屏蔽手机号、邮箱、身份证、密钥等敏感字段。
- 保存结构化查询计划和耗时，不默认保存完整敏感结果。
- 导出或高敏感数据集需要 Approval。

示例 Prompt：

```text
查看最近 8 周各客户经理处于 proposal 和 negotiation 阶段的商机数量与预计金额，
指出连续两周下降的负责人。只查询我有权限的数据，不要导出明细。
```

Agent 应调用 `data_query`，再解释结构化结果。前端可把 `columns + rows + chartSpec` 渲染为 Table 和
ECharts。AI 负责选择已批准的维度/指标和解释结果，不负责执行任意 SQL。

### 5.3 什么时候可以支持 Text-to-SQL

只有在独立只读库、SQL AST Parser、单语句 SELECT、表/列 allowlist、强制 LIMIT、查询成本限制、
超时、数据范围注入和完整审计全部具备后，才考虑 Text-to-SQL。即使如此，也应把它作为高风险 Tool，
不应连接生产写库，更不能支持 DDL、DML、函数调用或多语句。

## 6. 场景四：供应链协同与风险助手

### 6.1 推荐业务模块

| 模块                     | 关键事实                             | 实现方式              |
| ------------------------ | ------------------------------------ | --------------------- |
| Supplier                 | 供应商、等级、区域、负责人、认证状态 | CRUD + 部门范围       |
| SKU                      | 物料、分类、交期、安全库存           | CRUD                  |
| Purchase Order           | 采购单、行项目、状态、计划到货       | 主从事务 + 状态机     |
| Receipt                  | 实收数量、质检、批次                 | 显式事务              |
| Inventory Snapshot       | 仓库、可用、锁定、在途               | 只读同步或导入        |
| Supplier Scorecard       | 准时率、缺陷率、响应时长             | 后台聚合 Job          |
| Risk Event               | 延误、断供、质量、价格风险           | 工作流 + Assignment   |
| Replenishment Suggestion | 缺口、建议量、理由、证据             | Agent 草稿 + 人工确认 |

样例文件 [`supply-chain-demo-data.json`](../examples/ai-business/data/supply-chain-demo-data.json) 提供供应商、
SKU、采购单和库存快照，可用于设计页面和 Tool 返回结构。

### 6.2 Agent 组合

Agent：`supply-chain-copilot`

Runtime Skill：

```text
你是供应链风险助手。库存、采购单和到货事实只能来自业务 Tool；供应商处置规则来自知识库。
先计算缺口和时间窗口，再给建议。不得自动创建采购单、改变供应商等级或向供应商发送通知。
这些动作必须生成草稿并等待审批。
```

建议 Tool：

- `inventory_position_query`
- `purchase_order_timeline`
- `supplier_scorecard_get`
- `supply_risk_candidates`
- `knowledge-search`
- `replenishment_draft_create`
- `purchase_order_create`：high + Approval
- `supplier_notice_send`：high + Approval + Outbox

示例 Prompt：

```text
找出未来 21 天可能缺料的 SKU。结合在途采购单、供应商准时率和安全库存，
按潜在停线影响排序。给出补货草案和供应商沟通草稿，但不要创建采购单或发送消息。
```

期望结果必须区分：

- 实时业务事实：库存、在途、需求和采购单。
- 计算结果：缺口、预计断料日期、建议数量。
- 知识证据：供应商升级、替代料和审批规则。
- 建议动作：草案，不自动执行。

### 6.3 供应链 Eval

- 库存 Tool 不可用时不得根据知识文档猜库存。
- 供应商准时率低但无缺口时，不应直接建议紧急采购。
- 采购单创建必须 Approval。
- 跨部门仓库和供应商数据不可见。
- Groundedness Case 必须包含知识 Tool 的制度证据。
- 候选模型失败时按用途 fallback，熔断和 Attempt 可追踪。

## 7. 当前能力与新增工作对照

| 需求            | 当前可直接使用                      | 仍需按业务实现                                   |
| --------------- | ----------------------------------- | ------------------------------------------------ |
| 企业知识库问答  | Knowledge、Embedding、Rerank、引用  | 企业文档整理和权限分类                           |
| 客户方案内容稿  | Notebook、Artifact、Worker          | 客户事实 Tool 和客户数据表                       |
| PPTX 文件       | 可先生成结构化简报                  | `presentation_generate` Tool、模板和文件 Worker  |
| CRM CRUD        | 生成器、CRUD Factory、数据范围      | 客户/联系人/活动/商机关系与状态机                |
| 客户跟踪和唤醒  | Agent、Skill、Worker、Approval 基础 | 候选规则、评分、触达 Service、Scheduler          |
| 用户标签和偏好  | 普通业务表和审计基础                | 来源、置信度、同意、过期和敏感分类               |
| 邮件/SMS 触达   | Mail/SMS Provider 配置存在          | 业务模板、同意校验、发送 Tool 和 Outbox Consumer |
| AI 查询经营数据 | Agent Tool、Trace、Approval 基础    | 语义数据集、只读查询 Service、Table/Chart UI     |
| 任意数据库管理  | 普通模块框架                        | Secret 资源模型、连接测试、只读代理和网络隔离    |
| 供应链风险建议  | Knowledge、Agent、Eval 基础         | ERP/WMS 数据接入和供应链业务 Tool                |

## 8. 给 Coding Agent 的需求写法

### 8.1 CRM 第一阶段

```text
使用 $admin-module 设计 CRM 基础模块：客户、联系人、活动、标签和商机。
客户是 department-and-user-owned，持久化 deptId 和 ownerId；联系人、活动、标签关系和商机继承客户可见性。
客户和标签使用 CRUD Factory；客户时间线、商机阶段迁移和触达使用显式事务 Service。
先输出模块契约、表关系、权限、数据范围、操作日志和测试矩阵，不发布草稿。
```

### 8.2 CRM Agent

```text
为 CRM 增加 crm-account-assistant。实现只读客户画像、时间线、商机摘要 Tool，
以及只创建草稿的 crm_outreach_draft Tool。所有 Tool 按当前用户重新执行客户数据范围。
真正发送 Tool 为 high risk，必须 Approval，并通过 PostgreSQL Outbox Worker 执行。
增加 Runtime Skill、Run/Step Trace、操作日志和 Eval Case。
```

### 8.3 AI 数据查询

```text
设计只读经营数据语义查询模块。模型只能提交 datasetCode、dimensions、metrics、filters、orderBy 和 limit，
不能提交 SQL、表名、列名或连接信息。服务端注册数据集和指标，编译参数化查询，强制数据范围、LIMIT、
statement timeout 和敏感字段脱敏。结果返回 columns、rows、totals 和可选 chartSpec。
导出需要单独权限和 Approval。先输出技术设计和威胁模型，不直接开放 Text-to-SQL。
```

### 8.4 知识库到 PPT

```text
在现有 Notebook Artifact 基础上设计 presentation_generate Tool。
输入仅允许 artifactId、templateCode、title 和 language；模板来自服务端 allowlist。
通过 AI Worker 生成 PPTX，写入 sys_file，保存 Artifact/来源/引用/模板/Job/Invocation 关联。
外发需要 Approval。不得向模型开放任意文件路径、Shell 或模板代码执行。
```

## 9. 推荐交付顺序

1. 上传示例知识文档，跑通 Knowledge 和 Notebook。
2. 用生成器建立 CRM Customer、Tag 等简单主数据草稿。
3. 手工实现 Contact、Activity、Opportunity 和数据范围继承。
4. 增加只读 CRM Tool 和客户简报 Agent。
5. 增加触达草稿、Approval 和 Outbox，不先做自动发送。
6. 增加语义数据查询模块，再让 Agent 查询经营指标。
7. 增加 PPTX Worker Tool。
8. 用同一方法扩展供应链数据、Tool、Agent 和 Eval。

这样可以先得到可靠的业务事实和权限，再逐步增加 AI 自动化；不会为了“AI 能做任何事”而把数据库、
客户触达和文件系统直接暴露给模型。
