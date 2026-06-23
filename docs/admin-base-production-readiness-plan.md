# Admin Base 生产级对齐路线

> 当前核对：2026-06-23  
> 目标：明确当前小版本之后，Admin Base 要补哪些能力，才能从“可用起手式”推进到“生产级快速开发框架”。  
> 对齐对象：`xin-admin/xin-admin-laravel` 与 `ContiNew Admin`。只对齐能力和工程标准，不复制代码和框架结构。

## 1. 一句话结论

当前 Admin Base 已经完成一个可用小版本：核心系统管理、权限、数据权限、文件、存储、邮件、登录日志、在线会话、个人中心、通知公告、React Query 请求层和后台 UX 已经闭环。

距离生产级还有五类关键缺口：

1. 安全默认值：生产密钥、管理员初始密码、CORS、验证码和更完整的生产密码策略。
2. 可诊断性：`pnpm run doctor`、`GET /api/ready`、结构化日志、操作日志、错误追踪。
3. 发布治理：非破坏性 E2E、CI、迁移策略、备份恢复、部署文档。
4. 开发效率：业务模块模板、CRUD generator、OpenAPI/API 文档、权限 seed 自动化。
5. 框架边界：插件/后置模块边界、示例模块整理、未来多租户/任务调度/导入导出的取舍。

## 2. 当前生产级状态

| 领域         | 当前状态                                                   | 生产级判断                                |
| ------------ | ---------------------------------------------------------- | ----------------------------------------- |
| 核心后台模块 | 用户、角色、菜单、部门、字典、配置、文件、存储、邮件、登录日志、在线会话、通知公告已完成 | 可用                                      |
| 权限         | `sys_rule` + token abilities + `ability()` + `AuthButton`  | 可用，操作日志已完成第一版                |
| 数据权限     | `data_scope` + `sys_role_dept` + service 过滤              | 可用，需补更多业务模板示例                |
| CRUD 工程化  | Drizzle table + Zod + CRUD factory + route check           | 可用，需补 generator                      |
| 启动         | 源码启动文档、doctor、ready 已完成第一版                   | 可用，需补 setup                          |
| 数据库       | PostgreSQL-first、migration、seed                          | 可用，需补发布迁移规范和备份恢复          |
| 安全         | 密码 hash、token hash、密钥加密、系统数据保护、安全/登录/token 策略、登录验证码、忘记密码重置 | 基础可用，生产默认值需继续强化            |
| 文件         | 本地/S3-compatible、策略、元数据、预览、扩展名/MIME 基础校验 | 基础可用，需补病毒扫描/内容安全策略可选项 |
| 邮件         | SMTP 配置、默认账号、测试发送                              | 可用，需补模板/业务发送 API 规范          |
| 可观测性     | health、ready、doctor、Pino 请求日志、操作日志第一版       | 基础可用，需补错误追踪和外部观测平台      |
| 部署         | build/start 命令存在                                       | 不足                                      |
| CI/CD        | 无                                                         | 不足                                      |

## 3. 两个参考框架的对齐策略

### 3.1 XinAdmin / xin-admin-laravel

参考价值：

- 权限管理、数据字典、CRUD 表格、系统日志等后台基础能力。
- React + Ant Design 的后台交互模式。
- 前后端分离和快速开发体验。

我们已经对齐：

- `sys_rule` 菜单/路由/action 权限模型。
- `sys_role_rule`、token abilities、`ability()`。
- `AdminDataTable`、`AdminEntityForm`、`AuthButton`。
- 字典、配置、用户、角色、菜单权限、文件、登录日志、在线用户、通知公告等系统管理页面。

还需要补齐：

- 更完整的 API 文档和部署文档。
- 更稳定的快速启动和初始化体验。
- 导入/导出按需后置，不进入当前核心主路径。

### 3.2 ContiNew Admin

参考价值：

- 高质量后台工程化、Starter 组件、CRUD 套件、代码生成器。
- 系统内置数据保护、数据权限、多租户和插件模块化思路。
- 更完整的生产工程治理：文档、规范、质量门禁、持续迭代。

我们已经对齐：

