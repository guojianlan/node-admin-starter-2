# SaaS Phase 1-B：成员、邀请、模块与 Entitlement 实施合同

> 日期：2026-09-01
>
> 状态：`implemented-unverified`
>
> 上位设计：[`admin-base-business-product-plan.md`](./admin-base-business-product-plan.md)
>
> 多租户决策：[`adr/0001-saas-tenancy-and-legacy-boundary.md`](./adr/0001-saas-tenancy-and-legacy-boundary.md)

## 1. 阶段目标

本切片把 Tenant/Workspace 控制面从“组织与空间元数据”推进到可治理的成员、邀请和模块授权基础。它解决四个
问题：谁属于 Tenant/Workspace、如何安全加入、Tenant 开通哪些产品模块，以及服务端怎样判断某模块当前是否
真正可见。

本切片不实现 Team、套餐价格、订阅、正式计量账单或 Studio 客户内容；不改变历史 `sys_file`、Knowledge、
AI Job、Invocation 和 Operation Log 的归属。Phase 1 完成闸门仍是两个测试 Tenant 的项目、文件、任务、Tool、
导出和审计全链路互不可见。

## 2. 数据与范围合同

| 表                        | 可见性                 | 事实与约束                                                |
| ------------------------- | ---------------------- | --------------------------------------------------------- |
| `saas_tenant_member`      | Tenant custom scope    | owner/admin/member/viewer；owner 不通过普通成员 API 转移  |
| `saas_workspace_member`   | Workspace custom scope | owner/editor/reviewer/viewer；成员必须先属于同一 Tenant   |
| `saas_invitation`         | Tenant custom scope    | 邮箱、角色、过期和生命周期；只保存 Token SHA-256          |
| `saas_module`             | global system data     | code、版本、状态、依赖、route、required ability、能力声明 |
| `saas_tenant_entitlement` | Tenant custom scope    | trial/active/suspended/expired、来源、有效期和额度覆盖    |

`createdBy` 继续只作为审计字段。Tenant/Workspace 成员关系才是客户控制面资源范围；普通用户不能通过传入其他
Tenant、Workspace、邀请或 Entitlement ID 越过该范围。

## 3. 邀请生命周期

```text
pending -> accepted
   |----> revoked
   +----> expired
```

- 创建时生成 256-bit 随机 Token，响应只返回一次明文，数据库保存 SHA-256。
- 同一 Tenant、同一规范化邮箱只允许一个 pending 邀请。
- 可选 Workspace 必须属于同一 Tenant，Workspace 和 Workspace 角色必须同时出现。
- Tenant admin 不能邀请新的 admin；owner 转移不复用邀请或普通成员更新。
- 接受接口要求登录、Token 未过期且未处理、Tenant/Workspace 启用，并要求当前 `sys_user.email` 与邀请邮箱一致。
- 接受只绑定现有 `sys_user`，不创建第二套人员身份；重放返回冲突。
- Token、Token Hash 和认证信息不进入操作日志。当前切片未把 SMTP 投递和邀请事务绑定，管理页只提供一次性安全
  接受地址；邮件 Outbox 属于后续通知切片。

## 4. 成员管理规则

- Tenant owner/admin 可以查询其 Tenant 成员；admin 不能分配或变更 admin。
- Tenant owner 不能通过普通更新/移除接口被降级、停用或删除，未来使用独立所有权转移命令。
- 停用 Tenant 成员会同步停用其 Tenant 下 Workspace 成员关系。
- 移除 Tenant 成员在同一事务删除其 Tenant 下 Workspace 成员关系。
- Workspace 成员必须先是同一 Tenant 的 active 成员。
- Tenant owner/admin 或 Workspace owner 管理 Workspace 成员；Workspace owner 同样使用未来独立转移命令。
- 所有角色分配与移除使用显式 Route/Service、服务端范围校验和 high-risk 操作日志。

## 5. 模块上架与有效模块解析

