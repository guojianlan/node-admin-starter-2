# MCP Server、OAuth 与 Tool 生命周期

Updated: 2026-08-24

MCP 用于接入已知远程业务系统，不是任意远程代码执行入口。Admin Base 将 MCP Server、连接、远端
Tool 和 Agent Tool 映射纳入统一权限、风险、Approval、Run/Step 和 operation log。

## 1. 支持范围

- 传输：远程 MCP Streamable HTTP。
- Endpoint：生产只允许 HTTPS；开发 HTTP 只允许 localhost/127.0.0.1。
- OAuth：`none`、`client_credentials`、`authorization_code` + PKCE。
- Token：Access/Refresh Token 加密保存，过期时按 Refresh Token 自动刷新。
- 协议：`initialize`、`notifications/initialized`、`tools/list` 和 `tools/call`。
- 响应：普通 JSON 和 SSE `data:` JSON-RPC 响应。

不支持 stdio、Shell、脚本、本地二进制、任意 URL Tool。`sse` 传输值只保留配置兼容，执行时会明确
拒绝。客户端 Secret、Access Token 和 Refresh Token 不回显、不写入日志。

## 2. 生命周期

1. 管理员创建 Server，保存 Endpoint、传输和 OAuth 元数据。
2. `client_credentials` 直接交换 Token；`authorization_code` 创建十分钟 state 和 PKCE challenge，回调后交换 Token。
3. 连接成功后执行同步：初始化 MCP Session、发送 initialized、调用 `tools/list`。
4. 最多同步 500 个 Tool，映射到固定 `mcp_gateway` handler。
5. 新 Tool 默认 `allowlisted=false`、`status=0`，管理员必须设置风险、审批和启用状态。
6. Agent 调用时再次检查 Server、Connection、Tool allowlist/status 和原有 Approval。
7. 远端消失的 Tool 自动停用并退出 allowlist；删除 Server 会停用关联映射。

每次 Tool 调用建立短生命周期 Session，并透传 `Mcp-Session-Id` 完成该次 JSON-RPC 交换。远端返回
错误会脱敏后写入 Step 和连接状态。

## 3. OAuth 边界

Authorization Code state 与连接记录绑定并设置十分钟过期，使用 PKCE S256。回调成功后跳回
`/system/ai/governance?tab=mcp`。本地断开会撤销 Admin Base 中的加密 Token，但当前不调用远端
revoke endpoint。

## 4. 权限与审计

- 查询：`system.aiGovernance.query`。
- Server/连接配置：`system.aiGovernance.update`。
- 连接、同步、断开：`system.aiGovernance.execute`。
- allowlist、风险和 Approval 策略：`system.aiGovernance.approve`。

Server 创建、更新、删除、连接、同步、断开和 Tool 策略修改均写入 operation log；Secret、Token 和
远端原始 Authorization Header 不进入日志。

## 5. 内置系统数据 MCP

AI 治理的 MCP 页提供“部署系统数据 MCP”。该动作创建或更新 `admin-base-system` Server，通过内置
Client Credentials 连接，同步并启用五个低风险只读 Tool，同时创建系统 Agent“系统数据盘点助手”：

- `get_system_overview`：汇总页面、菜单节点、操作权限、用户、角色和部门数量。
- `list_pages`：按名称、路径或权限键查询 `sys_rule` 中的真实后台页面。
- `list_menu_tree`：查询全局菜单树，或查询指定用户基于角色权限得到的有效菜单。
- `list_roles_and_permissions`：查询角色、数据范围和已分配的菜单/操作权限。
- `list_personnel`：分页查询用户名、昵称、部门和角色，不返回密码、Token、手机号或邮箱。

它不是 SQL 控制台，不接受 SQL、表名或任意查询语句，也不提供新增、修改、删除能力。页面、菜单和
权限始终以 `sys_rule` 为事实来源；每次调用使用当前 AI Chat 用户身份再次校验用户状态和
`system.aiGovernance.query` 权限。页面和菜单盘点默认包含 `hidden` 路由组织节点，并在结果中保留
该字段；调用者可显式传 `includeHidden=false` 过滤。管理员可在 AI Chat 选择“系统数据盘点助手”，
询问：

```text
这个后台有多少个页面？主要分成哪些模块？
当前菜单结构是什么？
有哪些角色，每个角色有什么权限？
目前有哪些人员，他们分别属于什么部门和角色？
```

重新部署会轮换内置 Client Secret、撤销旧连接、重新同步 Tool 和修复 Agent 绑定。Client Secret、
Access Token 和 Refresh Token 只加密保存在数据库中，不通过管理 API 回显。

## 6. 后续扩展

- 远端 OAuth revoke endpoint。
- 长连接 MCP Session 池、健康探测和连接复用。
- 更完整的 MCP capability negotiation、resource/prompt 支持。
- 出站代理、DNS 重绑定防护和生产网络 allowlist。
- 只有在独立 Sandbox 成熟后才重新评估 stdio；当前不开放。
