# Foundation F4：SaaS 通知、开放集成、品牌与域名基座

> 实施日期：2026-09-03
>
> 状态：`implemented-unverified`
>
> 范围：通用 SaaS 基座 L1；不包含 Studio Kernel、13 个垂直产品、自动证书签发、任意公共 Callback Route 或真实 SMTP/公网 Webhook 生产验收。

## 1. 阶段目标与分层

F4 把“向客户发送通知”、“让客户系统安全调用/接收事件”和“使用 Tenant 品牌与域名”收口为可被任意业务 SaaS 复用的服务端合同。

| 层级 | F4 交付 | 不在 F4 内 |
| --- | --- | --- |
| L0 通用后台 | PostgreSQL migration、权限、操作日志、Secret 加密、独立 Worker 进程 | 替换现有邮件配置、新建第二后端或引入外部队列 |
| L1 SaaS 基座 | Tenant 通知 Outbox、API Key、Webhook、品牌、域名 | 具体业务事件的定义与对外 API |
| L2/L3 业务扩展 | 仅通过明确 Scope/Module/Event 使用 F4 服务 | Studio Project/Task/Asset、内容流程、行业 Connector 和垂直页面 |

Tenant 品牌、域名、API Key、Webhook Endpoint、Event 和 Delivery 都是 Tenant 自定义业务 Scope。可选 Workspace 约束由数据库关联和服务端校验共同执行，不信任客户端自报的 Tenant/Workspace。

## 2. 数据合同

Migration `0068_saas_integration_foundation` 新增九类事实：

| 表 | 用途 | 关键不变量 |
| --- | --- | --- |
| `saas_tenant_branding` | Tenant 产品名、Logo、主色、主题、Locale、Timezone、邮件署名 | 每 Tenant 唯一；Logo 只引用已有 `sys_file` |
| `saas_tenant_domain` | 自定义 hostname、DNS Challenge、验证/证书状态 | hostname 全局唯一；Challenge 只保存 Hash/Prefix |
| `saas_notification_outbox` | 邮件通知、领取、租约、重试、死信 | `(tenant_id, channel, idempotency_key)` 唯一；payload 加密 |
| `saas_api_key` | Key Hash、Scope、Workspace/Module 约束、过期/轮换/撤销 | 明文不入库；prefix/hash 唯一 |
| `saas_api_key_request_log` | 受限 API 请求审计事实 | 不存请求正文/Key；IP 仅保存 HMAC |
| `saas_webhook_endpoint` | URL、事件订阅、加密 Secret、超时与重试上限 | Secret 仅创建/轮换时返回明文 |
| `saas_webhook_event` | 对外事件 Outbox 事实 | `(tenant_id, event_type, event_key)` 唯一；payload 加密并保存 Hash |
| `saas_webhook_delivery` | Event 对 Endpoint 的投递状态机 | `(event_id, endpoint_id)` 唯一；只存响应正文 Hash |
| `saas_webhook_replay` | 入站 Provider Callback 持久化防重放占位 | `(tenant_id, workspace_id, source, event_key)` 唯一 |

Notification/Event/Delivery 的 Tenant/Workspace 由业务事实和服务端写入，Worker 执行前再检查 Tenant、Workspace、Invitation 或 Endpoint 当前状态。`createdBy` 是审计信息，不替代业务归属。

## 3. 通知 Outbox

### 3.1 写入与投递

`createInvitation()` 现在在同一 PostgreSQL 事务内写入 `saas_invitation` 和加密的 `saas_notification_outbox`，从而避免“邀请已创建但邮件任务丢失”。当前实现 `saas.invitation` 邮件模板；新通知类型必须增加显式模板处理器，不执行存储在 payload 里的任意 HTML/代码。

```text
queued/retry --claim + lease--> running
running --success-------------> delivered
running --retryable failure---> retry
running --attempts exhausted--> dead_letter
dead_letter --admin retry-----> queued
invalid business fact---------> cancelled
```

Worker 使用 `FOR UPDATE SKIP LOCKED`、过期 lease 接管、指数退避和最大尝试次数。投递前必须确认邀请仍为 pending、未过期、邮箱匹配且 Token Hash 匹配。SMTP 错误脱敏后才可保存。

### 3.2 隐私与保留

- 邀请 Token 和模板 payload 使用 AES-256-GCM 加密。
- 收件邮箱以明文保存，与已有 `saas_invitation.email` 保持一致，用于运维检索和投递；它仍属于 PII，生产必须设定保留周期和数据主体删除策略。
- 列表不返回 `payload_encrypted`，日志不记录 Token、邮件正文或 SMTP 凭据。

## 4. API Key

