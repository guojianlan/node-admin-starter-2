# AI Visual Workflow

## 这是不是 Mastra 自带的界面

Mastra 自带的是 Workflow 的编排 API、运行时和 JSON-safe Builder contract，不是一个可以直接嵌入
Admin Base 的 React 管理画布。`@mastra/core` 提供 `then`、`parallel`、`branch/conditional`、
`foreach`、`dowhile/dountil`、`sleep`、`sleepUntil`、`suspend/resume` 等运行能力；Studio 是 Mastra
自己的开发工具，不是当前安装的 `@mastra/core` 自动提供的业务管理页面。

因此 Admin Base 保留 `@xyflow/react` 作为管理员操作界面，但保存时会把画布图转换成 Mastra 的
`WorkflowBuilderDefinition`。这样界面是 Admin Base 的权限化配置页面，执行契约仍然和 Mastra 对齐，
不会让业务代码保存任意 JavaScript、函数闭包、Shell 或第二套工作流格式。

## Admin Base 与 Mastra 的关系

| 层次 | Admin Base | Mastra | 事实归属 |
| --- | --- | --- | --- |
| 配置界面 | Workflow 列表、草稿、全屏画布、节点检查器、版本和发布 | Core 没有可直接嵌入的 Admin React 画布；Studio 不是当前后台的权限页面 | Admin Base |
| 编排契约 | 把图转换成 JSON-safe Builder definition，并在发布前预检 | `then`、`parallel`、`branch`、`foreach`、`sleep`、`suspend/resume` 等编排语义 | Mastra Builder contract |
| 运行控制 | Run/Step、Request ID、租约、审批、数据范围、操作日志和费用账本 | Workflow runtime 和 step 执行能力 | Admin Base 授权，Mastra 执行 |
| 版本发布 | 草稿可以反复保存；发布版本不可变，回滚指向已有版本 | Builder definition 可被运行时消费 | Admin Base |

这里不是“自己做一套 Workflow 再反复转换成 Mastra”，而是保留一个稳定的 Admin Base
`VisualWorkflowGraph` 作为编辑模型，并在每次保存/发布时做一次单向编译：

```text
草稿 graph -> Mastra WorkflowBuilderDefinition -> preflight -> immutable published version
```

发布之后不反向把 Mastra 运行时对象序列化回画布，也不允许运行时偷偷修改草稿。这样可以避免
“画布改一次、Mastra 改一次、再次同步又覆盖一次”的多次修改风险。未来如果 Mastra Builder
contract 发生升级，只需要升级编译器和兼容性版本，历史已发布版本仍保留原始 graph 与
`compatibility_json`，可以明确提示迁移，而不是静默重写。

## 操作流程和编辑器布局

Workflow 的产品流程已经收口为：

```text
AI Agent / Workflow 列表 -> 点击 Workflow -> 独立全屏编辑器
  -> 保存草稿 -> Builder 预检 -> 发布不可变版本 -> 测试运行 -> 查看 Run/Step
```

`/system/ai/agent` 只展示 Workflow 入口和运行记录；`/system/ai/workflow` 负责 Workflow
列表，`/system/ai/workflow?id=<id>` 负责编辑具体定义，`?new=1` 负责创建草稿。编辑器使用
`@xyflow/react` 的无限画布，但不再把它放进一个小卡片：

