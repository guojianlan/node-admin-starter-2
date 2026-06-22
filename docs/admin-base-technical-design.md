# Admin Base 技术方案与实施任务

> 目标：参考 `xin-admin/xin-admin-laravel` 的后台框架实现，建设一个 Node.js 技术栈的基础 Admin 框架。本文将用户提到的 `drizme` 按 `Drizzle ORM` 理解。

> 当前核对：2026-06-22。项目已经完成 Next.js + Hono + Ant Design + Drizzle + PostgreSQL 的基础闭环，本文保留长期技术设计和验收标准；当前真实技术栈和架构以 `docs/admin-base-architecture.md` 为准，生产级对齐路线以 `docs/admin-base-production-readiness-plan.md` 为准，当前起手式完成范围以 `docs/admin-base-starter-completion-plan.md` 为准，PG/CRUD 迁移细节见 `docs/admin-base-migration-optimization-plan.md`。

## 1. 参考项目结论

源码已拉取到：

```text
tmp/xin-admin-laravel
```

`xin-admin-laravel` 不是单纯 Laravel 后端，它是一个“后端 API + React/Vite 前端 + 已构建静态资源”的全栈后台模板。核心技术和能力如下：

| 维度     | 参考项目实现                                                 | 对新项目的启发                                                      |
| -------- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| 后端框架 | Laravel，模块位于 `modules/*`                                | Node 侧应保持模块化，按 `system/user`、`system/tool`、`common` 分层 |
| 前端框架 | React + Vite，页面在 `web/pages`                             | Next.js App Router 可以天然替代文件路由                             |
| UI       | Ant Design，通用 `XinTable`、`XinForm`                       | 只参考它的产品模式和交互结构，不复用 Xin 封装组件、源码或组件 API   |
| 状态     | Zustand 管理用户、字典、全局主题                             | 可继续使用 Zustand，减少心智迁移成本                                |
| 鉴权     | 登录后生成 Sanctum token，token abilities 保存权限码         | Node 侧用 bearer token + abilities 快照复刻                         |
| 权限模型 | `sys_rule` 存菜单、路由、按钮权限；`sys_role_rule` 绑定角色  | 保留 `menu/route/action` 三层权限模型                               |
| 菜单     | `/system/menu` 返回用户可见菜单树                            | 前端布局由后端菜单树驱动                                            |
| CRUD     | 控制器继承 `BaseController`，统一分页、筛选、排序、快速搜索  | Hono API 侧提供统一 query builder                                   |
| 响应     | `{ success, msg, data, showType }`                           | 保留响应契约，前端统一拦截和提示                                    |
| 系统模块 | 用户、角色、菜单权限、部门、字典、配置、文件、邮件、存储、AI | MVP 先做用户、角色、菜单权限、部门、字典、配置、文件                |

关键源码位置：

```text
routes/api.php
modules/Common/Http/Controllers/BaseController.php
modules/Common/Trait/RequestJson.php
modules/SystemUser/Http/Controllers/IndexController.php
modules/SystemUser/Http/Controllers/SysUserController.php
modules/SystemUser/Http/Controllers/SysRoleController.php
modules/SystemUser/Http/Controllers/SysRuleController.php
modules/SystemUser/Models/SysUserModel.php
database/migrations/2025_01_01_000001_create_sys_user_table.php
database/seeders/SysUserSeeder.php
web/router/index.tsx
web/layout/index.tsx
web/layout/LayoutContext.tsx
web/components/XinTable/index.tsx
web/components/XinForm/index.tsx
web/utils/request.ts
web/stores/user/index.ts
web/stores/dict/index.ts
```

新项目的组件要自己设计，不能直接迁移或包一层 Xin 的封装。可参考的只是这些思想：

- 列配置驱动搜索、表格、表单。
- 统一列表请求、分页、排序、筛选。
- 操作按钮和权限码绑定。
- 通用字段渲染器减少重复表单代码。
- 表格工具栏、搜索区、弹窗表单保持一致。

新项目组件命名建议：

```text
AdminDataTable      # 我们自己的数据表格，不兼容 XinTable API
AdminSearchForm     # 我们自己的搜索表单
AdminEntityForm     # 我们自己的新增/编辑表单
AdminFieldRenderer  # 我们自己的字段渲染器
AuthButton          # 我们自己的权限按钮
PageScaffold        # 我们自己的页面模板
```

参考项目中也有几个迁移时不要照抄的问题：

- `README.md` 写 PHP `>=8.2`、Laravel `>=12`，但 `composer.json` 是 PHP `^8.3`、Laravel `^13.0`。
- 前端 `web/api/system/sys_user.ts` 的 `resetPassword` 调用 `/system/resetPassword`，后端真实路由是 `/system/user/resetPassword`。
- `SystemToolServiceProvider` 检查了 `sys_setting_items`，迁移文件实际创建的是 `sys_config_items`。
- 部分字段命名不完全一致，例如 `sys_rule` migration 用 `hidden`，模型 casts 里还有 `show`。

这些问题说明：新框架应保留它的产品结构和权限模型，但不要机械复制实现细节。

## 2. 推荐目标架构

采用单仓库、单 Next.js 应用承载前端和 Hono API：

```text
admin-base/
  src/
    app/
      (auth)/
        login/page.tsx
      (admin)/
        layout.tsx
        dashboard/page.tsx
        system/
          user/page.tsx
          role/page.tsx
          rule/page.tsx
          dept/page.tsx
          dict/page.tsx
          config/page.tsx
          file/page.tsx
      api/
        [[...route]]/route.ts
    components/
      admin-layout/
      admin-data-table/
      admin-search-form/
      admin-entity-form/
      admin-fields/
      auth-button/
    ui/
      app-provider.tsx
      theme/
        tokens.ts
        antd-theme.ts
      shell/
        AdminShell.tsx
        AdminHeader.tsx
        AdminMenu.tsx
        BreadcrumbBar.tsx
      page/
        PageScaffold.tsx
        PageHeader.tsx
        PageActions.tsx
      states/
        EmptyState.tsx
        ForbiddenPage.tsx
        NotFoundPage.tsx
    features/
      auth/
        login/
          LoginPage.tsx
      dashboard/
        DashboardPage.tsx
      system/
        user/
          UserPage.tsx
        role/
          RolePage.tsx
        rule/
          RulePage.tsx
        dept/
          DeptPage.tsx
        dict/
          DictPage.tsx
        config/
          ConfigPage.tsx
        file/
          FilePage.tsx
    router/
      route-manifest.ts
      menu-utils.ts
      next-adapter.tsx
      react-router-adapter.tsx
    platform/
      navigation.ts
      storage.ts
      runtime.ts
    lib/
      request.ts
      response.ts
      tree.ts
      auth-client.ts
    stores/
      auth.ts
      dict.ts
      global.ts
    server/
      app.ts
      context.ts
      crud/
        create-crud-routes.ts
        list-query.ts
        permissions.ts
        registry.ts
        types.ts
      db/
        index.ts
        schema/
        seed/
      middleware/
        auth.ts
        ability.ts
        error.ts
      routes/
        auth.ts
        system/
          user.ts
          role.ts
          rule.ts
          dept.ts
          dict.ts
          config.ts
          file.ts
      services/
        auth-service.ts
        permission-service.ts
        file-service.ts
        config-service.ts
      validators/
```

