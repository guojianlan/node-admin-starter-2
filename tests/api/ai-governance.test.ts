import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/server/app";
import { sqlite } from "@/server/db";
import {
  acquireAiCircuitPermission,
  assertAiQuotaAvailable,
  cancelAiJob,
  createAiRuntimeSkillVersion,
  decideAiMemoryCandidate,
  deleteAiRuntimeSkill,
  disconnectAiMcpConnection,
  executeMcpGatewayTool,
  listAiMcpServers,
  listAiMemoryCandidates,
  listAiRuntimeSkillVersions,
  maintainAiMemoryState,
  proposeAiMemoryCandidate,
  publishAiRuntimeSkillVersion,
  resolveAgentGovernedContext,
  saveAiMcpServer,
  saveAiMemory,
  saveAiRuntimeSkill,
  setAiMcpToolPolicy,
  syncAiMcpTools,
} from "@/server/services/ai-governance-service";
import { claimAiJob, enqueueAiJob, getAiWorkerQueueHealth } from "@/server/services/ai-job-service";
import {
  INTERNAL_SYSTEM_MCP_AGENT_CODE,
  INTERNAL_SYSTEM_MCP_CODE,
} from "@/server/services/ai-system-mcp-service";
import { getAdminTestPassword } from "../helpers/auth";
import { resetTestDatabase } from "../helpers/db";

async function login() {
  const response = await app.request("/api/system/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: getAdminTestPassword() }),
  });
  const body = (await response.json()) as { data?: { token?: string } };
  return String(body.data?.token ?? "");
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await resetTestDatabase();
});

