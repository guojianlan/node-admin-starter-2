# Admin Base 启动说明

> 目标：以源码直接启动为主，Docker 只作为可选的本地依赖辅助方案。当前项目按 PostgreSQL-first 维护，不再把 SQLite 作为本地默认库。

## 1. 前置条件

本地需要准备：

- Node.js 22 或更高版本。
- pnpm。
- PostgreSQL 14 或更高版本。

项目默认数据库连接串：

```text
postgres://admin_base:admin_base@localhost:5432/admin_base
```

如果你已经有可用 PostgreSQL，只要在 `.env.local` 里把 `DATABASE_URL` 改成自己的连接串即可。

## 2. 创建数据库

如果本机还没有默认数据库和用户，可以执行：

```bash
psql postgres -c "CREATE USER admin_base WITH PASSWORD 'admin_base';"
psql postgres -c "CREATE DATABASE admin_base OWNER admin_base;"
psql postgres -c "CREATE DATABASE admin_base_test OWNER admin_base;"
```

如果用户或数据库已经存在，PostgreSQL 会提示已存在；这种情况不用重复创建，确认 `.env.local` 连接串正确即可。

## 3. 配置环境变量

复制环境变量模板：

```bash
cp .env.example .env.local
```

最少需要关注：

```env
DATABASE_URL=postgres://admin_base:admin_base@localhost:5432/admin_base
ADMIN_BASE_SECRET_KEY=change-me-admin-base-secret
ADMIN_BASE_ADMIN_PASSWORD=123456
ADMIN_BASE_TOKEN_TTL_DAYS=7
ADMIN_BASE_PUBLIC_URL=http://localhost:3000
LOG_LEVEL=info
```

说明：

- `DATABASE_URL` 是后台连接 PostgreSQL 的唯一入口。
- `ADMIN_BASE_SECRET_KEY` 用于加密邮件密码、S3 Secret 等敏感配置；生产环境必须改成随机长密钥。
- `ADMIN_BASE_ADMIN_PASSWORD` 只在首次 seed 创建 `admin` 时生效，重复执行 seed 不会覆盖已存在管理员密码；生产环境必须显式配置，不能使用 `123456`。
- `ADMIN_BASE_PUBLIC_URL` 用于邀请邮件等服务端链接；生产环境必须是可公开访问的 HTTPS Origin。
- `NEXT_PUBLIC_API_BASE_URL` 同源部署时保持空值即可。
- `LOG_LEVEL` 控制 Pino 结构化日志级别，支持 `fatal`、`error`、`warn`、`info`、`debug`、`trace`、`silent`。
- 邮件 SMTP、存储配置、文件策略不建议写死到 `.env`，它们已经有后台配置页面。

## 4. 初始化并启动

安装依赖：

```bash
pnpm install
```

执行数据库迁移和默认数据写入：

```bash
pnpm db:migrate
pnpm db:seed
```

启动完整开发服务（包含 AI Worker 以及邀请邮件/Webhook 所需的 SaaS Outbox Worker）：

```bash
pnpm dev:all
```

只开发不涉及后台任务的 Web/API 页面时可以使用 `pnpm dev`。该命令不会隐式启动 Worker；如果页面
出现“任务等待执行”，应切换到 `pnpm dev:all`，或在独立终端按需运行 `pnpm ai:worker` 和
`pnpm saas:outbox`。

访问：

```text
http://localhost:3000
```

默认账号：

```text
admin / 123456
```

首次启动后建议立即修改管理员密码。

## 5. 常用命令

```bash
pnpm dev                 # 只启动 Next + Hono
pnpm dev:all             # 启动 Next + Hono + AI Worker + SaaS Outbox Worker
pnpm saas:outbox         # 常驻投递 SaaS 邀请邮件和 Webhook
pnpm saas:outbox:once    # 本地领取一轮 SaaS Outbox 任务后退出
pnpm ai:worker:health    # 检查超时排队任务和过期 Worker 租约
pnpm db:migrate          # 执行 PostgreSQL 迁移，不清空数据
pnpm db:seed             # 写入或补齐默认数据，保留已有业务配置
pnpm run doctor          # 环境和基础数据自检；pnpm doctor 是 pnpm 内置命令，不会执行项目脚本
pnpm admin:doctor        # 同上，提供一个不与 pnpm 内置命令冲突的别名
pnpm admin:check-routes  # 检查前端路由、数据库菜单权限、CRUD 权限配置是否一致
pnpm typecheck           # TypeScript 检查
pnpm lint                # ESLint
pnpm test                # API/Service 单测
pnpm build               # 生产构建
```

## 6. 重置开发数据库

`pnpm db:reset` 会删除并重建 PostgreSQL 的 `public` schema，然后重新执行 seed。命令要求显式允许并重复确认从 `DATABASE_URL` 解析出的数据库名：

```bash
ADMIN_BASE_ALLOW_DB_RESET=true \
ADMIN_BASE_RESET_DATABASE_NAME=admin_base \
pnpm db:reset
```

这个命令会清空本地已经配置过的邮件、存储、用户、文件元数据等数据。只建议在开发库需要完全重来时使用，不要在生产环境执行。

`pnpm e2e` 固定读取 `TEST_DATABASE_URL`，默认只允许名称以 `_test` 结尾的 `admin_base_test`，并在 3101 端口启动独立服务。它不会复用 3000 端口的开发服务，也不会重置 `DATABASE_URL` 指向的开发库。

## 7. Docker 的定位

Docker 可以作为可选能力，用来启动本地 PostgreSQL、Mailpit 这类依赖服务，但它不应该成为唯一启动方式。

推荐主路径仍然是：

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

后续如果补 `docker-compose.yml`，它只负责“本地依赖编排”，不替代源码启动流程。

## 8. 启动失败排查

数据库连接失败：

- 确认 PostgreSQL 已启动。
- 确认 `.env.local` 的 `DATABASE_URL` 用户、密码、端口、数据库名正确。
- 确认数据库用户有目标数据库权限。

登录失败：

- 确认执行过 `pnpm db:seed`。
- 默认账号是 `admin / 123456`。
- 如果修改过密码但忘记了，可以在开发环境重置数据库，或后续补专门的管理员密码重置脚本。

自检失败：

- 使用 `pnpm run doctor` 或 `pnpm admin:doctor`，不要使用 `pnpm doctor`。
- `pnpm doctor` 是 pnpm 自己的内置命令，不会执行本项目的自检脚本。
- `GET /api/health` 只说明进程存活。
- `GET /api/ready` 会检查 DB、migration、默认管理员、超级管理员角色和默认存储。

上传失败：

- 确认默认存储存在且启用。
- 本地默认上传目录是 `storage/uploads`。
- 文件策略在“系统配置 / 文件策略”里维护。

邮件测试失败：

- 确认“邮件配置”里的 SMTP host、port、账号、授权码正确。
- QQ 邮箱等服务需要使用 SMTP 授权码，不是登录密码。
- `ADMIN_BASE_SECRET_KEY` 改动后，旧的加密密码可能无法解密，需要重新保存邮件账号密码。
