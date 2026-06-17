# Admin Base 迁移优化方案

> 最后核对：2026-06-16  
> 目标：把当前 SQLite/手写 SQL 的 Admin Base，迁移成以 PostgreSQL 为主、CRUD 可持续迭代、权限清晰、开发体验轻的后台基座。  
> 边界：本文是本次迁移版本的执行方案，不替代 `docs/admin-base-technical-design.md` 的整体产品/技术设想。

## 1. 一句话结论

本项目现在已经有一套可用的后台雏形：Next.js + Hono + Drizzle schema + SQLite + Ant Design，前端 CRUD 组件抽象已经比较完整，后端列表查询有 `buildListQuery`，但新增、修改、删除大多仍散落在各 route 文件中用原生 SQL 完成。下一版本应该优先做三件事：

1. 数据库从 SQLite 切到 PostgreSQL，并把 `created_at` / `updated_at` / `deleted_at` 设计成数据库级语义。
2. 用 Drizzle `pgTable` table object + Zod schema + 权限配置做轻量 CRUD factory，不新增 Repository/DAO 这类厚层。
3. 把 CRUD 权限作为 factory 的必填配置，做到“每个启用动作都有服务端权限校验”，同时继续复用现有 `AdminDataTable` 和 `AuthButton`。

推荐方向是 **PG-first，不做 SQLite 兼容层，不为了将来可能的 MySQL 现在就抽双方言层**。如果以后确实要 MySQL，可以再针对 MySQL 做一轮 schema/迁移适配；当前为了迭代效率和类型清晰，先把 PostgreSQL 做对。

## 2. 当前实现快照

本节来自当前代码核对，而不是理想方案。

### 2.1 数据库与迁移

当前数据库入口：

- `src/server/db/index.ts`
- `src/server/db/schema/index.ts`
- `src/server/db/migrations.ts`
- `drizzle.config.ts`
- `scripts/db-migrate.ts`
- `scripts/db-reset.ts`

现状：

- ORM schema 使用 `drizzle-orm/sqlite-core` 的 `sqliteTable`。
- 运行库使用 `better-sqlite3`，默认数据库文件是 `data/admin-base.sqlite`。
- `DATABASE_URL` 现在只被当作 SQLite 文件路径处理，不是 PostgreSQL 连接串。
- `drizzle.config.ts` 当前 `dialect: "sqlite"`。
- 迁移不是 Drizzle 生成的 SQL 文件，而是 `src/server/db/migrations.ts` 中手写 SQL 数组。
- Hono app 启动时会执行 `runMigrations(sqlite)`。
- 本地 `data/admin-base.sqlite` 已应用 `0001_initial`、`0002_rule_form_fields`、`0003_file_group_tree_fields`。

当前 Drizzle schema 里公共时间戳是：

```ts
const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};
```

也就是说，现在的时间字段只是文本列，数据库没有默认值，也没有自动维护 `updated_at`。

### 2.2 时间戳

当前 `created_at` / `updated_at` 的来源是应用层：

- `src/server/db/index.ts` 暴露 `nowIso()`。
- `nowIso()` 返回 `new Date().toISOString()`。
- 各 route 在 `INSERT` 时手动写 `created_at` 和 `updated_at`。
- 各 route 在 `UPDATE` / 软删除时手动写 `updated_at`。
- `src/server/db/seed/seed.ts` 也有一份本地 `nowIso()`。

结论：

- 当前不是数据库自动时间戳。
- 当前不是 Drizzle 自动时间戳。
- 当前是 route/seed 代码手动维护 UTC ISO 字符串。

### 2.3 软删除

当前软删除是选择性存在：

| 表                                | 当前删除策略                                    |
| --------------------------------- | ----------------------------------------------- |
| `sys_user`                        | `deleted_at` 软删除                             |
| `sys_role`                        | `deleted_at` 软删除                             |
| `sys_dept`                        | `deleted_at` 软删除                             |
| `sys_dict`                        | `deleted_at` 软删除                             |
| `sys_dict_item`                   | `deleted_at` 软删除                             |
| `sys_config_group`                | `deleted_at` 软删除                             |
| `sys_config_items`                | `deleted_at` 软删除                             |
| `sys_file`                        | `deleted_at` 软删除，且已有回收站/恢复/永久删除 |
| `sys_rule`                        | 硬删除                                          |
| `sys_file_group`                  | 硬删除                                          |
| `sys_user_role` / `sys_role_rule` | 关联表硬删除                                    |
| `sys_access_token`                | 登出时硬删除                                    |
| `sys_login_record`                | 日志只插入，不软删除                            |

当前问题：

