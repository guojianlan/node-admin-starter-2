# Admin Base 基座与 SaaS 业务扩展边界

> 当前核对：2026-09-02
>
> 文档状态：`implemented-unverified`。本文定义分层和当前代码事实，不表示 Studio Kernel 或 13 个业务产品已经交付。

## 1. 目标

Admin Base 的近期目标是先成为稳定、可组合、可治理的后台与 SaaS 基座，再让内容生产、CRM、供应链或其他
行业产品作为扩展包接入。判断一项能力属于哪里，不看它出现在哪个页面，而看它是否可以脱离具体行业业务独立复用。

```text
L0 通用后台基座
  身份 / RBAC / 数据范围 / 审计 / 配置 / 文件 / 通知 / Worker / 可观测 / 工程门禁
        ↓
L1 通用 SaaS 基座
  Tenant / Workspace / Member / Invitation / Current Context / Module / Entitlement / Usage
        ↓
L2 业务族共享内核
  Studio Project / Asset / Task / Timeline / Export，或 CRM/供应链自己的共享事实
        ↓
L3 垂直 SaaS 产品
  小说 / 圆桌 / 图片叙事 / MV / 科普 / 画图等 13 个产品
```

依赖只能从下层指向上层。L0/L1 不得 import 某个 Studio Tab 的 schema、页面或 Provider 流程；L3 也不得绕过
L0/L1 自己实现账号、租户、权限、文件、任务、配额和审计。

## 2. 必须完善的通用后台基座（L0）

这些能力对任何正式后台都是基线，不属于某个 SaaS 产品的“可选功能”。

| 能力域       | 必须提供的合同                                                     | 当前事实                                                 |
| ------------ | ------------------------------------------------------------------ | -------------------------------------------------------- |
| 身份与会话   | 登录、密码策略、Token 撤销、强制改密、OAuth 边界                   | 已实现；真实 OAuth/邮件环境仍需验收                      |
| RBAC 与菜单  | `sys_rule` 统一 route/action、服务端 `ability()`、Token 权限快照   | 已实现                                                   |
| 数据归属     | global/department/user/custom 明确分类，直接 ID 与批量写入同样校验 | 框架已实现；每个新模块仍必须声明                         |
| 数据库与迁移 | PostgreSQL + Drizzle schema + 非破坏性 migration + seed            | 已实现工程合同                                           |
| 审计与秘密   | 重要 mutation 写 `sys_operation_log`，密钥加密/Hash/脱敏           | 已实现主合同                                             |
| 文件与存储   | 安全上传、引用保护、本地/S3-compatible、物理删除边界               | 已实现平台能力；Tenant 文件边界待 L1 收口                |
| 通知与集成   | 公告、邮件、短信、OAuth、失败可追踪                                | 管理能力已实现；通用 Outbox/真实 Provider 闭环未全部完成 |
| 长任务       | PostgreSQL Job/Outbox、lease、heartbeat、retry、cancel、fencing    | AI 运行链已实现；通用业务任务适配待收口                  |
| AI 治理      | Provider/Model、Invocation、Tool、Approval、Knowledge、Eval、MCP   | 已实现基础，不等于任何垂直 AI 产品已交付                 |
| 运维与质量   | health/ready/doctor、API/page 清单、route check、测试和安全 smoke  | 已实现工程门禁；环境验收按发布执行                       |

L0 的完成标准是“一个新业务模块不需要重新发明后台工程和治理能力”，不是菜单数量多，也不是页面能打开。

## 3. 任意 SaaS 都应复用的基座（L1）

L1 不是某个内容产品的业务扩展；只要系统要服务多个客户组织，就必须先完成这些能力。

