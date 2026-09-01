# PostgreSQL AI Worker 与 Outbox

Updated: 2026-08-24

Admin Base 使用 `sys_ai_job` 提供 PostgreSQL-first 的后台任务基础。它适合当前 Notebook Artifact、
Notebook Deep Research 和 Eval Dataset 长任务，并允许多个 Worker 进程竞争；它不是 Redis、Kafka、
RabbitMQ 或完整调度中心。

## 1. 启动

持续运行：

```bash
pnpm ai:worker
```

只领取一项后退出：

```bash
pnpm ai:worker:once
```

Web 进程不会隐式启动 Worker。生产部署应为 Worker 配置独立 PM2/systemd 进程，并与 Web 使用同一
数据库和加密环境变量。

本地开发同时启动 Web/API 与 Worker：

```bash
pnpm dev:all
```

这个入口会把两个进程作为一组管理；任一进程异常退出或收到 `SIGINT`/`SIGTERM` 时，另一个进程也会
被停止，避免留下孤立 Worker。只开发普通页面时仍可使用 `pnpm dev`。

## 2. Job 契约

当前 Job 类型：

- `notebook_artifact`
- `eval_dataset`
- `notebook_deep_research`
- `knowledge_parser`

Job 保存状态、优先级、尝试次数、最大尝试、可执行时间、幂等键、发起用户、资源、Request ID、领取
Worker、租约、结果和脱敏错误。

## 3. 领取与恢复

- Worker 使用 `FOR UPDATE SKIP LOCKED` 按 priority/id 领取。
- queued 且到达 `available_at` 的 Job 可领取。
- running 且租约过期的 Job 可回收。
- 执行期间按租约三分之一周期续期，避免长调用被第二个健康 Worker 重复领取。
- 失败使用最长 300 秒的指数退避，达到 `max_attempts` 后进入 failed。
- 幂等键唯一；重复提交返回已有 Job。
- retry 只允许仍有剩余尝试的 failed Job。
- cancel 只允许 queued/running Job。外部 Provider 调用可能无法立即中断，但取消后 Worker 不会覆盖状态或写回 Job 结果。
- 未显式指定 `available_at` 的立即 Job 使用 PostgreSQL `now()`；只有 Timer 等延迟任务使用调用方提供的
  时间。这样不同进程和数据库之间的毫秒级时钟偏差不会把立即 Job 暂时判定为未到期。

知识 Parser Job 携带 `documentId + expectedDocumentVersion`。文档版本变化后，旧 Worker 只能失败关闭，不能
覆盖新版本 chunk。业务状态与 Job 入队需要原子提交时，应在同一个 PostgreSQL transaction 中写入业务记录和
`sys_ai_job`。当前 Notebook/Eval/Knowledge Parser 是 Queue/Outbox 基础，不宣称已经提供 Redis/Kafka 级跨服务事件总线。

### 隔离恢复验收

恢复验收会重建测试库结构并强杀子进程，只允许连接本机 `*_test` 数据库：

```bash
NODE_ENV=test \
DATABASE_URL='postgres://admin_base:admin_base@127.0.0.1:5432/admin_base_test' \
ADMIN_BASE_SECRET_KEY='workflow-recovery-acceptance-secret' \
LOG_LEVEL=silent \
pnpm acceptance:workflow-recovery
```

脚本覆盖 Timer 和 Parent/Child Workflow。每条场景都由第一个 Worker 领取后直接收到 `SIGKILL`，租约到期
后由不同 `workerId` 的第二个进程接管，并断言 Job 只完成一次、`attempts=2`、没有 stale owner 和重复 Step。
Parent/Child 场景还会让 Child 进入 Human Input 持久暂停，提交输入后完成 Child，再由 `workflow_resume`
恢复 Parent。该脚本证明本机 PostgreSQL 上的真实多进程恢复，不替代真实多主机、网络分区和长时间压力验收。

## 4. 运维

治理页 `/system/ai/governance` 的“任务与账本”显示 Job、尝试次数、错误、重试和取消操作。Worker
应使用唯一 `workerId`；Job 错误只保存脱敏消息，不保存 Prompt、文档正文、API Key 或 Token。

生产监控至少应告警：

- queued 最老等待时间。
- failed 数量和失败率。
- running 租约过期数量。
- 同一 Job 重试次数。
- Worker 最近一次领取时间。

仓库提供一个不修改队列的健康检查和一个常驻监控进程：

```bash
pnpm ai:worker:health   # 单次检查；degraded 时退出码为 1
pnpm ai:worker:monitor  # 按间隔持续检查并输出结构化日志
```

健康状态使用可验证的队列事实，而不是猜测进程在线：可执行 Job 超过阈值仍未被领取，或 running Job
租约已经过期时返回 `degraded`。相关配置：

```bash
ADMIN_BASE_AI_WORKER_STALLED_AFTER_SECONDS=60
ADMIN_BASE_AI_WORKER_MONITOR_INTERVAL_SECONDS=30
ADMIN_BASE_AI_WORKER_ALERT_WEBHOOK_URL=https://alerts.example.com/hooks/admin-base
```

Webhook 可选，只在 `healthy`/`degraded` 状态变化时发送脱敏 JSON；发送失败会保留结构化错误日志并在
后续轮询重试。PM2 与 systemd 常驻样例分别位于 `deploy/pm2` 和 `deploy/systemd`。

Notebook 研究失败后的“重新研究”会创建新 Workflow Run，而不是覆盖原 Run 或原地重放已有 Step。
如果失败步骤显示“域名解析到内网或保留 IP”，这是 SSRF 防护结果：先检查代理、TUN/fake-IP DNS 或
搜索 Provider 返回 URL；不得通过允许内网/保留地址来让重试通过。

## 5. 升级条件

出现高吞吐、多优先级 SLA、跨区域、事件广播、延迟队列规模或 PostgreSQL 争用后，再评估 Redis、
RabbitMQ、Kafka 或专用 Workflow 引擎。迁移时保持 `sys_ai_job` 作为审计/幂等事实，避免丢失历史。
