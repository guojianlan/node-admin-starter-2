# Admin Base 起手式完成方案

> 历史计划说明：本文记录 2026-06-22 时的范围决策，其中“代码生成器、AI、SMS 暂缓”等结论
> 已被后续实现取代。当前完成度以
> [`admin-base-framework-completion-status.md`](admin-base-framework-completion-status.md) 为准，新增模块
> 使用 [`business-module-template.md`](business-module-template.md) 和
> [`ai-development-guide.md`](ai-development-guide.md)。

> 创建日期：2026-06-22  
> 目标：把当前 Admin Base 从“基础后台已经可用”推进到“可以作为长期业务项目起手式”的完成状态。  
> 适用范围：后续实现、验收、任务拆分均以本文为主；长期背景参考 `docs/admin-base-technical-design.md`，PG/CRUD 迁移细节参考 `docs/admin-base-migration-optimization-plan.md`。

## 0. 本轮完成状态

截至 2026-06-22，本计划中的起手式必做项已经完成到代码、seed、页面和测试门禁：

- `sys_rule`、`sys_role`、`sys_user`、`sys_file` 已收敛到 CRUD factory + 必要 custom route。
- `sys_user`、`sys_role`、`sys_dept`、`sys_rule`、`sys_dict`、`sys_config_group`、`sys_config_items`、`sys_storage`、`sys_mail_account` 已加入 `is_system` 保护。
- 角色已支持 `data_scope` 和 `sys_role_dept`，用户/部门/角色关联用户列表已接入数据权限。
- 已新增 `sys_storage`，支持默认本地存储和 S3-compatible 配置、测试、上传/下载/删除 adapter。
- 文件表已补 `storage_id`、`type`、`sha256`、`metadata_json`、缩略图字段，上传时写入存储和元数据。
- 已新增 `sys_mail_account`，支持 SMTP 配置、启停、默认账号、测试发送、密码加密和响应脱敏。
- 用户导入/导出、generator、AI、SMS、定时任务、租户仍保持后置。