- 顶部固定栏只放名称、编码、状态、版本、保存、发布和测试运行。
- 左侧节点面板可收起，按“输入与输出、数据处理、AI 与能力、流程控制、时间控制”分组；每个节点同时展示图标、中文名称、用途说明和稳定技术 key，并支持搜索。
- 中间画布占据主要空间，缩放、平移、MiniMap 和 Controls 保留在画布内；节点既可点击添加，也可从节点库拖到目标坐标。
- 画布提供移动/框选模式、多选、内部子图复制粘贴、复制一份、批量删除、撤销重做和定位全部节点；输入/输出节点不能被复制或删除，粘贴时会重建节点和内部连线 ID。
- 鼠标滚轮缩放，空白区域或按住空格平移；`Ctrl/Command + C/V/D`、`Ctrl/Command + Z`、`Ctrl/Command + Shift + Z` 和 `Delete/Backspace` 提供桌面快捷操作。
- 右侧检查器可以收起，并只负责当前节点配置；节点名称与技术 key 分开展示，条件、并行、遍历和循环使用结构化表单，低层 JSON 只保留在高级配置中。
- 测试输入和运行结果通过右侧抽屉按需打开，不和画布、节点配置争夺固定空间；字符串、图片、数组和对象输入都由 Schema 生成对应控件。
- 保存后才允许发布；存在未保存修改时发布按钮禁用，避免发布的不是当前草稿。
- 保存前会剥离 React Flow 的选中、拖动和渲染状态，只持久化真实 Workflow 节点类型、世界坐标、业务数据和连线；连线时前端先拒绝重复、自连接和循环，服务端仍执行最终 DAG 校验。

这套操作性比直接暴露 Mastra API 更适合管理员，也比把 Mastra Studio 作为第二套后台更容易
统一 `sys_rule`、数据范围、审批、审计和计费边界。

## 当前界面支持

在 `系统管理 -> AI Agent -> Workflows` 中可以添加：

| 画布节点 | Mastra 对应能力 | 说明 |
| --- | --- | --- |
| AI Agent | `agent` | 从 Admin Base Agent Registry 选择，不填写任意 Agent ID |
| 调用工具 | `tool` | 从受控 Tool Registry 选择，审批型 Tool 不能绕过 Approval |
| 字段映射 | `mapping` | 只允许 JSON-safe 的 `value`、`template`、`step`、`initData` 来源 |
| 并行执行 | `parallel` | 子任务同时开始，全部完成后按分支 key 汇总 |
| 条件分支 | `conditional` | 从上到下判断声明式 predicate，执行第一个命中项，并可配置默认分支 |
| 遍历列表 | `foreach` | 对数组逐项执行受控任务，最大并发为 20，结果顺序与输入一致 |
| 条件循环 | `loop` | 使用 `dowhile` 或 `dountil` 和声明式 predicate，单次运行最多 20 次 |
| 等待时长 | `sleep` | 毫秒级等待，最长 24 小时 |
| 等待至时间 | `sleepUntil` | 使用 ISO 时间，不接受函数形式的日期计算 |
| 子流程 | `workflow` | 引用已经发布的子 Workflow，禁止自引用和未知引用 |

在以上基础编排节点之上，P0/P1 平台节点已经进入同一个受治理执行入口：

| 平台节点 | 当前用途 | 关键边界 |
| --- | --- | --- |
| LLM 调用 | 按 chat/agent/RAG/Eval 用途策略或固定模型调用 AI SDK 7 | 支持 System Prompt、Prompt 模板、温度、输出上限、超时和基础 JSON Schema 校验；Invocation/Attempt 和费用账本不旁路 |
| 合并结果 | 多上游结果组成数组、对象，或执行 flatten/unique/first/last | 不执行任意脚本，只处理 JSON-safe 数据 |
| 重试与兜底 | 对 Agent、Tool 或子 Workflow 做最多 5 次指数退避重试，并可执行受控兜底任务 | 单次任务受超时限制；兜底仍经过 Registry、权限和审计 |
| 人工审批 | 持久暂停 Run，等待批准或拒绝后恢复原 Run | 需要 `system.aiAgent.approve`；它是业务决策节点，不替代高风险 Tool 自己的审批 |
| 等待事件 | 按精确 correlation key 等待外部业务事件 | 错误 key、重复提交、过期 Wait 都不能恢复 Run |
| 人工输入 | 保存标题、说明和表单 Schema，等待用户补充结构化数据后恢复 | 运行抽屉按 Schema 渲染文本、数字、布尔、枚举、对象和数组字段；服务端再次校验必填、类型、枚举和数值范围 |
| 知识检索 | 从授权可见的 Knowledge Base 检索并返回 Citation | 继续叠加 Knowledge 数据范围，不能通过 ID 绕过可见性 |
| 流程变量 | set/increment/append/merge 运行期状态 | 状态保存在 continuation 中，模板通过 `${state.key}` 读取 |
| 终止流程 | 显式成功结束或以业务失败终止 | 失败会收口 Run/Step 状态，不伪装成正常输出 |
| 读取 Memory | 读取当前用户已经确认保存的 Memory | 不读取其他用户数据，也不把候选当成已确认事实 |
| Memory 候选 | 产生待用户确认的长期记忆候选 | 只写 `proposed`，不静默保存长期 Memory |
| 解析文档 | 提交 `knowledge_parser` Job | 解析在 PostgreSQL Worker 中执行，不阻塞 Web 请求 |

