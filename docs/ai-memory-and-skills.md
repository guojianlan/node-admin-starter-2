# AI Memory、Runtime Skills 与 Knowledge Tool

Updated: 2026-08-24

本文定义 Admin Base 跨会话长期 Memory、运行时 Agent Skill 和知识检索 Tool 的当前契约。它们使用
Admin Base 自有 PostgreSQL、权限和审计，不启用 Mastra Memory，也不等同于仓库中的 Codex Skills。

## 1. Memory

`sys_ai_memory` 保存当前用户显式确认的长期信息。支持 `user` 和 `agent` scope、来源 Session/Message、
`manual | confirmed` 写入策略、`active | archived` 状态和可选过期时间。

运行时只注入：

- 当前用户拥有的记录。
- `active` 且未过期的记录。
- User Memory，以及与当前 Agent 匹配的 Agent Memory。
- 最近更新的最多 20 条。

Memory 只能通过明确的 UI/API 写入。系统不静默提取整段对话、不复制完整聊天原文，也不允许 Memory
覆盖系统安全规则、权限或 Tool 审批策略。用户可以查看、修改、归档和删除自己的 Memory。

## 2. Runtime Skills

Runtime Skill 保存 `name/code/description/instructions/status`，并通过关系表绑定 Agent 和 Tool。Agent
执行时会注入已启用 Skill 的指令；只要 Agent 绑定了 Skill，其可用 Tool 就限制为所有已绑定 Skill
允许 Tool 的并集。

Runtime Skill 只组合服务端文字指令和已经注册的 Tool，不接受 JavaScript、Shell、Python、二进制、
任意 URL handler 或文件系统脚本。系统 Skill 不能通过普通删除接口删除。

## 3. Agent Knowledge Tool

系统 Tool `knowledge-search` 使用 `handler_key = knowledge_search` 调用现有 `searchKnowledge` 服务。Tool
接收查询和受限结果数量，执行时携带当前用户、abilities 和 Run/Step 上下文。

安全规则：

- 复用 Knowledge `global | department | user` 可见范围。
- 显式知识库过滤仍要叠加当前用户权限，不能通过 ID 绕过。
- 返回知识库、文档、Chunk、引用位置和检索分数，供回答和 Eval groundedness 使用。
- 不向 Agent 暴露数据库、文件系统或任意 SQL。
- Query、候选正文和 Provider Secret 不进入 operation log。

## 4. 管理与权限

管理页：`/system/ai/governance`。

- Memory 查询和写入复用 `system.aiChat.query/update`，服务端再强制当前用户所有权。
- Skill 管理使用 `system.aiGovernance.query/update`。
- Agent 执行仍使用原有 Agent、Tool、Approval、Run/Step 和 operation log 权限链路。

## 5. 仍未实现

- 从聊天自动提出 Memory 候选并逐条让用户确认。
- Memory 冲突合并、重要度衰减和 Embedding 召回。
- 可执行 Runtime Skill 包、版本市场和第三方代码加载。
- Knowledge Tool 的写入、删除或索引命令；当前只开放受控检索。