已验证：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm admin:check-routes
pnpm build
pnpm e2e
```

## 1. 最新决策

当前项目已经完成 Next.js + Hono + Drizzle + PostgreSQL + Ant Design 的基础闭环，但作为起手式还不够。后续范围调整如下：

| 能力                 | 新决策         | 说明                                                                                |
| -------------------- | -------------- | ----------------------------------------------------------------------------------- |
| 系统 CRUD 收敛       | 必做           | `sys_rule`、`sys_role`、`sys_user`、`sys_file` 继续迁到 CRUD factory + custom route |
| 系统内置数据保护     | 必做           | 超级管理员、内置角色、核心菜单权限、默认部门、默认存储等必须禁止误删                |
| 数据权限             | 必做           | 角色需要 `data_scope`，用户/部门/角色等列表要能按部门或本人范围过滤                 |
| 文件管理             | 必做增强       | 不只保留本地上传，还要补齐存储配置、文件元数据、回收站和安全限制                    |
| 多存储配置           | 必做           | 起手式应内置本地存储和 S3-compatible 存储配置能力                                   |
| 邮件配置             | 必做           | 起手式应能配置 SMTP、测试发送，并安全保存密钥                                       |
| 用户导入/导出        | 暂缓           | 不是当前起手式必需能力                                                              |
| 代码生成器           | 暂缓           | 等 CRUD 约定稳定后再做轻量 generator                                                |
| AI/SMS/定时任务/租户 | 不进核心起手式 | 作为后续插件或业务模块，不阻塞当前完成                                              |

## 2. 当前状态判断

| 区域                | 当前状态           | 后续判断                                                                |
| ------------------- | ------------------ | ----------------------------------------------------------------------- |
| PostgreSQL baseline | 已完成             | 保持 PG-first，不做 SQLite 兼容目标                                     |
| 前端 CRUD 组件      | 已完成             | 继续复用 `AdminDataTable`、`AdminEntityForm`、`AuthButton`              |
| 后端 CRUD factory   | 已完成试点         | 已覆盖 `dict`、`config`、`dept`，需要扩展到复杂系统模块                 |
| 权限 fail-fast      | 已完成基础         | 继续让 CRUD meta、seed、route manifest 一致性检查失败即报错             |
| 菜单权限页          | 可用但 route-local | 迁入 CRUD factory，并保留 tree/status/hidden 自定义接口                 |
| 角色页              | 可用但 route-local | 基础 CRUD 迁入 factory，`setRule`、关联用户保留显式事务接口             |
| 用户页              | 可用但 route-local | 基础 CRUD 迁入 factory，密码 hash、角色同步、超级管理员保护保留显式逻辑 |
| 文件页              | 已增强但仍偏单存储 | 补多存储、文件元数据、安全限制，再整理 route-local SQL                  |
| 数据权限            | 未做               | 作为起手式必做项                                                        |
| 邮件配置            | 未做               | 作为起手式必做项                                                        |
| 多存储配置          | 未做               | 作为起手式必做项                                                        |

## 3. 完成目标

起手式完成后应满足：

1. 新业务模块可以通过 Drizzle table object + Zod schema + CRUD factory 快速接入。
2. 每个受保护 API 都有服务端权限校验，新增权限漏 seed 会被 `pnpm admin:check-routes` 发现。
3. 用户、角色、菜单、部门、字典、配置、文件、存储、邮件这些基础系统能力可直接使用。
4. 数据权限可以在常规列表中生效，至少覆盖用户、部门、角色和后续业务模块的部门范围过滤。
5. 文件管理可以选择默认存储，支持本地和 S3-compatible 存储配置。
6. 邮件配置可保存、启停、设为默认，并能发送测试邮件。
7. 系统内置数据不会被误删或破坏关键字段。
8. `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm admin:check-routes`、`pnpm build` 通过；涉及页面时 `pnpm e2e` 通过。

## 4. 不做范围

当前起手式不做：

- 用户导入、导出、导入模板解析。
- 完整代码生成器。
- 多租户。
- AI 模块。
- SMS 模块。
- 定时任务。
- 完整通知中心。
- 邮件模板系统。
- 多存储迁移任务和对象复制任务。

这些能力可以在起手式稳定后作为插件或业务模块继续扩展。

## 5. 实施顺序

推荐按下面顺序做，避免先做增强模块时继续扩大旧 route-local 负担。

### Phase 1：系统 CRUD 收敛

目标：把当前最核心的系统模块收敛到同一套 CRUD 和权限模型。

1. 迁 `sys_rule` 到 CRUD factory。
2. 迁 `sys_role` 到 CRUD factory。
3. 迁 `sys_user` 到 CRUD factory。
4. 整理 `sys_file` 标准元数据 CRUD。
5. 扩展 CRUD factory 支持事务型 hooks、系统内置数据保护和更多 action。

验收：

- `sys_rule` 基础新增、更新、删除走 CRUD factory。
- `sys_rule/tree`、`sys_rule/parent`、`status`、`hidden` 保留显式 route。
- `sys_role` 基础 CRUD 走 factory；`setRule` 和关联用户继续显式事务接口。
- `sys_user` 基础 CRUD 走 factory；密码 hash、角色同步、重置密码继续显式逻辑。
- `sys_file` 元数据列表、软删除、恢复可复用通用能力；上传、下载、物理删除继续显式 route。
- route-local SQL 明显减少，复杂业务逻辑仍保持可读。

### Phase 2：系统内置数据保护

目标：参考 ContiNew 的 `is_system` 思路，但保持 TypeScript/PG 实现轻量。

建议 schema：

```text
sys_user.is_system boolean not null default false
sys_role.is_system boolean not null default false
sys_dept.is_system boolean not null default false
sys_rule.is_system boolean not null default false
sys_dict.is_system boolean not null default false
sys_config_group.is_system boolean not null default false
sys_config_items.is_system boolean not null default false
sys_storage.is_system boolean not null default false
sys_mail_account.is_system boolean not null default false
```

保护规则：

- `admin` 超级管理员不能删除、不能禁用、不能移除超级管理员角色。
- 超级管理员角色不能删除、不能禁用、不能清空权限。
- 核心菜单权限不能删除，关键字段如 `key`、`type` 应限制修改。
- 默认部门不能删除。
- 默认存储不能删除，至少要先切换默认存储。
- 默认邮件账号如果被业务引用，不能直接删除。
- `is_system = true` 的记录允许改显示名、排序、描述等非关键字段，但不能破坏运行必需字段。

验收：

- 删除或破坏内置数据时返回明确业务错误。
- 前端对内置数据隐藏危险操作或展示禁用态。
- 后端始终兜底，不能只靠前端按钮隐藏。

### Phase 3：数据权限

目标：功能权限和数据权限分离。功能权限控制能否访问接口；数据权限控制能看到哪些记录。

建议角色字段：

```text
sys_role.data_scope text not null default 'all'
```

建议角色部门范围表：

```text
sys_role_dept
  role_id integer not null
  dept_id integer not null
  primary key (role_id, dept_id)
