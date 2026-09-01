import type { ApiTestCase, CoverageMode } from "./types";
import { generatedModuleApiOperations } from "./generated-module-test-cases";

const operationsByMethod = {
  DELETE: [
    "/api/system/ai/agent/{id}",
    "/api/system/ai/eval/cases/{id}",
    "/api/system/ai/eval/datasets/{id}",
    "/api/system/ai/knowledge/{id}",
    "/api/system/ai/knowledge/documents/{id}",
    "/api/system/ai/notebook/{id}",
    "/api/system/ai/notebook/{id}/members/{userId}",
    "/api/system/ai/notebook/{id}/sources/{sourceId}",
    "/api/system/ai/notebook/{id}/research/{runId}",
    "/api/system/ai/notebook/artifacts/{id}",
    "/api/system/ai/governance/memories/{id}",
    "/api/system/ai/governance/skills/{id}",
    "/api/system/ai/governance/mcp/servers/{id}",
    "/api/system/ai/governance/mcp/connections/{id}",
    "/api/system/ai/chat/sessions/{id}",
    "/api/system/ai/model/{id}",
    "/api/system/ai/provider/{id}",
    "/api/system/ai/web-search/provider/{id}",
    "/api/system/ai/tool/{id}",
    "/api/system/config/group/{id}",
    "/api/system/config/items/{id}",
    "/api/system/dept/{id}",
    "/api/system/dict/item/{id}",
    "/api/system/dict/list/{id}",
    "/api/system/file/chunk/{uploadId}",
    "/api/system/file/chunk/clean-expired",
    "/api/system/file/group/{id}",
    "/api/system/file/list/{id}",
    "/api/system/file/list/clean-trash",
    "/api/system/file/list/force/{id}",
    "/api/system/file/reference",
    "/api/system/login/log/{id}",
    "/api/system/login/log/clean",
    "/api/system/mail/account/{id}",
    "/api/system/notice/{id}",
    "/api/system/oauth/provider/{id}",
    "/api/system/online/user/{id}",
    "/api/system/online/user/expired",
    "/api/system/online/user/user/{userId}",
    "/api/system/operation/log/clean",
    "/api/system/profile/oauth/{provider}/unbind",
    "/api/system/role/{id}",
    "/api/system/rule/{id}",
    "/api/system/sms/provider/{id}",
    "/api/system/sms/template/{id}",
    "/api/system/storage/{id}",
    "/api/system/user/{id}",
  ],
  GET: [
    "/api/health",
    "/api/ready",
    "/uploads/{path}",
    "/api/saas/context",
    "/api/saas/tenants",
    "/api/saas/workspaces",
    "/api/system/ai/agent",
    "/api/system/ai/agent/options",
    "/api/system/ai/agent/runs",
    "/api/system/ai/agent/runs/{id}/steps",
    "/api/system/ai/agent/runs/{id}/trace",
    "/api/system/ai/eval/datasets",
    "/api/system/ai/eval/datasets/{id}",
    "/api/system/ai/eval/datasets/{id}/cases",
    "/api/system/ai/eval/options",
    "/api/system/ai/eval/results/{id}",
    "/api/system/ai/eval/runs",
    "/api/system/ai/eval/runs/{id}",
    "/api/system/ai/eval/runs/{id}/results",
    "/api/system/ai/workflow/definitions",
    "/api/system/ai/workflow/visual/definitions",
    "/api/system/ai/workflow/visual/definitions/{id}",
    "/api/system/ai/workflow/runs",
    "/api/system/ai/workflow/runs/{id}",
    "/api/system/ai/workflow/runs/{id}/events",
    "/api/system/ai/chat/options",
    "/api/system/ai/chat/runtime-config",
    "/api/system/ai/chat/sessions",
    "/api/system/ai/chat/sessions/{id}/approvals",
    "/api/system/ai/chat/sessions/{id}/export",
    "/api/system/ai/chat/sessions/{id}/messages",
    "/api/system/ai/chat/sessions/{id}/run/latest",
    "/api/system/ai/chat/sessions/{id}/runs/{runId}/events",
    "/api/system/ai/knowledge",
    "/api/system/ai/knowledge/{id}/documents",
    "/api/system/ai/knowledge/{id}/source-files",
    "/api/system/ai/knowledge/runs/{id}",
    "/api/system/ai/notebook",
    "/api/system/ai/notebook/options",
    "/api/system/ai/notebook/source-options",
    "/api/system/ai/notebook/{id}",
    "/api/system/ai/notebook/{id}/sources",
    "/api/system/ai/notebook/{id}/sources/search/candidates",
    "/api/system/ai/notebook/{id}/artifacts",
    "/api/system/ai/notebook/{id}/members",
    "/api/system/ai/notebook/{id}/research",
    "/api/system/ai/notebook/{id}/research/{runId}",
    "/api/system/ai/governance/options",
    "/api/system/ai/governance/memories",
    "/api/system/ai/governance/memory-candidates",
    "/api/system/ai/governance/skills",
    "/api/system/ai/governance/skills/{id}/versions",
    "/api/system/ai/governance/mcp/servers",
    "/api/system/ai/governance/mcp/connections",
    "/api/system/ai/governance/mcp/tools",
    "/api/system/ai/governance/mcp/oauth/callback",
    "/api/system/ai/governance/circuits",
    "/api/system/ai/governance/quotas",
    "/api/system/ai/governance/billing",
    "/api/system/ai/governance/jobs",
    "/api/system/ai/model",
    "/api/system/ai/model/{id}/pricing/preview",
    "/api/system/ai/pricing/catalog/models",
    "/api/system/ai/pricing/catalog/status",
    "/api/system/ai/setup/summary",
    "/api/system/ai/provider/{id}/models",
    "/api/system/ai/provider/{id}/test-models",
    "/api/system/ai/playground/options",
    "/api/system/ai/playground/runtime-config/{usage}",
    "/api/system/ai/provider",
    "/api/system/ai/web-search/provider",
    "/api/system/ai/runtime-config/{usage}",
    "/api/system/ai/runtime/purposes",
    "/api/system/ai/runtime/provider-health",
    "/api/system/ai/runtime/invocations",
    "/api/system/ai/runtime/invocations/{id}",
    "/api/system/ai/tool",
    "/api/system/config/group",
    "/api/system/config/items",
    "/api/system/dashboard/summary",
    "/api/system/dept",
    "/api/system/dept/tree",
    "/api/system/dept/users/{id}",
    "/api/system/dict/item",
    "/api/system/dict/list",
    "/api/system/dict/list/all",
    "/api/system/doctor",
    "/api/system/file/{id}/references",
    "/api/system/file/group/tree",
    "/api/system/file/list",
    "/api/system/file/list/download/{id}",
    "/api/system/file/list/trash",
    "/api/system/info",
    "/api/system/login/captcha",
    "/api/system/login/log",
    "/api/system/login/options",
    "/api/system/mail/account",
    "/api/system/menu",
    "/api/system/module/generator/drafts",
    "/api/system/module/generator/drafts/{name}/diff",
    "/api/system/module/generator/capabilities",
    "/api/system/module/generator/example",
    "/api/system/module/generator/schema",
    "/api/system/notice",
    "/api/system/notice/{id}/read-stats",
    "/api/system/notice/{id}/read-users",
    "/api/system/notice/my",
    "/api/system/notice/my/unread-count",
    "/api/system/oauth/{provider}/callback",
    "/api/system/oauth/{provider}/redirect",
    "/api/system/oauth/provider",
    "/api/system/online/user",
    "/api/system/operation/log",
    "/api/system/operation/log/export",
    "/api/system/operation/log/stats",
    "/api/system/profile",
    "/api/system/profile/login-records",
    "/api/system/profile/oauth/accounts",
    "/api/system/role",
    "/api/system/role/deptTree",
    "/api/system/role/ruleList",
    "/api/system/role/users/{id}",
    "/api/system/rule",
    "/api/system/rule/parent",
    "/api/system/rule/tree",
    "/api/system/settings/config/items",
    "/api/system/sms/provider",
    "/api/system/sms/template",
    "/api/system/storage",
    "/api/system/user",
    "/api/system/user/dept",
    "/api/system/user/role",
  ],
  POST: [
    "/api/saas/tenants",
    "/api/saas/workspaces",
    "/api/system/ai/agent",
    "/api/system/ai/eval/cases/from-run/{runId}",
    "/api/system/ai/eval/datasets",
    "/api/system/ai/eval/datasets/{id}/cases",
    "/api/system/ai/eval/datasets/{id}/runs",
    "/api/system/ai/knowledge",
    "/api/system/ai/knowledge/{id}/documents",
    "/api/system/ai/knowledge/{id}/documents/upload",
    "/api/system/ai/knowledge/documents/{id}/index",
    "/api/system/ai/knowledge/search",
    "/api/system/ai/knowledge/ask",
    "/api/system/ai/notebook",
    "/api/system/ai/notebook/{id}/sources",
    "/api/system/ai/notebook/{id}/sources/website",
    "/api/system/ai/notebook/{id}/sources/search",
    "/api/system/ai/notebook/{id}/sources/search/import",
    "/api/system/ai/notebook/{id}/sources/search/candidates/{candidateId}/reject",
    "/api/system/ai/notebook/{id}/research",
    "/api/system/ai/notebook/{id}/ask",
    "/api/system/ai/notebook/{id}/artifacts",
    "/api/system/ai/notebook/{id}/artifacts/async",
    "/api/system/ai/notebook/artifacts/{id}/regenerate",
    "/api/system/ai/governance/memories",
    "/api/system/ai/governance/skills",
    "/api/system/ai/governance/skills/{id}/versions",
    "/api/system/ai/governance/skills/{id}/versions/{version}/publish",
    "/api/system/ai/governance/skills/{id}/versions/{version}/rollback",
    "/api/system/ai/governance/mcp/servers",
    "/api/system/ai/governance/mcp/servers/{id}/connect",
    "/api/system/ai/governance/mcp/servers/{id}/sync",
    "/api/system/ai/governance/mcp/internal/oauth/token",
    "/api/system/ai/governance/mcp/internal",
    "/api/system/ai/governance/mcp/internal/provision",
    "/api/system/ai/governance/memory-candidates/{id}/decision",
    "/api/system/ai/workflow/visual/versions",
    "/api/system/ai/workflow/assets",
    "/api/system/ai/workflow/visual/definitions/{id}/versions/{version}/publish",
    "/api/system/ai/workflow/visual/definitions/{id}/runs",
    "/api/system/ai/workflow/runs/{id}/waits/{waitId}/decision",
    "/api/system/ai/workflow/runs/{id}/events",
    "/api/system/ai/workflow/runs/{id}/resume",
    "/api/system/ai/governance/circuits/reset",
    "/api/system/ai/governance/quotas",
    "/api/system/ai/governance/billing/adjustments",
    "/api/system/ai/governance/jobs/eval",
    "/api/system/ai/governance/jobs/{id}/retry",
    "/api/system/ai/governance/jobs/{id}/cancel",
    "/api/system/ai/approval/{id}/decision",
    "/api/system/ai/chat/sessions/{sessionId}/client-actions/{id}/result",
    "/api/system/ai/chat/sessions",
    "/api/system/ai/chat/sessions/{id}/messages/{messageId}/regenerate",
    "/api/system/ai/chat/sessions/{id}/messages/stream",
    "/api/system/ai/model",
    "/api/system/ai/model/test",
    "/api/system/ai/model/test/stream",
    "/api/system/ai/pricing/catalog/refresh",
    "/api/system/ai/playground/chat",
    "/api/system/ai/playground/chat/stream",
    "/api/system/ai/provider",
    "/api/system/ai/provider/batch-delete",
    "/api/system/ai/provider/test",
    "/api/system/ai/provider/test/stream",
    "/api/system/ai/setup/complete",
    "/api/system/ai/setup/discover",
    "/api/system/ai/web-search/provider",
    "/api/system/ai/web-search/provider/batch-delete",
    "/api/system/ai/web-search/provider/test",
    "/api/system/ai/tool",
    "/api/system/ai/workflow/{code}/runs",
    "/api/system/config/group",
    "/api/system/config/group/batch-delete",
    "/api/system/config/items",
    "/api/system/config/items/batch-delete",
    "/api/system/config/items/refreshCache",
    "/api/system/dept",
    "/api/system/dept/batch-delete",
    "/api/system/dict/item",
    "/api/system/dict/item/batch-delete",
    "/api/system/dict/list",
    "/api/system/dict/list/batch-delete",
    "/api/system/file/chunk/complete",
    "/api/system/file/chunk/init",
    "/api/system/file/chunk/part",
    "/api/system/file/group",
    "/api/system/file/list/batch-delete",
    "/api/system/file/list/batch-force",
    "/api/system/file/list/batch-restore",
    "/api/system/file/list/copy",
    "/api/system/file/list/upload",
    "/api/system/file/reference",
    "/api/system/login",
    "/api/system/login/log/batch-delete",
    "/api/system/logout",
    "/api/system/mail/account",
    "/api/system/mail/account/batch-delete",
    "/api/system/mail/account/test",
    "/api/system/module/generator/generate",
    "/api/system/module/generator/publish",
    "/api/system/module/generator/rollback",
    "/api/system/notice",
    "/api/system/notice/batch-delete",
    "/api/system/notice/my/{id}/read",
    "/api/system/notice/my/read-all",
    "/api/system/oauth/provider",
    "/api/system/oauth/provider/test",
    "/api/system/password-reset/confirm",
    "/api/system/password-reset/request",
    "/api/system/profile/avatar",
    "/api/system/profile/oauth/{provider}/bind",
    "/api/system/role",
    "/api/system/role/batch-delete",
    "/api/system/role/copy/{id}",
    "/api/system/role/setRule",
    "/api/system/rule",
    "/api/system/rule/batch-delete",
    "/api/system/sms/provider",
    "/api/system/sms/provider/batch-delete",
    "/api/system/sms/provider/test",
    "/api/system/sms/template",
    "/api/system/sms/template/test",
    "/api/system/storage",
    "/api/system/storage/batch-delete",
    "/api/system/storage/test",
    "/api/system/user",
    "/api/system/user/batch-delete",
  ],
  PUT: [
    "/api/saas/tenants/{id}",
    "/api/saas/workspaces/{id}",
    "/api/system/ai/eval/cases/{id}",
    "/api/system/ai/eval/datasets/{id}",
    "/api/system/ai/knowledge/{id}",
    "/api/system/ai/knowledge/documents/{id}/status",
    "/api/system/ai/notebook/{id}",
    "/api/system/ai/notebook/{id}/members",
    "/api/system/ai/governance/memories/{id}",
    "/api/system/ai/governance/skills/{id}",
    "/api/system/ai/governance/mcp/servers/{id}",
    "/api/system/ai/governance/mcp/tools/{id}/policy",
    "/api/system/ai/governance/circuits",
    "/api/system/ai/governance/quotas/{id}",
    "/api/system/ai/governance/billing/{id}/settlement",
    "/api/system/ai/runtime/purposes/{purpose}",
    "/api/system/ai/agent/{id}",
    "/api/system/ai/chat/sessions/{id}",
    "/api/system/ai/model/{id}",
    "/api/system/ai/model/default/{id}",
    "/api/system/ai/model/status/{id}",
    "/api/system/ai/model/{id}/pricing/apply",
    "/api/system/ai/provider/{id}",
    "/api/system/ai/provider/default/{id}",
    "/api/system/ai/provider/status/{id}",
    "/api/system/ai/web-search/provider/{id}",
    "/api/system/ai/web-search/provider/status/{id}",
    "/api/system/ai/tool/{id}",
    "/api/system/config/group/{id}",
    "/api/system/config/items/{id}",
    "/api/system/config/items/save",
    "/api/system/dept/{id}",
    "/api/system/dict/item/{id}",
    "/api/system/dict/list/{id}",
    "/api/system/file/group/{id}",
    "/api/system/file/list/{id}",
    "/api/system/file/list/move",
    "/api/system/file/list/rename/{id}",
    "/api/system/file/list/restore/{id}",
    "/api/system/mail/account/{id}",
    "/api/system/mail/account/default/{id}",
    "/api/system/mail/account/status/{id}",
    "/api/system/notice/{id}",
    "/api/system/notice/publish/{id}",
    "/api/system/notice/revoke/{id}",
    "/api/system/oauth/provider/{id}",
    "/api/system/oauth/provider/status/{id}",
    "/api/system/profile",
    "/api/system/profile/password",
    "/api/system/role/{id}",
    "/api/system/role/status/{id}",
    "/api/system/rule/{id}",
    "/api/system/rule/hidden/{id}",
    "/api/system/rule/status/{id}",
    "/api/system/settings/config/save",
    "/api/system/sms/provider/{id}",
    "/api/system/sms/provider/default/{id}",
    "/api/system/sms/provider/status/{id}",
    "/api/system/sms/template/{id}",
    "/api/system/sms/template/status/{id}",
    "/api/system/storage/{id}",
    "/api/system/storage/default/{id}",
    "/api/system/storage/status/{id}",
    "/api/system/user/{id}",
    "/api/system/user/resetPassword",
  ],
} as const;

