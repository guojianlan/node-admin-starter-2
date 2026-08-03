# Admin Base 快速开发框架差距与实施计划

> 历史计划说明：本文创建于 2026-06-22，保留用于追踪起手式演进，不再代表当前完成度。
> 当前能力以 [`admin-base-framework-completion-status.md`](admin-base-framework-completion-status.md)
> 为准；AI 驱动开发约定以 [`ai-development-guide.md`](ai-development-guide.md) 为准。

> 创建日期：2026-06-22  
> 目标：把当前 Admin Base 从“后台能力可用”推进到“新项目只配置少数项即可启动和二次开发”的快速开发框架。  
> 当前分支：`codex/admin-base-migration-plan`

## 1. 当前判断

当前系统能力已经接近起手式后台的第一阶段完成态：

- PostgreSQL、Hono API、Drizzle schema、Next.js App Router、Ant Design、React Query、Zustand 已形成闭环。
- 用户、角色、菜单权限、部门、字典、配置、文件、存储、邮件已具备页面、接口、权限和 seed。
- `is_system` 内置数据保护、角色 `data_scope`、多存储、SMTP 测试发送、文件策略已经进入代码。
- UI/UX 已按运营后台工作台方向统一，表格 URL 状态和请求缓存已落地。

但作为“快速开发框架”还缺一层交付能力：新项目拿到代码后，不应该先阅读长文档、手动判断是否 seed、手动检查密钥和默认账号。主启动路径应以源码直接启动为准：

