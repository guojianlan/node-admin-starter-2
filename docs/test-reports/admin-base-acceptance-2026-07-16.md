# Admin Base 验收执行记录 - 2026-07-16（2026-07-31 收口）

## 1. 执行信息

- 验收对象：截至 `8834cadcca17` 的完整收口实现
- 分支：`codex/admin-base-migration-plan`
- 环境：local acceptance / production-mode precheck
- Node.js：`v24.14.0`
- pnpm：`10.33.0`
- PostgreSQL：`16.13`
- 开发数据库：`admin_base`
- 隔离测试数据库：`admin_base_test`
- 开始时间：`2026-07-16 17:29:40 CST`
- 收口复验时间：`2026-07-31 16:40 - 17:56 CST`
- 执行方式：Codex 本机命令行、隔离 PostgreSQL 测试库、Playwright Chromium 桌面/移动项目

本报告先记录了 `2026-07-16` 的完整工作树验收，并在 `2026-07-31` 对拆分提交后的收口实现复验。

## 2. 发布门禁

| 用例 ID | 结果 | 证据 | 备注 |
| --- | --- | --- | --- |
| GATE-001 | Pass | `pnpm typecheck` exit 0 | 无 TypeScript 错误 |
| GATE-002 | Pass | `pnpm lint` exit 0 | ESLint 0 warning |
| GATE-003 | Pass | 12 test files / 292 tests passed / 134.49s | Vitest 数据库、API、服务和 220 个接口鉴权契约通过 |
| GATE-004 | Pass | `Route consistency check passed` | manifest、seed rule、ability、CRUD 权限一致 |
| GATE-005 | Pass | Next.js production build / 30 routes / 4.9s compile | Next.js `16.3.0-preview.5` Turbopack 构建通过 |
| GATE-006 | Pass | development smoke + production-mode smoke | login、health、ready、info、dashboard、user、notice 全部通过，未执行清库动作 |
| GATE-007 | Pass | `admin_base_test` reset + migrate + seed | 41 tables、2 users、2 roles、150 rules、34 config items、3 removable seed files；重复 migrate/seed 通过 |
| GATE-008 | Pass | 逻辑包 commit + push；`git diff --check` Pass | AI、系统安全、Shell/UI、测试与文档按包提交并推送 |
| GATE-009 | Pass | 220/220 API operations、28/28 pages | 无缺失、重复、过期或空验收标准 |
| GATE-010 | Pass | 95 E2E passed、29 mobile-only skips；83 acceptance passed、29 skips | 桌面/移动 CRUD 与权限回归、逐页浅色/暗色/窄屏和菜单布局验收通过 |
| GATE-011 | Pass | [GitHub Actions CI #30620823521](https://github.com/guojianlan/node-admin-starter-2/actions/runs/30620823521) / 15m14s | PostgreSQL migration/seed、292 Vitest、build、Chromium E2E 和 smoke 全部通过 |

## 3. 自动化结果

| 检查 | 结果 | 摘要 |
| --- | --- | --- |
| API/Page test-case completeness | Pass | 220 个 HTTP 操作、28 个 App Router 页面全部登记 |
| TypeScript | Pass | `tsc --noEmit` |
| ESLint | Pass | `eslint . --max-warnings=0` |
| Vitest | Pass | 12 个测试文件、292 个测试全部通过 |
| API anonymous auth contract | Pass | 220/220：公开接口不返回 401，所有受保护操作统一拒绝匿名请求 |
| Route/permission consistency | Pass | 页面、DB route、auth rule、CRUD permission 和显式 mutation 检查通过 |
| Production build | Pass | 28 个产品页面、Hono catch-all、uploads route 和系统路由完成构建 |
| Playwright full E2E | Pass | 95 passed、29 skipped；desktop 62/62，mobile 实际执行 33/33 |
| Page acceptance | Pass | 83 passed、29 skipped；每个执行用例检查主内容、403/500、pageerror 和页面级横向溢出 |
| Visual evidence | Pass | `test-results/acceptance-evidence` 共 83 张 PNG，约 11 MB；该目录被 Git 忽略，可由 `pnpm e2e:acceptance` 重建 |
| Development smoke | Pass | `http://127.0.0.1:3000` |
| Production-mode smoke | Pass | 生产环境变量启动后在 `http://127.0.0.1:3000` 完成非破坏性预检 |
| GitHub Actions | Pass | 提交 `8834cadcca17` 对应 CI #30620823521 全流程通过；CI 管理员密码配置与测试 seed 已统一 |
| Whitespace | Pass | `git diff --check` |
| Clean worktree | Pass | 收口内容已按逻辑包提交；最终 push 后工作树无未提交实现 |

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

## 5. 页面验收状态

| 范围 | 结果 | 说明 |
| --- | --- | --- |
| PAGE-001 - PAGE-028 数据/交互自动化部分 | Partial Pass | 所有路由有自动加载、主内容、API 5xx、pageerror、权限和溢出检查；复杂业务分支仍按功能用例逐项推进 |
| Desktop Light | Pass | 根路由/登录行为和 26 个后台页面全部通过，逐页截图已生成 |
| Desktop Dark | Partial Pass | 26 个后台页面全部通过且已截图；登录页暗色和像素级对比仍需人工复核 |
| Mobile Light | Pass | 根路由/登录行为和 26 个后台页面全部通过，无页面级横向溢出，逐页截图已生成 |
| Side/Mix/Columns/Top 菜单模式 | Partial Pass | side 全路由覆盖；top/mix/columns 在用户管理代表页面通过，hover/折叠细节仍需人工验收 |
| 页签与 tabs-cache | Blocked | 需要验证搜索、分页、滚动和表单草稿状态保持 |
| 复杂表格 | Partial Pass | 桌面/移动加载与操作列可达通过，移动固定列覆盖已修复；固定表头、底边框和视觉密度仍需人工复核 |

`2026-07-31` 复验已完成 Ant Design 6 警告清理：Space、Alert、Drawer 和 List 迁移完成；
角色权限树统一数字 key 并提前加载元数据；配置表单只在活动分组存在时写入值。针对角色编辑和
AI Agent 页面的定向 Playwright 复验未再出现上述浏览器告警。运行器仍会输出
`NO_COLOR`/`FORCE_COLOR` 的 Node 环境提示，该提示不来自产品页面。

## 6. 外部环境用例

| 环境 | 结果 | 阻塞原因 |
| --- | --- | --- |
| S3-compatible storage | Blocked | 未提供验收 Bucket、endpoint 和临时凭据 |
| SMTP | Blocked | 未提供验收 SMTP 和收件箱 |
| OAuth | Blocked | 开发库重置后 Provider 配置不存在；需要真实 callback 配置 |
| SMS | Blocked | 未提供真实或 mock webhook 验收端点 |
| AI Provider | Blocked | 开发库重置后 Provider/模型配置不存在；需要重新配置真实 LLM |

## 7. 发布结论

- 结论：**No-Go（生产发布）/ Local Baseline Pass**
- 自动化产品门禁：本机 typecheck、lint、292 Vitest、route check、build、production-mode smoke、95 E2E 和 83 页面验收均通过；最终远端 GitHub Actions 也已跑绿
- 阻断项：人工视觉复核和需要真实凭据的外部环境用例未完成
- P0 判定：历史 Critical 事故已经记录并完成恢复决策，但在交付与环境门禁通过前仍不能发布
- 当前服务：smoke 完成后已停止本机临时 production server

## 8. 下一步

1. 使用 `test-results/acceptance-evidence` 的 83 张自动截图继续执行人工视觉验收，重点核对暗色登录页、菜单 hover/折叠、页签缓存、固定表头和底边框。
2. 重新配置独立验收用 S3、SMTP、OAuth、SMS 和 AI Provider，执行 environment 用例。

### 已完成的防复发措施

- `db:reset` 每次执行都必须显式设置 `ADMIN_BASE_ALLOW_DB_RESET=true`。
- `ADMIN_BASE_RESET_DATABASE_NAME` 必须与 `DATABASE_URL` 中的数据库名完全一致。
- Playwright 固定使用 `*_test` 数据库和 3101 端口，不复用开发服务。
- CI 会创建 `admin_base_test`、安装 Chromium 并执行完整 `pnpm e2e`。
- API 测试清单中的 220 个操作全部接入匿名鉴权契约测试。