- 软删除表的唯一索引仍是普通 unique，例如 `sys_user.username`，软删后也无法重新创建同名用户。
- `sys_rule` 是核心菜单权限表，当前硬删除风险偏高。
- `sys_file_group` 是用户可维护树结构，当前硬删除可以接受，但如果后续要回收站或审计，也需要纳入软删除策略。

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
- 用户/角色这种需要同步关联表的操作已经用 SQLite transaction 包起来。
- 复杂业务如文件上传、角色分配、重置密码没有被强行塞进通用函数。

当前 route 的问题：

- 原生 SQL 重复，字段映射重复，时间戳重复。
- `buildListQuery` 仍然接收字符串 table/select/fieldMap，类型不强。
- `baseWhere` 有拼接字符串，例如 `sur.role_id = ${roleId}`，短期可控，但不是长期基座应该保留的模式。
- SQLite `GROUP_CONCAT`、`INSERT OR IGNORE`、`?` 占位等细节会卡住 PG 迁移。
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

因此本次迁移不建议重做前端 CRUD 层。重点应该放在后端 CRUD factory 和 PG schema。

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

本版本建议直接切 PG：

- 开发环境也用 Docker PG，不再继续以 SQLite 为主开发库。
- `DATABASE_URL` 变成标准 PG 连接串。
- Drizzle schema 从 `sqlite-core` 改为 `pg-core`。
- `drizzle.config.ts` 改为 `dialect: "postgresql"`。
- 迁移使用 Drizzle Kit 生成 SQL 文件，再补少量手写 SQL，例如 trigger、comment、特殊 index。

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

| 来源                    | 已吸收的优势                                                                                                                     | 不吸收的部分                                                                                                         | 落到本项目的设计                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `tmp/xin-admin-laravel` | 菜单/路由/action 合一的 `sys_rule` 权限模型、token abilities、列表搜索/排序/分页模式、列配置驱动表格和表单、Ant Design 后台交互  | Laravel 控制器/模型结构、XinTable/XinForm 组件 API、参考项目里不一致的字段和路由细节                                 | `sys_rule` + `sys_role_rule`、`ability()`、`buildListQuery`、`AdminDataTable`、`AdminEntityForm`、`AuthButton`                              |
| `tmp/continew-admin`    | 声明式 CRUD API、CRUD 动作推导权限、审计字段、角色数据权限、系统内置记录保护、代码生成器、文件元数据增强、字典/菜单/权限缓存意识 | Java Controller/Service/Mapper 层级、MyBatis Plus 逻辑删除实现、为了跨库牺牲 PG 能力的索引策略、一次性完整 generator | `createCrudRoutes`、`permissions.prefix + action map`、`timestamps + auditUsers + softDelete`、PG partial unique index、轻量 generator 预留 |
| 本项目当前实现          | Next.js + Hono 单仓、前端 CRUD 组件已经成型、权限中间件可用、route-local 业务逻辑清晰                                            | SQLite 作为主库、route 内重复 raw SQL、应用层手写时间戳、权限与 CRUD 未统一声明                                      | PG-first schema、数据库级时间戳、Drizzle table object CRUD factory、权限 fail fast、自定义 route 保留复杂业务                               |

结论：

- XinAdmin 提供产品结构和前端 CRUD 体验参考。
- ContiNew 提供工程化 CRUD、权限、审计、数据权限和 generator 参考。
- 本项目采用轻量 TypeScript 实现，不复制任一参考项目的后端分层。

## 10. 迁移实施步骤

### Phase 0：冻结当前事实

目的：先避免迁移时不知道改坏了哪里。

任务：

- 保留当前 SQLite 数据库只读备份。
- 记录当前默认账号、角色、权限种子。
- 跑一遍当前 `pnpm test`、`pnpm admin:check-routes`，记录基线。
- 确认哪些本地 dirty change 属于正在开发的文件，避免迁移时误覆盖。
- `admin:check-routes` 只校验内部页面路由；`link = 1` 或 `http(s)://` 外链菜单不要求存在于前端 route manifest。

输出：

- 当前 schema 快照。
- 当前 API 清单。
- 当前权限 action 清单。

### Phase 1：PG 基础设施

任务：

- 增加 PG driver，例如 `postgres` 或 `pg`，并用 Drizzle PG adapter。
- 修改 `src/server/db/index.ts`，让 `DATABASE_URL` 使用 PG 连接串。
- 修改 `drizzle.config.ts` 为 `dialect: "postgresql"`。
- 增加 `.env.example`：

```text
DATABASE_URL=postgres://admin_base:admin_base@localhost:5432/admin_base
```

