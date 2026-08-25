# Admin Base 框架总览

Admin Base 是一个 PostgreSQL-first 的 AI 驱动后台框架。Next.js App Router、React、Ant Design、Hono、Drizzle ORM 和 PostgreSQL 运行在同一个应用中，目标是让普通管理模块快速落地，同时保留认证、权限、审计、文件、外部 Provider 和 AI Runtime 等显式业务边界。

## 核心模块

- 组织与权限：用户、角色、菜单权限、部门、数据范围和 Token 权限快照。
- 系统能力：配置中心、系统设置、登录日志、在线用户、操作日志和 Dashboard。
- 集成能力：本地或 S3 存储、SMTP 邮件、OAuth、SMS 和文件安全策略。
- AI Runtime：Provider、模型、用途路由、有序回退、调用账本、健康指标和 Trace。
- AI 应用：Playground、Chat、Agent、Tool、Run、Step、Approval、Web Search 和 Knowledge/RAG。
- 开发治理：业务模块生成器、路由与权限诊断、机器可读测试清单和生产诊断。

## 架构原则

PostgreSQL 是业务事实源。`sys_rule` 是菜单与权限的事实源，路由清单只负责把前端页面绑定到权限码。普通关系型 CRUD 使用 `createCrudRoutes(...)`；密码、Token、OAuth、AI 流式调用、文件字节、发布撤回和其他外部副作用使用显式 route/service。

管理页面保持 App Router 页面薄壳，真实页面放在 `src/features/**`。标准列表优先复用 `PageScaffold`、`AdminDataTable`、`AdminSearchForm`、`AdminEntityForm` 和共享 URL 状态。

## 数据与审计

新增业务记录必须明确属于全局数据、部门数据、用户数据、部门与用户共同拥有，或自定义业务范围。`createdBy` 只是审计证据，不能代替 `deptId` 或 `ownerId` 的业务所有权。

所有重要写操作进入 `sys_operation_log`。密码、Token、API Key、Access Key 和 Provider Secret 必须加密、哈希、掩码或完全不返回，不能写入普通日志与知识文档。