```

建议 `data_scope` 枚举：

| 值                  | 含义                     |
| ------------------- | ------------------------ |
| `all`               | 全部数据                 |
| `custom_dept`       | 指定部门数据             |
| `current_dept`      | 当前用户所在部门         |
| `current_dept_tree` | 当前用户所在部门及子部门 |
| `self`              | 仅本人数据               |

实现方式：

- 登录或 `/system/info` 返回当前用户角色、部门和聚合后的数据权限。
- 后端新增 `resolveDataScope(ctx)`，根据当前用户角色计算最终范围。
- CRUD list config 支持 `dataScope` hook，把部门/本人过滤条件注入查询。
- 常规业务表如果有 `dept_id`、`created_by`、`owner_id` 等字段，可以声明如何应用数据权限。
- 超级管理员默认 `all`。

优先覆盖：

1. 用户列表：按用户 `dept_id` 或本人过滤。
2. 部门列表：按部门树过滤。
3. 角色关联用户：受数据权限影响。
4. 后续业务 CRUD：通过 factory 的 `dataScope` 配置接入。

暂不做：

- PG RLS。
- 多租户隔离。
- 复杂字段级权限。

验收：

- 普通角色配置为 `self` 时，只能看到本人相关数据。
- 配置为 `current_dept` 时，只能看到本部门数据。
- 配置为 `current_dept_tree` 时，可以看到本部门及子部门数据。
- 配置为 `custom_dept` 时，只能看到指定部门范围。
- API 和页面表现一致，不能只过滤前端。

### Phase 4：多存储配置

目标：文件管理不再只依赖本地路径，而是通过存储配置选择默认存储。

建议新增表：

```text
sys_storage
  id serial primary key
  name text not null
  code text not null
  type text not null              -- local | s3
  endpoint text
  region text
  bucket text
  access_key text
  secret_key_encrypted text
  base_url text
  root_path text
  is_default boolean not null default false
  status integer not null default 1
  sort integer not null default 0
  options_json text
  is_system boolean not null default false
  created_at / updated_at / deleted_at
  created_by / updated_by / deleted_by
```

文件表建议补充：

```text
sys_file.storage_id integer references sys_storage(id)
sys_file.type text                  -- image | video | audio | document | archive | other
sys_file.sha256 text
sys_file.metadata_json text
sys_file.thumbnail_path text
sys_file.thumbnail_url text
```

存储类型：

- `local`：默认启用，落到 `storage/uploads`。
- `s3`：S3-compatible，兼容 S3、R2、MinIO、OSS S3 协议网关等。

接口建议：

```text
GET    /api/system/storage
POST   /api/system/storage
PUT    /api/system/storage/:id
DELETE /api/system/storage/:id
PUT    /api/system/storage/status/:id
PUT    /api/system/storage/default/:id
POST   /api/system/storage/test
```

权限建议：

```text
system.storage.query
system.storage.create
system.storage.update
system.storage.delete
system.storage.status
system.storage.setDefault
system.storage.test
```

文件策略配置项（上传、预览、回收站和去重策略；默认存储由“存储配置”维护）：

```text
file.max_upload_size_mb
file.allowed_extensions
file.denied_extensions
file.public_base_url
file.preview_max_size_mb
file.trash_retention_days
file.enable_sha256_dedupe
```

验收：

- 系统至少有一个默认本地存储。
- 可新增 S3-compatible 存储并测试连接。
- 上传文件时写入 `storage_id` 和完整元数据。
- 默认存储不能直接删除。
- 密钥类字段不在列表和详情中明文返回。

### Phase 5：文件管理增强

目标：文件管理成为起手式可用能力，而不是只满足 demo 上传。

保留：

- 文件夹管理。
- 文件上传。
- 列表、搜索、排序。
- 预览：图片、视频、音频、PDF、Word、Excel、文本。
- 下载。
- 软删除、恢复、永久删除。
- 浮动音频播放器。

增强：

- 存储配置驱动上传。
- `sha256` 计算和可选去重。
- 文件类型归类。
- 上传大小和扩展名限制。
- 回收站保留天数配置。
- 文件物理删除和 DB 永久删除保持一致。
- 下载和预览都要经过权限校验或签名策略。

验收：

- 本地存储上传、预览、下载、删除、恢复、永久删除全部可用。
- S3-compatible 至少完成配置、测试和上传路径设计；如果第一轮不接真实 S3，也要保留 adapter 边界。
- 文件列表能按类型、大小、上传人、删除状态过滤。
- `pnpm e2e` 覆盖上传、预览、删除、恢复的核心路径。

### Phase 6：邮件配置

目标：起手式具备基础 SMTP 配置和测试能力。

建议新增表：

```text
sys_mail_account
  id serial primary key
  name text not null
  code text not null
  host text not null
  port integer not null
  secure boolean not null default false
  username text
  password_encrypted text
  from_name text
  from_email text not null
  reply_to text
  is_default boolean not null default false
  status integer not null default 1
  sort integer not null default 0
  is_system boolean not null default false
  created_at / updated_at / deleted_at
  created_by / updated_by / deleted_by