超过 30 秒的 Sleep、未来时间等待、Approval、Event 和 Human Input 会写入
`sys_ai_workflow_wait` 与 Run continuation。到期任务由 `workflow_resume` Job 恢复，审批和事件则由受权限保护的
API 恢复同一个 Run，而不是创建第二条伪运行记录。

### 节点如何确定模型、Agent、Skill 和 MCP

不是每个节点都会调用模型。画布节点按执行职责分为以下几类：

| 节点类别 | 管理员选择什么 | 运行时如何解析 |
| --- | --- | --- |
| Agent | 一个已启用 Agent | 使用 Agent 固定模型；未固定时使用 `agent` 用途级模型策略，并加载 Agent 绑定的 Runtime Skills、Memory 和受控 Tools |
| Tool | 一个受控 Tool | 直接调用 Tool Registry；MCP 同步后的工具以 `mcp_gateway` Tool 形式执行，并继续受 allowlist、Approval 和审计约束 |
| Skill | 不作为独立节点 | Skill 是绑定到 Agent 的版本化指令与 Tool 能力包，不能脱离 Agent 单独运行 |
| 条件、并行、遍历、循环、等待 | 编排参数 | 不调用模型，只控制输入、分支、并发、次数和时间 |
| 子 Workflow | 一个已发布 Workflow | 动态查询并执行发布版本，禁止自引用，最大嵌套深度为 8 |
| LLM 调用 | 用途级模型策略或一个固定模型 | 通过统一 AI SDK Runtime 调用，并继承 Provider fallback、Invocation/Attempt、Token 和费用账本 |

选中 Agent 后，右侧“实际运行配置”必须展示最终解析到的模型、Skills、Tool 数量和是否包含 MCP；Tool
下拉必须区分普通受控 Tool 与 MCP Tool。管理员不应根据名称猜测执行链路。

旧版 `model` 节点仍然禁止发布。新的“LLM 调用”是独立合同，它要求 Prompt，可选择用途级策略或固定模型，
并显式配置 System Prompt、结构化输出、温度和可选执行限制；运行时始终经过统一 AI SDK 7 Runtime，不会把
Provider URL、API Key 或任意代码保存到画布。

## 内置 Workflow 示例

迁移 `0060_ai_visual_workflow_examples` 只在编码不存在时创建模板，不覆盖管理员已经编辑的同名 Workflow。
确定性模板默认发布，可以直接打开“测试运行”；依赖外部模型的模板默认保持草稿，防止缺少 Provider 时
看起来像一个可运行的生产流程。

| 示例 | 编码 | 主要节点 | 初始状态 | 运行要求 |
| --- | --- | --- | --- | --- |
| 客户优先级路由 | `demo-customer-priority-routing` | 条件分支、默认分支、计算器 | 已发布 | 无 API Key |
| 并行系统快照 | `demo-parallel-system-snapshot` | 并行、当前时间、系统状态 | 已发布 | 无 API Key；系统指标受当前管理员权限控制 |
| 批量计算任务 | `demo-foreach-batch-calculation` | Foreach、并发 3、计算器 | 已发布 | 无 API Key |
| 循环直到得到结果 | `demo-loop-until-result` | Loop、`dountil`、停止条件 | 已发布 | 无 API Key |
| 延迟处理通知 | `demo-delayed-notification` | Sleep、字段映射 | 已发布 | 无 API Key |
| AI 并行双视角评审 | `demo-ai-parallel-review` | 两个 Agent 并行评审 | 草稿 | 启用 Chat Provider/API Key、Chat Model，并把模型绑定给通用工作助手 |
| 搞怪图片生成器 | `funny-image-transform` | 图片输入、字段映射、Image Tool | 草稿 | 启用支持图片编辑的 Image Provider/API Key 和 `modelType=image` 模型 |

