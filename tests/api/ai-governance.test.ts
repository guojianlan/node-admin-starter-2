import { beforeEach, describe, expect, it, vi } from "vitest";
import { sqlite } from "@/server/db";
import {
  acquireAiCircuitPermission,
  assertAiQuotaAvailable,
  cancelAiJob,
  deleteAiRuntimeSkill,
  executeMcpGatewayTool,
  listAiMcpServers,
  resolveAgentGovernedContext,
  saveAiMcpServer,
  saveAiMemory,
  saveAiRuntimeSkill,
  setAiMcpToolPolicy,
  syncAiMcpTools,
} from "@/server/services/ai-governance-service";
import { claimAiJob, enqueueAiJob } from "@/server/services/ai-job-service";
import { resetTestDatabase } from "../helpers/db";

beforeEach(async () => {
  vi.unstubAllGlobals();
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
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const callHeaders = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);
    expect(callHeaders.get("mcp-session-id")).toBe("session-1");
    expect(await listAiMcpServers()).toEqual([
      expect.objectContaining({ id: serverId, hasClientSecret: false, allowedToolCount: 1 }),
    ]);
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
