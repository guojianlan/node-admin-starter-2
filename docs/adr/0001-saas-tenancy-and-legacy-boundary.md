# ADR-0001：SaaS Tenant/Workspace 隔离与历史资源边界

- 状态：Accepted，Phase 1 分批实施
- 决策日期：2026-09-01
- 适用范围：`/api/saas/*`、后续 `/api/studio/*`、Studio 新业务数据

## 背景

Admin Base 当前是单组织 PostgreSQL 应用。系统已经具备用户、角色、部门数据范围、文件、AI Provider、Worker、
审计和 AI 费用事实，但这些历史资源没有统一的 `tenant_id` / `workspace_id`，不能直接声明为多租户安全。
内容生产平台又要求项目、文件、任务、Tool、导出和审计在两个 Tenant 之间互不可见，因此 Tenant 模型必须先于
Studio 业务表确定。

## 决策

### 1. 初始隔离模型

采用共享 PostgreSQL 数据库、共享 schema、业务表强制 `tenant_id` 的方案。Workspace 归属于一个 Tenant，
Workspace 级资源同时保存非空 `tenant_id` 和 `workspace_id`。理由是：

- 与当前单应用、PostgreSQL-first、Drizzle 和手写 migration 契约一致。
- 可以在一个事务中处理 Tenant、Workspace、项目、任务、费用和审计事实。
- 当前规模没有证明 schema-per-tenant 或 database-per-tenant 的运维成本是必要的。
- 后续可按区域或大客户迁移到独立数据库，但应用层资源合同不需要改变。

PostgreSQL RLS 暂不作为第一道权限边界。首期由显式 Service 在列表、详情、写入、批量、Tool、Job、导出和回调
入口统一校验成员关系；RLS 作为 defense-in-depth 必须经过连接池 session context、migration、备份恢复和运维
演练后再启用。

### 2. 第一批事实表

- `saas_tenant`：平台客户组织、区域、生命周期和保留策略。该表是平台控制面数据，不使用部门 data scope。
- `saas_workspace`：Tenant 内业务线或项目空间。
- `saas_tenant_member`：用户的 Tenant 角色和有效状态。
- `saas_workspace_member`：用户的 Workspace 角色和有效状态。

Tenant/Workspace 成员关系属于 custom business scope。`created_by` 只做审计，不能替代成员关系或资源归属。

### 3. 默认 Tenant 与历史数据

迁移创建系统保护的 `default` Tenant 和 `default` Workspace，并把迁移时存在的用户加入其中；空库 seed 在创建
内置用户后重复执行同一幂等成员补齐。该映射只表达“现有单组织兼容上下文”，不自动把所有历史资源改写成
已完成 Tenant 隔离。

历史边界如下：

- `sys_user`、`sys_role`、`sys_rule`、系统配置和平台 Provider 继续属于平台系统域。
- 现有 `sys_file`、Knowledge、Notebook、AI Job、Invocation、Operation Log 暂不增加可空 Tenant 字段来伪装
  多租户；每个域必须在独立迁移中决定系统级、Tenant 级或 Workspace 级归属。
- 新 Studio 资产通过 `studio_asset.tenant_id/workspace_id` 绑定 `sys_file.id`；对象存储键必须使用服务端生成的
  `tenants/<tenant-code>/workspaces/<workspace-code>/...` 前缀，不能相信客户端路径。
- 历史文件迁移需要清单、引用检查、校验和、可回滚复制和隔离验收，不能只更新 URL 或 metadata。

### 4. API 上下文

`GET /api/saas/context` 是只返回当前主体自身成员关系的认证接口，不要求平台管理 ability。普通用户的
Tenant/Workspace 管理列表继续同时校验对应 ability 与成员范围；超级管理员只能在平台控制面读取组织元数据，
不因此获得未来 Studio 客户正文的静默读取权。

后续 Studio Query/Command 必须显式接收或由已验证的当前上下文解析 `tenantId/workspaceId`，服务端再校验：

1. Tenant 和 Workspace 均启用且未软删除。
2. Workspace 确实属于 Tenant。
3. 当前主体具有有效成员关系及动作角色。
4. 资源行的 `tenant_id/workspace_id` 与上下文一致。
5. Job、Tool、导出和回调重新执行相同校验，不复用前端筛选作为安全证据。

### 5. 平台运维与 break-glass

平台超级管理员当前只用于 Tenant/Workspace 元数据运营。跨 Tenant 读取客户业务内容必须另建有时效、原因、审批、
Request ID 和追加审计的 break-glass 命令；没有该命令前，不提供“查询全部 Studio 内容”的隐式超级管理员分支。

## 不采用的方案

- `tenant_id` 长期可空：会让查询遗漏条件时产生跨 Tenant 泄漏，拒绝。
- 只依赖 `created_by`：资源转移、项目成员和自动任务无法表达，拒绝。
- 每 Tenant 一个 schema/database：当前没有规模、合规或客户 SLA 证据，延后。
- 用部门代替 Tenant/Workspace：部门是 Tenant 内组织结构，不能表达付费客户或跨部门项目空间，拒绝。
- 在所有历史 `sys_*` 表一次性增加 Tenant：缺少逐域语义和迁移证据，拒绝。

## 验收与后续迁移

本 ADR 的第一切片完成条件：默认上下文幂等创建、Tenant 创建原子生成默认 Workspace、普通成员列表隔离、直接
跨 Tenant 写入拒绝、权限种子、操作日志、API/page 清单和页面路由通过自动化验证。

第二切片追加：邀请只保存 Token Hash 并绑定现有用户邮箱；Tenant/Workspace owner 不能通过普通成员接口被
降级或移除；成员、邀请和 Entitlement 继续使用同一 Tenant/Workspace 成员范围；模块只有在真实 route、path、
required ability 和依赖就绪后才能上架；有效模块解析同时要求模块启用、有效 Entitlement、用户 ability 和依赖
闭包。模块目录是全局平台元数据，Entitlement 是 Tenant custom business scope。

Foundation F2（2026-09-02）追加：新 SaaS 文件通过 `saas_file_binding` 绑定非空 Tenant/Workspace，实际
`sys_file.path` 使用服务端生成的 `tenants/<tenant-code>/workspaces/<workspace-code>/...`；新业务 Job、Tool、
Export 统一使用 `saas_async_operation`，Callback 通过 operation 数据库事实恢复 Scope，操作日志增加结构化
`tenant_id/workspace_id`。历史 `sys_file`、Knowledge、`sys_ai_job` 和 `sys_ai_tool_execution` 不自动回填，仍需
逐域迁移。详细合同和攻击矩阵见
[`../saas-foundation-f2-resource-scope.md`](../saas-foundation-f2-resource-scope.md)。

整个 Phase 1 仍需继续交付团队、Studio Project/Asset/Task/Template/Timeline/Export、历史资源逐域迁移、
用量聚合及两个测试 Tenant 的项目/业务任务完整攻击矩阵。在这些完成前，只能称为
“Tenant/Workspace 控制面基础已实现”，不能称为完整多租户 SaaS。