这些示例覆盖的是节点语义而不是行业业务的最终实现。复制模板后应修改名称和编码，并根据业务配置输入
Schema、Agent 指令、Tool 权限与输出契约；不要直接把通用工作助手当作不同职责的多个专业 Agent。

### 示例：搞怪图片生成器

迁移 `0055_ai_image_workflow_tool`、`0057_ai_image_workflow_schemas` 和
`0059_ai_image_workflow_refresh_current_draft` 会创建或刷新一个名为
`funny-image-transform` 的完整草稿模板。已有发布版本不会被覆盖；如果历史版本配置不完整，
系统会保留它并切换到新的完整草稿版本。它的图是：

```text
图片输入(JSON) -> Mapping 生成 Tool 参数 -> 图片创意改造(image-transform) -> 生成结果
```

运行输入的 JSON 结构为：

```json
{
  "fileId": 123,
  "instruction": "变成夸张搞怪的漫画风格，保留主体和主要构图",
  "size": "1024x1024",
  "style": "cartoon"
}
```

其中 `fileId` 是输入 Schema 中声明的 `x-input: "image"` 字段，因此测试运行面板会自动显示
图片上传按钮；`instruction`、`size` 和 `style` 会自动生成输入控件。Mapping 节点只映射这四个
字段，不再保留用户看不到的 `modelId` 参数。图片 Tool 使用当前启用的 Image Model，管理员不需要
在 Workflow 里重复选择模型；如果需要固定模型，应在后续版本增加显式的用途级模型选择策略。

编辑器的测试运行抽屉会直接上传图片到 `user_content` 用途域，再把文件 ID 传给已发布的
Workflow；原图不会被覆盖，生成结果会写入同一默认存储并返回新的文件 ID 和 URL。普通文件管理
不会把这类生成资产列入 `general` 列表。

`image-transform` 是系统内置、服务端受控 Tool。它只接受文件 ID、改图要求和可选尺寸/风格，
不会接受任意 Provider URL、脚本或 API Key。服务端会重新检查图片类型、文件读取权限、Image
Provider/Model 是否启用，然后通过 AI SDK `generateImage` 调用：

```text
Workflow executeWorkflow 权限
  -> image-transform Tool Registry
  -> Image Model（model_type=image）
  -> AI SDK generateImage（/images/edits）
  -> sys_file(user_content)
  -> Workflow Run/Step + AI Invocation/Attempt + operation log
```

要让示例真正运行，管理员需要先在 AI 模型管理中创建并启用 `modelType=image` 的模型，并在
Provider 中配置能兼容 AI SDK Image API 的 Base URL/API Key。没有 Image 模型时，Tool 会在运行
前失败并显示“图片工作流需要 Image 类型模型”，不会退回 Chat 模型，也不会发出外部请求。

当前 Image Runtime 支持 OpenAI、Google 和 OpenAI-compatible Provider。DashScope 等兼容服务商
需要确认其图片编辑接口兼容 `/images/edits` 且返回 `b64_json`；如果某个服务商只支持自定义
异步任务接口，应新增独立 Provider Adapter，不能在 Workflow 图里硬编码接口。

## 为什么 Agent 前面经常需要 Mapping

Mastra 的 Agent step 输入固定是：

```json
{ "prompt": "..." }
```

它不会把普通字符串自动包成 `prompt`。因此正确的流程是：

```text
输入 -> Mapping({ prompt: ${inputData} }) -> Agent -> 输出
```

保存或发布时会运行 Mastra 的 preflight；如果前后节点的输入输出 schema 不兼容，发布会拒绝，避免
运行到一半才出现 `expected object, received string`。

## 发布边界