export const publicApiOperations = new Set([
  "GET /api/health",
  "GET /api/ready",
  "GET /uploads/{path}",
  "GET /api/system/login/captcha",
  "GET /api/system/login/options",
  "GET /api/system/oauth/{provider}/callback",
  "GET /api/system/oauth/{provider}/redirect",
  "GET /api/system/ai/governance/mcp/oauth/callback",
  "POST /api/system/login",
  "POST /api/system/password-reset/confirm",
  "POST /api/system/password-reset/request",
]);

function areaFor(path: string) {
  if (path === "/api/health" || path === "/api/ready" || path.includes("/doctor"))
    return "生产诊断";
  if (
    path.includes("/password-reset") ||
    path.includes("/login") ||
    path.includes("/logout") ||
    path.includes("/oauth/")
  )
    return "认证安全";
  if (path.startsWith("/api/saas/")) return "SaaS 控制面";
  const match = path.match(/^\/api\/system\/([^/]+)(?:\/([^/{]+))?/);
  return [match?.[1], match?.[2]].filter(Boolean).join(" / ") || "系统接口";
}

function coverageFor(path: string): CoverageMode {
  if (/\/(test|callback|redirect|download|stream)\b/.test(path)) return "environment";
  if (
    /\/(health|ready|login|profile|notice|file|config|dict|role|user|operation|sms|ai|module|saas)\b/.test(
      path,
    )
  )
    return "automated";
  return "planned";
}

function createCase(method: string, path: string): ApiTestCase {
  const operation = `${method} ${path}`;
  if (operation === "POST /api/system/ai/governance/mcp/internal/oauth/token") {
    return {
      operation,
      area: "ai / governance",
      success: [
        "启用的内置 Server 使用正确 Client Credentials 换取短期 Access Token 和可轮换 Refresh Token",
        "Refresh Token grant 校验签名、类型和有效期后签发新 Token，响应符合 OAuth token 结构",
      ],
      failures: [
        "Client ID、Client Secret、grant_type 或 Refresh Token 无效时返回 4xx，不签发任何 Token",
        "Server 被停用、删除或轮换 Secret 后，旧凭据和旧 Token 立即失效",
      ],
      dataAssertions: [
        "Token 只绑定当前内置 MCP Server、Token 类型和过期时间，scope 固定为 system.read",
        "响应不包含保存的加密 Secret、Server 数据库字段或认证用户资料",
      ],
      security: [
        "接口不使用后台登录 Token，而使用独立 Client Credentials；Secret 比较采用固定时间摘要比较",
        "Client Secret、Access Token 和 Refresh Token 不写入 operation log 或普通请求日志",
      ],
      sideEffects: [
        "换证不修改业务数据，重新部署内置 MCP 时由治理动作负责轮换 Secret 和撤销旧连接",
      ],
      coverage: "automated",
    };
  }
  if (operation === "POST /api/system/ai/governance/mcp/internal") {
    return {
      operation,
      area: "ai / governance",
      success: [
        "有效 MCP Access Token 和调用用户可完成 initialize、initialized、ping、tools/list 与 tools/call",
        "五个 Tool 可读取系统概览、页面、菜单树、角色权限和脱敏人员组织数据",
      ],
      failures: [
        "Token 缺失、签名错误、过期或 Server 停用时返回 401；调用用户无效或缺少查询权限时返回 403",
        "未知 Tool、非法参数和未知 JSON-RPC method 返回受控错误，不能转化为任意 SQL 或写操作",
      ],
      dataAssertions: [
        "页面、菜单和权限来自 sys_rule；人员结果支持分页并只包含用户名、昵称、部门、角色和状态",
        "响应不含 passwordHash、Token、手机号、邮箱或其他认证凭据",
      ],
      security: [
        "MCP Client 与当前调用用户同时校验，用户必须启用并拥有 system.aiGovernance.query",
        "只暴露固定只读 Tool 注册表，不接受 SQL、表名、URL、脚本或任意 handler",
      ],
      sideEffects: ["所有 tools/call 都是数据库只读查询，不修改菜单、权限、角色、用户或部门数据"],
      coverage: "automated",
    };
  }
  if (operation === "POST /api/system/ai/governance/mcp/internal/provision") {
    return {
      operation,
      area: "ai / governance",
      success: [
        "一键创建或更新 admin-base-system Server，完成连接、Tool 同步、allowlist 和系统 Agent 绑定",
        "重复部署轮换 Client Secret、撤销旧连接并修复五个 Tool 策略，不创建重复 Server 或 Agent",
      ],
      failures: [
        "未登录返回 401，缺少 update、execute 或 approve 任一权限返回 403且不改变现有配置",
        "连接、同步或 Agent 保存失败时返回明确错误，不回显 Client Secret 或 OAuth Token",
      ],
      dataAssertions: [
        "五个 MCP Tool 均为 enabled、allowlisted、low risk、无需审批，并映射到同一系统 Agent",
        "Server、活动 Connection、镜像 Tool、Agent 及 Agent-Tool 关联与响应 ID 一致",
      ],
      security: [
        "部署要求 system.aiGovernance.update、execute 和 approve 三项权限",
        "生成的 Client Secret 只加密保存，响应、操作日志和 UI 都不得回显",
      ],
      sideEffects: [
        "写入 critical 级 operation log，details 只记录固定 code 和 read_only 模式",
        "旧活动连接被撤销，旧 Access/Refresh Token 被清空；系统 Agent 作为内置资源禁止误删",
      ],
      coverage: "automated",
    };
  }
  if (operation === "POST /api/system/ai/chat/sessions/{sessionId}/client-actions/{id}/result") {
    return {
      operation,
      area: "ai / chat",
      success: [
        "granted 结果在浏览器和服务端分别粗化后写入 Approval/Step，Run 进入 waiting_continuation 并恢复同一 Agent 流程",
        "denied、unavailable 或 error 作为合法 Client Tool 结果完成当前 Step，Agent 随后询问城市而不是把会话标记失败",
      ],
      failures: [
        "未登录返回 401，缺少 system.aiChat.chat 返回 403；跨用户、跨会话、非 browser-location Tool 返回 409",
        "过期或已处理结果返回 409，重复提交不能创建第二条消息、执行第二次续跑或覆盖原结果",
      ],
      dataAssertions: [
        "经纬度只保留两位小数，accuracy 为受限安全整数；Approval、Step 和系统上下文不含客户端提交的精确坐标",
        "Approval 为 executed、Step 为 completed、父 Run 为 waiting_continuation；过期请求将 Step/Run 收口为 denied/stopped",
      ],
      security: [
        "接口只要求当前会话用户的 system.aiChat.chat，不使用管理员 system.aiAgent.approve 权限，也不能执行任意服务端 Tool",
        "请求体使用判别联合严格校验；服务端只构造受控输出和系统消息，不接受客户端自定义 output 或日志字段",
      ],
      sideEffects: [
        "成功或降级结果刷新会话消息统计并允许一次续跑；过期结果停止等待中的 Run，避免永久挂起",
        "操作日志只记录 browser_location、结果状态和是否授权，不记录经纬度、accuracy 或浏览器原始错误对象",
      ],
      coverage: "automated",
    };
  }
  const isPublic = publicApiOperations.has(operation);
  const isRead = method === "GET";
  const isStream = path.endsWith("/stream");
  const isDownload =
    path.startsWith("/uploads/") || path.includes("/download/") || path.endsWith("/export");
  const isRedirect =
    path.includes("/oauth/") && (path.endsWith("/redirect") || path.endsWith("/callback"));
  const isReadiness = path === "/api/health" || path === "/api/ready" || path.endsWith("/doctor");
  const isConnectionTest = path.endsWith("/test") || path.endsWith("/test/stream");
  const hasPathParameter = path.includes("{");

  const success = isReadiness
    ? [
        "依赖正常时返回约定状态码；health 返回 ok，ready/doctor 的检查项、总状态和时间戳完整",
        "ready/doctor 的 env、database、migration、seed、存储、邮件和生产安全结论与真实环境一致",
      ]
    : isRedirect
      ? [
          "合法 Provider 和 state/code 完成 HTTP 302 跳转，Location 仅指向允许的本站或 Provider 地址",
          "callback 按登录/绑定模式创建正确 token 或绑定关系，并记录 OAuth 登录方式和结果",
        ]
      : isStream
        ? [
            "合法输入产生可持续消费的流，meta/delta/tool/finish 或错误事件顺序符合协议",
            "正文增量、usage、finishReason 和最终持久化状态一致，客户端结束后不残留 loading",
          ]
        : isDownload
          ? [
              "合法请求返回文件或导出内容，文件名、Content-Type、长度和内容与目标记录/筛选一致",
              "文件读取支持合法 Range 时返回 206；下载包含 nosniff，危险文件不以内联可执行方式响应",
            ]
          : isConnectionTest
            ? [
                "合法临时参数或已保存资源完成真实连接/请求测试，并返回可读的耗时与结果",
                "测试不覆盖已保存密钥，不改变默认资源或业务数据，流式测试能够正常结束",
              ]
            : isRead
              ? [
                  "合法查询返回 HTTP 2xx、统一成功结构和与当前筛选/权限一致的数据",
                  "分页、筛选、空结果或详情字段符合接口语义，不泄漏未授权记录",
                ]
              : [
                  "合法输入返回 HTTP 2xx 和统一成功结构，目标业务动作只执行一次",
                  "数据库状态、缓存或外部资源状态与响应一致，刷新后仍可观察到结果",
                ];

  const failures = isReadiness
    ? [
        "数据库、迁移、关键 seed 或生产安全项失败时 ready/doctor 返回 503 和具体失败项；health 不伪装依赖状态",
        "doctor 未登录返回 401、无权限返回 403；诊断输出不得泄漏数据库密码、密钥或完整凭据",
      ]
    : isRedirect
      ? [
          "Provider 停用/缺配置、state 缺失/过期/不匹配、code 缺失或上游失败时拒绝，不创建 token 或绑定",
          "失败写登录/操作日志但不暴露 clientSecret、上游 token、内部堆栈或账号枚举信息",
        ]
      : isDownload
        ? [
            "文件不存在或越权时返回 404/403；路径穿越被拒绝；非法 Range 返回 416 和正确 Content-Range",
            "存储读取失败时不返回截断但标记成功的文件，不泄漏本地绝对路径、Bucket 密钥或内部堆栈",
          ]
        : isStream
          ? [
              isPublic
                ? "无效参数或上游拒绝时返回受控错误"
                : "未登录返回 401；缺少对应 ability 返回 403，且不启动模型或外部请求",
              "参数非法、Provider 超时/断流、主动取消或工具失败时结束流并持久化准确状态，不重复消息、Step 或副作用",
            ]
          : [
              isPublic
                ? "缺少必填参数、参数过期或凭据错误时返回统一错误结构，不暴露账号、密钥或内部堆栈"
                : "未登录返回 401；缺少对应 ability 返回 403，且不产生业务写入",
              hasPathParameter
                ? "路径参数不存在、格式非法或目标越权时失败，不能误操作其他记录"
                : "非法查询或请求体、业务约束冲突和依赖失败时返回明确错误，不能产生半完成状态",
            ];

  const dataAssertions = isDownload
    ? [
        "响应字节、文件大小、MIME、文件名和 Range 区间与存储元数据及源文件一致",
        "导出内容严格使用当前筛选和数据权限，危险文件响应头符合下载策略",
      ]
    : isRedirect
      ? [
          "state 单次消费，OAuth account/user/token 关联与回调身份一致",
          "失败前后账号绑定数、用户权限和现有 token 保持不变",
        ]
      : isStream
        ? [
            "每个事件可解析，delta 拼接结果等于完成文本，usage 和 finishReason 写入最终记录",
            "失败、取消和 length 截断状态可区分，Run/Step/消息不会长期停留 running",
          ]
        : isReadiness
          ? [
              "检查项名称、ready/warning/failed 状态和 HTTP 状态码映射稳定",
              "修改依赖状态后结果立即反映真实环境，不使用过期成功缓存",
            ]
          : [
              "响应 code、message、data 或分页字段符合统一响应契约",
              isRead
                ? "返回记录、总数、排序、过滤和数据权限范围与数据库事实一致"
                : "成功时目标记录和关联关系正确；失败时事务回滚且原数据保持不变",
            ];

  return {
    operation,
    area: areaFor(path),
    success,
    failures,
    dataAssertions,
    security: [
      isPublic
        ? "接口允许匿名访问，但必须执行限流、状态校验或防枚举规则"
        : "接口要求有效 token 和声明的最小权限",
      "响应、日志和导出内容不得包含 password、token、secret、accessKey 或 clientSecret 明文",
    ],
    sideEffects: [
      isRead && !path.includes("/callback")
        ? "普通查询不修改业务数据；读取回执、最近活跃等显式例外必须可追踪"
        : "写动作按风险要求写入操作日志，并记录 requestId、用户、动作和成功/失败状态",
      "缓存、token、文件、邮件、OAuth 或 AI 调用等副作用必须与事务结果一致且可重试",
    ],
    coverage: coverageFor(path),
  };
}

export const apiTestCases: ApiTestCase[] = [
  ...Object.entries(operationsByMethod).flatMap(([method, paths]) =>
    paths.map((path) => createCase(method, path)),
  ),
  ...generatedModuleApiOperations.map((operation) => createCase(operation.method, operation.path)),
];
