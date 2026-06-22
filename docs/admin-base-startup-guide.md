# Admin Base 启动说明

> 目标：以源码直接启动为主，Docker 只作为可选的本地依赖辅助方案。当前项目按 PostgreSQL-first 维护，不再把 SQLite 作为本地默认库。

## 1. 前置条件

本地需要准备：

- Node.js 20 或更高版本。
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
ADMIN_BASE_TOKEN_TTL_DAYS=7
```

说明：

- `DATABASE_URL` 是后台连接 PostgreSQL 的唯一入口。
- `ADMIN_BASE_SECRET_KEY` 用于加密邮件密码、S3 Secret 等敏感配置；生产环境必须改成随机长密钥。
- `NEXT_PUBLIC_API_BASE_URL` 同源部署时保持空值即可。
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

启动开发服务：

```bash
pnpm dev
```

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
pnpm dev                 # 启动 Next + Hono
pnpm db:migrate          # 执行 PostgreSQL 迁移，不清空数据
pnpm db:seed             # 写入或补齐默认数据，保留已有业务配置
pnpm admin:check-routes  # 检查前端路由、数据库菜单权限、CRUD 权限配置是否一致
pnpm typecheck           # TypeScript 检查
pnpm lint                # ESLint
pnpm test                # API/Service 单测
pnpm build               # 生产构建
```

## 6. 重置开发数据库

`pnpm db:reset` 会删除并重建 PostgreSQL 的 `public` schema，然后重新执行 seed。

```bash
pnpm db:reset
```

这个命令会清空本地已经配置过的邮件、存储、用户、文件元数据等数据。只建议在开发库需要完全重来时使用，不要在生产环境执行。

当前 `pnpm e2e` 的 Playwright 配置也会执行 `pnpm db:reset`，因此如果你本地数据库里有已经配置好的 SMTP 或存储数据，先不要直接运行 `pnpm e2e`。

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

上传失败：

- 确认默认存储存在且启用。
- 本地默认上传目录是 `storage/uploads`。
- 文件策略在“系统配置 / 文件策略”里维护。

邮件测试失败：

- 确认“邮件配置”里的 SMTP host、port、账号、授权码正确。
- QQ 邮箱等服务需要使用 SMTP 授权码，不是登录密码。
- `ADMIN_BASE_SECRET_KEY` 改动后，旧的加密密码可能无法解密，需要重新保存邮件账号密码。