### 为什么 Hono 放在 Next.js 里

推荐先用 Next.js App Router + `src/app/api/[[...route]]/route.ts` 挂载 Hono：

```ts
import { handle } from "hono/vercel";
import { app } from "@/server/app";

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const PATCH = handle(app);
```

这样做的好处：

- 前端和 API 同源，登录 token、上传、部署都更简单。
- Hono 仍然提供清晰的 route/middleware/service 分层。
- 后续如果需要拆成独立 API 服务，可以把 `src/server` 平移到 `apps/api`，前端改 `NEXT_PUBLIC_API_BASE_URL` 即可。

### Next.js 到纯 React CSR 的迁移边界

当前可以用 Next.js 开发，但业务页面不要写死在 `src/app/**/page.tsx` 里。推荐原则是：

```text
src/app/**/page.tsx 只是 Next.js 路由壳
src/features/**/XxxPage.tsx 才是真实页面
```

例如：

```tsx
// src/app/(admin)/system/user/page.tsx
import { UserPage } from "@/features/system/user/UserPage";

export default function Page() {
  return <UserPage />;
}
```

真实页面 `UserPage` 需要遵守这些限制：

- 不直接依赖 `next/navigation`、`next/link`、`next/image`。
- 不依赖 Server Component、Server Action、Next.js route handler。
- 不在页面组件里读取 `cookies()`、`headers()` 这类 Next server API。
- API 调用统一走 `src/lib/request.ts`，通过环境变量控制 base URL。
- 跳转、当前位置、query string 统一走 `src/platform/navigation.ts` 暴露的适配 hook。
- 页面路由信息集中维护在 `src/router/route-manifest.ts`，Next 和 React Router 分别读取同一份 manifest。

这样后续切到纯 React CSR 时，只需要：

1. 新增 Vite 或其他 React 宿主。
2. 用 `src/router/react-router-adapter.tsx` 根据同一份 route manifest 创建 React Router。
3. 继续复用 `src/features`、`src/components`、`src/stores`、`src/lib`。
4. Hono API 如果仍同仓部署，改 base URL；如果拆独立服务，前端代码不用改业务逻辑。

路由 manifest 示例：

```ts
import type { ComponentType } from "react";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { UserPage } from "@/features/system/user/UserPage";
import { RolePage } from "@/features/system/role/RolePage";

export type AdminRouteRecord = {
  path: string;
  key: string;
  component: ComponentType;
  title: string;
  auth?: string;
};

export const adminRoutes: AdminRouteRecord[] = [
  {
    path: "/dashboard",
    key: "dashboard",
    title: "仪表盘",
    component: DashboardPage,
  },
  {
    path: "/system/user",
    key: "system.user",
    title: "用户管理",
    auth: "system.user.query",
    component: UserPage,
  },
  {
    path: "/system/role",
    key: "system.role",
    title: "角色管理",
    auth: "system.role.query",
    component: RolePage,
  },
];
```

注意：`route-manifest.ts` 只描述“前端有哪些页面可以渲染”，不是菜单和权限的 source of truth。菜单、角色、按钮权限仍以数据库 `sys_rule` 为准，前端 manifest 只用于宿主路由注册和本地匹配。

### UI 一致性优先级

当前项目的首要目标是做一个“基础 admin 框架”，所以 UI 一致性优先级高于路由宿主迁移。Next.js 到纯 React CSR 的迁移边界必须服务于 UI 复用，而不是让页面各自实现一套布局。

强约束：

- 只能有一套 `AppProvider`，统一 Ant Design `ConfigProvider`、`App`、message/modal/notification、主题 token 和全局样式。
- 只能有一套 `AdminShell`，统一 Header、Sider、Menu、Breadcrumb、Content padding、折叠状态、移动端抽屉。
- 所有后台页面必须使用 `PageScaffold`，统一页面标题、描述、右上角操作区、内容间距。
- 所有 CRUD 列表优先使用 `AdminDataTable`，不要每个页面手写一套 Table toolbar、搜索区、分页、弹窗。
- 所有搜索表单必须通过 `AdminSearchForm`，搜索条件默认同步到 URL。
- 所有新增/编辑表单优先使用 `AdminEntityForm` 和 `AdminFieldRenderer`，字段类型、校验展示、弹窗宽度、提交按钮位置保持一致。
- 页面组件 `src/features/**/XxxPage.tsx` 只编排业务，不直接写后台壳层布局。
- 页面内不直接修改 Ant Design theme，不直接引入第二套组件库，不写页面级随意 spacing token。
- 迁移到 React Router 时，替换的是 `router/platform` 适配层，不替换 `ui/components/features`。

推荐的 UI 单向依赖：

```text
app 或 react-router 宿主
  -> ui/app-provider
  -> ui/shell/AdminShell
  -> ui/page/PageScaffold
  -> features 页面
  -> components/admin-data-table + admin-search-form + admin-entity-form + admin-fields
```

不要让 `features` 反向依赖 Next `app` 或单独创建 Layout/Menu/ConfigProvider。

`PageScaffold` 示例：

```tsx
type PageScaffoldProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
};

export function PageScaffold(props: PageScaffoldProps) {
  return (
    <div className="admin-page">
      <PageHeader title={props.title} description={props.description} actions={props.actions} />
      <div className="admin-page-content">{props.children}</div>
    </div>
  );
}
```

页面示例：

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

这类页面在 Next 和纯 React CSR 下都不需要改，UI 也不会漂移。

## 3. 技术选型

| 类别    | 选型                              | 说明                                    |
| ------- | --------------------------------- | --------------------------------------- |
| Runtime | Node.js 22 LTS 或当前项目约定版本 | 保持现代 Web API 能力                   |
| 框架    | Next.js App Router                | 页面、布局、路由、构建统一              |
| API     | Hono                              | 路由和中间件轻量，适合 Node/Edge 双部署 |
| ORM     | Drizzle ORM                       | 类型安全 schema、迁移、查询构造         |
| DB      | PostgreSQL                        | 本地开发和上线环境统一 PG-first         |
| UI      | Ant Design                        | 后台管理系统主 UI                       |
| 状态    | Zustand                           | 用户、权限、字典、主题等客户端状态      |
| 校验    | Zod                               | Hono 入参校验、表单 schema 共用         |
| 密码    | argon2id 或 bcrypt                | 推荐 argon2id，bcrypt 作为兼容选项      |
| 上传    | 本地存储 + S3-compatible 配置     | 起手式内置多存储配置和默认存储选择      |
| 测试    | Vitest + Playwright               | API 单测、权限单测、关键页面 e2e        |