```bash
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Docker 可以作为可选能力，用来启动 PostgreSQL、Mailpit 这类本地依赖，但不作为唯一入口。如果后续补 `docker-compose.yml`，它只负责依赖编排，不替代源码启动流程。

当前已经新增源码启动说明：`docs/admin-base-startup-guide.md`。

启动脚手架维护规则、待办池和新增项模板见：`docs/admin-base-startup-scaffold-maintenance.md`。

## 2. 最小配置契约

面向普通项目接入者，只暴露这些必填或高频配置：

| 配置项                      | 必填 | 当前状态      | 目标说明                                                 |
| --------------------------- | ---- | ------------- | -------------------------------------------------------- |
| `DATABASE_URL`              | 是   | 已有          | PostgreSQL 连接串，开发和生产统一入口                    |
| `ADMIN_BASE_SECRET_KEY`     | 是   | 代码有默认值  | 用于邮件密码、S3 Secret 等敏感配置加密；生产必须强制配置 |
| 默认管理员密码              | 是   | 固定 `123456` | setup 阶段允许配置或生成，首次启动明确提示               |
| `NEXT_PUBLIC_API_BASE_URL`  | 否   | 已有          | 同源部署留空，前后端拆分时填写                           |
| `DATABASE_POOL_SIZE`        | 否   | 代码支持      | 默认 10，写入 `.env.example` 即可                        |
| `ADMIN_BASE_TOKEN_TTL_DAYS` | 否   | 已有          | 默认 7 天                                                |

这些能力不应该放在 `.env` 里，而应继续走后台系统配置：

- 邮件 SMTP：登录后在“邮件配置”维护，可测试发送。
- 存储配置：登录后在“存储配置”维护，可测试连接和设置默认。
- 文件策略：登录后在“系统配置 / 文件策略”维护上传大小、扩展名、预览限制、回收站保留等。

## 3. 还缺什么

### P0：启动闭环

目标：新项目第一次启动不再依赖口头说明。

需要补齐：

1. 启动文档
   - 源码直启作为主路径。
   - 明确 PostgreSQL 创建、`.env.local`、migration、seed、dev 启动。
   - 明确 `db:reset` 是破坏性开发命令。
2. `pnpm setup`，可作为后续增强
   - 检查 `.env.local` 是否存在。
   - 检查 `DATABASE_URL` 是否可连接。
   - 执行 migration。
   - 执行 seed。
   - 创建 `storage/uploads`。
   - 输出访问地址和默认账号。
3. `pnpm run doctor` / `pnpm admin:doctor`，已完成
   - 检查 Node、pnpm、PostgreSQL 连接、migration 状态、默认存储、默认邮件账号、密钥是否仍为默认值。
   - 不修改数据，只输出 ready / warning / failed。
4. `GET /api/ready`，已完成
   - 区分应用进程存活和系统可用。
   - 至少检查 DB、migration、默认存储、默认管理员、默认角色。
5. `docker-compose.yml`，可选
   - 提供 PostgreSQL。
   - 提供 Mailpit 或类似本地 SMTP 测试服务。
   - 默认数据库、用户、端口与 `.env.example` 一致。
   - 不作为源码启动的硬依赖。
6. README 改成 5 分钟启动路径
   - 主路径只保留最少命令。
   - 危险命令如 `pnpm db:reset` 下沉到“重置开发环境”。

验收：

```bash
pnpm db:migrate
pnpm db:seed
pnpm dev
curl http://localhost:3000/api/health
```

### P1：配置安全和默认值

目标：开发方便，但生产不能无声使用弱默认值。

需要补齐：

1. `ADMIN_BASE_SECRET_KEY` 校验
   - 开发环境允许默认值但 `doctor` 警告。
   - 生产环境缺失或使用默认值时启动失败。
2. 默认管理员密码配置
   - 支持 `ADMIN_BASE_ADMIN_PASSWORD` 只在首次 seed 时生效。
   - 如果未配置，开发环境保持 `123456`；生产环境必须显式配置。
3. seed 幂等和安全边界说明
   - `db:seed` 只补默认数据，不覆盖用户配置。
   - `db:reset` 明确标记为破坏性命令。
4. 敏感字段轮换说明
   - `ADMIN_BASE_SECRET_KEY` 改动会影响已保存 SMTP/S3 密钥解密。
   - 后续可补密钥轮换脚本，但不作为当前 P0 阻塞。

### P2：业务模块开发体验

目标：作为“快速开发框架”，新增模块要有固定套路。

需要补齐：

1. CRUD 模块脚手架文档
   - Drizzle table。
   - Zod schema。
   - CRUD factory route。
   - route manifest。
   - seed 菜单权限。
   - 前端 `AdminDataTable` 页面。
2. 示例业务模块
   - 保留一个小而完整的 `example`，用于演示列表、搜索、权限、数据权限、文件字段。
   - 当前“示例组件”菜单需要决定是保留为开发示例，还是在生产 seed 默认隐藏。
3. 权限命名约定
   - `module.entity.query/create/update/delete/status/import/export`。
   - 自定义 action 必须写入 seed，并被 `pnpm admin:check-routes` 检查。
4. 数据权限接入说明
   - 业务表有 `dept_id`、`created_by`、`owner_id` 时如何接入 `resolveDataScope`。

### P3：部署交付

目标：起手式不仅能本地跑，也能被业务项目部署。

需要补齐：

1. 生产启动文档
   - build/start。
   - env 必填项。
   - 反向代理上传大小。
   - 本地存储持久化目录。
2. Dockerfile
   - Next standalone 或普通 Node 运行方式二选一。
   - 不把 `.env.local` 和 `storage/uploads` 打进镜像。
3. migration 发布策略
   - 部署前执行 `pnpm db:migrate`。
   - 禁止生产运行 `db:reset`。
4. 备份与恢复最小说明
   - PostgreSQL 备份。
   - `storage/uploads` 或对象存储备份。

## 4. 推荐实施顺序

1. 先做 P0：启动文档、README 快速启动、`db:reset` 风险说明。
2. 再做 P1：密钥、默认管理员密码、生产启动保护。
3. 再补 P0 增强：`pnpm setup`、可选 `docker-compose.yml`。
4. 然后做 P2：新增业务模块模板和示例模块整理。
5. 最后做 P3：Dockerfile、部署文档、备份说明。

## 5. 完成度估算

按“后台基础能力”看，当前大约完成 80%：

- 用户、权限、角色、部门、配置、文件、存储、邮件、数据权限已经有可用闭环。
- 剩余主要是 generator、业务模块样板、部署包装和长期插件化能力。

按“快速开发框架交付体验”看，当前大约完成 55%：

- 核心代码和功能完成度高。
- 启动交付和依赖编排还没完成；配置校验、readiness、生产安全默认值已经完成第一版。

下一轮如果完成 P0 + P1，就可以把“只配置几样东西即可启动”的体验推进到 75%-80%。再补 P2 之后，才算真正适合拿去快速开新业务模块。

## 6. 当前不建议做的事

- 不要重新引入 SQLite 作为本地默认库。当前目标是 PG-first。
- 不要把 SMTP、S3、文件策略全部挪到 `.env`。它们已经是后台可配置能力，`.env` 只放启动和加密所需的基础配置。
- 不要把 `pnpm e2e` 作为普通本地检查默认命令；当前 Playwright 配置会执行 `pnpm db:reset`，会清空本地配置数据。
- 不要先做完整 generator。先把手写模块模板和 `doctor` 做稳，再抽脚手架。
