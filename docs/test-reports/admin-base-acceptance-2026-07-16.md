# Admin Base 验收执行记录 - 2026-07-16（2026-08-03 Package C 收口）

## 1. 执行信息

- 验收对象：截至 `dd58ab1` 的已推送实现及 `2026-08-03` Package C 工作树
- 分支：`codex/admin-base-migration-plan`
- 环境：local acceptance / production-mode precheck
- Node.js：`v24.14.0`
- pnpm：`10.33.0`
- PostgreSQL：`16.13`
- 开发数据库：`admin_base`
- 隔离测试数据库：`admin_base_test`
- 开始时间：`2026-07-16 17:29:40 CST`
- 收口复验时间：`2026-07-31 16:40 - 17:56 CST`
- 外部服务本地复验时间：`2026-08-03 CST`
- Package C 收口时间：`2026-08-03 CST`
- 执行方式：Codex 本机命令行、隔离 PostgreSQL 测试库、Playwright Chromium 桌面/移动项目

本报告先记录了 `2026-07-16` 的完整工作树验收，在 `2026-07-31` 对拆分提交后的收口实现复验，
并在 `2026-08-03` 使用 Docker 本地依赖逐项验证 S3、SMTP、OAuth、SMS 和 AI Provider，
随后完成受控模块开发 Agent、文件工作区布局和对应自动化收口。

## 2. 发布门禁