13 个规划产品已作为 `draft` 系统模块写入目录。这只表示规划目录已登记，不表示 Studio 页面、API 或 Provider
闭环已交付。模块切换到 `active` 前必须同时满足：

1. `routeKey` 对应启用的 `sys_rule` route/nested。
2. `routePath` 与该 route 的真实 path 一致。
3. `requiredAbility` 对应启用的 `sys_rule` action。
4. 所有 dependency code 存在、已上架且依赖图无自依赖或循环。

`GET /api/saas/modules/effective?tenantId=...` 的结果同时要求：

```text
Tenant active
+ 当前用户具有有效 Tenant 成员关系
+ Module active
+ Entitlement trial/active 且已开始、未过期
+ 当前 Token 包含 required ability（超级管理员仅绕过 ability，不获得客户内容读取权）
+ 依赖模块也在有效集合
```

这是菜单可见条件的第一版服务端合同。2026-09-02 后续基座切片已经加入 Tenant/Workspace 当前上下文和
`tenant-menu` 入口过滤，详见 [`admin-base-saas-foundation-boundary.md`](./admin-base-saas-foundation-boundary.md)。
前端隐藏仍不能替代 Studio API 的 Tenant/Workspace/ACL 校验。

## 6. API 与页面

主要 API：

- `GET/PUT/DELETE /api/saas/tenant-members...`
- `GET/PUT/DELETE /api/saas/workspace-members...`
- `GET/POST /api/saas/invitations`
- `POST /api/saas/invitations/:id/revoke`
- `POST /api/saas/invitations/accept`
- `GET/POST/PUT /api/saas/modules...`
- `GET /api/saas/modules/effective`
- `GET/POST/PUT /api/saas/entitlements...`

页面：

- `/saas/members`：Tenant 成员、Workspace 成员、邀请三个工作区。
- `/saas/modules`：模块目录和 Tenant Entitlement 两个工作区。
- `/saas/invitations/accept`：登录用户邀请自服务页面，隐藏于后台菜单。

## 7. 权限与审计

| 资源        | 权限                                                                 |
| ----------- | -------------------------------------------------------------------- |
| 成员        | `saas.member.query/update/remove`                                    |
| 邀请        | `saas.member.invite/revokeInvite`；接受是登录用户 Token + 邮箱自服务 |
| 模块        | `saas.module.query/create/update`                                    |
| Entitlement | `saas.module.entitlementQuery/entitlementCreate/entitlementUpdate`   |

成员分配、移除、邀请、模块上架和 Entitlement 变更写入 `sys_operation_log`。明文 Token 不作为日志 details 参数，
统一日志清洗也会对 token/secret/password 等键执行脱敏。

## 8. 自动化验收与剩余边界

定向 API 自动化覆盖：

- 默认上下文与 Tenant/Workspace 原子创建回归。
- Token Hash、邮箱规范化、现有身份绑定、接受与重放拒绝。
- 跨 Tenant 邀请、成员查询和 Entitlement 写入拒绝。
- owner 普通变更阻断。
- 规划模块不能提前获得 Entitlement。
- 真实 route/ability 就绪的测试模块可以上架、开通并按 ability 进入有效模块集合。

当前自动门禁证据：

- `pnpm admin:verify --module saas` 通过，SaaS 定向测试 6/6。
- `pnpm admin:verify --full` 通过，38 个测试文件、628 项测试全部通过。
- API 清单 388/388、页面清单 41/41、路由—权限治理检查全部通过。
- Next.js 16.3.1 生产 build 通过，包含 `/saas/members`、`/saas/modules` 和
  `/saas/invitations/accept`。

本切片没有安全运行环境和凭据，因此没有运行 smoke；也没有把 production build 当作浏览器明暗主题、窄屏和实际
交互验收。状态保持 `implemented-unverified`。真实邀请邮件、Team、套餐继承、
用量、Studio Kernel 和两 Tenant 全链路资源攻击矩阵进入后续切片。