## 4. 核心领域模型

保留参考项目的 `sys_*` 风格，便于对照和迁移。

### 4.1 用户与组织

| 表                 | 说明           |
| ------------------ | -------------- |
| `sys_user`         | 后台管理员用户 |
| `sys_role`         | 角色           |
| `sys_user_role`    | 用户角色关联   |
| `sys_dept`         | 部门树         |
| `sys_login_record` | 登录日志       |

`sys_user` 关键字段：

```text
id, username, password_hash, nickname, avatar_id, sex, bio,
mobile, email, dept_id, login_ip, login_time, status,
created_at, updated_at, deleted_at
```

### 4.2 权限与菜单

参考项目用 `sys_rule` 同时表达菜单、路由、接口按钮权限。新项目建议仍使用一张表，但类型命名更清晰：

```text
type: "menu" | "route" | "action"
```

如需兼容 XinAdmin 数据，可将原始 `rule` 映射为新项目的 `action`。

`sys_rule` 关键字段：

```text
id, parent_id, type, key, name, path, icon, order,
i18n_key, status, hidden, link, created_at, updated_at
```

权限码示例：

```text
system.user.query
system.user.create
system.user.update
system.user.delete
system.role.setRule
system.rule.status
```

菜单树只返回 `type in ("menu", "route")` 且启用的记录；按钮和接口权限使用 `action` 类型。

### 4.3 Token 与会话

参考项目使用 Sanctum token abilities。Node 侧建议自建 `sys_access_token`：

```text
id, user_id, name, token_hash, abilities_json,
last_used_at, expires_at, created_at, updated_at
```

登录成功后：

1. 校验用户名、密码、用户状态。
2. 查询用户角色和权限。
3. 超级管理员 `id=1` 拥有所有启用权限。
4. 生成随机 token，只保存 hash。
5. 将 abilities 快照写入 token，返回明文 bearer token。
6. 记录登录日志。

请求进入 Hono 后：

1. `authMiddleware` 读取 `Authorization: Bearer <token>`。
2. hash 后查 `sys_access_token`。
3. 校验过期时间和用户状态。
4. 将 `user`、`abilities` 写入 Hono context。
5. `ability("system.user.query")` 中间件做接口权限校验。

### 4.4 字典、配置、文件

| 表                 | 说明       |
| ------------------ | ---------- |
| `sys_dict`         | 字典类型   |
| `sys_dict_item`    | 字典项     |
| `sys_config_group` | 配置分组   |
| `sys_config_items` | 配置项     |
| `sys_file_group`   | 文件分组   |
| `sys_file`         | 文件元数据 |

配置建议保留动态表单能力：

```text
key, title, describe, values, type, options_json, props_json, group_id, sort
```

配置读取做服务层缓存，先用进程内 LRU 或简单内存缓存；如果部署多实例，再换 Redis。

文件起手式目标：

- 默认本地存储上传到 `storage/uploads/YYYYMMDD/<random>.<ext>`。
- 增加存储配置，至少支持 `local` 和 S3-compatible。
- `sys_file` 保存原始文件名、路径、大小、扩展名、类型、上传者、分组、存储 ID、hash 和元数据。
- 提供上传、列表、软删除、恢复、永久删除、下载。
- 多存储对象迁移、对象复制、缩略图队列可后置，不阻塞起手式完成。

## 5. API 契约

统一响应：

```ts
export type ApiResponse<T = unknown> = {
  success: boolean;
  msg: string;
  data?: T;
  showType?: 0 | 1 | 2 | 3 | 4 | 5 | 99;
  errorCode?: string | number;
  description?: string;
  placement?: "top" | "topLeft" | "topRight" | "bottom" | "bottomLeft" | "bottomRight";
};
```

分页响应：

```ts
export type PageResult<T> = {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
};
```

常用 API：

```text
POST   /api/system/login
POST   /api/system/logout
GET    /api/system/info
GET    /api/system/menu
PUT    /api/system/updateInfo
PUT    /api/system/updatePassword
GET    /api/system/loginRecord

GET    /api/system/user
POST   /api/system/user
PUT    /api/system/user/:id
DELETE /api/system/user/:id
PUT    /api/system/user/resetPassword
GET    /api/system/user/role
GET    /api/system/user/dept

GET    /api/system/role
POST   /api/system/role
PUT    /api/system/role/:id
DELETE /api/system/role/:id
GET    /api/system/role/ruleList
POST   /api/system/role/setRule
PUT    /api/system/role/status/:id

GET    /api/system/rule
POST   /api/system/rule
PUT    /api/system/rule/:id
DELETE /api/system/rule/:id
GET    /api/system/rule/parent
PUT    /api/system/rule/hidden/:id
PUT    /api/system/rule/status/:id

GET    /api/system/dept
POST   /api/system/dept
PUT    /api/system/dept/:id
DELETE /api/system/dept/:id
POST   /api/system/dept/batch-delete

GET    /api/system/dict/list
POST   /api/system/dict/list
PUT    /api/system/dict/list/:id
DELETE /api/system/dict/list/:id
POST   /api/system/dict/list/batch-delete
GET    /api/system/dict/list/all
GET    /api/system/dict/item
POST   /api/system/dict/item
PUT    /api/system/dict/item/:id
DELETE /api/system/dict/item/:id
POST   /api/system/dict/item/batch-delete

GET    /api/system/config/group
POST   /api/system/config/group
PUT    /api/system/config/group/:id
DELETE /api/system/config/group/:id
POST   /api/system/config/group/batch-delete
GET    /api/system/config/items
POST   /api/system/config/items
PUT    /api/system/config/items/:id
DELETE /api/system/config/items/:id
POST   /api/system/config/items/batch-delete
PUT    /api/system/config/items/save
POST   /api/system/config/items/refreshCache

GET    /api/system/file/list
POST   /api/system/file/list/upload
GET    /api/system/file/list/trashed
DELETE /api/system/file/list/:id
POST   /api/system/file/list/restore/:id
DELETE /api/system/file/list/force-delete/:id
GET    /api/system/file/list/download/:id
```

## 6. 后端详细实现

### 6.1 Hono 入口

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { errorMiddleware } from "./middleware/error";
import { authRoutes } from "./routes/auth";
import { systemRoutes } from "./routes/system";