- 保存草稿允许保留旧版模型节点，便于迁移历史草稿。
- 发布必须通过 Mastra Builder 预检。
- 发布时 Agent、Tool、子 Workflow 必须存在、启用，并且引用来自 Admin Base Registry。
- 旧版直接引用 Model 的节点不能发布，必须改成 Agent 节点；模型由 Agent 或用途级 Model Runtime 解析。
- 受审批保护的 Tool 不能通过 Workflow 绕过审批。
- 运行结果继续写入 Admin Base 的 `sys_ai_workflow_run`、`sys_ai_workflow_run_step`、调用账本和
  `sys_operation_log`，Mastra 不创建另一套权限、审批或费用事实表。

## 当前执行边界

简单线性转换流程通过 Mastra Workflow runtime 执行。声明式和平台治理节点先经过 Mastra Builder
contract 和引用校验，再进入 Admin Base 受治理执行入口；工具、Agent、LLM、Knowledge 和长流程继续经过
Provider、Run/Step、权限、审批和费用治理。动态子 Workflow、长 Sleep、Sleep Until、人工审批、事件等待和
人工输入的持久暂停/恢复已经接入。子 Workflow 自身进入持久暂停时，父 Run 会创建 `child_workflow` Wait 并
保存父 Run、父节点和调用深度；子 Run 完成或失败后解析父 Wait，再由 PostgreSQL Worker 恢复父流程。运行抽屉
可以从父 Wait 进入子 Run 完成审批或人工输入，管理员不需要重新运行父流程。

自定义治理节点在 Builder 中以带 `__adminBaseRuntimeNode` 标记的 JSON-safe Mapping 占位合同表示。这个标记
用于发布预检和兼容性识别，不能被描述成 Mastra 原生实现；实际业务语义由 Admin Base executor 执行。
`sys_ai_workflow_wait`、continuation 和 PostgreSQL Worker 是当前恢复事实源，尚未启用 Mastra Storage 自动建表
或维护第二套 Snapshot 数据。

这一区分是刻意保留的：Mastra 负责编排语义和执行内核，Admin Base 负责业务控制面。后续可以把更多
节点切换到 Mastra Dynamic Workflow runtime，但每次切换都必须保留相同的权限、审计、审批、租约和
账本证据。

## 运行与恢复验收（2026-09-01）

- `pnpm acceptance:workflow-recovery` 只允许连接本机 `*_test` PostgreSQL。它分别启动两个真实 Node Worker
  进程，让第一个进程领取 Timer 或父子 Workflow Job 后被 `SIGKILL`，等待租约到期，再由第二个进程接管。
- Timer 与父子 Workflow 两条链路均验证 Job 最终只完成一次、`attempts=2`、旧 owner 被清理且没有重复
  Step。父子链路还覆盖 Child 在 Human Input 持久暂停、提交表单后恢复 Child、再唤醒 Parent。
- 立即 Job 的 `available_at` 使用 PostgreSQL `now()`，避免 Web 主机和数据库毫秒级时钟偏差把新 Job
  暂时判断成未来任务；显式定时任务仍使用调用方传入的时间。
- Human Input 运行抽屉按保存的 Schema 渲染 text、textarea、number/integer、boolean、enum、object 和
  array 控件；服务端独立执行 required、type、integer、enum、min/max 和未知字段校验。
- 浏览器已验证桌面/390px、浅色/暗色、节点库和节点配置覆盖层、测试运行抽屉，以及 Parent Run `#10`
  与 Child Run `#11` 的暂停、输入、恢复和完成链路。React Flow 子控件使用共享主题 token，窄屏默认收起
  两侧面板；最新页面日志没有 warning/error。
- `pnpm admin:verify --full` 已通过 37 个测试文件、598 个测试、364/364 API、36/36 页面清单、路由权限
  一致性和 Next.js 16.3.1 Turbopack 生产构建。

这些证据完成了本机多进程恢复、Workflow 浏览器交互和构建门禁，不等于真实多主机、网络分区、数小时
任务或全站 36 页手工验收。真实 Chat Provider 压测已执行，但当前唯一候选 Provider 返回 429；调用没有
卡死，Attempt 被归类为 `rate_limit`，由于没有第二候选模型也没有发生 fallback。上游配额恢复并配置候选
模型后需要重新执行，不能把这次结果写成 Provider 通过。