| 能力域               | 当前状态                                                      | 后续必须收口                                                           |
| -------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Tenant / Workspace   | 已有 schema、migration、页面、API、成员范围                   | 生命周期联动与环境验收                                                 |
| Member / Invitation  | 已有角色、停用/移除、Hash Token、邮箱绑定                     | SMTP Outbox、所有权转移、Team                                          |
| Current Context      | 本阶段新增服务端校验、数据库偏好、Header 传递、Header 切换器  | 所有新 SaaS 资源统一使用 `requireSaasContext`                          |
| Module / Entitlement | 已有模块目录、上架闸门、依赖、有效模块解析和 F3 套餐继承      | 批量授权、运营审批                                                     |
| Tenant 菜单          | 本阶段新增已上架模块按有效 Entitlement fail closed            | 业务模块上架时必须登记真实 route/action；控制面 route 不登记为产品模块 |
| 用量与配额           | F3 已有 Tenant/Workspace/Module/Metric reserve/settle/release | 生产并发规模、长跑 Worker 和业务模块逐项接入                           |
| Tenant 文件          | F2 已新增 `saas_file_binding` 与 Scope 文件 API               | 新业务资产必须绑定非空 Tenant/Workspace；历史文件仍按域迁移            |
| Tenant Worker        | F2 已新增 Job/Tool/Export/Callback 统一异步 Scope 封套        | 业务处理器与真实 Provider 必须在副作用前使用数据库 Scope 重新校验      |
| API / Webhook        | 尚未形成通用 SaaS 合同                                        | API Key Hash、scope、签名、重放保护、Outbox、重试                      |
| Plan / Billing       | F3 已有 Plan、Module Limit 与 Tenant Subscription 控制面      | Invoice、Payment、正式关账和 Provider 对账后续独立阶段                 |
| 品牌与域名           | 主题/I18n 有平台基础                                          | Tenant 品牌、域名验证、邮件品牌和安全回退                              |

### 3.1 当前上下文合同

- `saas_user_context` 只保存当前用户最后一次通过服务端验证的 Tenant/Workspace 偏好。
- 客户端在普通、文本流和事件流请求中发送 `X-SaaS-Tenant-Id`、`X-SaaS-Workspace-Id`。
- Header 只是选择输入，不是授权证据。业务 Service 必须使用 `requireSaasContext` 或等价显式校验，重新确认有效成员关系、Tenant/Workspace 状态和资源归属。
- `PUT /api/saas/context` 是当前用户自服务操作，不需要平台管理 ability，但必须登录、校验成员范围并写操作日志。
- Tenant 变更时，Workspace 必须重新从该 Tenant 的可访问集合解析，不能沿用另一个 Tenant 的 ID。
- `saas_module` 中的已上架产品模块只有在当前 Tenant 的有效 Entitlement、Token ability 和依赖同时满足时才进入菜单；无上下文时 fail closed。Tenant/Workspace 管理等控制面 route 不登记为产品模块。

## 4. 业务 SaaS 扩展（L2/L3）

以下内容不应继续堆进“基础后台已完成”的口径。

### 4.1 Studio 共享内核（L2）

`studio_project`、`studio_project_member`、`studio_asset`、`studio_asset_version`、`studio_task`、
`studio_template`、`studio_timeline_version` 和 `studio_export` 是内容生产业务族的共享内核。它们可以被 13 个产品
复用，但不适合要求 CRM、财务或供应链都使用，因此仍属于业务扩展层。

L2 第一版就必须具有非空 `tenant_id/workspace_id`、Project ACL、对象存储前缀、Worker 幂等/取消/重试、版本和
导出证据；不能先建全局表再补多租户。

### 4.2 13 个垂直产品（L3）

小说、无限画布、AI 圆桌会议、图片叙事、名著阅读视频、歌曲 MV、人物中心、AI 脱口秀、百家讲坛、知识科普、
演员库、素材/场景库和画图目前都只是 `saas_module.status = draft` 的目录登记。它们尚没有各自完整的业务表、API、
页面、Worker、Provider 闭环和真实环境验收。

已有 Image Runtime、Workflow Canvas、Agent、Knowledge 或文件管理只能作为这些产品的底层依赖，不能据此把任何
业务产品标成完成。

## 5. 基座优先实施顺序

