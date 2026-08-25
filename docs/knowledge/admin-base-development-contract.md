# Admin Base 开发契约

## 新模块交付链路

一个可访问的业务模块通常需要同时接入 Drizzle schema、数据库 migration、`sys_rule` 权限 seed、后端路由、服务端 ability、数据范围、操作日志、前端路由清单、App Router 薄壳、`src/features/**` 页面、API 测试和页面验收清单。

普通 CRUD 优先通过模块生成器生成草稿。草稿必须先预览 diff 和验证，发布后源码归仓库所有。复杂关系、树结构、状态机、主从事务和非 system 域模块需要显式设计，不能强行塞进生成器。

## 权限与数据范围

权限码使用 `<domain>.<resource>.<action>`。前端 `AuthButton` 只控制可见性，后端仍必须使用 `authRequired()` 和 `ability(code)`。角色权限或数据范围改变后，应按业务风险撤销受影响用户的旧 Token。

用户生成的业务数据默认不能视为全局数据。部门数据在服务端创建时写入 `deptId`，用户数据写入 `ownerId`，列表和单条写操作都必须验证范围。跨部门读取、更新和删除应有自动化测试。

## 验证命令

迭代时使用最小完整验证：

```bash
pnpm admin:verify --quick
pnpm admin:verify --module <module-name>
pnpm admin:verify --full
pnpm admin:verify --full --smoke
```

普通验证不得运行 `db:reset`。Smoke 只在安全运行环境和明确凭据下执行。外部 S3、SMTP、OAuth、SMS 和 AI Provider 验收要区分本地模拟与真实 Provider 证据。
