# Foundation F3：SaaS 用量、配额与套餐继承基座

> 实施日期：2026-09-02
>
> 状态：`implemented-unverified`
>
> 范围：通用 SaaS 基座 L1；不包含 Invoice、Payment、Provider 官方账单、Studio Kernel 或垂直业务 Tab。

## 1. 本阶段解决的问题

F1/F2 已建立可信 Tenant/Workspace 上下文、新 SaaS 资源 Scope、Tenant 文件和异步运行封套，但此前
Entitlement 只能回答“是否开通”，不能原子回答“还可消费多少、能否并发执行、失败后如何归还”。F3 增加：

1. Tenant/Workspace/Module/Metric 的显式用量维度。
2. `reserve -> settle | release | expired` 的额度占用生命周期。
3. PostgreSQL 事务锁下的总量和并发额度校验。
4. Workspace override、Tenant override、Entitlement override、Plan 的确定性继承顺序。
5. `reject` 与 `allow_with_audit` 超限策略。
6. 追加式 Usage Ledger、幂等补偿和结构化高风险审计。
7. `saas_async_operation` 完成结算、失败/取消/Scope 失效释放的计量闭环。

## 2. 数据合同

### 2.1 Plan 与 Subscription

| 表                         | 归属           | 职责                                                              |
| -------------------------- | -------------- | ----------------------------------------------------------------- |
| `saas_plan`                | 平台全局控制面 | 套餐身份、状态和说明，不包含客户正文                              |
| `saas_plan_module_limit`   | 平台全局控制面 | 按 Module/Metric/Period 配置总量、并发与超限策略                  |
| `saas_tenant_subscription` | Tenant 控制面  | Tenant 当前套餐、状态和有效期；一个 Tenant 只有一条未删除当前记录 |

Plan/Subscription 不替代 Entitlement。消费前仍必须存在 active/trial、已开始且未过期的
`saas_tenant_entitlement`，模块也必须已上架。Plan 提供默认额度，Entitlement 决定模块是否可用。

### 2.2 Policy Override

`saas_usage_policy_override` 支持 Tenant 级或指定 Workspace 级策略。记录必须至少配置
`limit_quantity` 或 `concurrency_limit`，并保存修改原因。Workspace 必须真实属于 Tenant；Module 必须已上架。

有效策略优先级固定为：

```text
Workspace override
  > Tenant override
  > saas_tenant_entitlement 的 task_count 月额度/并发 override
  > Tenant 当前 active/trial Plan 的 Module limit
  > fail closed（未配置）
```

Workspace override 的总量与并发只聚合当前 Workspace；其他来源按 Tenant 聚合全部 Workspace。策略解析结果会把
来源、聚合范围、周期、限额、并发和超限规则快照写入 Reservation，运行期间修改套餐不会倒改历史占用事实。

### 2.3 Reservation 与 Ledger

`saas_usage_reservation` 是临时占用事实：

- 非空 `tenant_id/workspace_id/module_id/metric`。
- Scope 内唯一 `idempotency_key`。
- `reserved_quantity`、`concurrent_units`、过期时间和资源关联。
- 状态只允许 `reserved -> settled | released | expired`。
- 保存有效策略快照和是否已进入 governed overage。

`saas_usage_ledger` 是追加式事实：

- `settlement` 每个 Reservation 最多一条。
- `adjustment/reversal` 通过 Scope 幂等键防止重复补偿。
- 保存周期、数量、来源、Request ID 和业务资源关联，不保存 Prompt、回复正文、文件字节或 Provider Secret。
- 已写入历史记录不通过结算接口原地覆盖；修正必须追加 adjustment/reversal。

数量使用 PostgreSQL `NUMERIC(30, 6)`，API/Service 以十进制字符串传递，避免 JavaScript 浮点数承担财务或高精度
Token/Storage 事实。

## 3. Reserve / Settle / Release

### 3.1 Reserve

`reserveSaaSUsage()` 在事务中：

1. 重新校验请求用户的 Tenant/Workspace Scope。
2. 锁定当前 Tenant/Module 的有效 Entitlement，串行化同一配额域的竞争请求。
3. 回收已过期 Reservation。
4. 检查幂等键；同参数重试返回原记录，参数冲突返回 409。
5. 汇总同周期 Ledger 和未过期 Reservation。
6. 原子校验总量与并发；并发始终硬拒绝，数量按 `reject` 或 `allow_with_audit` 执行。
7. 写入带策略快照的 Reservation。

因此两个并发请求不能通过“先查再写”共同突破额度。客户端传入的 Tenant、limit 或 payload 不会覆盖数据库策略。

### 3.2 Settle

`settleSaaSUsageReservation()` 锁定 Reservation，只允许 `reserved -> settled`：

- 同数量重复结算返回原事实，不重复写 Ledger。
- 不同数量重复结算返回 409。
- `reject` 策略下实际量超过占用量返回 429。
- `allow_with_audit` 可结算超量，但 Reservation/Ledger 标记 overage，并写 high 风险日志。
- released/expired Reservation 不能结算。

### 3.3 Release 与过期回收