export const app = new Hono();

app.use("*", cors());
app.onError(errorMiddleware);

app.route("/api/system", authRoutes);
app.route("/api/system", systemRoutes);
```

### 6.2 Context 类型

```ts
type AdminUserContext = {
  id: number;
  username: string;
  nickname: string;
  status: number;
};

type HonoVariables = {
  user: AdminUserContext;
  abilities: string[];
};
```

### 6.3 认证中间件

实现点：

- 不存明文 token。
- `token_hash = sha256(token)`。
- 每次请求更新 `last_used_at` 可以异步做，避免影响请求主路径。
- `expires_at` 为空表示记住我。

伪代码：

```ts
export function authRequired() {
  return async (c, next) => {
    const token = parseBearer(c.req.header("authorization"));
    if (!token) return c.json(fail("Token not provided"), 401);

    const row = await findAccessTokenByHash(hashToken(token));
    if (!row || isExpired(row.expiresAt)) return c.json(fail("Invalid token"), 401);

    const user = await findActiveUser(row.userId);
    if (!user) return c.json(fail("User disabled"), 401);

    c.set("user", user);
    c.set("abilities", row.abilities);
    await next();
  };
}
```

### 6.4 权限中间件

```ts
export function ability(code: string) {
  return async (c, next) => {
    const user = c.get("user");
    if (user.id === 1) return next();

    const abilities = c.get("abilities") ?? [];
    if (!abilities.includes(code)) {
      return c.json(
        {
          success: false,
          msg: "No Permission",
          showType: 4,
          description: "没有当前操作权限",
        },
        403,
      );
    }
    await next();
  };
}
```

### 6.5 查询构造器

参考 Laravel `BaseController::buildSearch`，Node 侧实现 `buildListQuery`：

输入：

```ts
type ListQueryConfig = {
  searchable?: Record<string, "=" | "like" | "date" | "betweenDate">;
  quickSearchFields?: string[];
  sortableFields?: string[];
};
```

能力：

- `page`、`pageSize` 分页。
- `keywordSearch` 在白名单字段内 `like`。
- `filter` 只允许白名单字段 `in`。
- `sorter` 只允许白名单字段排序。
- 所有字段名从 schema 映射，不允许直接信任前端字段字符串。

### 6.6 Route、Service 与 CRUD factory 边界

本项目不强制每个模块都拆成 `route -> service -> repository/dao`。当前目标是降低重复 CRUD，同时保持调用链短、类型清晰。

推荐边界：

```text
普通 CRUD
  -> createCrudRoutes(...)
  -> Drizzle query builder

复杂业务
  -> route-local endpoint
  -> small service/helper when it crosses tables, auth, files, or cache
  -> Drizzle query builder