| 用例 ID  | 结果 | 证据                                                                                                                   | 备注                                                                                                    |
| -------- | ---- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| GATE-001 | Pass | `pnpm typecheck` exit 0                                                                                                | 无 TypeScript 错误                                                                                      |
| GATE-002 | Pass | `pnpm lint` exit 0                                                                                                     | ESLint 0 warning                                                                                        |
| GATE-003 | Pass | 15 test files / 313 tests passed / 205.41s                                                                             | Vitest 数据库、API、服务、受控 Agent 和 224 个接口鉴权契约通过                                          |
| GATE-004 | Pass | `Route consistency check passed`                                                                                       | manifest、seed rule、ability、CRUD 权限一致                                                             |
| GATE-005 | Pass | Next.js production build / 30 routes / 5.9s compile                                                                    | Next.js `16.3.0-preview.5` Turbopack 构建通过                                                           |
| GATE-006 | Pass | development smoke + production-mode smoke                                                                              | login、health、ready、info、dashboard、user、notice 全部通过，未执行清库动作                            |
| GATE-007 | Pass | `admin_base_test` reset + migrate + seed                                                                               | 41 tables、2 users、2 roles、150 rules、34 config items、3 removable seed files；重复 migrate/seed 通过 |
| GATE-008 | Pass | Package A、B、外部服务和文件布局已独立 push；Package C 提交前 `git diff --check` Pass                                  | AI 驱动开发能力按独立逻辑包交付                                                                         |
| GATE-009 | Pass | 224/224 API operations、28/28 pages                                                                                    | 无缺失、重复、过期或空验收标准                                                                          |
| GATE-010 | Pass | 95 E2E passed、29 mobile-only skips；83 acceptance passed、29 skips                                                    | 桌面/移动 CRUD 与权限回归、逐页浅色/暗色/窄屏和菜单布局验收通过                                         |
| GATE-011 | Pass | [GitHub Actions CI #30620823521](https://github.com/guojianlan/node-admin-starter-2/actions/runs/30620823521) / 15m14s | PostgreSQL migration/seed、292 Vitest、build、Chromium E2E 和 smoke 全部通过                            |
| GATE-012 | Pass | MinIO、Mailpit、Keycloak、SMS Mock、OpenAI-compatible Mock 逐项通过                                                    | 测试资源、OAuth 绑定、Compose 容器和验收卷均已清理                                                      |
| GATE-013 | Pass | 10 个 Package C 专项用例；真实草稿/差异/隔离验证通过                                                                   | 六个受控工具、权限、生产拒绝、审批证据、拒绝、过期、重放、冲突、陈旧计划和操作日志均覆盖                |

## 3. 自动化结果

| 检查                            | 结果 | 摘要                                                                                                          |
| ------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------- |
| API/Page test-case completeness | Pass | 224 个 HTTP 操作、28 个 App Router 页面全部登记                                                               |
| TypeScript                      | Pass | `tsc --noEmit`                                                                                                |
| ESLint                          | Pass | `eslint . --max-warnings=0`                                                                                   |
| Vitest                          | Pass | 15 个测试文件、313 个测试全部通过                                                                             |
| API anonymous auth contract     | Pass | 224/224：公开接口不返回 401，所有受保护操作统一拒绝匿名请求                                                   |
| Route/permission consistency    | Pass | 页面、DB route、auth rule、CRUD permission 和显式 mutation 检查通过                                           |
| Production build                | Pass | 28 个产品页面、Hono catch-all、uploads route 和系统路由完成构建                                               |
| Playwright full E2E             | Pass | 95 passed、29 skipped；desktop 62/62，mobile 实际执行 33/33                                                   |
| Page acceptance                 | Pass | 83 passed、29 skipped；每个执行用例检查主内容、403/500、pageerror 和页面级横向溢出                            |
| Visual evidence                 | Pass | `test-results/acceptance-evidence` 共 83 张 PNG，约 11 MB；该目录被 Git 忽略，可由 `pnpm e2e:acceptance` 重建 |
| Development smoke               | Pass | `http://127.0.0.1:3000`                                                                                       |
| Production-mode smoke           | Pass | 生产环境变量启动后在 `http://127.0.0.1:3000` 完成非破坏性预检                                                 |
| Local external services         | Pass | S3 上传下载、SMTP 收件、OAuth callback、SMS webhook、AI Chat/Embedding/stream 全部通过                        |
| GitHub Actions                  | Pass | 提交 `8834cadcca17` 对应 CI #30620823521 全流程通过；CI 管理员密码配置与测试 seed 已统一                      |
| Whitespace                      | Pass | `git diff --check`                                                                                            |
| Package C source gate           | Pass | typecheck、lint、test、test-case、route、build 和 diff 检查通过                                               |

Vitest 中 4 段 `Refusing db:reset` 堆栈是生产保护测试的预期子进程输出，覆盖高风险目标、缺少显式允许和数据库名不匹配，最终对应测试为 Pass。

## 4. 数据库事故

独立事故记录和防复发改动见 [`../incidents/2026-07-16-development-database-reset.md`](../incidents/2026-07-16-development-database-reset.md)。

### ACC-INC-001 - 开发数据库被误重置

- 严重级别：Critical
- 结果：Fail
- 发生时间：约 `2026-07-16 17:34:07 CST`
- 目标期望：只重置 `admin_base_test`
- 实际结果：命令执行器未应用调用参数中的环境变量，`pnpm db:reset` 使用默认 `.env`，重置了 `admin_base`
- 事故发生后的开发库状态：41 tables、2 seed users、2 roles、149 rules、32 config items、0 files、0 operation logs、0 AI chat sessions
- 文件系统状态：`storage/` 仍约 19 MB，物理上传文件未被删除，但数据库文件元数据已经丢失，现为孤立文件
- 备份检查：仓库和上级项目目录未发现 PostgreSQL `.sql`、`.dump` 或 `.backup`
- 旧数据来源：`data/admin-base.sqlite` 最后更新时间为 `2026-06-17`，只有 2 users 和 6 file records，且属于旧 SQLite schema，不足以无损恢复当前 PostgreSQL 数据
- 回滚能力：PostgreSQL schema drop 已提交，当前无可用 dump，不能通过事务回滚

后续不得自动把旧 SQLite 数据导回 PostgreSQL。项目负责人已于 `2026-07-31` 接受 seed 状态，
不恢复无法验证的历史文件元数据。默认 seed 改为生成“网站素材”分组及 3 个可删除的网站示例文件；
旧的孤立上传文件不会被自动挂接到新记录。数据恢复决策已关闭。

### 本轮发现并修复

1. Dashboard 无权限用户 E2E 仍断言已删除的假指标“总收入”，已改为真实指标“今日登录成功”。
2. 移动端共享表格固定首列和固定操作列互相覆盖，导致操作按钮被拦截；窄屏现取消 sticky 固定列并通过容器横向滚动访问操作列。
3. Ant Design Table `pagination.position` 已迁移到 `pagination.placement`，对应弃用告警消失。
4. AI Chat/Playground 在未配置 Provider/默认模型时把正常未就绪状态返回为 HTTP 500；现返回 HTTP 200、`ready: false`、`reason`，页面显示明确未就绪提示。
5. 文件 seed 新增“网站素材”分组及浅色登录背景、暗色登录背景、`robots.txt`，均为普通可删除文件。
6. 文件物理强删改为独立 `system.file.forceDelete` 权限；被引用文件只有该权限可强删，引用关系级联清理并记录 critical 日志。
7. 危险文件通过 `/uploads/...` 直链访问时强制 `attachment + application/octet-stream + nosniff`，不再允许 HTML/SVG 内联执行。
8. Agent 的系统状态和操作日志工具绑定当前用户权限；无操作日志权限的用户不能借 Agent 读取审计数据。
9. Vitest 固定单 worker，测试环境不再由 App 模块顶层并发 migration，消除共享 PostgreSQL 测试库重置竞态。
10. PostgreSQL 未加引号的 camelCase SQL alias 会转为小写；补齐 `accessKey`、`rootPath` 和 `storageType` 归一化，修复 S3 已保存凭据无法读取及下载误走本地存储的问题。
11. OAuth callback origin 改为读取 `X-Forwarded-Host`、`X-Forwarded-Proto` 和真实 `Host`，修复服务绑定 `0.0.0.0` 时生成无效 callback URL 的问题。
12. 文件管理和共享表格改为工作区高度闭合、局部滚动、固定表头/分页和完整空状态，消除空表固定列竖线及右侧内容未撑满问题。
13. 新增系统内置模块开发 Agent；六个工具复用模块生成器服务，发布/回滚强制审批并记录 planHash、受影响文件、验证结果、有效期、审批人和执行状态。

## 5. 页面验收状态

| 范围                                    | 结果         | 说明                                                                                             |
| --------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| PAGE-001 - PAGE-028 数据/交互自动化部分 | Partial Pass | 所有路由有自动加载、主内容、API 5xx、pageerror、权限和溢出检查；复杂业务分支仍按功能用例逐项推进 |
| Desktop Light                           | Pass         | 根路由/登录行为和 26 个后台页面全部通过，逐页截图已生成                                          |
| Desktop Dark                            | Pass         | 26 个后台页面全部通过且已截图；项目负责人人工复核无问题                                          |
| Mobile Light                            | Pass         | 根路由/登录行为和 26 个后台页面全部通过，无页面级横向溢出，逐页截图已生成                        |
| Side/Mix/Columns/Top 菜单模式           | Pass         | side 全路由覆盖；top/mix/columns 代表页面自动化通过，hover/折叠细节人工复核无问题                |
| 页签与 tabs-cache                       | Blocked      | 需要验证搜索、分页、滚动和表单草稿状态保持                                                       |
| 复杂表格                                | Pass         | 桌面/移动加载与操作列可达通过，移动固定列覆盖已修复；固定表头、底边框和视觉密度人工复核无问题    |
| 人工视觉复核                            | Pass         | 项目负责人于 `2026-08-03` 确认当前人工视觉验收无问题                                             |

`2026-07-31` 复验已完成 Ant Design 6 警告清理：Space、Alert、Drawer 和 List 迁移完成；
角色权限树统一数字 key 并提前加载元数据；配置表单只在活动分组存在时写入值。针对角色编辑和
AI Agent 页面的定向 Playwright 复验未再出现上述浏览器告警。运行器仍会输出
`NO_COLOR`/`FORCE_COLOR` 的 Node 环境提示，该提示不来自产品页面。

## 6. 外部环境用例

| 环境                  | 本地模拟结果 | 验证范围                                                           | 真实环境边界                                               |
| --------------------- | ------------ | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| S3-compatible storage | Pass         | MinIO 连接、设为默认、上传、下载和字节一致性                       | 云 IAM、跨区网络、CDN 和对象版本策略仍需 staging 验证      |
| SMTP                  | Pass         | Mailpit SMTP 发送和收件箱主题校验                                  | 公网投递率以及 SPF、DKIM、DMARC 仍需真实域名验证           |
| OAuth                 | Pass         | Keycloak Authorization Code、state、callback、邮箱匹配、绑定和解绑 | GitHub、微信等平台审核和 Provider 特有策略仍需真实应用验证 |
| SMS                   | Pass         | Webhook 鉴权、号码、正文和变量请求                                 | 运营商送达、签名和模板审核仍需真实供应商验证               |
| AI Provider           | Pass         | OpenAI-compatible 模型列表、Chat、Embedding、Provider/模型流式解析 | 云模型配额、计费、审核、质量和真实延迟仍需真实凭据验证     |

复验使用 [`../local-external-services-acceptance.md`](../local-external-services-acceptance.md) 中的固定本地配置。
脚本只创建 `acceptance-*` 临时资源，结束后已确认活动资源和 `keycloak-local` OAuth 绑定均为 0。
`docker compose down -v --remove-orphans` 已移除本轮所有容器、网络及 MinIO/Mailpit 数据卷。

## 7. 发布结论

- 结论：**Local Acceptance Pass / 真实生产外部服务待 staging 验证**
- 自动化产品门禁：本机 typecheck、lint、313 Vitest、224/224 API 清单、28/28 页面清单、route check 和 30 页面 build 均通过；此前 production-mode smoke、95 E2E 和 83 页面验收及上一收口提交的远端 GitHub Actions 已跑绿
- 本地外部服务：五项协议和业务闭环均已通过，人工视觉复核已确认无问题
- 生产边界：真实云凭据、域名、平台审核、配额和公网送达不能由本地模拟替代，发布前仍需 staging 验证
- P0 判定：历史 Critical 事故已经记录并完成恢复决策；本轮未执行 `db:reset`
- 当前服务：本轮 Docker 验收环境已停止并删除；原开发服务重启后继续运行

## 8. 下一步

1. Package C push 后确认远端 CI 跑绿，并由项目负责人手动验证模块开发 Agent 的对话和审批展示。
2. 在独立 staging 环境使用最小权限真实凭据复验 S3、SMTP、OAuth、SMS 和 AI Provider。
3. 上线前重新执行发布门禁、非破坏性 smoke，并确认数据库备份和回滚点。

### 已完成的防复发措施

- `db:reset` 每次执行都必须显式设置 `ADMIN_BASE_ALLOW_DB_RESET=true`。
- `ADMIN_BASE_RESET_DATABASE_NAME` 必须与 `DATABASE_URL` 中的数据库名完全一致。
- Playwright 固定使用 `*_test` 数据库和 3101 端口，不复用开发服务。
- CI 会创建 `admin_base_test`、安装 Chromium 并执行完整 `pnpm e2e`。
- API 测试清单中的 224 个操作全部接入匿名鉴权契约测试。
