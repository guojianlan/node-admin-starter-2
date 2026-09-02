# Foundation F2：SaaS Resource Scope、文件与异步运行基座

> 实施日期：2026-09-02
>
> 状态：`implemented-unverified`
>
> 范围：通用 SaaS 基座 L1；不包含 Studio Kernel、业务 Tab、套餐计量和真实 Provider/Webhook 验收。

## 1. 本阶段解决的问题

Foundation F1 已建立可信的当前 Tenant/Workspace 选择，但 Header 只能表达“用户想在哪个上下文工作”，不能证明
文件、任务、Tool、导出、回调或审计事实属于该上下文。F2 增加统一 `SaaSResourceScope`，要求所有新 SaaS 资源
同时满足：

1. 当前用户是 active Tenant 成员，并具有 active Workspace 访问关系；Tenant 与 Workspace 均 active。
2. Workspace 确实属于 Tenant，资源行的非空 `tenant_id/workspace_id` 与当前 Scope 完全一致。
3. Worker、Tool、副作用执行、结果文件和 Callback 在执行前再次解析数据库事实，不能信任 payload 中的 Tenant ID。
4. 跨 Tenant 的直接 ID 攻击统一返回 404，不泄漏目标是否存在。
5. 平台权限和超级管理员身份不自动授予客户正文读取权；未来 break-glass 必须是独立、有时效和追加审计的命令。

## 2. 统一 Scope 合同

`src/server/services/saas-resource-scope-service.ts` 提供：

```ts
type SaaSResourceScope = {
  tenantId: number;
  workspaceId: number;
  tenantCode: string;
  workspaceCode: string;
  tenantRole: TenantRole;
  workspaceRole: WorkspaceRole | null;
};
```

- `resolveSaaSResourceScope()` 从当前用户、已保存上下文或经校验的 Header 选择解析 Scope。
- `revalidateSaaSResourceScope()` 用固定的数据库 Tenant/Workspace 和发起用户重新校验成员与生命周期。
- `assertSaaSResourceScope()` 对资源行执行同 Scope 比较，跨 Tenant/Workspace 统一按不可见处理。
- `buildSaaSObjectPrefix()` 只接受数据库中的 Tenant/Workspace code，生成
  `tenants/<tenant-code>/workspaces/<workspace-code>`；客户端不能传对象前缀。

平台用户即使拥有 `saas.workspace.query`，没有有效客户成员关系时也不能解析客户资源 Scope。

## 3. Tenant 文件合同

### 3.1 数据事实

`saas_file_binding` 不替代历史 `sys_file`，而是给所有新 SaaS 文件增加强制非空的业务归属：

| 字段                        | 合同                                                        |
| --------------------------- | ----------------------------------------------------------- |
| `tenant_id/workspace_id`    | 非空、共同构成资源 Scope；Workspace 必须属于 Tenant         |
| `file_id`                   | 唯一绑定一个 `sys_file`，避免一个物理文件被两个 Tenant 认领 |
| `object_key`                | 唯一，必须等于服务端生成并实际写入的 `sys_file.path`        |
| `resource_type/resource_id` | 可选但必须成对，用于当前业务主绑定                          |
| `purpose`                   | 文件用途标签，不参与授权                                    |
| `created_by/updated_by`     | 审计证据，不替代资源归属                                    |

历史普通文件、Knowledge 文件和既有 `user_content` 不会被自动回填成 Tenant 文件。历史迁移仍需独立的引用清单、
对象复制、校验和与回滚方案。

### 3.2 API 与副作用

- `GET /api/saas/files`：只列当前 Workspace 文件。
- `POST /api/saas/files/upload`：先校验 Scope，再写入服务端前缀，写入前再次校验并创建绑定。
- `GET /api/saas/files/:id`、`GET /api/saas/files/:id/download`：metadata 和字节读取使用相同 Scope。
- `PUT/DELETE /api/saas/files/:id/binding`：更新或移除业务主绑定，不改变文件的 Tenant 所有权。

上传若在对象写入后、绑定完成前发生 Scope 失效或事务失败，会删除未引用对象。物理删除仍必须走既有显式存储
Service；F2 没有增加一个绕过引用保护的删除入口。

## 4. Job、Tool、Export 与 Callback 合同

历史 `sys_ai_job` 和 `sys_ai_tool_execution` 继续属于平台 AI 域。新 SaaS 业务不得直接把它们当作 Tenant 隔离事实。
F2 增加 `saas_async_operation`，为新业务提供统一的运行封套：

| 能力   | 合同                                                                                 |
| ------ | ------------------------------------------------------------------------------------ | ---- | ----------------------------------------------- |
| `kind` | `job                                                                                 | tool | export`；三个类型共享同一 Scope、租约和幂等合同 |
| Scope  | `tenant_id/workspace_id` 非空；创建时从已验证 Scope 写入，payload 不能覆盖           |
| 幂等   | `(tenant_id, workspace_id, idempotency_key)` 唯一，不允许跨 Workspace 复用事实       |
| Worker | `FOR UPDATE SKIP LOCKED`、attempt、lease；claim 后以及外部副作用前重新校验 Scope     |
| Tool   | 处理器使用 claim 返回的数据库 Scope 校验输入/输出资源，不能直接信任 `payload.fileId` |
| Export | 完成时的 `result_file_id` 必须属于同一 Scope，不能混入其他 Tenant 文件               |
| 失效   | 成员停用、Tenant 停用或 Workspace 归档后，claim/lease 校验 fail closed，不执行副作用 |

