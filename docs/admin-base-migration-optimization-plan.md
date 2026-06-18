# Admin Base 迁移优化方案

> 最后核对：2026-06-18  
> 目标：在已经完成 PostgreSQL 基线迁移的基础上，继续把 Admin Base 收敛成 CRUD 可持续迭代、权限清晰、开发体验轻的后台基座。  
> 边界：本文是当前版本的执行主文档；长期产品/技术设想见 `docs/admin-base-technical-design.md`。

## 1. 一句话结论

本项目现在已经完成基础后台闭环：Next.js + Hono + Drizzle schema + PostgreSQL + Ant Design。PG baseline、数据库级时间戳、软删除 partial unique index、默认 seed、前端 CRUD 组件、文件预览和系统管理页面已经可用。

下一阶段不再是“从 SQLite 迁移到 PG”，而是继续做三件事：

1. 把当前 route-local 常规 CRUD 收敛到 Drizzle `pgTable` table object + Zod schema + 权限配置的轻量 CRUD factory。
2. 把 CRUD 权限作为 factory 的必填配置，做到“每个启用动作都有服务端权限校验”，并扩展 `admin:check-routes` 做 fail-fast 检查。
3. 继续复用和增强现有 `AdminDataTable`、`AdminEntityForm`、`AuthButton`、文件预览和系统管理页面，不为了抽象新增 Repository/DAO 厚层。

推荐方向保持 **PG-first，不做 SQLite 兼容层，不为了将来可能的 MySQL 现在就抽双方言层**。如果以后确实要 MySQL，可以再针对 MySQL 做一轮 schema/迁移适配；当前为了迭代效率和类型清晰，先把 PostgreSQL 和 CRUD/权限闭环做对。

## 1.1 当前 ready 状态

| 项目                | 状态     | 说明                                                                         |
| ------------------- | -------- | ---------------------------------------------------------------------------- |
| PG 基础设施         | 已完成   | `postgres` driver、Drizzle PG adapter、`DATABASE_URL` PG 连接串已就位        |
| PG baseline         | 已完成   | `0001_pg_baseline` 手写迁移覆盖系统主表、外键、索引、trigger                 |
| 时间戳              | 已完成   | `created_at/updated_at` 为 `timestamptz default now()`，更新触发器生效       |
| 软删除唯一约束      | 已完成   | 主数据表采用 `deleted_at`，唯一约束改成 `where deleted_at is null`           |
| 审计字段            | 部分完成 | schema/migration 已有 `created_by/updated_by/deleted_by`，route 尚未统一写入 |
| 前端 CRUD           | 已完成   | `AdminDataTable`、URL 状态、表单、搜索、权限按钮已经可支撑系统页             |
| 文件管理            | 已增强   | 文件夹管理、图片/视频/PDF/Word/Excel/文本预览、浮动音频播放器已加入          |
| 后端 CRUD factory   | 已完成   | 已新增 Drizzle table object CRUD factory、权限 meta、批量删除、审计字段写入  |
| CRUD 试点迁移       | 已完成   | `dict` / `config` / `dept` 常规 CRUD 已迁移，复杂接口继续保留显式 route      |
| CRUD 权限 fail-fast | 未开始   | 下一阶段要把权限配置和 seed/route 检查绑定                                   |
| main 分支整理       | 待处理   | 当前在 `codex/admin-base-migration-plan`，后续基座框架阶段再切 `main`        |

## 2. 当前实现快照

本节来自 2026-06-18 当前代码核对，而不是理想方案。

### 2.1 数据库与迁移

当前数据库入口：

- `src/server/db/index.ts`
- `src/server/db/schema/index.ts`
- `src/server/db/migrations.ts`
- `drizzle.config.ts`
- `scripts/db-migrate.ts`
- `scripts/db-reset.ts`

现状：

- ORM schema 已使用 `drizzle-orm/pg-core` 的 `pgTable`。
- 运行库使用 `postgres` + `drizzle-orm/postgres-js`。
- `DATABASE_URL` 是标准 PG 连接串，默认是 `postgres://admin_base:admin_base@localhost:5432/admin_base`。
- `drizzle.config.ts` 当前 `dialect: "postgresql"`。
- 迁移仍是 `src/server/db/migrations.ts` 中手写 SQL 数组，当前基线是 `0001_pg_baseline`。
- `scripts/db-migrate.ts` / `scripts/db-reset.ts` 已按 PG 执行。
- `src/server/db/index.ts` 仍导出名为 `sqlite` 的兼容 client，这是为了保留旧 route 的 `.prepare().all/get/run` 调用形态；它底层执行的是 PostgreSQL，不代表项目仍在使用 SQLite。

当前 Drizzle schema 里公共时间戳是：

```ts
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};
```

`src/server/db/migrations.ts` 还会为主数据表创建 `set_updated_at()` trigger，因此普通 UPDATE 会由数据库刷新 `updated_at`。

### 2.2 时间戳

当前 `created_at` / `updated_at` 的事实：

- DB 层字段类型是 `TIMESTAMPTZ`，默认值是 `now()`。
- `updated_at` 的最终兜底是 PG trigger `set_updated_at()`。
- 当前 route 里仍有少量 `nowIso()` 写入，主要是为了兼容旧 route-local SQL 写法；这不是目标形态。
- 下一阶段 CRUD factory 应该避免普通 CRUD 手写 `created_at/updated_at`，只在 seed/backfill/import 需要固定历史时间时显式写入。

