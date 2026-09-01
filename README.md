# Admin Base

Node.js 技术栈的基础后台框架，参考 `xin-admin/xin-admin-laravel` 的产品结构和权限模型实现，但不复用 Xin 的封装组件。

## 起手式完成状态

当前起手式完成范围与验收记录见 [`docs/admin-base-starter-completion-plan.md`](docs/admin-base-starter-completion-plan.md)。

当前技术栈、模块边界和运行架构见 [`docs/admin-base-architecture.md`](docs/admin-base-architecture.md)。

AI 辅助开发的仓库约束、模块决策、生成/审核流程和安全边界见
[`AGENTS.md`](AGENTS.md) 与 [`docs/ai-development-guide.md`](docs/ai-development-guide.md)。项目级 Codex
Skills 位于 [`.codex/skills`](.codex/skills)，模块生成输入契约见
[`schemas/admin-module.schema.json`](schemas/admin-module.schema.json)。

测试资产分为三层：业务场景见 [`docs/admin-base-functional-test-cases.md`](docs/admin-base-functional-test-cases.md)，逐接口成功/失败契约见 [`docs/admin-base-api-test-cases.md`](docs/admin-base-api-test-cases.md)，逐页面数据/交互/视觉验收见 [`docs/admin-base-page-test-cases.md`](docs/admin-base-page-test-cases.md)。`pnpm test:check-cases` 会阻止新增接口或页面时遗漏测试用例。

生产级对齐路线和与 XinAdmin / ContiNew 的差距见 [`docs/admin-base-production-readiness-plan.md`](docs/admin-base-production-readiness-plan.md)。

源码启动、环境变量、数据库初始化和常见问题见 [`docs/admin-base-startup-guide.md`](docs/admin-base-startup-guide.md)。

快速开发框架的启动体验、最小配置项和后续缺口见 [`docs/admin-base-quick-start-framework-plan.md`](docs/admin-base-quick-start-framework-plan.md)。

启动脚手架的维护规则和待办池见 [`docs/admin-base-startup-scaffold-maintenance.md`](docs/admin-base-startup-scaffold-maintenance.md)。

S3、SMTP、OAuth、SMS 和 AI Provider 的 Docker 本地模拟及配置见
[`docs/local-external-services-acceptance.md`](docs/local-external-services-acceptance.md)。

已进入核心起手式：

- 用户、角色、菜单权限、部门、字典、配置、文件、存储、邮件。
- `is_system` 内置数据保护。
- 角色 `data_scope` 数据权限和部门范围过滤。
- 本地存储 + S3-compatible 存储配置，文件上传写入存储和 sha256 元数据。
- SMTP 邮件账号配置、默认账号、测试发送和密钥脱敏。
- `sys_operation_log` 后台操作日志，记录关键管理动作和失败结果。
- 登录日志、在线用户会话、个人中心、安全/登录/token 策略配置。
- 登录验证码按 `login.captcha_enabled` 动态启用，忘记密码支持邮箱重置链接。
- 通知公告和用户消息入口，支持发布、撤回、未读计数和已读状态。
- 文件上传扩展名、MIME、魔数和危险类型策略，支持分片上传、引用保护和安全下载。
- OAuth、SMS、AI Provider/模型资源配置和密钥脱敏。
- AI Playground、持久化 AI Chat、Agent/Tool/Run/Step/Approval 运行闭环。
- Web 模块生成器、路由权限一致性检查和业务模块模板。

后置范围：

- 多租户、任务调度中心、字段级权限 UI、实时 WebSocket 消息、完整插件市场和高级 AI 评测/计费。

## 技术栈

- Next.js App Router
- React Client Components
- Ant Design
- Hono
- Drizzle ORM schema
- PostgreSQL 本地开发和上线数据库
- Zustand
- Zod
- Vitest
- Playwright

## 快速启动

前置条件：本机已经有 PostgreSQL，并且存在 `admin_base` 用户和 `admin_base` 数据库。默认连接串见“本地数据库”。

```bash
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm db:seed
pnpm dev:all
```

访问：

```text
http://localhost:3000
```

默认账号：

```text
admin / 123456
```

## 常用命令

```bash
pnpm dev                 # 只启动 Next + Hono，适合不执行后台任务的开发
pnpm dev:all             # 启动 Next + Hono + AI Worker，Notebook 研究等后台任务推荐使用
pnpm ai:worker:health    # 单次检查队列等待与 Worker 租约，异常时返回非零退出码
pnpm db:migrate          # 执行 PostgreSQL 迁移
pnpm db:seed             # 写入默认管理员、角色、菜单、权限、字典、配置、存储、邮件
ADMIN_BASE_ALLOW_DB_RESET=true ADMIN_BASE_RESET_DATABASE_NAME=admin_base pnpm db:reset
                         # 危险：确认目标库名后清空 public schema，仅开发重置使用
pnpm run doctor          # 环境和基础数据自检；pnpm doctor 是 pnpm 内置命令，不会执行项目脚本
pnpm admin:doctor        # 同上，提供一个不与 pnpm 内置命令冲突的别名
pnpm admin:check-routes  # 检查 route manifest 与数据库菜单/权限是否一致
pnpm admin:verify --quick # 类型、测试清单和路由权限快速验证
pnpm admin:verify --full  # 类型、lint、测试、权限检查和生产构建
pnpm lint                # ESLint
pnpm typecheck           # TypeScript
pnpm test                # API/Service 单测
pnpm test:check-cases    # 检查所有 API 和页面均有测试用例
pnpm test:docs           # 从机器可读清单重新生成测试文档
pnpm e2e                 # Playwright E2E，固定使用 *_test 数据库和 3101 端口
pnpm build               # 生产构建
```

