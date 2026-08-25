# PostgreSQL AI Worker 与 Outbox

Updated: 2026-08-24

Admin Base 使用 `sys_ai_job` 提供 PostgreSQL-first 的后台任务基础。它适合当前 Notebook Artifact 和
Eval Dataset 长任务，并允许多个 Worker 进程竞争；它不是 Redis、Kafka、RabbitMQ 或完整调度中心。

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

## 2. Job 契约

当前 Job 类型：

- `notebook_artifact`
- `eval_dataset`

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

业务状态与 Job 入队需要原子提交时，应在同一个 PostgreSQL transaction 中写入业务记录和
`sys_ai_job`。当前 Notebook/Eval 是 Queue/Outbox 基础，不宣称已经提供跨服务事件总线。

## 4. 运维

治理页 `/system/ai/governance` 的“任务与账本”显示 Job、尝试次数、错误、重试和取消操作。Worker
应使用唯一 `workerId`；Job 错误只保存脱敏消息，不保存 Prompt、文档正文、API Key 或 Token。

生产监控至少应告警：

- queued 最老等待时间。
- failed 数量和失败率。
- running 租约过期数量。
- 同一 Job 重试次数。
- Worker 最近一次领取时间。

## 5. 升级条件

出现高吞吐、多优先级 SLA、跨区域、事件广播、延迟队列规模或 PostgreSQL 争用后，再评估 Redis、
RabbitMQ、Kafka 或专用 Workflow 引擎。迁移时保持 `sys_ai_job` 作为审计/幂等事实，避免丢失历史。