1. **Foundation F1（本阶段）**：可信当前上下文、数据库偏好、请求 Header、后台切换器、Entitlement 菜单过滤、跨 Tenant 测试。
2. **Foundation F2（已实现，环境未验收）**：统一 `SaaSResourceScope`，Tenant 化新文件绑定、业务 Job/Tool/Export/Callback/Audit 上下文，并补两个 Tenant 攻击矩阵；详细合同见 [`saas-foundation-f2-resource-scope.md`](./saas-foundation-f2-resource-scope.md)。
3. **Foundation F3（已实现，环境未验收）**：Tenant/Workspace/Module/Metric 用量
   reserve-settle-release、并发额度、套餐继承、幂等补偿与超限审计；详细合同见
   [`saas-foundation-f3-usage-quota.md`](./saas-foundation-f3-usage-quota.md)。
4. **Foundation F4**：通知 Outbox、邀请邮件、API Key、Webhook 签名/重放/重试、Tenant 品牌和域名。
5. **Studio K1-K3**：只有 F1-F2 的隔离合同稳定后，才建设 Project/Asset、Task/Timeline/Export 和公共工作台。
6. **垂直产品**：每次选择 1-2 个产品做完整 MVP，不批量创建空菜单或空页面。

## 6. 基座完成闸门

“可以开始规模化开发 SaaS 扩展”至少需要：

- 两个测试 Tenant 的上下文、项目、文件、任务、Tool、导出和审计互不可见。
- 页面菜单、API、Worker、Webhook 和导出使用同一个服务端 Tenant/Workspace 解析合同。
- Entitlement 不只隐藏前端入口，业务 API 也拒绝未开通、过期、依赖不完整或超额调用。
- 文件对象路径不信任前端 Tenant 前缀；Job payload 不能通过篡改 Tenant ID 读取其他客户数据。
- 所有新增 API/page 进入机器可读测试清单，schema/migration/seed/permission/audit/tests/docs 同阶段交付。
- 自动门禁通过后仍分别记录浏览器、SMTP、S3、外部 Provider、Worker 长跑和生产同构环境的验收状态。

## 7. 本阶段验证边界

2026-09-02 当前已完成：

- `pnpm admin:verify --module saas`：SaaS 定向测试 18/18、类型、模块 ESLint、route check 和测试清单通过。
- `pnpm lint`：全仓 ESLint 通过。
- `pnpm test`：完整运行 40 个 Test Files、656 项测试全部通过。
- API/page 清单为 404/404、41/41，F1 上下文、F2 资源 Scope 与 F3 用量/套餐 API 均有独立安全合同。
- Foundation F2 新增统一 `SaaSResourceScope`、服务端 Tenant/Workspace 文件前缀、`saas_file_binding`、
  `saas_async_operation`、`saas_callback_event` 和结构化 Tenant 审计维度；Tenant A/B 的文件、Job、Tool、Export、
  Callback 与 Audit 攻击矩阵由 `tests/api/saas-resource-foundation.test.ts` 自动阻断。
- Foundation F3 新增 `saas_plan`、`saas_plan_module_limit`、`saas_tenant_subscription`、
  `saas_usage_policy_override`、`saas_usage_reservation` 和追加式 `saas_usage_ledger`；Plan/Entitlement/Tenant/
  Workspace 的继承顺序、并发 Reserve、幂等结算/释放、过期回收、governed overage 以及异步 operation
  完成/失败/取消补偿由 `tests/api/saas-usage-foundation.test.ts` 自动覆盖。

`pnpm admin:verify --full` 的 TypeScript、ESLint、Vitest、test-case inventory 和 route check 均通过；其附带的
production build 被开始前已有的 `next-env.d.ts -> .next/dev/types` 与过期 `.next/dev` 路由类型阻断，错误指向已不存在
的 `system/qa/note/page.js`，未改写或提交该用户文件。未运行 smoke、真实浏览器明暗主题/窄屏、真实 S3、常驻 Worker
长跑或外部 Provider/Webhook 验收。因此状态保持 `implemented-unverified`；自动化通过不等于生产环境或视觉验收完成。