失败、取消或明确补偿使用 `releaseSaaSUsageReservation()`；重复释放幂等，已结算记录不能释放。Reservation 到期后
在下一次 Reserve/Summary 或清理入口中转为 `expired`，总量和并发槽立即恢复。

## 4. 异步操作集成

`createMeteredSaaSAsyncOperation()` 先创建用量占用，再把 `module_id/usage_reservation_id` 作为数据库关联写入
`saas_async_operation`。两者 Scope、Module、发起人和有效状态必须一致。

| 异步结果                     | 用量动作                                           |
| ---------------------------- | -------------------------------------------------- |
| `completeSaaSAsyncOperation` | 同一事务写 settlement Ledger 并完成 operation      |
| `failSaaSAsyncOperation`     | 同一事务 release Reservation 并标记 failed         |
| `cancelSaaSAsyncOperation`   | 仅发起人在同 Scope 取消；release Reservation       |
| claim 前 Scope 失效          | fail closed，release Reservation，不执行外部副作用 |

旧的非计量 F2 operation 仍允许 `module_id/usage_reservation_id` 同时为空，用于控制面和迁移兼容。新业务长任务必须
使用 metered wrapper，不能只创建裸 operation 后在前端自行计数。

## 5. 管理与查询 API

| API                                     | Ability                  | 边界                                |
| --------------------------------------- | ------------------------ | ----------------------------------- |
| `GET /api/saas/plans`                   | `saas.module.planQuery`  | 查询全局 Plan 与限制                |
| `POST/PUT /api/saas/plans`              | `saas.module.planManage` | 事务创建/替换 Plan 限制             |
| `PUT /api/saas/subscriptions/:tenantId` | `saas.module.planManage` | 分配 Tenant 当前套餐                |
| `PUT /api/saas/usage/policies`          | `saas.module.planManage` | 管理 Tenant/Workspace override      |
| `GET /api/saas/usage/summary`           | `saas.module.usageQuery` | 读取当前可信 Scope 的有效策略和汇总 |
| `GET /api/saas/usage/ledger`            | `saas.module.usageQuery` | 只列当前 Workspace 的追加账本       |
| `POST /api/saas/usage/adjustments`      | `saas.module.planManage` | 带幂等键的 high 风险人工补偿        |

Reserve/Settle/Release 没有开放为浏览器可任意调用的公共 API。业务模块必须通过明确的服务端 Command/Worker
调用，并把 Module/Metric/资源关系写死在业务合同中，避免客户端占用任意指标或自行结算。

## 6. 攻击与竞态矩阵

自动化覆盖：

- Plan 默认额度生效，Entitlement/Tenant/Workspace override 按固定优先级覆盖。
- 重复 Reserve、Settle、Release 和 Adjustment 不重复占用或记账。
- 两个并发 Reserve 只有额度允许的请求成功。
- 总量或并发超限返回 429，失败事务不写半成品。
- release/expired 立即恢复额度；settle/release 互斥。
- Tenant A 不能使用 Tenant B Scope 结算 Reservation，也不能拼接跨 Tenant Workspace Header。
- operation payload 中伪造 Tenant 不改变 operation/reservation 的数据库 Scope。
- operation 完成结算；失败、取消、成员失效分别释放。
- governed overage 保存 Reservation/Ledger 标记并写 high 风险审计。
- Ledger/Audit 不保存敏感业务 payload。

对应自动化：`tests/api/saas-usage-foundation.test.ts`。

## 7. 明确不在 F3 内的内容

- 不创建 Studio Project/Asset/Task/Timeline/Export 或 13 个垂直产品页面。
- 不实现 Invoice、应收、Payment、Refund、税率、正式关账和 Provider 官方账单对账。
- 不把 `sys_ai_quota_policy/sys_ai_billing_ledger` 伪装成 Tenant 账本；历史 AI 域仍按原 system/department/user 语义。
- 不提供前端“用量中心”空 Tab；当前先交付可被任意 SaaS 业务复用的后端合同和运维 API。
- 不声称真实多进程长跑、生产并发规模、浏览器、外部 Provider 或财务验收已完成。

因此状态保持 `implemented-unverified`。F3 只能称为“通用 SaaS 用量/配额/套餐继承基座已实现并通过自动化”，不能称为
完整商业计费系统或任一业务 SaaS 已交付。

## 8. 本阶段自动验证记录

- `pnpm admin:verify --module saas`：3 个定向 Test Files、18/18 Tests，通过。
- `pnpm typecheck`、全仓 `pnpm lint`：通过。
- `pnpm test`：40/40 Test Files、656/656 Tests，通过。
- `pnpm test:check-cases`：404/404 API、41/41 页面，通过。
- `pnpm admin:check-routes`、`git diff --check`：通过。

未运行 production build、smoke、真实浏览器、生产并发压测、常驻多 Worker 长跑或正式财务/Provider 验收。
开始前已有的 `next-env.d.ts -> .next/dev/types` 用户修改继续保留并排除在 F3 提交外；F2 已证明该状态会让附带
production build 读取过期 `.next/dev` 路由类型，因此本阶段没有通过清理 `.next` 或覆盖用户文件来绕过环境边界。