结论：

- 数据库级时间戳已经 ready。
- route-local SQL 里的手写时间戳是历史兼容残留，后续随 CRUD factory 迁移逐步移除。

### 2.3 软删除

当前软删除是选择性存在：

| 表                                | 当前删除策略                                          |
| --------------------------------- | ----------------------------------------------------- |
| `sys_user`                        | `deleted_at` 软删除                                   |
| `sys_role`                        | `deleted_at` 软删除                                   |
| `sys_dept`                        | `deleted_at` 软删除                                   |
| `sys_dict`                        | `deleted_at` 软删除                                   |
| `sys_dict_item`                   | `deleted_at` 软删除                                   |
| `sys_config_group`                | `deleted_at` 软删除                                   |
| `sys_config_items`                | `deleted_at` 软删除                                   |
| `sys_file`                        | `deleted_at` 软删除，且已有回收站/恢复/永久删除       |
| `sys_rule`                        | schema/migration 有 `deleted_at`，当前 route 仍硬删除 |
| `sys_file_group`                  | schema/migration 有 `deleted_at`，当前 route 仍硬删除 |
| `sys_user_role` / `sys_role_rule` | 关联表硬删除                                          |
| `sys_access_token`                | 登出时硬删除                                          |
| `sys_login_record`                | 日志只插入，不软删除                                  |

当前问题：

- PG schema/migration 已经把主数据表的唯一索引改成 partial unique index。
- `sys_rule` 和 `sys_file_group` 虽然已有 `deleted_at` 字段，但 route 行为仍是硬删除；下一阶段要决定是否把它们纳入通用软删除。
- 审计字段已经落库，但 route 尚未统一写 `created_by/updated_by/deleted_by`。

### 2.4 后端 CRUD

当前列表查询已有一个实际使用的封装：

- `src/server/services/list-query.ts`
- `buildListQuery(url, config)`

它负责：

- `page` / `pageSize`
- `keyword`
- 白名单字段筛选
- 白名单字段排序
- `COUNT + LIMIT/OFFSET`
- `baseWhere`

但新增、修改、删除主要仍在 route 文件中直接写 SQL：

- `src/server/routes/system/user.ts`
- `src/server/routes/system/role.ts`
- `src/server/routes/system/rule.ts`
- `src/server/routes/system/dept.ts`
- `src/server/routes/system/dict.ts`
- `src/server/routes/system/config.ts`
- `src/server/routes/system/file.ts`

项目里虽然有 `src/server/services/sql-helpers.ts`，包含 `insertRecord` / `updateRecord` / `softDeleteRecord` 等函数，但当前没有任何 route 使用它。因此它不是事实上的 CRUD 抽象层。

当前 route 的优点：

- 每个接口的权限清楚写在路由上。
- Zod 校验靠近接口，业务规则容易读。
- 用户/角色这种需要同步关联表的操作已经用 PG transaction 兼容包装包起来。
- 复杂业务如文件上传、角色分配、重置密码没有被强行塞进通用函数。

当前 route 的问题：

- 原生 SQL 重复，字段映射重复，时间戳重复。
- `buildListQuery` 仍然接收字符串 table/select/fieldMap，类型不强。
- `baseWhere` 有拼接字符串，例如 `sur.role_id = ${roleId}`，短期可控，但不是长期基座应该保留的模式。
- route 内仍保留旧 `.prepare().all/get/run` 写法，虽然已经通过 PG 兼容 client 跑通，但不是长期目标。
- 常规 CRUD 和权限码没有绑定成一个声明，新增模块时容易漏权限。

### 2.5 前端 CRUD

前端已经有较完整的通用层：

- `src/components/admin-data-table/AdminDataTable.tsx`
- `src/components/admin-entity-form/AdminEntityForm.tsx`
- `src/components/admin-search-form/AdminSearchForm.tsx`
- `src/components/admin-fields/AdminFieldRenderer.tsx`
- `src/components/auth-button/AuthButton.tsx`
- `src/lib/request.ts`

`AdminDataTable` 已经支持：

- 列配置驱动表格、搜索、表单。
- URL query 同步分页、筛选、排序。
- 统一 `GET /api` 列表。
- 统一 `POST` 创建、`PUT` 更新、`DELETE` 删除。
- `accessName.create/update/delete` 按钮显隐。
- 自定义 `handleRequest` / `operateRender` / `beforeSubmit`。
- 搜索表单是否展示、搜索区位置、toolbar 标题、多个表格的 URL state prefix。

因此本次迁移不建议重做前端 CRUD 层。重点应该放在后端 CRUD factory 和 PG schema。

最近已增强：

- `AdminImageField` 支持图片 URL、上传和选择已有图片。
- `AdminEntityForm` 支持字段帮助提示和自定义表单控件。
- 配置项页面支持动态控件预览、选项 JSON/属性 JSON 校验和图片配置。
- 字典页支持内嵌字典项管理。
- 文件页支持文件夹 CRUD、文件预览、下载、回收站、音频浮动播放器。
- `/uploads/[...path]` 支持 MIME、Range、流式输出和 `nosniff`。

### 2.6 权限

当前权限链路：