- `scripts/db-migrate.ts` 改成执行 PG migrations。
- `scripts/db-reset.ts` 改成 PG 下 drop/recreate schema 或 truncate + seed。
- 保留 SQLite 代码到迁移完成前的分支即可，不建议长期双轨。

验收：

- 空 PG 可以 migration。
- 空 PG 可以 seed。
- `/api/health` 正常。

### Phase 2：PG schema baseline

任务：

- 将 `src/server/db/schema/index.ts` 拆成多个 PG schema 文件。
- 把 `text created_at/updated_at` 改成 `timestamptz`。
- 增加 `deleted_at`、`created_by`、`updated_by`、`deleted_by`。
- 增加外键和索引。
- 把软删除唯一约束改成 partial unique index。
- 增加 `set_updated_at()` trigger SQL。
- Seed 写入时不再手动写普通时间戳，除非需要固定历史时间。

验收：

- Drizzle schema 和生成 SQL 可以落库。
- `sys_rule` action 权限完整。
- 软删后可以创建同 code/username 的新记录。
- UPDATE 后 `updated_at` 自动变化。

### Phase 3：迁移现有数据

当前项目仍是开发期，优先建议 reset + seed：

- 如果当前 SQLite 数据只是测试数据：直接 PG reset + seed。
- 如果需要保留本地数据：写一次性迁移脚本，SQLite 读出 -> 字段转换 -> PG insert。

字段转换重点：

- ISO string -> `timestamptz`。
- 缺失 `deleted_at` 的表补 null。
- 新增 `created_by/updated_by/deleted_by` 默认 null 或 1。
- SQLite 自增 ID 可以保留，导入后同步 PG sequence。

导入后必须校验：

- 用户、角色、权限关系数量。
- 菜单树数量。
- 权限 action 数量。
- 字典项数量。
- 文件元数据与 `storage/uploads` 文件是否对应。

### Phase 4：CRUD factory 试点

先选低风险模块：

1. `sys_dict`
2. `sys_dict_item`
3. `sys_config_group`
4. `sys_config_items`

原因：

- 结构简单。
- 现在已经是标准 CRUD。
- 能验证 list/search/sort/create/update/delete/permission 的完整闭环。

试点完成后再迁：

1. `sys_dept`
2. `sys_rule`
3. `sys_role`
4. `sys_user`
5. `sys_file`

每迁一个模块，保留该模块自定义接口，不强行抽象。

### Phase 5：权限和 seed 完善

任务：

- 定义 CRUD action 到权限码的标准映射。
- 扩展 `admin:check-routes`，校验 CRUD definitions 的权限码存在于 `sys_rule`。
- 增加开发期启动校验：enabled action 必须有权限配置。
- 确认字典公共接口、健康检查、登录等例外都显式标记。
- 确认外链菜单继续只作为菜单数据存在，不参与前端内部 route manifest 校验。
- 角色授权页能看到新增 action。

验收：

- 普通用户无权限访问 CRUD API 返回 403。
- 普通用户无权限时前端按钮不显示。
- 超级管理员仍拥有全部启用 action。
- 新增 CRUD 模块时，漏 seed 会在检查命令中失败。

### Phase 6：质量门禁

建议迁移版本完成时至少跑：

```bash
pnpm typecheck
pnpm test
pnpm admin:check-routes
pnpm lint
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

### v1：PG + 时间戳 + schema

范围：

- PG 连接和迁移。
- PG schema baseline。
- DB-level `created_at/updated_at`。
- soft delete partial unique index。
- seed 跑通。

不做：

- 全部 route 重构。
- 数据权限。
- generator。

### v2：CRUD factory 试点

范围：

- `createCrudRoutes`。
- Drizzle list query。
- 字典/配置模块迁移。
- 权限 fail-fast。
- `admin:check-routes` 扩展。

不做：

- 用户/角色复杂模块一次性迁完。
- 文件模块重构。

### v3：系统模块迁移

范围：

- 部门、菜单、角色、用户迁移到 CRUD factory + custom routes。
- 审计字段写入。
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

本迁移版本完成时，应该满足：

- 开发环境默认使用 PG。
- `DATABASE_URL` 是 PG 连接串。
- `created_at` / `updated_at` 是 `timestamptz`，并由数据库维护。
- 主数据表软删除使用 `deleted_at`。
- 软删除表的唯一约束不会阻止重新创建同名有效记录。
- 常规 CRUD 至少在字典/配置模块完成 factory 试点。
- 每个 CRUD action 都有服务端权限校验。
- 权限 seed 和 CRUD/meta 检查可自动发现遗漏。
- 前端 `AdminDataTable` 不需要大改即可继续工作。
- `pnpm typecheck`、`pnpm test`、`pnpm admin:check-routes` 通过。