- `is_system` 系统记录保护。
- `data_scope` 数据权限。
- CRUD factory。
- 存储/邮件配置作为基础系统能力。
- 登录日志、在线会话、个人中心、安全策略和通知公告作为后台框架基础能力。
- 登录验证码和忘记密码邮箱重置作为认证基础能力。
- 生成器、租户、定时任务作为后置或插件化能力。

还需要补齐：

- 代码生成器。
- 模块模板和插件边界。
- OpenAPI/接口文档。
- 生产部署、CI、备份恢复、可观测性。

## 4. 生产级里程碑

### P0：生产安全底座

目标：避免项目带着开发默认值上线。

任务：

1. 环境变量校验
   - `ADMIN_BASE_SECRET_KEY` 生产必填。
   - 生产环境禁止使用示例密钥。
   - `DATABASE_URL` 缺失时 fail-fast。
2. 管理员初始密码
   - 新增 `ADMIN_BASE_ADMIN_PASSWORD`。
   - 仅首次 seed 创建 admin 时生效。
   - 生产环境必须显式配置。
3. CORS 和安全响应头
   - 开发允许宽松 CORS。
   - 生产按 `ADMIN_BASE_ALLOWED_ORIGINS` 或同源限制。
   - 增加基础安全 header。
4. Token/session 策略，已完成第一版
   - 保持 token hash 存储。
   - 已记录 token IP、User-Agent、过期时间和最近活跃时间。
   - 已支持在线会话列表、强制下线、清理过期 token、重置/修改密码后撤销 token。
   - 已支持 `login.captcha_enabled` 控制登录验证码显示和后端校验。
   - 已支持忘记密码邮箱重置链接，重置 token 只保存 hash，并有过期和已使用状态。
5. 上传安全，已完成基础强化
   - 已强化常见 MIME/扩展名一致性校验。
   - 默认拒绝 SVG、HTML、脚本类文件。
   - 生产文档说明反向代理上传大小和对象存储权限。

验收：

```bash
NODE_ENV=production pnpm build
pnpm test
```

生产默认密钥或默认管理员密码缺失时，应有明确失败或警告策略。

### P1：可诊断和可运维

目标：启动失败、运行失败、配置错误都能快速定位。

任务：

1. `GET /api/ready`
   - 检查 DB 连接。
   - 检查 migration 表。
   - 检查默认管理员、默认角色、默认存储。
   - 返回 ready/warning/failed 明细。
2. `pnpm run doctor` / `pnpm admin:doctor`
   - 不修改数据。
   - 检查 Node、pnpm、DATABASE_URL、migration、seed、默认存储、默认邮件账号、密钥风险。
3. 结构化日志
   - Pino 已引入。
   - request id、user id、path、status、duration。
   - 生产环境输出 JSON。
4. 操作日志，已完成第一版
   - 已新增 `sys_operation_log`。
   - 已记录用户、IP、User-Agent、request id、模块、操作、资源、结果、耗时。
   - CRUD factory 已自动记录常规 create/update/delete/batchDelete/restore/forceDelete/status。
   - 登录/退出、存储、邮件、角色授权、菜单显隐/状态、配置保存、登录日志清理、强制下线、个人资料、通知发布/撤回等显式动作已接入。
   - 后续如新增高风险自定义 route，应继续显式接入操作日志。
5. 错误追踪接口
   - 保持对用户友好的错误响应。
   - 日志中保留 stack 和 request id。

验收：

```bash
pnpm run doctor
pnpm admin:doctor
curl http://localhost:3000/api/health
curl http://localhost:3000/api/ready
pnpm test
```

说明：`pnpm doctor` 是 pnpm 内置命令，不会执行项目脚本，因此本项目使用 `pnpm run doctor` 和 `pnpm admin:doctor`。

### P2：发布和验证治理

目标：上线流程可重复、可回滚、可验证。

任务：

1. 非破坏性 E2E
   - 新增不执行 `db:reset` 的 browser smoke。
   - 保留 destructive E2E 给隔离测试库。
2. CI
   - 安装依赖。
   - typecheck、lint、test、admin:check-routes、build。
   - 使用独立 PostgreSQL service。