- `src/server/middleware/auth.ts` 解析 bearer token。
- `src/server/services/auth-service.ts` 登录时把用户 action 权限快照写入 `sys_access_token.abilities_json`。
- `src/server/middleware/ability.ts` 校验 `ability("system.user.query")`。
- 超级管理员 `id = 1` 直接放行。
- 前端 `AuthButton` 基于 Zustand 中的 access 做按钮显隐。
- `src/server/db/seed/default-data.ts` 维护 `sys_rule` 的菜单和 action 权限种子。
- `scripts/admin-check-routes.ts` 检查前端 route manifest 和数据库 route/action 是否一致。

当前问题：

- 权限依赖每个 route 手动挂 `ability()`，常规 CRUD 没有统一校验契约。
- 前端按钮的 `accessName` 和后端 route 权限没有源头绑定。
- `dict/list/all` 只有登录态，没有 `system.dict.query`，这是合理的字典公共接口，但这类例外应该显式配置，而不是默认漏掉。
- 后续如果加入 `batchDelete`、`restore`、`forceDelete`、`export`、`import`，必须提前定义权限命名规则。

## 3. 目标决策

### 3.1 数据库：PostgreSQL 作为唯一当前目标

本版本已经直接切到 PG：

- 开发环境使用 Docker PG，不再继续以 SQLite 为主开发库。
- `DATABASE_URL` 已经是标准 PG 连接串。
- Drizzle schema 已经从 `sqlite-core` 改为 `pg-core`。
- `drizzle.config.ts` 已经是 `dialect: "postgresql"`。
- 当前迁移使用手写 PG baseline SQL，补齐 trigger 和特殊 index；后续可以再决定是否引入 Drizzle Kit 生成迁移作为主流程。

不建议现在做 SQLite/PG/MySQL 三方适配：

- 会逼迫我们避开 PG 的 partial index、`timestamptz`、JSONB、触发器等能力。
- 会让 CRUD factory 变成方言抽象层，增加心智负担。
- 用户已经明确未来不是 SQLite，且本地已有 PG。

MySQL 只作为“未来可迁移的约束”保留：

- 表名、字段名保持 snake_case。
- 避免业务代码依赖 PG 特有 SQL 字符串。
- 方言能力放在 migration/schema 层，不穿透到页面和普通 CRUD 调用。

### 3.2 时间戳：数据库默认值 + 数据库触发器

目标：

- `created_at` 由数据库默认 `now()` 生成。
- `updated_at` 由数据库默认 `now()` 生成，并在 UPDATE 时由 trigger 自动刷新。
- 应用层普通 CRUD 不再手动写 `created_at` / `updated_at`。
- seed/import/backfill 可以显式写历史时间，但常规业务代码不依赖它。

PG 建议：

```sql
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_sys_user_updated_at
before update on sys_user
for each row
execute function set_updated_at();
```

为什么用 trigger，而不是只靠代码：

- 后续脚本、导入、后台任务、数据修复不需要记得手动写 `updated_at`。
- CRUD factory 和少量自定义 route 可以少写重复字段。
- 数据库是最终事实源，更适合上线后的审计和排障。

为什么不是只用 Drizzle `defaultNow()`：

- `defaultNow()` 只能解决 INSERT 默认值。
- UPDATE 时的 `updated_at` 仍然需要代码或 trigger。
- 本项目存在 raw SQL、seed、文件操作、后续导入导出，trigger 更稳。

MySQL 对应方案：

```sql
created_at timestamp not null default current_timestamp,
updated_at timestamp not null default current_timestamp on update current_timestamp
```

但本版本按 PG 实现。

### 3.3 软删除：保留 `deleted_at`，PG 用 partial index

目标：

- 主数据表使用 `deleted_at timestamptz null`。
- 删除是 `UPDATE ... SET deleted_at = now()`。
- 恢复是 `UPDATE ... SET deleted_at = null`。
- 永久删除只开放给确实有回收站语义的模块，例如文件。
- 关联表、token、日志继续硬删除或只追加。

推荐主数据表：

- `sys_user`
- `sys_role`
- `sys_dept`
- `sys_rule`
- `sys_dict`
- `sys_dict_item`
- `sys_config_group`
- `sys_config_items`
- `sys_file`
- `sys_file_group` 可选，若要树结构回收站则加入。

PG 唯一索引建议：

```sql
create unique index sys_user_username_active_uidx
on sys_user (username)
where deleted_at is null;

create unique index sys_role_code_active_uidx
on sys_role (code)
where deleted_at is null;

create unique index sys_dict_code_active_uidx
on sys_dict (code)
where deleted_at is null;
```

为什么不用 ContiNew 那种 `deleted = 0/id`：

- ContiNew 需要兼容 MySQL/PostgreSQL 等多数据库，它用 `deleted` 字段参与唯一索引是合理的跨库方案。
- 我们当前 PG-first，`deleted_at is null` partial unique index 更自然，语义更清楚，索引更小。
- `deleted_at` 还能直接表达删除时间，回收站排序和审计更方便。

### 3.4 审计字段：建议本版本补齐，但不强行复杂化

当前只有时间，没有操作人。建议在主数据表补充：

```text
created_by
updated_by
deleted_by
```

约束：

