# Admin Base 启动脚手架维护规范

> 目标：让启动相关内容可持续维护。后续如果继续补配置项、脚本、Docker、部署说明或排查项，都按本文归档，避免 README、启动说明和计划文档互相重复。

## 1. 文档分工

启动脚手架相关内容固定分为四层：

| 文件                                              | 维护内容                                                           | 不应该放什么                     |
| ------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------- |
| `README.md`                                       | 最短启动入口、核心命令、默认账号、关键文档链接                     | 大段排查、完整配置说明、长期计划 |
| `docs/admin-base-startup-guide.md`                | 当前已经可执行的源码启动步骤、环境变量说明、数据库初始化、常见问题 | 尚未实现的脚本和未来设想         |
| `docs/admin-base-quick-start-framework-plan.md`   | 启动脚手架后续计划、缺口、优先级、完成度判断                       | 具体命令细节和排查长文           |
| `docs/admin-base-startup-scaffold-maintenance.md` | 如何维护这些启动内容、如何新增项、验收规则                         | 单次问题排查记录                 |

规则：

- 已经能跑的内容写进 `startup-guide`。
- 还没做但确定要做的内容写进 `quick-start-framework-plan`。
- 只需要用户第一眼看到的内容才放进 `README`。
- 维护方法、变更模板、验收清单放进本文。

## 2. 新增内容放哪里

新增启动相关内容时，先按下面分类：

| 新增内容         | 维护位置                                                      | 是否需要改代码 |
| ---------------- | ------------------------------------------------------------- | -------------- |
| 新的必填环境变量 | `.env.example`、`startup-guide`、必要时 `doctor`              | 通常需要       |
| 新的可选环境变量 | `.env.example`、`startup-guide`                               | 视情况         |
| 新的启动命令     | `package.json`、`README`、`startup-guide`                     | 需要           |
| 数据库初始化变化 | migration/seed、`startup-guide`、`quick-start-framework-plan` | 需要           |
| 破坏性命令       | `startup-guide` 明确风险，README 只保留短提示                 | 可能需要       |
| Docker 本地依赖  | `docker-compose.yml`、`startup-guide` 的 Docker 小节          | 需要           |
| 生产部署要求     | 新增或更新部署文档，README 只链接                             | 可能需要       |
| 常见启动错误     | `startup-guide` 的排查小节                                    | 不一定         |
| 未来想法         | `quick-start-framework-plan`                                  | 不需要         |

## 3. 环境变量维护规则

新增环境变量时必须同时回答四个问题：

1. 是否启动必需。
2. 是否只在生产必需。
3. 是否能安全提供开发默认值。
4. 改动后是否影响已保存数据。

环境变量分层：

- 启动必需：`DATABASE_URL`、`ADMIN_BASE_SECRET_KEY`。
- 启动可选：`NEXT_PUBLIC_API_BASE_URL`、`DATABASE_POOL_SIZE`、`ADMIN_BASE_TOKEN_TTL_DAYS`。
- 后台配置项：SMTP、S3、本地存储、文件策略。这些不优先放到 `.env`，因为系统里已经有配置页面。

敏感配置规则：

- `ADMIN_BASE_SECRET_KEY` 改动会影响已保存的 SMTP 密码和 S3 Secret 解密。
- 生产环境不能使用示例密钥。
- 如果后续新增 `ADMIN_BASE_ADMIN_PASSWORD`，只应在首次 seed 时生效，不能覆盖已存在管理员密码。

## 4. 脚本维护规则

启动脚本按风险分层：

| 脚本                                    | 定位                 | 是否可自动修改数据                 |
| --------------------------------------- | -------------------- | ---------------------------------- |
| `pnpm db:migrate`                       | 执行数据库结构迁移   | 是，但不应清空业务数据             |
| `pnpm db:seed`                          | 补齐默认数据         | 是，但不应覆盖用户配置             |
| `pnpm db:reset`                         | 完全重置开发库       | 是，破坏性                         |
| `pnpm setup`                            | 后续可做的一键初始化 | 是，但只能做 migrate/seed/目录创建 |
| `pnpm run doctor` / `pnpm admin:doctor` | 环境和基础数据检查   | 否                                 |

新增脚本时必须写清：

- 适用场景。
- 是否破坏数据。
- 是否可在生产运行。
- 成功输出是什么。
- 失败时用户下一步应该看哪里。

## 5. 启动脚手架待办池

后续想继续完善启动脚手架，优先从这个池子取：

| 优先级 | 项目                                    | 状态   | 目标                                       |
| ------ | --------------------------------------- | ------ | ------------------------------------------ |
| P0     | 源码启动文档                            | 已完成 | 不依赖 Docker，源码直接跑通                |
| P0     | README 5 分钟启动路径                   | 已完成 | 第一屏给出最短启动命令                     |
| P0     | `db:reset` 风险说明                     | 已完成 | 避免误清本地配置                           |
| P1     | `ADMIN_BASE_ADMIN_PASSWORD`             | 已完成 | 首次 seed 可配置管理员初始密码             |
| P1     | 生产环境密钥校验                        | 已完成 | 生产不能使用默认 `ADMIN_BASE_SECRET_KEY`   |
| P1     | `pnpm run doctor` / `pnpm admin:doctor` | 已完成 | 只检查不修改，输出环境健康状态             |
| P1     | `GET /api/ready`                        | 已完成 | 判断 DB、默认数据、默认存储是否可用        |
| P2     | `pnpm setup`                            | 待做   | 一键执行 migrate、seed、目录创建和结果提示 |
| P2     | 可选 `docker-compose.yml`               | 待做   | 提供 PostgreSQL/Mailpit 本地依赖           |
| P2     | 安全 E2E 命令                           | 待做   | 避免默认 E2E 清空本地配置                  |
| P3     | 生产部署文档                            | 待做   | build/start、迁移、持久化、反代说明        |
| P3     | Dockerfile                              | 待做   | 用于生产镜像，不替代源码启动               |

## 6. 每次改动的验收清单

只改文档：

```bash
pnpm exec prettier --check README.md docs/*.md
git diff --check
```

改环境变量、seed、启动脚本：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm admin:check-routes
```

改启动或数据库初始化：

```bash
pnpm db:migrate
pnpm db:seed
pnpm dev
curl http://localhost:3000/api/health
curl http://localhost:3000/api/ready
```

注意：

- 不要把 `pnpm e2e` 当成普通启动验收，因为当前 Playwright 配置会执行 `pnpm db:reset`。
- 如果后续补了不清库的 E2E 命令，再把它加入常规验收。

## 7. 新增项模板

后续如果你觉得“启动脚手架还要加一个东西”，可以按这个模板放进 `quick-start-framework-plan` 或本文待办池：

```text
项目：
为什么需要：
使用场景：
是否阻塞源码启动：
是否修改数据：
是否生产可用：
涉及文件：
验收命令：
```

判断标准：

- 会影响第一次启动的，优先级至少 P1。
- 只提升排查效率的，通常是 P1 或 P2。
- 只服务部署或团队规范的，通常是 P2 或 P3。
- 只服务未来生成模块的，不要混进启动主流程。

## 8. 当前维护结论

当前阶段继续以源码启动为主：

```bash
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Docker 可以做，但只能作为“本地依赖可选方案”。真正要继续完善的是配置安全、健康检查、初始化脚本和不破坏本地数据的验证路径。