```

接口建议：

```text
GET    /api/system/mail/account
POST   /api/system/mail/account
PUT    /api/system/mail/account/:id
DELETE /api/system/mail/account/:id
PUT    /api/system/mail/account/status/:id
PUT    /api/system/mail/account/default/:id
POST   /api/system/mail/account/test
```

权限建议：

```text
system.mail.query
system.mail.create
system.mail.update
system.mail.delete
system.mail.status
system.mail.setDefault
system.mail.test
```

实现要求：

- 密码加密保存，不明文写入 DB。
- 列表和详情不返回明文密码，只返回是否已配置。
- 测试发送只允许有权限的管理员操作。
- 默认邮件账号不能直接删除，需要先取消默认或切换默认。

暂不做：

- 邮件模板管理。
- 邮件队列。
- 发送日志大屏。
- 多通道通知中心。

验收：

- 可以保存 SMTP 配置。
- 可以发送测试邮件。
- 错误信息能区分认证失败、连接失败、收件地址错误。
- 密钥不出现在前端响应、日志和测试输出中。

### Phase 7：质量门禁和文档同步

每个阶段完成后至少跑：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm admin:check-routes
pnpm build
```

涉及前端页面时加跑：

```bash
pnpm e2e
```

文档同步要求：

- `README.md` 保持启动、默认账号、核心模块和文档入口准确。
- `docs/admin-base-migration-optimization-plan.md` 保持当前实现状态准确。
- 新增权限时必须同步 seed 和 `admin:check-routes` 检查。
- 新增系统模块时必须说明是否进入起手式核心，还是插件/业务模块。

## 6. 推荐任务切分

### Sprint 1：系统 CRUD 和保护

- 扩展 CRUD factory：事务 hooks、保护 hooks、更多 action meta。
- 迁 `sys_rule`。
- 迁 `sys_role`。
- 迁 `sys_user`。
- 加 `is_system` 字段和 seed。
- 补保护规则测试。

完成标准：

- 用户/角色/菜单三大核心模块保持现有页面能力。
- 内置记录无法被破坏。
- route-local SQL 明显减少。
- 所有权限检查通过。

### Sprint 2：数据权限

- 加 `sys_role.data_scope`。
- 加 `sys_role_dept`。
- 后端实现 `resolveDataScope`。
- CRUD factory 支持 `dataScope` hook。
- 角色页支持配置数据范围。
- 用户/部门/角色列表应用数据权限。

完成标准：

- `all`、`custom_dept`、`current_dept`、`current_dept_tree`、`self` 都有测试覆盖。
- 普通用户 API 返回数据被真实过滤。

### Sprint 3：存储配置和文件增强

- 加 `sys_storage`。
- 增加存储配置页面。
- 本地存储 adapter 标准化。
- 设计 S3-compatible adapter。
- 文件表补 `storage_id`、`sha256`、`type`、`metadata_json`。
- 文件上传、列表、回收站按新模型整理。

完成标准：

- 默认本地存储可用。
- 存储配置权限完整。
- 文件上传和预览不回退。

### Sprint 4：邮件配置

- 加 `sys_mail_account`。
- 增加邮件配置页面。
- 实现 SMTP 测试发送。
- 密钥加密和脱敏。
- 默认邮件账号保护。

完成标准：

- 可配置 SMTP。
- 测试发送可用。
- 密钥不泄漏。

## 7. 最终完成标准

可以认为起手式完成的条件：

- 新项目 clone 后按 README 可启动。
- 默认 PG schema 和 seed 可一键初始化。
- 登录、菜单、权限、数据权限、用户、角色、菜单权限、部门、字典、配置、文件、存储、邮件全部可用。
- 常规 CRUD 新模块有清晰模板，不需要复制大量 route-local SQL。
- 内置数据有后端保护。
- 文件管理可配置默认存储。
- 邮件配置可测试。
- 用户导入/导出、generator、AI、SMS、租户明确后置，不影响起手式交付。