- 这些字段由应用层从 Hono context 写入，因为数据库不知道当前登录用户。
- `created_at` / `updated_at` 仍由数据库维护。
- `created_by` 在 seed 阶段允许为空或写超级管理员 `1`。
- `updated_by` 在 UPDATE 时由 CRUD factory 自动写。
- `deleted_by` 在软删除时由 CRUD factory 自动写。

这不是新增一层，只是把后台系统常见审计能力放进基础 CRUD。

### 3.5 CRUD：轻量 factory，不加 Repository/DAO

本项目不建议引入传统三层：

```text
controller -> service -> repository -> dao
```

推荐边界：

```text
route/custom endpoint
  -> createCrudRoutes(...) for regular CRUD
  -> small service/helper only when business operation crosses tables or external systems
  -> Drizzle query builder
```

也就是说，常规 CRUD 用一个 factory 注册 route；复杂业务继续保留显式 route。

适合进入 CRUD factory 的动作：

- list/page
- get/detail
- create
- update
- softDelete
- batchSoftDelete
- restore
- forceDelete
- status/toggle

不适合强行进入 CRUD factory 的动作：

- 用户重置密码。
- 用户角色同步的复杂事务，可以用 hook，但逻辑要显式。
- 角色分配权限。
- 文件上传、下载、复制、移动、永久删除物理文件。
- 登录、登出、刷新权限。

## 4. 目标目录建议

建议迁移后后端 DB/CRUD 目录如下：

```text
src/server/db/
  index.ts                 # PG client + Drizzle db
  migrate.ts               # migration runner if needed
  schema/
    common.ts              # timestamps/audit helpers
    system-user.ts
    system-permission.ts
    system-dict.ts
    system-config.ts
    system-file.ts
    index.ts
  seed/
    seed.ts
    system-rules.ts
src/server/crud/
  create-crud-routes.ts
  list-query.ts
  permissions.ts
  types.ts
src/server/routes/system/
  user.ts                  # custom endpoints + CRUD registration
  role.ts
  rule.ts
  dept.ts
  dict.ts
  config.ts
  file.ts
```

说明：

- `src/server/crud` 是工具层，不是 Repository。
- `schema/common.ts` 只放字段 helper，不放业务。
- route 文件仍然是业务入口，开发者可以一眼看到这个模块开放了哪些 API。

## 5. PG schema 设计建议

### 5.1 公共字段 helper

Drizzle PG 示例：

```ts
import { integer, timestamp } from "drizzle-orm/pg-core";

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const softDelete = {
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

export const auditUsers = {
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
};
```

主数据表组合：

```ts
{
  id: serial("id").primaryKey(),
  ...
  ...timestamps,
  ...softDelete,
  ...auditUsers,
}
```

ID 选择：

- 当前后台基座用 `serial` / integer 足够，前后端都用 number，开发体验好。
- 如果未来明确要超大表，再切 `bigserial`，但要同步处理 JS `bigint`/string 的序列化问题。

### 5.2 约束和索引

PG 迁移时必须补齐：

- 主键。
- 唯一约束或 partial unique index。
- 外键。
- 外键列索引。
- 常用查询组合索引。

当前重点索引：

| 表                 | 索引建议                                                                  |
| ------------------ | ------------------------------------------------------------------------- |
| `sys_user`         | `username where deleted_at is null` 唯一；`dept_id`；`status, created_at` |
| `sys_role`         | `code where deleted_at is null` 唯一；`status, sort`                      |
| `sys_dept`         | `parent_id`；`code where deleted_at is null` 可选唯一                     |
| `sys_rule`         | `key where deleted_at is null` 唯一；`parent_id`；`type, status`          |
| `sys_user_role`    | `(user_id, role_id)` 主键；`role_id` 索引                                 |
| `sys_role_rule`    | `(role_id, rule_id)` 主键；`rule_id` 索引                                 |
| `sys_dict`         | `code where deleted_at is null` 唯一                                      |
| `sys_dict_item`    | `(dict_id, value) where deleted_at is null` 唯一；`dict_id, status, sort` |
| `sys_config_group` | `code where deleted_at is null` 唯一                                      |
| `sys_config_items` | `key where deleted_at is null` 唯一；`group_id`                           |
| `sys_file`         | `group_id`；`uploader_id`；`deleted_at`；`created_at`                     |
| `sys_access_token` | `token_hash` 唯一；`user_id`；`expires_at`                                |

注意：

- PG 不会自动给外键列建索引，必须显式创建。
- 当前 `buildListQuery` 是 offset 分页，后台数据量不大可以先保留；大表如日志/文件后续再引入 cursor 分页。

### 5.3 外键策略

建议：

- `sys_user.dept_id -> sys_dept.id`：`on delete set null`。
- `sys_user_role.user_id -> sys_user.id`：`on delete cascade`。
- `sys_user_role.role_id -> sys_role.id`：`on delete cascade`。
- `sys_role_rule.role_id -> sys_role.id`：`on delete cascade`。
- `sys_role_rule.rule_id -> sys_rule.id`：`on delete cascade`。
- `sys_dict_item.dict_id -> sys_dict.id`：`on delete restrict` 或 soft-delete 联动。
- `sys_config_items.group_id -> sys_config_group.id`：`on delete restrict` 或 soft-delete 联动。
- `sys_file.group_id -> sys_file_group.id`：`on delete set null`。
- `sys_access_token.user_id -> sys_user.id`：`on delete cascade`。

原则：

