# Admin Base

Node.js 技术栈的基础后台框架，参考 `xin-admin/xin-admin-laravel` 的产品结构和权限模型实现，但不复用 Xin 的封装组件。

## 起手式完成状态

当前起手式完成范围与验收记录见 [`docs/admin-base-starter-completion-plan.md`](docs/admin-base-starter-completion-plan.md)。

当前技术栈、模块边界和运行架构见 [`docs/admin-base-architecture.md`](docs/admin-base-architecture.md)。

生产级对齐路线和与 XinAdmin / ContiNew 的差距见 [`docs/admin-base-production-readiness-plan.md`](docs/admin-base-production-readiness-plan.md)。

源码启动、环境变量、数据库初始化和常见问题见 [`docs/admin-base-startup-guide.md`](docs/admin-base-startup-guide.md)。

快速开发框架的启动体验、最小配置项和后续缺口见 [`docs/admin-base-quick-start-framework-plan.md`](docs/admin-base-quick-start-framework-plan.md)。

启动脚手架的维护规则和待办池见 [`docs/admin-base-startup-scaffold-maintenance.md`](docs/admin-base-startup-scaffold-maintenance.md)。

已进入核心起手式：

- 用户、角色、菜单权限、部门、字典、配置、文件、存储、邮件。
- `is_system` 内置数据保护。
- 角色 `data_scope` 数据权限和部门范围过滤。
- 本地存储 + S3-compatible 存储配置，文件上传写入存储和 sha256 元数据。
- SMTP 邮件账号配置、默认账号、测试发送和密钥脱敏。

后置范围：

- 用户导入/导出、代码生成器、AI、SMS、定时任务、租户。

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

## 常用命令

```bash
pnpm dev                 # 启动 Next + Hono
pnpm db:migrate          # 执行 PostgreSQL 迁移
pnpm db:seed             # 写入默认管理员、角色、菜单、权限、字典、配置、存储、邮件
pnpm db:reset            # 危险：清空 PostgreSQL public schema 并重新 seed，仅开发重置使用
pnpm admin:check-routes  # 检查 route manifest 与数据库菜单/权限是否一致
pnpm lint                # ESLint
pnpm typecheck           # TypeScript
pnpm test                # API/Service 单测
pnpm e2e                 # Playwright E2E
pnpm build               # 生产构建
```

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
```

本地上传文件：

```text
storage/uploads
```

这些文件默认不进入 Git。