3. 迁移发布策略
   - 生产只允许 `db:migrate`。
   - 禁止生产 `db:reset`。
   - 每次 schema 改动必须带 migration 和回滚/备份说明。
4. 部署文档
   - Node 运行方式。
   - 反向代理配置。
   - 本地存储持久化目录。
   - S3-compatible 推荐配置。
   - SMTP 配置注意事项。
5. 备份恢复
   - PostgreSQL 备份。
   - `storage/uploads` 或对象存储备份。
   - 恢复演练步骤。

验收：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm admin:check-routes
pnpm build
```

CI 必须能在干净环境跑通。

### P3：开发效率和框架能力

目标：新业务模块能稳定快速接入。

任务：

1. 业务模块模板文档
   - table schema。
   - Zod create/update schema。
   - CRUD factory route。
   - route manifest。
   - seed rule/action。
   - React feature page。
   - 数据权限接入。
2. 示例业务模块
   - 一个小而完整的业务 CRUD。
   - 包含列表、搜索、权限、数据权限、文件字段。
   - 生产 seed 默认隐藏或标记示例。
3. Generator 第一版
   - 从配置生成 schema/route/page/seed 草稿。
   - 只覆盖 80% 常规 CRUD，不追求一次生成复杂业务。
4. OpenAPI/API 文档
   - 从 route/Zod 或手写 manifest 生成接口文档。
   - 至少覆盖系统 API 和 CRUD factory API。
5. 权限/菜单检查增强
   - 检查前端 route manifest、seed rule、CRUD permission、页面权限按钮的一致性。

### P4：企业增强和插件化

目标：让核心起手式保持轻，重功能以插件或后置模块接入。

候选：

- 多租户。
- 任务调度。
- 用户导入/导出。
- 邮件模板。
- 通知中心。
- SMS。
- OAuth/第三方登录。
- AI 模块。

原则：

- 不影响当前核心启动路径。
- 不强制引入 Redis/队列/对象存储。
- 插件模块要有独立 route、seed、migration、测试和文档。

## 5. 技术栈演进建议

当前保持：

- Next.js + Hono 单应用。
- PostgreSQL-first。
- Ant Design + React Query + Zustand。
- Drizzle schema + 手写 migration。

建议新增：

| 能力               | 建议                                            |
| ------------------ | ----------------------------------------------- |
| 结构化日志         | Pino 已完成第一版                               |
| readiness          | Hono `/api/ready` 已完成第一版                  |
| 环境校验           | Zod env schema                                  |
| API 文档           | OpenAPI，优先从 Zod/route manifest 生成         |
| CI                 | GitHub Actions + PostgreSQL service             |
| 非破坏性浏览器检查 | Playwright 新增 smoke 项目或自定义脚本          |
| Docker             | 可选，先 Dockerfile，再 docker-compose 依赖服务 |

暂不建议：

- 为了未来兼容 MySQL 而牺牲 PG partial index 和 schema 简洁性。
- 在核心框架里强依赖 Redis、队列、租户。
- 先做复杂 generator，再补生产安全和运维能力。

## 6. 文档维护要求

后续生产级能力落地时同步维护：

| 改动类型       | 必改文档                                          |
| -------------- | ------------------------------------------------- |
| 技术栈变化     | `docs/admin-base-architecture.md`、`README.md`    |
| 启动变化       | `docs/admin-base-startup-guide.md`、`README.md`   |
| 生产级路线变化 | 本文                                              |
| 启动脚手架变化 | `docs/admin-base-startup-scaffold-maintenance.md` |
| CRUD/PG 变化   | `docs/admin-base-migration-optimization-plan.md`  |
| 起手式范围变化 | `docs/admin-base-starter-completion-plan.md`      |

每次完成一个生产级 milestone 后，更新本文对应状态为“已完成”，并写明验收命令。

## 7. 参考来源

- XinAdmin 官网：`https://xin-admin.github.io/`
- `xin-admin/xin-admin-laravel`：`https://github.com/xin-admin/xin-admin-laravel`
- ContiNew Admin：`https://github.com/continew-org/continew-admin`