- 关联表可以 cascade。
- 主数据表不要轻易 cascade 删除业务数据。
- 软删除表的业务删除由应用控制，不依赖数据库 cascade。

## 6. CRUD factory 设计

### 6.1 核心输入

不要用“表名字符串”作为核心 API。应该用 Drizzle table object，这样 TypeScript 和 PG 迁移都更稳。

建议定义：

```ts
type CrudAction =
  | "query"
  | "get"
  | "create"
  | "update"
  | "delete"
  | "batchDelete"
  | "restore"
  | "forceDelete"
  | "status"
  | "export"
  | "import";

type CrudPermissions = {
  prefix: string;
  actions?: Partial<Record<CrudAction, string | false>>;
};

type CrudHooks<TCreate, TUpdate> = {
  beforeCreate?: (ctx: CrudContext, values: TCreate) => Promise<TCreate> | TCreate;
  afterCreate?: (ctx: CrudContext, id: number, values: TCreate) => Promise<void> | void;
  beforeUpdate?: (ctx: CrudContext, id: number, values: TUpdate) => Promise<TUpdate> | TUpdate;
  afterUpdate?: (ctx: CrudContext, id: number, values: TUpdate) => Promise<void> | void;
  beforeDelete?: (ctx: CrudContext, ids: number[]) => Promise<void> | void;
};
```

示例：

```ts
export const dictCrud = createCrudRoutes({
  path: "/dict/list",
  table: sysDict,
  idColumn: sysDict.id,
  createSchema: dictCreateSchema,
  updateSchema: dictUpdateSchema,
  permissions: {
    prefix: "system.dict",
  },
  list: {
    columns: {
      id: sysDict.id,
      name: sysDict.name,
      code: sysDict.code,
      status: sysDict.status,
      sort: sysDict.sort,
      createdAt: sysDict.createdAt,
    },
    searchable: {
      name: "like",
      code: "like",
      status: "eq",
    },
    quickSearchFields: ["name", "code"],
    sortableFields: ["id", "sort", "status", "createdAt"],
    defaultSort: { field: "sort", order: "asc" },
    softDelete: true,
  },
});
```

权限默认推导：

```text
query        -> system.dict.query
get          -> system.dict.query
create       -> system.dict.create
update       -> system.dict.update
delete       -> system.dict.delete
batchDelete  -> system.dict.delete
restore      -> system.dict.delete
forceDelete  -> system.dict.delete
status       -> system.dict.status
export       -> system.dict.export
import       -> system.dict.import
```

允许显式覆盖：

```ts
permissions: {
  prefix: "system.file",
  actions: {
    create: "system.file.upload",
    update: "system.file.upload",
    query: "system.file.query",
    delete: "system.file.delete",
    get: false, // 明确公开或只需登录态的接口，必须显式写 false
  },
}
```

### 6.2 权限必须 fail fast

CRUD factory 注册时应做开发期校验：

- 启用的 action 没有权限码，也没有显式 `false`，直接抛错。
- 权限码不符合 `system.<module>.<action>` 约定，开发环境 warning 或失败。
- `permissions.prefix` 对应 action 没有 seed 到 `sys_rule`，`admin:check-routes` 失败。

这样能避免“页面按钮隐藏了，但接口没保护”或“接口保护了，但角色页找不到这个权限”的情况。

### 6.3 list query 的升级

当前 `buildListQuery` 是字符串 SQL。迁移后建议升级成 Drizzle 版本：

- `fieldMap` 从字符串列名变成 typed column/expression。
- `where` 用 Drizzle `eq` / `ilike` / `and` / `or`。
- `sort` 只允许白名单字段。
- 默认加 `deleted_at is null`，除非配置 `includeDeleted` 或 `onlyDeleted`。
- `pageSize` 继续限制最大 200。

保留 offset 分页作为默认：

- 后台 CRUD 数据通常不是超大表。
- 前端 `AdminDataTable` 已按 page/pageSize 工作。
- 日志、文件等大表后续单独支持 cursor。

### 6.4 复杂模块怎么处理

不要把所有东西塞进 CRUD factory。

推荐拆法：

| 模块     | 常规 CRUD                | 自定义 route                     |
| -------- | ------------------------ | -------------------------------- |
| 字典     | 字典类型、字典项         | `/dict/list/all` 缓存读取        |
| 配置     | 配置分组、配置项         | `/config/items/save`、刷新缓存   |
| 部门     | 部门基础 CRUD            | 树结构、部门用户列表             |
| 菜单权限 | 菜单基础 CRUD            | 树、父级选项、状态/显隐快捷操作  |
| 角色     | 角色基础 CRUD            | 分配权限、关联用户               |
| 用户     | 用户基础 CRUD            | 重置密码、角色/部门选项          |
| 文件     | 文件元数据列表/删除/恢复 | 上传、下载、复制、移动、物理删除 |

规则：

- CRUD factory 管重复模式。
- route-local 代码管业务例外。
- 事务逻辑可以通过 hook 或显式 route 保留清晰度。

## 7. 权限与数据权限

### 7.1 功能权限

当前 `system.<module>.<action>` 命名是好的，继续保留。

本版本建议标准 action：

```text
query
create
update
delete
status
import
export
upload
download
restore
forceDelete
setRule / assign / resetPassword 等业务动作
```

后端必须是最终权限边界：