`saas_callback_event` 从 `operation_id` 恢复 Tenant/Workspace 和发起人，Callback payload 中即使带有其他 Tenant ID
也不能改变数据库 Scope。同一 `(operation_id, callback_key)` 只应用一次。F2 只提供 Provider adapter 应调用的内部合同；
公网 Webhook 的签名、时间窗、重放缓存、密钥轮换和重试属于 Foundation F4。

## 5. Tenant 审计

`sys_operation_log` 新增成对出现的 `tenant_id/workspace_id` 和组合索引。`runWithOperationLog()` 与后台日志入口可
接收结构化 `saasScope`，不再只把 Tenant ID 埋在 `details_json`。

`GET /api/saas/audit` 强制使用当前 Scope 查询，只返回结构化元数据，不返回文件正文、Job payload、Callback
payload 或 Provider Secret。平台原有 `/api/system/operation/log` 仍是平台审计入口，不等同于客户正文访问权。

## 6. 两 Tenant 攻击矩阵

自动化使用 Tenant A/Workspace A 与 Tenant B/Workspace B，覆盖：

| 攻击面        | 自动断言                                                                       |
| ------------- | ------------------------------------------------------------------------------ |
| 文件对象路径  | A/B 上传路径分别使用服务端 Scope 前缀，不能由请求指定                          |
| metadata/list | A 列表和按 ID 查询不出现 B 文件                                                |
| 下载          | A 猜测 B fileId 返回 404，不能读取字节                                         |
| 绑定/解绑     | A 不能把 B fileId 绑定到 A 的资源                                              |
| 平台用户      | 有功能 ability 但不是客户成员时不能隐式读取客户文件                            |
| Job payload   | payload 可出现伪造 Tenant ID，但数据库 operation Scope 始终来自 A              |
| Worker        | A 成员停用后 claim 失败并将该 attempt 标记失败，副作用处理器不会执行           |
| Tool          | A 的 Tool Scope 校验 B 文件失败                                                |
| Export        | A 的 Export 不能把 B 文件登记为结果                                            |
| Callback      | payload 中 B Tenant ID 不改变从 operation 恢复出的 A Scope；重复事件不重复应用 |
| Audit         | A 的审计 API 不返回 B 的事件                                                   |

对应自动化：`tests/api/saas-resource-foundation.test.ts`。

## 7. 明确不在 F2 内的内容

- 不创建 `studio_project`、`studio_asset`、`studio_task`、`studio_export` 或 13 个产品业务表/页面。
- 不把历史 `sys_file`、Knowledge、Notebook、AI Job/Tool 全量迁移为 Tenant 资源。
- 不提供任意 Job/Tool 的公共执行 API；业务模块必须注册明确处理器并在处理器内使用 claim 返回的 Scope。
- 不实现套餐配额、并发额度、reserve/settle/release；这些属于 Foundation F3。
- 不实现真实 S3、常驻 Worker 长跑、Provider Callback/Webhook、浏览器页面或生产 smoke 验收。

因此本阶段仍标记为 `implemented-unverified`。F2 自动门禁通过后，只能称为“新 SaaS 资源的 Scope/文件/异步运行
基座已实现”，不能称为 Studio Kernel 或完整多租户 SaaS 已交付。

## 8. 后续阶段

1. Foundation F3（已实现，环境未验收）：Tenant/Workspace/Module/Metric 用量 reserve-settle-release、并发额度、
   套餐继承、幂等补偿与超限策略；见 [`saas-foundation-f3-usage-quota.md`](./saas-foundation-f3-usage-quota.md)。
2. Foundation F4：通知 Outbox、邀请邮件、API Key、Webhook 签名/重放/重试、Tenant 品牌和域名。
3. Studio K1-K3：新业务表从第一天使用非空 Scope、`saas_file_binding` 和 `saas_async_operation`，再实现项目、资产、
   任务、Timeline 和导出业务语义。

## 9. 本阶段自动验证记录

- `pnpm admin:verify --module saas`：2 个定向 Test Files、12/12 Tests，通过。
- `pnpm typecheck`、全仓 `pnpm lint`：通过。
- `pnpm test`：39/39 Test Files、642/642 Tests，通过。
- `pnpm test:check-cases`：396/396 API、41/41 页面，通过。
- `pnpm admin:check-routes`、`git diff --check`：通过。

`pnpm admin:verify --full` 在以上源码门禁全部通过后进入附带 production build；build 被开始前已有的
`next-env.d.ts -> .next/dev/types` 和过期 `.next/dev` 路由类型阻断，首个错误为找不到已不存在的
`src/app/(admin)/system/qa/note/page.js`。F2 没有页面或 App Router 变更，且该用户文件已恢复并排除在 F2 提交外，
因此没有用清理 `.next` 或改写 `next-env.d.ts` 绕过该环境边界。