### 4.1 生命周期和授权

API Key 格式为 `sabk_<32-byte-random-base64url>`，数据库只保存 SHA-256 Hash 和用于识别的 Prefix。创建和轮换时仅在当次响应返回明文；轮换在同一事务中撤销旧 Key。

每个 Key 必须列出 1-100 个精确 Scope，不支持通配。默认拒绝包含 `system`、`permission`、`secret`、`apiKey`、`memberAdmin`、`billing`、`payment`、`refund`、`forceDelete` 或 `physicalDelete` 等高风险段的 Scope。Workspace/Module 资源约束是第二道闸门，不会因 Scope 命中而略过。

### 4.2 业务 API 接入合同

F4 不开放一个“可以调用任意路由”的通用入口。具体业务 API 必须在路由中固定：

1. `requiredScope`，例如 `studio.project.query`；
2. 该请求实际命中的 `workspaceId` 和 `moduleCode`；
3. 该业务自身的 Entitlement、资源 ACL、用量配额和幂等合同；
4. 请求完成后调用 `recordSaaSApiKeyRequest()`，仅记录 Key ID、Scope、Method、Path、Request ID、结果和 HMAC IP。

`authenticateSaaSApiKey()` 只解析受信 Principal，不把 API Key 伪装成后台用户 JWT，也不自动授予平台 `ability()`。当前没有具体业务 API 使用 API Key，因此审计表和认证 Service 已就绪，实际请求接线必须随第一个业务 API 一起验收。

## 5. Webhook

### 5.1 出站事件与签名

`enqueueSaaSWebhookEvent()` 以 Tenant/EventType/EventKey 幂等创建加密 Event，并为当时匹配 Tenant、Workspace 和事件订阅的 active Endpoint 创建 Delivery。同 Key/同参数返回原 Event，同 Key/不同 payload 返回 409。

签名原文与 Header：

```text
<unix-seconds>.<eventKey>.<rawBody>
X-Admin-Base-Signature: t=<unix-seconds>,v1=<hmac-sha256>
```

投递同时发送 Event Type、Event ID、Delivery ID、Timestamp 和 Request ID Header。对端必须使用原始 Body 验签，再解析 JSON。

### 5.2 SSRF、DNS Rebinding 与响应边界

- 只允许 HTTPS 标准 443 端口，拒绝 URL credentials 和名称为 Token/Secret/API Key/Signature/Password/Authorization/Credential 的查询参数。
- 拒绝 localhost、`.local`、`.internal`、内网/环回/链路本地/保留 IP。
- 域名投递前获取全部 DNS 地址，任意一个非公网地址都拒绝；HTTPS 连接固定使用已验证 IP，TLS Server Name 仍使用原 hostname。
- 不保存 Provider 响应正文，只保存 HTTP status 和 SHA-256 Hash；错误文本先脱敏再截断。

### 5.3 入站回调验证

`verifySaaSWebhookSignature()` 实现 HMAC-SHA256、默认 300 秒时间窗口和恒定时间比较；`verifyAndClaimSaaSWebhookReplay()` 在 PostgreSQL 中以 Tenant/Workspace/Source/EventKey 占位，防止跨进程重放。

F4 只提供验签和防重放 Service，不开放可接收任意 payload 的公共 Route。每个 Provider Callback 必须在其业务阶段声明固定 source、事件 schema、Secret 来源、Scope 恢复和幂等状态转移。

## 6. Tenant 品牌与自定义域名

Tenant 品牌包含产品名、Logo 文件引用、主色、主题默认值、Locale、Timezone、邮件署名和支持邮箱。F4 已将邀请邮件的产品名和链接接入有效品牌。登录页、导出、水印和对外分享页由相应业务阶段显式接入，不在 F4 中暗中改写全局主题。

域名只接受 hostname，不接受协议、路径或端口。创建时一次性返回 TXT 值：

```text
admin-base-verification=<random-token>
```

DNS 所有权验证只会将域名推进到 `status=verified` 与 `certificateStatus=pending`。当且仅当域名同时满足 `verified + isPrimary + certificateStatus=active` 时，`getTenantPublicBaseUrl()` 才返回自定义 HTTPS 域名；其他情况统一回退 `ADMIN_BASE_PUBLIC_URL`。

F4 没有伪造证书自动化。部署/证书控制器未把 `certificate_status` 推进为 `active` 前，用户链接始终使用平台域名。

## 7. 管理 API 与权限