- 前端 `AuthButton` 只是体验优化。
- `ability()` 必须包住每个受保护 endpoint。
- CRUD factory 负责自动挂 `authRequired()` 和 `ability()`。
- 自定义 route 继续显式写 `ability()`。

### 7.2 权限种子同步

当前 `seedRules` 手写维护权限。迁移后建议二选一：

方案 A：继续手写 seed，但 `admin:check-routes` 扩展校验 CRUD meta。

- 优点：简单、可控。
- 缺点：新增 CRUD 时仍要改 seed。

方案 B：从 CRUD definitions 生成 action seed，再和手写菜单合并。

- 优点：权限不容易漏。
- 缺点：需要约定菜单和 action 的父子关系。

建议先做方案 A，再升级方案 B。

### 7.3 数据权限

ContiNew 有角色数据权限设计，我们可以预留，但不建议本版本直接做复杂 RLS。

建议阶段：

1. 先在 `sys_role` 增加 `data_scope`，在 `sys_role_dept` 存自定义部门范围。
2. CRUD list config 支持 `dataScope` hook，根据当前用户注入部门/本人过滤条件。
3. 用户、部门、角色这几个模块先验证数据权限。
4. 如果未来是多租户或数据库直连客户端，再考虑 PG RLS。

为什么不一开始启用 RLS：

- 当前 DB 只由 Hono 服务端访问，外部用户不直连数据库。
- 功能权限已经在 Hono 中间件完成。
- RLS 需要为每个请求设置 session 变量，并梳理 migration/seed/admin 脚本身份，当前会增加迁移复杂度。

但如果后续做 SaaS 多租户，`tenant_id` + PG RLS 会很有价值。

## 8. ContiNew 可借鉴点

本地参考项目 `tmp/continew-admin` 中值得借鉴的是产品规则，不是 Java 分层。

可借鉴：

- `@CrudRequestMapping` 按声明开放 CRUD API。
- `BaseController.preHandle` 根据 CRUD API 类型推导权限。
- `BaseDO` 统一 `create_user/create_time/update_user/update_time/deleted`。
- 角色有 `data_scope`，支持功能权限和数据权限分离。
- 主数据表带 `is_system`，系统内置记录可以禁止删除或限制修改关键字段。
- 代码生成器可以基于表结构生成 CRUD API、权限、前端页面模板。
- 文件模块有更完整的元数据，例如 hash、存储平台、缩略图、文件类型。
- 字典、菜单、权限缓存更新是明确的系统能力。

不建议照搬：

- Controller -> Service -> Mapper 的 Java 层级。
- MyBatis Plus 的逻辑删除字段形态。
- 为跨数据库牺牲 PG partial index 的设计。
- 一开始就上完整代码生成器，容易拖慢当前基座迁移。

迁移到本项目的方式：

- 用 `createCrudRoutes` 替代 `@CrudRequestMapping`。
- 用 `permissions.prefix + action map` 替代 `preHandle` 的权限推导。
- 用 `timestamps + auditUsers + softDelete` 字段 helper 替代 Java `BaseDO`。
- 用 `admin:check-routes` 扩展校验替代运行时才发现权限缺失。
- 后续再做轻量 generator，生成 schema、Zod、CRUD config、页面 columns，而不是生成多层文件。

## 9. 两个参考框架的吸收对照

| 来源                    | 已吸收的优势                                                                                                                          | 不吸收的部分                                                                                                         | 落到本项目的设计                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `tmp/xin-admin-laravel` | 菜单/路由/action 合一的 `sys_rule` 权限模型、token abilities、列表搜索/排序/分页模式、列配置驱动表格和表单、Ant Design 后台交互       | Laravel 控制器/模型结构、XinTable/XinForm 组件 API、参考项目里不一致的字段和路由细节                                 | `sys_rule` + `sys_role_rule`、`ability()`、`buildListQuery`、`AdminDataTable`、`AdminEntityForm`、`AuthButton`                              |
| `tmp/continew-admin`    | 声明式 CRUD API、CRUD 动作推导权限、审计字段、角色数据权限、系统内置记录保护、代码生成器、文件元数据增强、字典/菜单/权限缓存意识      | Java Controller/Service/Mapper 层级、MyBatis Plus 逻辑删除实现、为了跨库牺牲 PG 能力的索引策略、一次性完整 generator | `createCrudRoutes`、`permissions.prefix + action map`、`timestamps + auditUsers + softDelete`、PG partial unique index、轻量 generator 预留 |
| 本项目当前实现          | Next.js + Hono 单仓、PG-first schema、数据库级时间戳、前端 CRUD 组件已经成型、权限中间件可用、CRUD factory 试点已落地、文件预览已增强 | 用户、角色、菜单、文件仍有 route-local SQL；兼容 client 名称仍叫 `sqlite`；跨表事务模块暂未迁入 CRUD factory         | 继续沿用 Drizzle table object CRUD factory、权限 fail fast、自定义 route 保留复杂业务、逐步移除 route-local CRUD 重复                       |

结论：

- XinAdmin 提供产品结构和前端 CRUD 体验参考。
- ContiNew 提供工程化 CRUD、权限、审计、数据权限和 generator 参考。
- 本项目采用轻量 TypeScript 实现，不复制任一参考项目的后端分层。

## 10. 迁移实施步骤