describe("AI governance foundation", () => {
  it("injects only explicit active Memory and restricts Agent tools through Runtime Skills", async () => {
    const knowledgeTool = (await sqlite
      .prepare("SELECT id FROM sys_ai_tool WHERE code = 'knowledge-search'")
      .get()) as { id: number };
    const agent = (await sqlite
      .prepare("SELECT id FROM sys_ai_agent WHERE code = 'general-assistant'")
      .get()) as { id: number };

    await saveAiMemory({
      userId: 1,
      payload: { scopeType: "user", content: "用户明确偏好中文回答", writePolicy: "manual" },
    });
    await saveAiMemory({
      userId: 1,
      payload: {
        scopeType: "agent",
        agentId: agent.id,
        content: "检索时必须返回引用",
        writePolicy: "confirmed",
      },
    });
    await saveAiMemory({
      userId: 1,
      payload: { scopeType: "user", content: "已归档内容", status: "archived" },
    });
    await saveAiMemory({
      userId: 1,
      payload: {
        scopeType: "user",
        content: "已过期内容",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
    });

    const skillId = await saveAiRuntimeSkill({
      userId: 1,
      payload: {
        name: "知识检索规范",
        code: "knowledge-research",
        instructions: "先检索知识库，再根据证据回答。",
        toolIds: [knowledgeTool.id],
        agentIds: [agent.id],
      },
    });
    const context = await resolveAgentGovernedContext({ agentId: agent.id, userId: 1 });
    expect(context.memoryCount).toBe(2);
    expect(context.skillCount).toBe(1);
    expect(context.instructions).toContain("用户明确偏好中文回答");
    expect(context.instructions).toContain("先检索知识库");
    expect(context.instructions).not.toContain("已归档内容");
    expect(context.instructions).not.toContain("已过期内容");
    expect([...context.allowedToolIds!]).toEqual([knowledgeTool.id]);

    await sqlite
      .prepare("UPDATE sys_ai_runtime_skill SET is_system = true WHERE id = ?")
      .run(skillId);
    await expect(deleteAiRuntimeSkill(skillId, 1)).rejects.toMatchObject({ status: 409 });
  });

  it("creates Memory candidates, merges conflicts, and decays inactive importance", async () => {
    const proposed = await proposeAiMemoryCandidate({
      userId: 1,
      content: "我偏好使用中文回答，并且喜欢简洁的表格。",
    });
    expect(proposed).toMatchObject({ status: "proposed" });
    const candidates = await listAiMemoryCandidates({ userId: 1, status: "proposed" });
    expect(candidates).toHaveLength(1);
    const accepted = await decideAiMemoryCandidate({ id: Number(proposed?.id), userId: 1, decision: "accept" });
    expect(accepted.status).toBe("accepted");
    const rejected = await proposeAiMemoryCandidate({ userId: 1, content: "我习惯先看结论。" });
    await expect(decideAiMemoryCandidate({ id: Number(rejected?.id), userId: 1, decision: "reject" })).resolves.toMatchObject({ status: "rejected" });
    const memory = (await sqlite.prepare("SELECT id FROM sys_ai_memory WHERE user_id = 1 AND status = 'active' ORDER BY id DESC LIMIT 1").get()) as { id: number };
    await sqlite.prepare("UPDATE sys_ai_memory SET importance = 50, last_accessed_at = now() - interval '90 days' WHERE id = ?").run(memory.id);
    expect(await maintainAiMemoryState(Date.now() + 61_000)).toMatchObject({ decayed: expect.any(Number) });
    const decayed = (await sqlite.prepare("SELECT importance FROM sys_ai_memory WHERE id = ?").get(memory.id)) as { importance: number };
    expect(Number(decayed.importance)).toBeLessThan(50);
  });

  it("publishes and rolls back immutable Runtime Skill versions with dependency validation", async () => {
    const agent = (await sqlite.prepare("SELECT id FROM sys_ai_agent WHERE code = 'general-assistant'").get()) as { id: number };
    const tool = (await sqlite.prepare("SELECT id FROM sys_ai_tool WHERE code = 'knowledge-search'").get()) as { id: number };
    const skillId = await saveAiRuntimeSkill({
      userId: 1,
      payload: { name: "Versioned Skill", code: `versioned-skill-${Date.now()}`, instructions: "只使用证据回答", toolIds: [tool.id], agentIds: [agent.id] },
    });
    const first = await createAiRuntimeSkillVersion({ skillId, userId: 1 });
    await expect(publishAiRuntimeSkillVersion({ skillId, version: first.version, userId: 1 })).resolves.toMatchObject({ status: "published" });
    const second = await createAiRuntimeSkillVersion({ skillId, userId: 1 });
    await expect(publishAiRuntimeSkillVersion({ skillId, version: second.version, userId: 1 })).resolves.toMatchObject({ status: "published" });
    const versions = await listAiRuntimeSkillVersions(skillId);
    expect(versions).toEqual(expect.arrayContaining([expect.objectContaining({ version: 1, status: "retired" }), expect.objectContaining({ version: 2, status: "published" })]));
    await expect(publishAiRuntimeSkillVersion({ skillId, version: 1, userId: 1 })).resolves.toMatchObject({ status: "published" });
  });

  it("allows exactly one half-open probe and keeps circuit state in PostgreSQL", async () => {
    const provider = await sqlite
      .prepare(
        `INSERT INTO sys_ai_provider
         (name, code, provider_type, base_url, timeout_ms, status, sort)
         VALUES ('Circuit Provider', 'circuit-provider', 'openai-compatible',
           'https://circuit.test/v1', 30000, 1, 1) RETURNING id`,
      )
      .run();
    await sqlite
      .prepare(
        `INSERT INTO sys_ai_provider_circuit
         (provider_id, purpose, state, consecutive_failures, next_probe_at)
         VALUES (?, 'chat', 'open', 3, now() - interval '1 second')`,
      )
      .run(provider.lastInsertRowid);

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        acquireAiCircuitPermission({
          providerId: Number(provider.lastInsertRowid),
          purpose: "chat",
        }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const persisted = (await sqlite
      .prepare(
        `SELECT state, probe_lease_until AS "probeLeaseUntil"
         FROM sys_ai_provider_circuit WHERE provider_id = ? AND purpose = 'chat'`,
      )
      .get(provider.lastInsertRowid)) as { state: string; probeLeaseUntil: string | null };
    expect(persisted.state).toBe("half_open");
    expect(persisted.probeLeaseUntil).toBeTruthy();
  });

  it("uses a protocol-initialized MCP session and keeps discovered tools disabled until allowlisted", async () => {
    const serverId = await saveAiMcpServer({
      userId: 1,
      payload: {
        name: "Test MCP",
        code: "test-mcp",
        endpointUrl: "https://mcp.test/rpc",
        transport: "streamable_http",
        oauthMode: "none",
        status: "active",
      },
    });
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { method: string };
      if (payload.method === "initialize") {
        return Response.json(
          { jsonrpc: "2.0", id: "init", result: { protocolVersion: "2025-06-18" } },
          { headers: { "mcp-session-id": "session-1" } },
        );
      }
      if (payload.method === "notifications/initialized")
        return new Response(null, { status: 202 });
      if (payload.method === "tools/list") {
        return Response.json({
          jsonrpc: "2.0",
          id: "list",
          result: {
            tools: [
              {
                name: "search_docs",
                title: "Search docs",
                inputSchema: { type: "object", properties: { query: { type: "string" } } },
              },
            ],
          },
        });
      }
      return Response.json({
        jsonrpc: "2.0",
        id: "call",
        result: { content: [{ type: "text", text: "MCP result" }] },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveAiMcpServer({
        userId: 1,
        payload: {
          name: "Unsafe MCP",
          code: "unsafe-mcp",
          endpointUrl: "http://example.com/rpc",
        },
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(await syncAiMcpTools({ serverId, userId: 1 })).toMatchObject({ discovered: 1 });
    const tool = (await sqlite
      .prepare(
        `SELECT mcp.id, mirrored.status AS "mirroredStatus", mirrored.config_json AS "configJson"
         FROM sys_ai_mcp_tool mcp
         INNER JOIN sys_ai_tool mirrored
           ON mirrored.config_json::jsonb->>'mcpToolId' = mcp.id::text
         WHERE mcp.server_id = ?`,
      )
      .get(serverId)) as { id: number; mirroredStatus: number; configJson: string };
    expect(tool.mirroredStatus).toBe(0);

    await setAiMcpToolPolicy({
      id: tool.id,
      userId: 1,
      allowlisted: true,
      riskLevel: "medium",
      approvalRequired: true,
      status: 1,
    });
    const result = await executeMcpGatewayTool({
      configJson: tool.configJson,
      arguments: { query: "x" },
      userId: 1,
    });
    expect(result).toMatchObject({ content: [{ text: "MCP result" }] });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const callHeaders = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);
    expect(callHeaders.get("mcp-session-id")).toBe("session-1");
    expect(await listAiMcpServers()).toEqual([
      expect.objectContaining({ id: serverId, hasClientSecret: false, allowedToolCount: 1 }),
    ]);

    const connection = await sqlite
      .prepare("INSERT INTO sys_ai_mcp_connection (server_id, user_id, status) VALUES (?, 1, 'connected') RETURNING id")
      .run(serverId);
    await sqlite
      .prepare("UPDATE sys_ai_mcp_session SET connection_id = ? WHERE server_id = ? AND user_id = 1")
      .run(connection.lastInsertRowid, serverId);
    await disconnectAiMcpConnection(Number(connection.lastInsertRowid));
    expect(
      (await sqlite.prepare("SELECT status FROM sys_ai_mcp_session WHERE server_id = ? AND user_id = 1").get(serverId)) as { status: string },
    ).toEqual({ status: "closed" });
  });

  it("serves authenticated read-only system catalog MCP tools without exposing contact fields", async () => {
    await saveAiMcpServer({
      userId: 1,
      payload: {
        name: "Admin Base System",
        code: "admin-base-system",
        endpointUrl: "https://admin-base.test/api/system/ai/governance/mcp/internal",
        transport: "streamable_http",
        oauthMode: "client_credentials",
        clientId: "admin-base-system-client",
        clientSecret: "test-internal-mcp-secret",
        tokenUrl: "https://admin-base.test/api/system/ai/governance/mcp/internal/oauth/token",
        scopes: "system.read",
        status: "active",
      },
    });
    const invalidToken = await app.request("/api/system/ai/governance/mcp/internal/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: "admin-base-system-client",
        client_secret: "wrong-secret",
      }).toString(),
    });
    expect(invalidToken.status).toBe(401);
    const tokenResponse = await app.request("/api/system/ai/governance/mcp/internal/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: "admin-base-system-client",
        client_secret: "test-internal-mcp-secret",
      }).toString(),
    });
    expect(tokenResponse.status).toBe(200);
    const token = (await tokenResponse.json()) as { access_token: string };
    const missingUser = await app.request("/api/system/ai/governance/mcp/internal", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: "tools", method: "tools/list" }),
    });
    expect(missingUser.status).toBe(401);
    const rpc = async (payload: Record<string, unknown>) =>
      app.request("/api/system/ai/governance/mcp/internal", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token.access_token}`,
          "content-type": "application/json",
          "x-admin-base-user-id": "1",
        },
        body: JSON.stringify(payload),
      });
    const initializedResponse = await rpc({ jsonrpc: "2.0", id: "init", method: "initialize" });
    expect(initializedResponse.status).toBe(200);
    const initialized = await initializedResponse.json();
    expect(initialized).toMatchObject({
      result: { serverInfo: { name: "admin-base-system" }, capabilities: { tools: {} } },
    });
    const toolsResponse = await rpc({ jsonrpc: "2.0", id: "tools", method: "tools/list" });
    const tools = await toolsResponse.json();
    expect(tools).toMatchObject({ result: { tools: expect.any(Array) } });
    expect((tools as { result: { tools: unknown[] } }).result.tools).toHaveLength(5);

    const pages = (await (
      await rpc({
        jsonrpc: "2.0",
        id: "pages",
        method: "tools/call",
        params: { name: "list_pages", arguments: { limit: 100 } },
      })
    ).json()) as { result: { structuredContent: Array<{ path: string }> } };
    expect(pages.result.structuredContent.length).toBeGreaterThan(10);
    expect(pages.result.structuredContent).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/system/ai/chat" })]),
    );
    const menu = (await (
      await rpc({
        jsonrpc: "2.0",
        id: "menu",
        method: "tools/call",
        params: { name: "list_menu_tree", arguments: {} },
      })
    ).json()) as { result: { structuredContent: { tree: Array<{ name: string }> } } };
    expect(menu.result.structuredContent.tree.length).toBeGreaterThan(1);
    expect(menu.result.structuredContent.tree).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "系统管理" })]),
    );

    const overview = await (
      await rpc({
        jsonrpc: "2.0",
        id: "overview",
        method: "tools/call",
        params: { name: "get_system_overview", arguments: {} },
      })
    ).json();
    expect(overview).toMatchObject({
      result: {
        structuredContent: {
          pageCount: expect.any(Number),
          permissionCount: expect.any(Number),
          userCount: expect.any(Number),
        },
      },
    });
    const personnel = await (
      await rpc({
        jsonrpc: "2.0",
        id: "personnel",
        method: "tools/call",
        params: { name: "list_personnel", arguments: { page: 1, pageSize: 10 } },
      })
    ).json();
    const personnelJson = JSON.stringify(personnel);
    expect(personnelJson).toContain("admin");
    expect(personnelJson).not.toContain("passwordHash");
    expect(personnelJson).not.toContain('"email"');
    expect(personnelJson).not.toContain('"mobile"');
  });

  it("provisions the built-in system MCP, allowlists its tools, and binds a system Agent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const target = new URL(typeof url === "string" ? url : url instanceof URL ? url : url.url);
        expect(target.origin).toBe("http://localhost");
        return app.request(`${target.pathname}${target.search}`, init);
      }),
    );
    const unauthorized = await app.request("/api/system/ai/governance/mcp/internal/provision", {
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);
    const token = await login();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_BASE_ADMIN_PASSWORD", "AdminBase-Test-Production-Password-2026!");
    vi.stubEnv("ADMIN_BASE_PUBLIC_URL", "https://admin.example.test");
    const response = await app.request("/api/system/ai/governance/mcp/internal/provision", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    const responseText = await response.text();
    expect(response.status, responseText).toBe(200);
    const body = JSON.parse(responseText) as {
      data?: { discoveredTools?: number; allowedTools?: number };
    };
    const result = body.data;
    expect(result).toMatchObject({ discoveredTools: 5, allowedTools: 5 });

    const server = (await sqlite
      .prepare(
        `SELECT id, status FROM sys_ai_mcp_server
         WHERE code = ? AND deleted_at IS NULL`,
      )
      .get(INTERNAL_SYSTEM_MCP_CODE)) as { id: number; status: string };
    expect(server.status).toBe("active");
    const policies = (await sqlite
      .prepare(
        `SELECT allowlisted, approval_required AS "approvalRequired", risk_level AS "riskLevel", status
         FROM sys_ai_mcp_tool WHERE server_id = ? ORDER BY id`,
      )
      .all(server.id)) as Array<Record<string, unknown>>;
    expect(policies).toHaveLength(5);
    expect(policies).toEqual(
      policies.map(() => ({
        allowlisted: true,
        approvalRequired: false,
        riskLevel: "low",
        status: 1,
      })),
    );
    const agent = (await sqlite
      .prepare(
        `SELECT id, name, status, is_system AS "isSystem" FROM sys_ai_agent
         WHERE code = ? AND deleted_at IS NULL`,
      )
      .get(INTERNAL_SYSTEM_MCP_AGENT_CODE)) as {
      id: number;
      name: string;
      status: number;
      isSystem: boolean;
    };
    expect(agent).toMatchObject({ name: "系统数据盘点助手", status: 1, isSystem: true });
    const binding = (await sqlite
      .prepare("SELECT COUNT(*)::int AS total FROM sys_ai_agent_tool WHERE agent_id = ?")
      .get(agent.id)) as { total: number };
    expect(binding.total).toBe(5);
    const log = (await sqlite
      .prepare(
        `SELECT risk_level AS "riskLevel", details_json AS "detailsJson"
         FROM sys_operation_log WHERE module = 'system.aiMcp'
           AND action = 'provisionInternalServer' ORDER BY id DESC LIMIT 1`,
      )
      .get()) as { riskLevel: string; detailsJson: string };
    expect(log.riskLevel).toBe("critical");
    expect(log.detailsJson).toContain('"mode":"read_only"');
    expect(log.detailsJson).not.toContain("clientSecret");
  });

  it("deduplicates jobs and prevents two workers from claiming the same queue item", async () => {
    const first = await enqueueAiJob({
      jobType: "eval_dataset",
      payload: { datasetId: 1 },
      userId: 1,
      idempotencyKey: "eval-dataset-1",
    });
    const duplicate = await enqueueAiJob({
      jobType: "eval_dataset",
      payload: { datasetId: 1 },
      userId: 1,
      idempotencyKey: "eval-dataset-1",
    });
    expect(duplicate).toBe(first);

    const [workerA, workerB] = await Promise.all([claimAiJob("worker-a"), claimAiJob("worker-b")]);
    expect([workerA, workerB].filter(Boolean)).toHaveLength(1);
    await cancelAiJob(first);
    await expect(cancelAiJob(first)).rejects.toMatchObject({ status: 409 });
  });

  it("reports stale queued jobs and expired leases as degraded Worker queue health", async () => {
    const jobId = await enqueueAiJob({
      jobType: "eval_dataset",
      payload: { datasetId: 1 },
      userId: 1,
      idempotencyKey: "worker-health-1",
    });
    expect(await getAiWorkerQueueHealth(10)).toMatchObject({
      status: "healthy",
      queuedCount: 1,
      stalledQueuedCount: 0,
      expiredLeaseCount: 0,
    });

    await sqlite
      .prepare("UPDATE sys_ai_job SET available_at = now() - interval '20 seconds' WHERE id = ?")
      .run(jobId);
    expect(await getAiWorkerQueueHealth(10)).toMatchObject({
      status: "degraded",
      queuedCount: 1,
      stalledQueuedCount: 1,
      expiredLeaseCount: 0,
    });

    await claimAiJob("worker-health-test", 120);
    await sqlite
      .prepare("UPDATE sys_ai_job SET lease_until = now() - interval '1 second' WHERE id = ?")
      .run(jobId);
    expect(await getAiWorkerQueueHealth(10)).toMatchObject({
      status: "degraded",
      queuedCount: 0,
      stalledQueuedCount: 0,
      expiredLeaseCount: 1,
    });
  });

  it("aggregates department quota across users instead of treating it as a per-user limit", async () => {
    const admin = (await sqlite
      .prepare("SELECT id, dept_id AS \"deptId\" FROM sys_user WHERE username = 'admin'")
      .get()) as { id: number; deptId: number };
    const secondUser = await sqlite
      .prepare(
        `INSERT INTO sys_user (username, nickname, password_hash, dept_id, status)
         VALUES ('quota-peer', 'Quota Peer', 'not-used', ?, 1) RETURNING id`,
      )
      .run(admin.deptId);
    await sqlite
      .prepare(
        `INSERT INTO sys_ai_quota_policy
         (name, subject_type, subject_id, period, max_input_tokens, currency, status)
         VALUES ('Department shared quota', 'department', ?, 'monthly', 100, 'USD', 1)`,
      )
      .run(admin.deptId);
    for (const userId of [admin.id, Number(secondUser.lastInsertRowid)]) {
      await sqlite
        .prepare(
          `INSERT INTO sys_ai_invocation
           (purpose, source_type, user_id, status, input_tokens, output_tokens, finished_at)
           VALUES ('chat', 'quota-test', ?, 'completed', 60, 0, now())`,
        )
        .run(userId);
    }
    await expect(assertAiQuotaAvailable(admin.id)).rejects.toMatchObject({ status: 429 });
  });
});