`pnpm typecheck` 使用独立的 `tsconfig.typecheck.json`，不会读取运行中的 Next dev server 持续改写的
`.next/dev/types`；生产路由与 Next 生成类型仍由 `pnpm build` 验证。

## 目录约定

```text
src/app/**/page.tsx         # Next 路由薄壳，只 import 并渲染 features 页面
src/features/**             # 业务页面，可迁移到纯 React CSR
src/components/**           # 通用业务组件：表格、搜索、表单、字段、权限按钮
src/ui/**                   # 统一后台 UI：Provider、Shell、PageScaffold、状态页
src/platform/navigation.ts  # Next navigation 适配层，未来可替换 React Router 适配
src/router/route-manifest.ts# 前端可渲染页面清单，不是菜单权限 source of truth
src/server/**               # Hono API、认证权限、服务、DB schema、seed
```

业务页面必须保持可迁移：

- `src/app/**/page.tsx` 只做薄路由壳。
- `src/features/**` 不直接依赖 `next/navigation`、`next/link`、Server Actions、`cookies()`、`headers()`。
- 跳转和 URL query 统一走 `src/platform/navigation.ts`。
- API 调用统一走 `src/lib/request.ts`。

## UI 约定

- 全局只能使用一个 `AppProvider`。
- 后台壳层统一走 `AdminShell`。
- 后台页面统一走 `PageScaffold`。
- CRUD 页面优先使用 `AdminDataTable`、`AdminSearchForm`、`AdminEntityForm`、`AdminFieldRenderer`。
- 页面不要单独创建 `ConfigProvider`、`Layout.Sider`、`Layout.Header`、`Menu`。
- 页面不要随意写一套 spacing/color/radius；需要新增全局视觉规则时先放到 `src/ui/theme` 或共享组件。

## 权限与菜单

菜单和权限以数据库 `sys_rule` 为 source of truth，不从 Next 文件路由生成。

权限类型：

```text
menu   # 目录
route  # 页面菜单
action # 按钮/API 权限
```

权限码命名：

```text
system.user.query
system.user.create
system.user.update
system.user.delete
system.role.setRule
```

新增后台页面流程：

1. 在 `src/features/**` 创建真实页面。
2. 在 `src/app/(admin)/**/page.tsx` 创建薄路由壳。
3. 在 `src/router/route-manifest.ts` 注册 path、key、title、auth。
4. 在 seed 或后台菜单权限页新增 `sys_rule` 的 `route` 和对应 `action`。
5. 执行 `pnpm admin:check-routes` 确认 manifest、菜单、默认权限一致。

前端按钮显隐使用：

```tsx
<AuthButton auth="system.user.create">
  <Button type="primary">新增</Button>
</AuthButton>
```

注意：按钮显隐只是体验优化，Hono API 必须继续使用 `ability(code)` 做服务端强校验。

## CRUD 页面写法

```tsx
export function UserPage() {
  return (
    <PageScaffold title="用户管理" description="管理后台用户、角色和部门归属">
      <AdminDataTable
        api="/api/system/user"
        accessName="system.user"
        rowKey="id"
        columns={columns}
      />
    </PageScaffold>
  );
}
```

搜索、分页、排序会默认写入 URL，例如：

```text
/system/user?keyword=admin&page=2&pageSize=20&status=1&sort=createdAt.desc
```

规则：

- 搜索后 URL 立即更新。
- 刷新后恢复搜索条件、分页和排序。
- 复制 URL 可分享同一列表视图。
- 浏览器前进/后退恢复历史搜索状态。
- 重置会清理当前表格相关 query 参数。

## 本地数据库

项目现在按 PG-first 开发，不再使用 SQLite 作为本地开发主库。默认连接串：

```text
postgres://admin_base:admin_base@localhost:5432/admin_base
```

测试数据库：

```text
postgres://admin_base:admin_base@localhost:5432/admin_base_test
```

如果需要覆盖连接，写入 `.env.local`：

```text
DATABASE_URL=postgres://admin_base:admin_base@localhost:5432/admin_base
ADMIN_BASE_SECRET_KEY=change-me-admin-base-secret
ADMIN_BASE_ADMIN_PASSWORD=123456
```

本地上传文件：

```text
storage/uploads
```

这些文件默认不进入 Git。