### Phase 0：事实冻结与 PG 基线，已完成

已完成内容：

- 当前默认账号、角色、权限种子已经由 `src/server/db/seed/default-data.ts` 维护。
- `admin:check-routes` 已经只校验内部页面路由；`link = 1` 或 `http(s)://` 外链菜单不要求存在于前端 route manifest。
- `postgres` driver、Drizzle PG adapter、PG `DATABASE_URL` 已经就位。
- `drizzle.config.ts` 已经是 `dialect: "postgresql"`。
- `scripts/db-migrate.ts` / `scripts/db-reset.ts` 已经按 PG 执行。
- `src/server/db/schema/index.ts` 已经切到 `pgTable`。
- `src/server/db/migrations.ts` 已经有 `0001_pg_baseline`，覆盖系统主表、外键、索引、partial unique index 和 `updated_at` trigger。
- `pnpm typecheck`、`pnpm test`、`pnpm admin:check-routes` 已经在当前分支通过。

仍需注意：

- 当前 `src/server/db/index.ts` 的兼容 client 仍叫 `sqlite`，这是技术债命名；底层已经是 PG。
- 如果后续要清理命名，应在 CRUD factory 开始前或完成后单独做一次小改，避免和业务迁移混在一起。

### Phase 1：CRUD factory 试点，已完成

已迁移低风险模块：

1. `sys_dict`
2. `sys_dict_item`
3. `sys_config_group`
4. `sys_config_items`
5. `sys_dept`

原因：

- 结构简单。
- 当前已经是标准 CRUD。
- 能验证 list/search/sort/create/update/delete/permission 的完整闭环。
- 前端页面已经复用 `AdminDataTable` 和 `AdminEntityForm`，适合作为后端 factory 的试点面。

已完成任务：

- 新增 `src/server/crud/create-crud-routes.ts`、`types.ts`、`permissions.ts`。
- CRUD factory 接收 Drizzle table object，不接 table name string。
- CRUD factory 接收 Zod create/update schema。
- CRUD factory 接收 `permissions.prefix` 和 action map，enabled action 没有权限配置时开发期 fail fast。
- list query 从字符串 SQL 逐步切到 Drizzle column/expression 白名单。
- 字典和配置模块先迁到 factory，自定义接口保留显式 route：
  - `/dict/list/all`
  - `/config/items/save`
  - `/config/items/refreshCache`
- 部门常规 CRUD 已迁到 factory，自定义接口保留显式 route：
  - `/dept/tree`
  - `/dept/users/:id`
- factory 统一写入 `created_by/updated_by/deleted_by`，`created_at/updated_at` 继续由 PG 默认值和 trigger 维护。
- factory 支持单条删除和 `POST <basePath>/batch-delete`，默认映射到 `<prefix>.delete` 权限。

验收结果：

- 字典/配置列表、新增、编辑、删除行为不回退。
- 普通用户无权限访问 CRUD API 返回 403。
- 普通用户无权限时前端按钮不显示。
- 超级管理员仍拥有全部启用 action。
- route-local SQL 在试点模块明显减少。
- `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm admin:check-routes`、`pnpm build`、`pnpm e2e` 通过。

### Phase 2：权限和 seed fail-fast，已完成

已完成任务：

- 定义 CRUD action 到权限码的标准映射。
- 扩展 `admin:check-routes`，校验 CRUD definitions 的权限码存在于 `sys_rule`。
- 增加开发期启动校验：enabled action 必须有权限配置，公开例外必须显式写 `false`。
- 字典公共接口、健康检查、登录等继续保留显式 route，不进入 CRUD factory。
- 确认外链菜单继续只作为菜单数据存在，不参与前端内部 route manifest 校验。
- 角色授权页能看到新增 action。

验收结果：

- 新增 CRUD 模块时，漏 seed 会在检查命令中失败。
- 新增 CRUD 模块时，漏服务端权限会在注册或测试阶段失败。
- `system.<module>.<action>` 命名保持统一。

### Phase 3：系统模块迁移，下一步

试点完成后继续迁：

1. `sys_rule`
2. `sys_role`
3. `sys_user`
4. `sys_file`

每迁一个模块，保留该模块自定义接口，不强行抽象。

模块边界：

- 部门：基础 CRUD 已迁，树结构和部门用户列表保留自定义。
- 菜单权限：基础 CRUD 可迁，但删除语义、父级选项、状态/显隐快捷操作要保留自定义或用 hook 保护。
- 角色：存在 `sys_role_rule` 同步事务，迁移前需要给 CRUD factory 增加事务型 hook 或继续显式 route。
- 用户：存在密码 hash、`sys_user_role` 同步事务和超级管理员保护，迁移前需要事务型 hook 或继续显式 route。
- 文件：元数据列表、删除、恢复可部分迁，上传、下载、复制、移动、物理删除保留自定义。

### Phase 4：审计字段和系统保护，部分完成

已完成：

- CRUD factory 自动写 `created_by/updated_by/deleted_by`。
- 默认部门 `id = 1` 禁止通过 CRUD factory 删除。

后续任务：

- 明确哪些表启用 `is_system` 或 hard-coded protected IDs。
- 超级管理员、内置角色、核心菜单权限禁止删除或限制关键字段修改。
- 决定 `sys_rule` 和 `sys_file_group` 是否从当前硬删除改成软删除。