```

route 负责：

- API 路径和权限边界。
- 读取参数和 Zod 校验。
- 调用 CRUD factory 或少量业务 helper。
- 返回统一响应。

service/helper 只在这些场景使用：

- 登录、token、权限聚合。
- 用户角色、角色权限这类跨表事务。
- 文件上传、下载、物理文件删除。
- 配置或字典缓存刷新。

不建议为了“分层完整”给每个简单 CRUD 都新增 service、repository、dao。后续常规模块应优先落到轻量 CRUD factory，复杂动作保留显式 route。

### 6.7 Drizzle schema 切分

建议按领域拆文件：

```text
src/server/db/schema/user.ts
src/server/db/schema/permission.ts
src/server/db/schema/dict.ts
src/server/db/schema/config.ts
src/server/db/schema/file.ts
src/server/db/schema/index.ts
```

示例：

```ts
export const sysRule = pgTable("sys_rule", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id").notNull().default(0),
  type: varchar("type", { length: 20 }).notNull(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  path: varchar("path", { length: 100 }),
  icon: varchar("icon", { length: 100 }),
  order: integer("order").notNull().default(0),
  i18nKey: varchar("i18n_key", { length: 100 }),
  status: integer("status").notNull().default(1),
  hidden: integer("hidden").notNull().default(1),
  link: integer("link").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

## 7. 前端详细实现

### 7.1 页面与布局

Next.js App Router 布局建议：

```text
src/app/(admin)/layout.tsx
```

这个 layout 负责承载后台框架，但不承载具体业务页面逻辑。业务页面放在 `src/features/**`，Next 的 `page.tsx` 只 import 并渲染对应页面组件。

职责：

- 校验本地 token。
- 初始化用户信息 `/api/system/info`。
- 初始化字典 `/api/system/dict/list/all`。
- 拉取菜单 `/api/system/menu`。
- 渲染 Ant Design `Layout`、`Menu`、`Breadcrumb`、Header 用户信息、主题设置。
- 根据当前 pathname 和后端菜单树恢复选中菜单、展开菜单和面包屑。
- 对不存在于前端 route manifest 的路径渲染 404。
- 对存在页面但当前用户无菜单/无查询权限的路径渲染 403。

登录页：

```text
src/app/(auth)/login/page.tsx
```

职责：

- 登录表单。
- 成功后存 token。
- 调用 `/api/system/info` 初始化用户和权限。
- 跳转默认首页 `/dashboard` 或后端配置首页。

同样建议：

```tsx
// src/app/(auth)/login/page.tsx
import { LoginPage } from "@/features/auth/login/LoginPage";

export default function Page() {
  return <LoginPage />;
}
```

这样迁移到纯 React CSR 时，`LoginPage` 不用改。

### 7.2 前端 request 封装

保留参考项目的拦截思路，但用 `fetch` 或轻量封装即可：

- 自动加 `Authorization`。
- 自动加语言头。
- 401 清理 token 并跳登录。
- 403 显示无权限。
- 业务失败根据 `showType` 调用 Ant Design message/notification。
- 列表、创建、更新、删除提供通用方法。

建议文件：

```text
src/lib/request.ts
src/lib/api/system/user.ts
src/lib/api/system/role.ts
```

### 7.3 AdminDataTable

参考 `XinTable` 的信息架构，但重新设计和实现自己的 `AdminDataTable`。它不兼容 `XinTable` API，也不复制它的源码。

```ts
type AdminDataTableColumn<T> = AntdTableColumn<T> & {
  valueType?: FieldValueType;
  hideInSearch?: boolean;
  hideInForm?: boolean;
  hideInTable?: boolean;
  hideInCreate?: boolean;
  hideInUpdate?: boolean;
  fieldProps?: Record<string, unknown>;
};
```

能力：

- 自动列表请求。
- 分页、排序、筛选。
- 快速搜索。
- 根据列配置生成 `AdminSearchForm`。
- 根据列配置生成 `AdminEntityForm`。
- 搜索条件、筛选条件、排序、分页默认同步到 URL。
- 首次进入页面从 URL 恢复列表状态，刷新页面不丢搜索条件和分页条件。
- 浏览器前进/后退能恢复对应列表状态。
- 默认创建、编辑、删除按钮。
- `accessName` 自动拼接 `.create/.update/.delete`。
- 支持 `operateRender`、`actionBarRender`、`handleRequest`、`handleFinish` 覆盖。

这会显著降低后续模块开发成本。用户、角色、字典、配置都可以靠它快速搭起来。

### 7.4 AdminSearchForm 与 URL 状态

搜索条件必须显示在 URL 上，这是列表页 UX 的基础能力，而不是可选优化。

目标效果：

```text
/system/user?keyword=zhang&page=2&pageSize=20&status=1&deptId=3&sort=createdAt.desc
/system/login-record?username=admin&loginTime.from=2026-06-01&loginTime.to=2026-06-11&page=1&pageSize=50
```

用户体验要求：

- 搜索后 URL 立即更新。
- 刷新页面后保留搜索条件、筛选条件、排序和分页。
- 复制 URL 给别人，打开后看到同样的列表视图。
- 浏览器前进/后退恢复历史搜索状态。
- 修改搜索条件时默认回到 `page=1`。
- 只修改分页时保留当前搜索条件。
- 点击“重置”时清理当前表格相关 query 参数。

URL 参数规范：

| 状态     | URL 参数                  | 示例                                                |
| -------- | ------------------------- | --------------------------------------------------- |
| 当前页   | `page`                    | `page=2`                                            |
| 每页条数 | `pageSize`                | `pageSize=20`                                       |
| 快速搜索 | `keyword`                 | `keyword=admin`                                     |
| 排序     | `sort`                    | `sort=createdAt.desc`                               |
| 普通字段 | 字段名                    | `status=1`                                          |
| 多选字段 | 重复字段名                | `roleId=1&roleId=2`                                 |
| 日期范围 | `field.from` / `field.to` | `createdAt.from=2026-06-01&createdAt.to=2026-06-11` |
| 树选择   | 字段名                    | `deptId=3`                                          |

不要把搜索状态压成一个 JSON 字符串放到 URL。JSON 虽然实现简单，但不利于可读、分享、调试和手动修改。

组件职责：

```text
AdminDataTable
  -> useTableUrlState
  -> AdminSearchForm
  -> Ant Design Table
```

`useTableUrlState` 是跨 Next/React Router 的核心 hook：

```ts
type TableUrlState = {
  page: number;
  pageSize: number;
  keyword?: string;
  sort?: { field: string; order: "asc" | "desc" };
  filters: Record<string, string | string[] | undefined>;
};

type TableUrlStateActions = {
  setSearch: (values: Record<string, unknown>) => void;
  setPage: (page: number, pageSize?: number) => void;
  setSort: (field?: string, order?: "asc" | "desc") => void;
  reset: () => void;
};
```

这个 hook 不直接依赖 `next/navigation`。它通过 `src/platform/navigation.ts` 获取当前 pathname、query 和 replace/push 方法。Next 下用 Next adapter；未来纯 React CSR 下换 React Router adapter。

Next adapter 示例：

```ts
export function useNavigationAdapter() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  return {
    pathname,
    search: searchParams.toString(),
    replace: (url: string) => router.replace(url, { scroll: false }),
    push: (url: string) => router.push(url, { scroll: false }),
  };
}
```

`AdminDataTable` 请求参数从 URL 状态生成：

```ts
const { state, actions } = useTableUrlState({
  defaultPageSize: 20,
  allowedFields: columns.map((item) => item.dataIndex),
});

const requestParams = {
  page: state.page,
  pageSize: state.pageSize,
  keyword: state.keyword,
  sort: state.sort,
  ...state.filters,
};
```

防止状态失控的规则：

- URL 只保存列表视图状态，不保存弹窗打开状态、表单临时输入、勾选行。
- `allowedFields` 必须来自列配置或显式白名单，避免任意 query 透传到 API。
- 空值不写入 URL。
- 默认值不写入 URL，例如 `page=1` 可省略，除非产品要求显式展示。
- query 更新用 `replace`，避免每输入一个字都污染浏览器历史；点击搜索按钮或分页可以按需要使用 `push`。
- 输入框即时输入不直接写 URL，点击搜索或回车后再写 URL。

后端也要兼容这套参数：

```text
GET /api/system/user?page=2&pageSize=20&keyword=zhang&status=1&deptId=3&sort=createdAt.desc
```

Hono 的 `buildListQuery` 需要识别：

- `page`、`pageSize`
- `keyword`
- `sort=field.asc|field.desc`
- 重复 query 参数表示数组筛选
- `.from/.to` 表示范围条件

### 7.5 AdminEntityForm 与字段渲染

字段类型优先覆盖：

```text
text, password, textarea, digit, money,
select, treeSelect, cascader,
radio, radioButton, checkbox, switch,
date, dateTime, dateRange, time, timeRange,
color, image, icon, user
```

MVP 先实现：

```text
text, password, textarea, digit, select, treeSelect,
radio, radioButton, switch, dateRange, image
```

`icon`、`user` 可以第二阶段补。

### 7.6 AuthButton

前端按钮显隐：

```tsx
<AuthButton auth="system.user.create">
  <Button type="primary">新增</Button>
</AuthButton>
```

实现：

- 未传 `auth` 默认显示。
- 当前用户 `access` 包含权限码则显示。
- 超级管理员由后端直接返回全量权限，前端不用写特殊判断。

注意：前端显隐只是体验优化，真正权限必须在 Hono API 中间件校验。

### 7.7 Next.js 中的权限与菜单控制

Next.js 下权限分三层控制：

| 层级       | 控制点                                                | 作用                               |
| ---------- | ----------------------------------------------------- | ---------------------------------- |
| 路由存在性 | `src/router/route-manifest.ts`                        | 判断这个前端页面是否存在           |
| 菜单可见性 | `/api/system/menu` 返回的 `sys_rule` 菜单树           | 决定侧边栏、面包屑、用户可导航页面 |
| 操作权限   | `/api/system/info` 返回的 `access` + Hono `ability()` | 前端按钮显隐和后端接口强校验       |

#### 7.7.1 菜单不是 Next 文件路由生成的

不要用 Next 的 `app/` 文件目录反推菜单。后台系统里菜单必须是数据库数据，因为菜单要能由角色授权控制。

正确关系：

```text
Next app routes / route-manifest: 当前前端有哪些页面
sys_rule menu/route/action: 当前系统给用户开放哪些菜单和操作
```

`/api/system/menu` 返回示例：

```ts
type MenuNode = {
  id: number;
  parentId: number;
  type: "menu" | "route";
  key: string;
  name: string;
  path?: string;
  icon?: string;
  hidden: number;
  link: number;
  children?: MenuNode[];
};
```

前端拿到菜单后做三件事：

1. 渲染侧边栏，只展示 `hidden === 1`、`status === 1` 的 `menu/route`。
2. 用 `path -> MenuNode` 建索引，匹配当前 pathname 的菜单项。
3. 用菜单祖先链生成 selectedKeys、openKeys、breadcrumb。

#### 7.7.2 Next layout 中的页面访问控制

在 `src/app/(admin)/layout.tsx` 中做客户端权限守卫即可。原因是当前目标偏后台系统，页面会大量依赖 token、Zustand、Ant Design 交互，后续还要迁移纯 React CSR；所以不要把权限逻辑绑定到 Next Server Component。

推荐 `AdminGuard`：

```tsx
"use client";

import { usePathname, useRouter } from "next/navigation";
import { Spin } from "antd";
import { useEffect, useMemo } from "react";
import { adminRoutes } from "@/router/route-manifest";
import { findMenuByPath } from "@/router/menu-utils";
import { useAuthStore } from "@/stores/auth";
import { useMenuStore } from "@/stores/menu";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { token, access, initialized, initSession } = useAuthStore();
  const { menus, initMenus } = useMenuStore();

  useEffect(() => {
    if (!token) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
      return;
    }
    void initSession();
    void initMenus();
  }, [token, pathname, router, initSession, initMenus]);

  const route = useMemo(() => adminRoutes.find((item) => item.path === pathname), [pathname]);

  const menu = useMemo(() => findMenuByPath(menus, pathname), [menus, pathname]);

  if (!token || !initialized) return <Spin fullscreen />;

  if (!route) {
    return <NotFoundPage />;
  }

  if (route.auth && !access.includes(route.auth)) {
    return <ForbiddenPage />;
  }

  if (!menu && pathname !== "/dashboard") {
    return <ForbiddenPage />;
  }

  return children;
}
```

这里的 `AdminGuard` 是 Next 适配层。迁移到 React Router 时保留同样的判断逻辑，只把 `usePathname/useRouter` 换成 React Router 的 `useLocation/useNavigate`。

#### 7.7.3 API 权限必须由 Hono 兜底

前端菜单和按钮不能作为安全边界。每个敏感 API 都要写：

```ts
systemUserRoutes.get("/user", authRequired(), ability("system.user.query"), async (c) => {
  return c.json(success(await userService.list(c.req.query())));
});

systemUserRoutes.post("/user", authRequired(), ability("system.user.create"), async (c) => {
  return c.json(success(await userService.create(await c.req.json())));
});
```

权限码来源于 `sys_rule.type = "action"` 或兼容 XinAdmin 的 `type = "rule"`。用户登录时把当前权限快照写进 token abilities；如果希望角色改动实时生效，可以在每次请求从数据库重算，或者在角色权限变更后使相关 token 失效。MVP 建议使用 token abilities 快照，角色权限变更后提示用户重新登录；第二阶段再做 token version 或权限缓存失效。

#### 7.7.4 菜单与路由不一致时的处理

需要定义清楚不一致场景：

| 场景                            | 处理                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| manifest 有页面，数据库没有菜单 | 页面可存在，但默认不可通过菜单访问；直接访问返回 403，除非 route 标记为 public/adminHidden |
| 数据库有菜单，manifest 没页面   | 菜单渲染时过滤或点击后跳 404，同时在开发环境 warning                                       |
| 用户有菜单但无 action 查询权限  | 不推荐出现；seed 和角色授权要保证 route 对应 query 权限                                    |
| 用户有 action 但无菜单          | API 可被授权访问，但页面不显示；适合纯接口权限                                             |

推荐启动时提供一个开发期检查脚本：

```text
pnpm admin:check-routes
```

检查：

- `sys_rule.type = route` 的 `path` 是否都存在于 route manifest。
- route manifest 中需要菜单的页面是否存在对应 `sys_rule.key`。
- route 对应的默认查询权限是否存在，例如 `system.user -> system.user.query`。

### 7.8 UI 一致性落地标准

UI 一致性要通过组件边界保证，不靠开发者临场判断。MVP 阶段先固定以下标准。

#### 7.8.1 主题与 Provider

全局只能有一个 `src/ui/app-provider.tsx`：

```tsx
export function AppProvider({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider theme={antdTheme}>
      <AntApp>
        <AntdFeedbackBridge />
        {children}
      </AntApp>
    </ConfigProvider>
  );
}
```

`antdTheme` 只能从 `src/ui/theme/antd-theme.ts` 导出，基础 token 从 `src/ui/theme/tokens.ts` 导出。

禁止：

- 页面单独创建 `ConfigProvider`。
- 页面内直接覆盖全局 `colorPrimary`、`borderRadius`、`fontSize`。
- 页面使用随机 class 处理大范围间距。

#### 7.8.2 后台壳层

后台只允许使用 `AdminShell`：

```tsx
<AppProvider>
  <AdminGuard>
    <AdminShell>{children}</AdminShell>
  </AdminGuard>
</AppProvider>
```

`AdminShell` 统一负责：

- Header 高度、背景、用户区。
- Sider 宽度、折叠宽度、菜单样式。
- Breadcrumb 样式和位置。
- Content 背景和 padding。
- 移动端菜单抽屉。
- 全局 loading、403、404 的呈现方式。

页面不得直接使用 Ant Design `Layout.Sider`、`Layout.Header` 重新搭后台壳层。

#### 7.8.3 页面模板

所有后台页面必须使用 `PageScaffold`：

```tsx
<PageScaffold
  title="角色管理"
  description="管理角色资料和菜单权限"
  actions={<Button type="primary">新增角色</Button>}
>
  <AdminDataTable ... />
</PageScaffold>
```

统一规则：

| 元素     | 规则                                                      |
| -------- | --------------------------------------------------------- |
| 页面标题 | `PageScaffold.title`，不要在页面里手写 `Typography.Title` |
| 页面描述 | `PageScaffold.description`，可选但位置固定                |
| 主操作   | 放 `PageScaffold.actions` 或 `AdminDataTable` action bar  |
| 内容容器 | 由 `PageScaffold` 决定 padding 和 spacing                 |
| 卡片     | 只用于表格、表单、详情等真实内容容器，不做套娃卡片        |
| 空状态   | 使用统一 `EmptyState`                                     |
| 错误状态 | 使用统一 `ForbiddenPage`、`NotFoundPage`                  |

#### 7.8.4 CRUD 页面

用户、角色、部门、菜单、字典、配置等 CRUD 页优先使用同一结构：

```tsx
export function RolePage() {
  return (
    <PageScaffold title="角色管理" description="配置角色和权限范围">
      <AdminDataTable
        api="/api/system/role"
        accessName="system.role"
        rowKey="id"
        columns={columns}
      />
    </PageScaffold>
  );
}
```

CRUD 页默认交互：

- 顶部左侧：新增、批量操作、搜索展开。
- 顶部右侧：刷新、密度、列设置。
- 表格操作列：图标按钮 + Tooltip。
- 删除操作：统一确认弹窗。
- 新增/编辑：默认 ModalForm，复杂表单可用 DrawerForm，但按钮、loading、关闭逻辑一致。
- 权限按钮：统一 `AuthButton`。
- 搜索表单：统一折叠/展开，不要页面自定义搜索布局。

只有业务强相关且 `AdminDataTable` 无法表达时，才允许自定义页面结构；自定义结构也必须复用 `PageScaffold`、`AdminEntityForm`、`AuthButton` 和主题 token。

#### 7.8.5 表单与字段

字段渲染必须统一经过 `AdminFieldRenderer`：

```text
valueType -> Ant Design 组件
text      -> Input
password  -> Input.Password
digit     -> InputNumber
select    -> Select
treeSelect -> TreeSelect
radioButton -> Radio.Group optionType=button
switch    -> Switch
dateRange -> DatePicker.RangePicker
image     -> ImageUploader
```

表单约定：

- 普通弹窗表单宽度默认 `720` 或 `800`，不要页面随意指定。
- CRUD 表单默认 `layout="vertical"`。
- 表单 grid 默认两列，窄屏自动一列。
- 必填、校验错误、帮助文案样式由 Ant Design 和 `AdminEntityForm` 统一处理。
- 图片上传、图标选择、用户选择等复杂字段做成统一字段组件，不在页面内临时拼。

#### 7.8.6 UI 一致性验收

每个新增后台页面验收时至少检查：

- 是否使用 `PageScaffold`。
- 是否复用 `AdminDataTable` 或明确说明不能复用的原因。
- 是否没有单独创建 `ConfigProvider`、`Layout`、`Menu`。
- 是否没有页面级硬编码大范围 spacing、颜色、圆角。
- 页面标题、描述、操作区是否和其他系统页位置一致。
- 表格 toolbar、搜索、分页、操作列是否和其他 CRUD 页一致。
- 新增/编辑弹窗宽度、按钮位置、loading 状态是否一致。
- 403、404、空状态、loading 状态是否使用统一组件。
- 桌面和移动端至少各检查一次，确认 Header、Sider、内容区不重叠。

## 8. MVP 模块范围

第一版已经完成基础 admin 框架主体。根据 2026-06-22 的起手式范围调整，邮件配置、存储配置、多存储文件管理和数据权限进入核心完成标准；AI、SMS、定时任务、租户、用户导入导出和 generator 仍后置。

| 模块              | MVP 是否做 | 说明                                               |
| ----------------- | ---------- | -------------------------------------------------- |
| 登录/退出         | 做         | 必需                                               |
| 用户信息/修改密码 | 做         | 必需                                               |
| 菜单权限          | 做         | 框架核心                                           |
| 用户管理          | 做         | 框架核心                                           |
| 角色管理          | 做         | 框架核心                                           |
| 部门管理          | 做         | 组织基础                                           |
| 字典管理          | 做         | 通用业务支撑                                       |
| 系统配置          | 做         | 网站标题、Logo、基础开关                           |
| 文件管理          | 做增强版   | 本地上传、多存储配置、列表、预览、回收站、安全限制 |
| 存储配置          | 做         | 至少支持 local 和 S3-compatible 配置               |
| 邮件配置          | 做         | SMTP 配置、默认账号、测试发送、密钥脱敏            |
| 数据权限          | 做         | 角色 `data_scope`、自定义部门范围、列表过滤        |
| 仪表盘            | 做占位     | 后续业务替换                                       |
| 国际化            | 可延后     | 参考项目有 i18n，但基础框架可先中文                |
| 主题设置          | 可延后     | 先保留 AntD token 基础主题                         |
| 用户导入/导出     | 延后       | 起手式当前不依赖                                   |
| 代码生成器        | 延后       | 等 CRUD 约定稳定后再做                             |
| AI 模块           | 不做       | 与基础 admin 框架无关                              |

## 9. 实施任务清单

说明：下面清单是长期技术设计验收口径。当前代码已经完成 P0 到 P5 的主体闭环，并且已经切到 PostgreSQL。后续继续开发时，不要重新按 P0 从头搭建；应从 `docs/admin-base-starter-completion-plan.md` 继续推进。

### P0：项目初始化

- [ ] 初始化 Next.js + TypeScript 项目。
- [ ] 接入 Ant Design，确认 SSR/Client Component 边界。
- [ ] 接入 Hono，并通过 `/api/health` 验证 API 可访问。
- [ ] 接入 Drizzle ORM 和数据库连接。
- [ ] 建立 `src/ui/theme/tokens.ts` 和 `src/ui/theme/antd-theme.ts`，统一主题 token。
- [ ] 建立 `src/ui/app-provider.tsx`，统一 Ant Design Provider 和反馈组件桥接。
- [ ] 建立 `src/features` 页面目录，Next `page.tsx` 只作为薄路由壳。
- [ ] 建立 `src/router/route-manifest.ts`，集中维护前端可渲染页面。
- [ ] 建立 `src/platform/navigation.ts`，隔离 Next navigation 和未来 React Router navigation。
- [ ] 配置 ESLint、Prettier、tsconfig path alias。
- [ ] 配置 `.env.example`。

验收：

- [ ] `pnpm dev` 可启动。
- [ ] 首页或登录页可访问。
- [ ] `/api/health` 返回 `{ success: true }`。

### P1：数据库与种子数据

- [ ] 编写 Drizzle schema：用户、角色、部门、菜单权限、token、登录日志。
- [ ] 编写 Drizzle schema：字典、配置、文件。
- [ ] 编写迁移脚本。
- [ ] 编写 seed：超级管理员 `admin/123456`。
- [ ] 编写 seed：默认菜单、权限码、角色、部门、字典、配置。
- [ ] 编写 `tree` 工具函数。

验收：

- [ ] 一条命令完成 migrate + seed。
- [ ] 数据库中存在默认管理员、角色、菜单树。
- [ ] 默认权限码能覆盖用户、角色、菜单、部门、字典、配置、文件模块。

### P2：后端认证与权限

- [ ] 实现统一响应 helper。
- [ ] 实现错误处理中间件。
- [ ] 实现 `buildListQuery`，支持 URL query 格式的分页、快速搜索、字段筛选、范围筛选、排序。
- [ ] 实现登录接口。
- [ ] 实现退出接口。
- [ ] 实现 token hash 存储。
- [ ] 实现 `authRequired` 中间件。
- [ ] 实现 `ability(code)` 中间件。
- [ ] 实现 `/system/info`。
- [ ] 实现 `/system/menu`。
- [ ] 实现登录日志。

验收：

- [ ] 登录成功返回 token。
- [ ] 未登录访问受保护接口返回 401。
- [ ] 无权限访问接口返回 403 或业务无权限响应。
- [ ] 超级管理员能获取全部权限和菜单。
- [ ] `GET /api/system/user?page=2&pageSize=20&keyword=admin&status=1&sort=createdAt.desc` 能返回正确分页、搜索和排序结果。

### P3：前端登录与布局

- [ ] 实现登录页。
- [ ] 实现 request 封装。
- [ ] 实现 auth store。
- [ ] 实现 dict store。
- [ ] 实现 admin layout。
- [ ] 实现 `AdminShell`，统一 Header、Sider、Menu、Breadcrumb、Content 区域。
- [ ] 实现 `PageScaffold`、`PageHeader`、`PageActions`。
- [ ] 实现 `AdminGuard`，在 Next layout 中完成登录态、路由存在性、菜单可见性、页面权限判断。
- [ ] 实现侧边菜单。
- [ ] 实现面包屑。
- [ ] 实现 Header 用户区和退出。
- [ ] 实现 AuthButton。
- [ ] 实现 route manifest 与后端菜单树的一致性检查脚本。

验收：

- [ ] 登录后进入后台。
- [ ] 刷新页面后仍能恢复用户信息和菜单。
- [ ] 点击菜单可以跳转对应页面。
- [ ] 无权限按钮不显示。
- [ ] 所有后台页面都通过 `AdminShell` 和 `PageScaffold` 呈现。
- [ ] 业务页面只依赖 `features/components/stores/lib/platform`，不直接依赖 Next 专有 API。
- [ ] 后端菜单不存在或当前用户无权限的页面，直接访问时返回 403 页面。

### P4：通用 CRUD 组件

- [ ] 实现 `AdminFieldRenderer`。
- [ ] 实现 `AdminEntityForm`。
- [ ] 实现 `AdminSearchForm`。
- [ ] 实现 `AdminDataTable`。
- [ ] 实现 `useTableUrlState`，搜索、筛选、排序、分页全部同步 URL。
- [ ] 实现统一 `EmptyState`、`ForbiddenPage`、`NotFoundPage`、全局 loading 呈现。
- [ ] 支持分页、排序、筛选、快速搜索。
- [ ] 支持刷新页面恢复搜索条件和分页条件。
- [ ] 支持浏览器前进/后退恢复历史列表状态。
- [ ] 支持新增、编辑、删除弹窗。
- [ ] 支持 `accessName` 权限按钮。
- [ ] 支持自定义请求和自定义操作列。

验收：

- [ ] 用户管理页可以用 `AdminDataTable` 完成列表、新增、编辑、删除。
- [ ] 角色管理页可以复用 `AdminDataTable`。
- [ ] 字典管理页可以复用 `AdminDataTable`。
- [ ] 用户、角色、字典三个页面的标题区、表格工具栏、搜索区、弹窗表单视觉一致。
- [ ] 在用户管理页搜索关键字、状态、部门后，URL 中可见对应 query 参数。
- [ ] 在第 2 页刷新浏览器后，仍保持第 2 页和当前搜索条件。
- [ ] 点击重置后，URL 中对应搜索和分页参数被清理。

### P5：系统模块实现

- [ ] 用户管理 API + 页面。
- [ ] 角色管理 API + 页面。
- [ ] 菜单权限 API + 页面。
- [ ] 部门管理 API + 页面。
- [ ] 字典 API + 页面。
- [ ] 配置 API + 页面。
- [ ] 文件 API + 页面。
- [ ] 仪表盘占位页面。

验收：

- [ ] 管理员可创建普通用户并分配角色。
- [ ] 角色可分配菜单和按钮权限。
- [ ] 普通用户登录后只看到授权菜单。
- [ ] 修改角色权限后重新登录或刷新权限能生效。
- [ ] 字典数据能驱动页面 select/tag。
- [ ] 配置能保存并刷新缓存。
- [ ] 文件能上传、列表、删除、下载。

### P6：质量与工程化

- [ ] API 单测：登录、权限、菜单、角色授权。
- [ ] Service 单测：权限聚合、树构建、查询构造器。
- [ ] E2E：登录、用户 CRUD、角色授权。
- [ ] UI 一致性检查：用户、角色、菜单、字典、配置页面截图对比页面壳层、标题区、表格工具栏和弹窗表单。
- [ ] URL 状态 E2E：搜索、分页、刷新、前进后退、重置。
- [ ] 表单校验错误测试。
- [ ] 增加 README：启动、迁移、默认账号。
- [ ] 增加开发约定：权限码命名、菜单新增流程、CRUD 页面写法。

验收：

- [ ] `pnpm lint` 通过。
- [ ] `pnpm typecheck` 通过。
- [ ] 核心测试通过。
- [ ] 核心后台页面在桌面和移动端无明显布局漂移。
- [ ] README 可以让新开发者从零启动项目。

## 10. 推荐开发顺序

最稳的顺序：

```text
P0 项目骨架
-> P1 数据库和 seed
-> P2 登录鉴权
-> P3 布局菜单
-> P4 通用 CRUD
-> P5 系统模块
-> P6 测试和文档
```

当前基础 admin 框架的关键路径已经跑通。后续起手式完成路径是：

```text
系统 CRUD 收敛 -> 系统内置数据保护 -> 数据权限 -> 多存储文件管理 -> 邮件配置 -> 质量门禁
```

只要这个闭环完成，后续业务模块就能按固定模式扩展。

## 11. 第一轮实现建议

第一轮实际编码建议控制在以下交付物：

1. Next.js + Hono + Drizzle 基础项目可启动。
2. DB schema + seed 可生成默认管理员。
3. 登录、退出、当前用户、菜单接口可用。
4. Ant Design 后台布局可用。
5. 用户、角色、菜单权限三个页面可用。
6. `AdminDataTable`、`AdminSearchForm`、`AdminEntityForm` 能支撑搜索、分页、新增、编辑、删除，并默认同步 URL 状态。

后续暂缓：

- 用户导入/导出。
- 代码生成器。
- 国际化完整覆盖。
- 主题抽屉。
- AI 模块。
- SMS、定时任务、租户等插件型能力。

这样可以最快得到“可登录、可授权、可扩展业务模块”的基础后台框架。