| 能力 | API | Ability |
| --- | --- | --- |
| 品牌 | `GET/PUT /api/saas/branding` | `saas.branding.query/manage` |
| 域名 | `GET/POST /api/saas/domains`，`POST /domains/:id/verify|revoke` | `saas.domain.query/manage` |
| 通知 | `GET /api/saas/notifications/outbox`，`POST /outbox/:id/retry` | `saas.notification.query/manage` |
| API Key | `GET/POST /api/saas/api-keys`，`POST /:id/rotate|revoke` | `saas.apiKey.query/manage` |
| Webhook | `GET/POST /api/saas/webhooks`，`PUT /:id`，`POST /:id/rotate-secret|revoke` | `saas.webhook.query/manage` |
| Delivery | `GET /api/saas/webhook-deliveries`，`POST /:id/retry` | `saas.webhook.query/manage` |

所有 Route 使用 `authRequired()` 和显式 `ability()`。所有管理 Mutation 写 `sys_operation_log`；API Key、Webhook Secret、域名 Challenge、撤销与人工重试均按 high 风险处理。客户 Tenant 访问还要求当前用户在该 Tenant 中为 active owner/admin。

## 8. Worker 运行合同

```bash
pnpm saas:outbox:once  # 领取一轮，适合本地调试/检查
pnpm saas:outbox       # 常驻处理邮件通知和 Webhook Delivery
pnpm dev:all           # 开发环境同时启动 Web/API、AI Worker 和 SaaS Outbox Worker
```

生产必须将 Web、AI Worker、AI Worker Monitor 和 SaaS Outbox Worker 作为同一镜像/代码版本的独立进程，分别配置自动重启和日志。已提供 PM2 配置和 `admin-base-saas-outbox-worker.service` systemd 模板。不应把 Worker 放进 Web 进程、Serverless 请求或数据库 migration。

## 9. 自动验证与环境边界

`tests/api/saas-integration-foundation.test.ts` 覆盖：

- 邀请/Email Outbox 同事务、Token Hash、payload 加密、Tenant 品牌渲染和 messageId。
- Notification retry/dead-letter/人工重试和错误脱敏。
- API Key Hash、一次性明文、精确 Scope、Workspace/Module 约束、轮换/撤销。
- Webhook Secret/payload 加密、Event 幂等、HMAC Header、响应 Hash、时间窗口和持久化防重放。
- HTTPS/SSRF/敏感 Query/DNS Pin 边界。
- Tenant Domain DNS TXT 验证、证书未激活回退、激活后切换、撤销回退和跨 Tenant 拒绝。

2026-09-03 自动门禁记录：

- `pnpm admin:verify --module saas`：4 个定向 Test Files、28/28 Tests，通过。
- F4 定向 `tests/api/saas-integration-foundation.test.ts`：10/10 Tests，通过。
- `pnpm typecheck`、`pnpm lint`、`pnpm admin:check-routes`、`pnpm test:check-cases` 通过。
- API/page 机器清单为 423/423、41/41；F4 新增 19 个管理 API 合同。
- `pnpm test`：41/41 Test Files、685/685 Tests，通过。
- `git diff --check`：通过。

本阶段未运行 production build、smoke、E2E 或浏览器验收。开始前已有的
`next-env.d.ts -> .next/dev/types` 用户修改继续保留并排除在 F4 提交外，没有通过清理
`.next` 或覆盖用户文件绕过已知 build 边界。

自动化通过后仍必须保持 `implemented-unverified`，直到在目标环境完成：

- 真实 SMTP 发送、退信/投递回执和 PII 保留策略。
- 真实公网 DNS/TXT 传播、TLS 证书控制器和反向代理域名路由。
- 公网 Webhook TLS、防火墙/出站策略、对端验签、重试与死信恢复。
- 多进程常驻 Worker 长跑、租约接管、队列积压、监控和告警。
- 第一个真实业务 API 的 API Key 认证/请求审计与第一个 Provider Callback Route 的端到端验收。

## 10. 明确排除与下一阶段

- 不创建品牌、API Key、Webhook 或 Outbox 的空白 Tab/页面；当前交付 schema、Service、API、Worker、权限、审计和自动合同。
- 不把 `saas_api_key` 变成后台 JWT，不给 Key 开放任意 route 或默认高风险 Scope。
- 不把 Webhook Endpoint 当作任意 URL 请求器，不保存请求/响应正文到普通日志。
- 不在证书激活前使用 Tenant 自定义域名生成链接。
- 不包含 Studio Kernel、垂直产品、Connector Marketplace、Team、Invoice/Payment 或商业计费。

F4 完成自动门禁后，下一个业务阶段应选择明确的 Studio K1 或其他 L2 共享内核，用真实 Project/Task API 接入 F1 Scope、F2 文件/异步任务、F3 配额和 F4 API Key/Webhook，而不是批量生成 13 个空产品。