### Phase 5：质量门禁

建议迁移版本完成时至少跑：

```bash
pnpm typecheck
pnpm test
pnpm admin:check-routes
pnpm lint
pnpm build
```

如果改了前端页面或 AdminDataTable 行为，再跑：

```bash
pnpm e2e
```

PG 侧增加最小数据库断言：

- `updated_at` trigger 生效。
- soft delete partial unique index 生效。
- 外键约束生效。
- 权限 seed 和 CRUD meta 一致。

## 11. 版本切分建议

### v1：PG + 时间戳 + schema，已完成

范围：

- PG 连接和迁移。
- PG schema baseline。
- DB-level `created_at/updated_at`。
- soft delete partial unique index。
- seed 跑通。

遗留：

- 兼容 client 名称仍叫 `sqlite`。
- route-local SQL 仍多。
- 审计字段未统一写入。

### v2：CRUD factory 试点，已完成

范围：

- `createCrudRoutes`。
- Drizzle list query。
- 字典/配置/部门模块迁移。
- 权限 fail-fast。
- `admin:check-routes` 扩展。
- CRUD factory 统一写入 `created_by/updated_by/deleted_by`。
- 字典页面 URL 状态和字典项标题契约补齐。

不做：

- 用户/角色复杂模块一次性迁完。
- 文件模块重构。

### v3：系统模块事务型迁移，下一步

范围：

- 菜单、角色、用户、文件逐步迁移到 CRUD factory + custom routes。
- 为角色/用户这类跨表写入增加事务型 hook，或继续保留显式 route。
- 系统内置记录保护，例如 `is_system` 或 hard-coded protected IDs。

### v4：增强能力

范围：

- 文件模块 PG 化和更完整元数据。
- 导入/导出。
- 数据权限。
- 字典/配置缓存失效。
- 轻量 generator。

## 12. 关键取舍说明

### 为什么不是继续 SQLite 开发，生产再 PG

因为当前迁移要解决的问题恰好都是数据库行为：

- timestamp trigger。
- partial unique index。
- 外键和索引。
- SQL 方言。
- Drizzle PG schema。

继续 SQLite 开发会让问题延迟到上线前暴露，反而降低开发体验。

### 为什么不是新增 Repository/DAO

用户的目标是降低重复 CRUD，不是把调用链变长。当前 route 已经很轻，前端也已经抽象。更合适的是：

```text
普通 CRUD -> createCrudRoutes
复杂业务 -> 明确 route + 小 service/helper
数据库访问 -> Drizzle query builder
```

这样既减少重复，又不会让开发者为了改一个字段在四五层之间跳转。

### 为什么 CRUD factory 要接 table object，不接 table name

接 table name 虽然最简单，但会丢掉类型：

- 字段名无法由 TypeScript 保护。
- PG 迁移后 SQL 方言风险更大。
- 权限、搜索、排序、insert/update 字段映射会继续靠字符串约定。

接 Drizzle table object 可以保留字段类型和列对象，适合长期迭代。

### 为什么 `updated_at` 放数据库，不放代码

代码写 `updated_at` 在小项目里可行，但本项目已经有：

- seed。
- 迁移脚本。
- route-local SQL。
- 后续导入导出。
- 未来可能的后台任务。

只要有一个路径漏写，时间就不可信。数据库 trigger 可以把这个规则统一兜住。

### 为什么软删除用 `deleted_at`，不是 `deleted`

`deleted_at` 的优点：

- 直接知道删除时间。
- 回收站排序自然。
- PG partial index 表达“未删除唯一”很清楚。
- null/非 null 语义简单。

`deleted` 字段适合 ContiNew 那种跨数据库统一逻辑删除，但我们当前 PG-first，不需要牺牲 PG 的优势。

### 为什么暂不直接上 RLS

RLS 很适合多租户和数据库直连场景，但当前 Admin Base 是 Hono 服务端访问数据库。功能权限先放在 Hono 中间件更直接，数据权限可以先做应用层 predicate。等确定 SaaS/tenant 后，再引入 `tenant_id + set_config + RLS` 更稳。

## 13. 完成标准

当前已经满足：

- 开发环境默认使用 PG。
- `DATABASE_URL` 是 PG 连接串。
- `created_at` / `updated_at` 是 `timestamptz`，并由数据库维护。
- 主数据表软删除使用 `deleted_at`。
- 软删除表的唯一约束不会阻止重新创建同名有效记录。
- 前端 `AdminDataTable` 不需要大改即可继续工作。
- 常规 CRUD 已在字典、配置、部门模块完成 factory 试点。
- 每个 CRUD action 都有服务端权限校验。
- 权限 seed 和 CRUD/meta 检查可自动发现遗漏。
- 审计字段由 CRUD factory 统一写入。
- route-local raw SQL 在试点模块明显减少。
- `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm admin:check-routes`、`pnpm build`、`pnpm e2e` 通过。

下一阶段完成时，应该满足：

- 菜单、角色、用户、文件中适合迁入 CRUD factory 的标准动作继续减少 route-local SQL。
- 对跨表事务模块给出明确事务型 hook 或显式 route 保留策略。
- 系统内置记录保护规则从 hard-coded ID 逐步收敛到统一 schema 或配置。
- `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm admin:check-routes`、`pnpm build` 通过；涉及前端时 `pnpm e2e` 通过。
