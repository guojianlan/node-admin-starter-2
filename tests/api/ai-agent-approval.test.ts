import { beforeAll, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, sqlite } from "../helpers/db";
import {
  appendAgentRunStep,
  appendAgentRunEvent,
  AiApprovalDecisionConflictError,
  AiAgentRunLeaseLostError,
  claimAgentRunLease,
  createAgentRun,
  createAgentRunLease,
  createToolApproval,
  decideToolApproval,
  executeAgentTool,
  finishAgentRun,
  heartbeatAgentRun,
  listAiAgents,
  listAiAgentRunEvents,
  listAiTools,
  saveAiTool,
} from "@/server/services/ai-agent-service";
import { saveAiMcpServer, setAiMcpToolPolicy } from "@/server/services/ai-governance-service";

beforeAll(async () => {
  await resetTestDatabase();
});

async function createApprovalFixture(toolCode: string, toolInput: Record<string, unknown>) {
  const agent = (await sqlite
    .prepare(
      "SELECT id FROM sys_ai_agent WHERE code = 'module-development-agent' AND deleted_at IS NULL",
    )
    .get()) as { id: number } | undefined;
  if (!agent) throw new Error("Missing seeded module development agent");
  const sessionResult = await sqlite
    .prepare(
      `INSERT INTO sys_ai_chat_session (user_id, title, agent_id, status, created_by, updated_by)
       VALUES (1, ?, ?, 1, 1, 1) RETURNING id`,
    )
    .run(`approval-${toolCode}-${Date.now()}`, agent.id);
  const sessionId = Number(sessionResult.lastInsertRowid);
  const runId = await createAgentRun({ sessionId, agentId: agent.id, userId: 1 });
  const tools = await listAiTools({ activeOnly: true, agentId: agent.id });
  const tool = tools.find((item) => item.code === toolCode);
  if (!tool) throw new Error(`Missing seeded tool: ${toolCode}`);
  const stepId = await appendAgentRunStep({
    runId,
    stepNo: 1,
    stepType: "approval",
    status: "waiting_approval",
    toolId: tool.id,
    toolName: tool.code,
    toolCallId: `call-${Date.now()}-${Math.random()}`,
    input: toolInput,
  });
  return { sessionId, runId, stepId, tool };
}

describe("AI Agent approval governance", () => {
  it("fences Agent Run attempts with a lease owner and heartbeat", async () => {
    const agent = (await sqlite
      .prepare("SELECT id FROM sys_ai_agent WHERE code = 'module-development-agent'")
      .get()) as { id: number };
    const sessionResult = await sqlite
      .prepare(
        `INSERT INTO sys_ai_chat_session (user_id, title, agent_id, status, created_by, updated_by)
         VALUES (1, 'run lease test', ?, 1, 1, 1) RETURNING id`,
      )
      .run(agent.id);
    const sessionId = Number(sessionResult.lastInsertRowid);
    const run = await createAgentRunLease({
      sessionId,
      agentId: agent.id,
      userId: 1,
      leaseSeconds: 30,
    });

    expect(run).toMatchObject({ attempt: 1 });
    expect(run.leaseOwner).toMatch(/^admin-base-agent-run-/);
    expect(run.leaseUntil).toBeTruthy();
    await expect(heartbeatAgentRun({ id: run.id, leaseOwner: run.leaseOwner })).resolves.toBeUndefined();
    await expect(
      heartbeatAgentRun({ id: run.id, leaseOwner: "stale-agent-attempt" }),
    ).rejects.toBeInstanceOf(AiAgentRunLeaseLostError);

    const stepId = await appendAgentRunStep({
      runId: run.id,
      stepNo: 1,
      stepType: "model",
      status: "completed",
      output: { ok: true },
      leaseOwner: run.leaseOwner,
    });
    expect(stepId).toBeGreaterThan(0);
    const firstEvent = await appendAgentRunEvent({
      runId: run.id,
      eventType: "meta",
      payload: { runId: run.id },
      leaseOwner: run.leaseOwner,
    });
    const secondEvent = await appendAgentRunEvent({
      runId: run.id,
      eventType: "delta",
      payload: { text: "hello" },
      leaseOwner: run.leaseOwner,
    });
    expect(secondEvent.sequence).toBe(firstEvent.sequence + 1);
    await expect(
      listAiAgentRunEvents({ runId: run.id, userId: 1, afterEventId: firstEvent.id }),
    ).resolves.toMatchObject([{ id: secondEvent.id, eventType: "delta" }]);
    await expect(
      appendAgentRunStep({
        runId: run.id,
        stepNo: 2,
        stepType: "tool",
        status: "completed",
        leaseOwner: "stale-agent-attempt",
      }),
    ).rejects.toBeInstanceOf(AiAgentRunLeaseLostError);

    await finishAgentRun({
      id: run.id,
      status: "completed",
      totalSteps: 1,
      leaseOwner: run.leaseOwner,
    });
    const completed = (await sqlite
      .prepare(
        `SELECT status, lease_owner AS "leaseOwner", lease_until AS "leaseUntil"
         FROM sys_ai_agent_run WHERE id = ?`,
      )
      .get(run.id)) as { status: string; leaseOwner: string | null; leaseUntil: string | null };
    expect(completed).toEqual({ status: "completed", leaseOwner: null, leaseUntil: null });

    await finishAgentRun({ id: run.id, status: "failed", leaseOwner: "stale-agent-attempt" });
    const unchanged = (await sqlite
      .prepare("SELECT status FROM sys_ai_agent_run WHERE id = ?")
      .get(run.id)) as { status: string };
    expect(unchanged.status).toBe("completed");
  });

  it("rejects all writes and tool execution after a lease expires", async () => {
    const agent = (await sqlite
      .prepare("SELECT id FROM sys_ai_agent WHERE code = 'module-development-agent'")
      .get()) as { id: number };
    const sessionResult = await sqlite
      .prepare(
        `INSERT INTO sys_ai_chat_session (user_id, title, agent_id, status, created_by, updated_by)
         VALUES (1, 'expired run lease test', ?, 1, 1, 1) RETURNING id`,
      )
      .run(agent.id);
    const run = await createAgentRunLease({
      sessionId: Number(sessionResult.lastInsertRowid),
      agentId: agent.id,
      userId: 1,
    });
    const tool = (await listAiTools({ activeOnly: true, agentId: agent.id })).find(
      (item) => item.code === "module_design",
    );
    if (!tool) throw new Error("Missing module_design tool");
    const stepId = await appendAgentRunStep({
      runId: run.id,
      stepNo: 1,
      stepType: "approval",
      status: "waiting_approval",
      toolId: tool.id,
      toolName: tool.code,
      toolCallId: `expired-approval-${Date.now()}`,
      input: { contract: { name: "expired", title: "must not approve", fields: [] } },
      leaseOwner: run.leaseOwner,
    });
    await sqlite
      .prepare("UPDATE sys_ai_agent_run SET lease_until = now() - interval '1 second' WHERE id = ?")
      .run(run.id);

    await expect(heartbeatAgentRun({ id: run.id, leaseOwner: run.leaseOwner })).rejects.toBeInstanceOf(
      AiAgentRunLeaseLostError,
    );
    await expect(
      executeAgentTool(
        tool,
        { contract: { name: `expired-${Date.now()}`, title: "must not execute", fields: [] } },
        { userId: 1, runId: run.id, leaseOwner: run.leaseOwner },
      ),
    ).rejects.toBeInstanceOf(AiAgentRunLeaseLostError);
    await expect(
      createToolApproval({
        runId: run.id,
        stepId,
        sessionId: Number(sessionResult.lastInsertRowid),
        userId: 1,
        tool,
        toolName: tool.code,
        toolCallId: `expired-approval-${Date.now()}`,
        toolInput: { contract: { name: "expired", title: "must not approve", fields: [] } },
        leaseOwner: run.leaseOwner,
      }),
    ).rejects.toBeInstanceOf(AiAgentRunLeaseLostError);
    await expect(
      appendAgentRunStep({
        runId: run.id,
        stepNo: 1,
        stepType: "model",
        status: "completed",
        leaseOwner: run.leaseOwner,
      }),
    ).rejects.toBeInstanceOf(AiAgentRunLeaseLostError);
    await finishAgentRun({ id: run.id, status: "failed", leaseOwner: run.leaseOwner });
    const unchanged = (await sqlite
      .prepare("SELECT status, lease_owner AS \"leaseOwner\" FROM sys_ai_agent_run WHERE id = ?")
      .get(run.id)) as { status: string; leaseOwner: string | null };
    expect(unchanged).toEqual({ status: "running", leaseOwner: run.leaseOwner });
  });

  it("reuses a completed tool result for the same run attempt and tool call", async () => {
    const agent = (await sqlite
      .prepare("SELECT id FROM sys_ai_agent WHERE code = 'general-assistant'")
      .get()) as { id: number };
    const sessionResult = await sqlite
      .prepare(
        `INSERT INTO sys_ai_chat_session (user_id, title, agent_id, status, created_by, updated_by)
         VALUES (1, 'tool idempotency test', ?, 1, 1, 1) RETURNING id`,
      )
      .run(agent.id);
    const run = await createAgentRunLease({
      sessionId: Number(sessionResult.lastInsertRowid),
      agentId: agent.id,
      userId: 1,
    });
    const tool = (await listAiTools({ activeOnly: true, agentId: agent.id })).find(
      (item) => item.code === "calculator",
    );
    if (!tool) throw new Error("Missing calculator tool");

    const first = await executeAgentTool(
      tool,
      { expression: "2 + 2" },
      { userId: 1, runId: run.id, leaseOwner: run.leaseOwner, toolCallId: "calc-call-1" },
    );
    const replay = await executeAgentTool(
      tool,
      { expression: "999" },
      { userId: 1, runId: run.id, leaseOwner: run.leaseOwner, toolCallId: "calc-call-1" },
    );

    expect(first).toEqual({ expression: "2 + 2", result: 4 });
    expect(replay).toEqual(first);
    const records = (await sqlite
      .prepare(
        `SELECT COUNT(*)::int AS total, MAX(status) AS status
         FROM sys_ai_tool_execution WHERE run_id = ? AND tool_call_id = 'calc-call-1'`,
      )
      .get(run.id)) as { total: number; status: string };
    expect(records).toEqual({ total: 1, status: "completed" });
  });

  it("atomically reclaims one expired Agent Run and fences the previous worker", async () => {
    const agent = (await sqlite
      .prepare("SELECT id FROM sys_ai_agent WHERE code = 'general-assistant'")
      .get()) as { id: number };
    const sessionResult = await sqlite
      .prepare(
        `INSERT INTO sys_ai_chat_session (user_id, title, agent_id, status, created_by, updated_by)
         VALUES (1, 'agent worker reclaim test', ?, 1, 1, 1) RETURNING id`,
      )
      .run(agent.id);
    const first = await createAgentRunLease({
      sessionId: Number(sessionResult.lastInsertRowid),
      agentId: agent.id,
      userId: 1,
    });
    await sqlite
      .prepare("UPDATE sys_ai_agent_run SET lease_until = now() - interval '1 second' WHERE id = ?")
      .run(first.id);

    const [workerA, workerB] = await Promise.all([
      claimAgentRunLease({ workerId: "agent-worker-a", leaseSeconds: 30 }),
      claimAgentRunLease({ workerId: "agent-worker-b", leaseSeconds: 30 }),
    ]);
    const claims = [workerA, workerB].filter((claim) => claim?.id === first.id);
    expect(claims).toHaveLength(1);
    const takeover = claims[0];
    if (!takeover) throw new Error("Missing Agent Run takeover");
    expect(takeover.attempt).toBe(2);
    expect(takeover.leaseOwner).toMatch(/^agent-worker-/);
    await expect(
      heartbeatAgentRun({ id: first.id, leaseOwner: first.leaseOwner }),
    ).rejects.toBeInstanceOf(AiAgentRunLeaseLostError);
    await expect(
      heartbeatAgentRun({ id: first.id, leaseOwner: takeover.leaseOwner }),
    ).resolves.toBeUndefined();
  });

  it("increments the attempt when an approval continuation takes over a waiting run", async () => {
    const agent = (await sqlite
      .prepare("SELECT id FROM sys_ai_agent WHERE code = 'module-development-agent'")
      .get()) as { id: number };
    const sessionResult = await sqlite
      .prepare(
        `INSERT INTO sys_ai_chat_session (user_id, title, agent_id, status, created_by, updated_by)
         VALUES (1, 'continuation lease test', ?, 1, 1, 1) RETURNING id`,
      )
      .run(agent.id);
    const sessionId = Number(sessionResult.lastInsertRowid);
    const first = await createAgentRunLease({
      sessionId,
      agentId: agent.id,
      userId: 1,
    });
    const approvalResult = await sqlite
      .prepare(
        `INSERT INTO sys_ai_tool_approval
          (run_id, session_id, user_id, tool_name, tool_call_id, expires_at, status)
         VALUES (?, ?, 1, 'continuation-test', ?, now() + interval '30 minutes', 'pending')
         RETURNING id`,
      )
      .run(first.id, sessionId, `continuation-${Date.now()}`);
    const approvalId = Number(approvalResult.lastInsertRowid);
    await sqlite
      .prepare("UPDATE sys_ai_agent_run SET source_approval_id = ?, status = 'waiting_continuation', lease_owner = NULL, lease_until = NULL WHERE id = ?")
      .run(approvalId, first.id);
    const second = await createAgentRunLease({
      sessionId,
      agentId: agent.id,
      userId: 1,
      sourceApprovalId: approvalId,
    });
    expect(second.id).toBe(first.id);
    expect(second.attempt).toBe(2);
    expect(second.leaseOwner).not.toBe(first.leaseOwner);
    await expect(
      appendAgentRunStep({
        runId: first.id,
        stepNo: 1,
        stepType: "model",
        status: "completed",
        leaseOwner: first.leaseOwner,
      }),
    ).rejects.toBeInstanceOf(AiAgentRunLeaseLostError);
    await expect(
      appendAgentRunStep({
        runId: second.id,
        stepNo: 1,
        stepType: "model",
        status: "completed",
        leaseOwner: second.leaseOwner,
      }),
    ).resolves.toBeGreaterThan(0);
  });

  it("seeds the development agent and records constrained tool actions in operation logs", async () => {
    const agents = await listAiAgents();
    const developmentAgent = agents.find((item) => item.code === "module-development-agent");
    expect(developmentAgent).toMatchObject({ name: "模块开发助手", isSystem: true, status: 1 });
    if (!developmentAgent) throw new Error("Missing seeded module development agent");

    const tools = await listAiTools({ activeOnly: true, agentId: developmentAgent.id });
    expect(tools.map((item) => item.code)).toEqual([
      "module_design",
      "module_generate_draft",
      "module_preview_diff",
      "module_validate",
      "module_publish",
      "module_rollback",
    ]);

    const designTool = tools[0];
    if (!designTool) throw new Error("Missing module_design tool");
    const result = await executeAgentTool(
      designTool,
      {
        contract: {
          name: "cms-config",
          title: "CMS 配置",
          fields: [{ name: "name", label: "名称", required: true }],
        },
      },
      { userId: 1 },
    );
    expect(result).toMatchObject({ name: "cms-config", title: "CMS 配置" });
    const log = (await sqlite
      .prepare(
        `SELECT action, success, resource_id AS "resourceId", details_json AS "detailsJson"
         FROM sys_operation_log
         WHERE module = 'system.moduleGenerator.agent' AND action = 'module_design'
         ORDER BY id DESC LIMIT 1`,
      )
      .get()) as
      | { action: string; success: boolean; resourceId: string; detailsJson: string }
      | undefined;
    expect(log).toMatchObject({
      action: "module_design",
      success: true,
      resourceId: "cms-config",
    });
    expect(JSON.parse(log?.detailsJson ?? "{}")).toMatchObject({ toolCode: "module_design" });

    const publishTool = tools.find((item) => item.code === "module_publish");
    if (!publishTool) throw new Error("Missing module_publish tool");
    await expect(
      saveAiTool({
        ...publishTool,
        riskLevel: "low",
        approvalRequired: false,
        userId: 1,
      }),
    ).rejects.toThrow(/系统固定/);
  });

  it("rejects an approval once and refuses replay without executing the tool", async () => {
    const fixture = await createApprovalFixture("module_publish", {
      name: "module-that-must-not-exist",
      planHash: "b".repeat(64),
    });
    const approvalResult = await sqlite
      .prepare(
        `INSERT INTO sys_ai_tool_approval
          (run_id, step_id, session_id, user_id, tool_id, tool_name, tool_call_id, input_json,
           plan_hash, affected_files_json, validation_json, expires_at, status)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, now() + interval '30 minutes', 'pending')
         RETURNING id`,
      )
      .run(
        fixture.runId,
        fixture.stepId,
        fixture.sessionId,
        fixture.tool.id,
        fixture.tool.code,
        `deny-${Date.now()}`,
        JSON.stringify({ name: "module-that-must-not-exist", planHash: "b".repeat(64) }),
        "b".repeat(64),
        JSON.stringify(["src/should-not-exist.ts"]),
        JSON.stringify({ command: "pnpm admin:verify", passed: true, output: "ok" }),
      );
    const approvalId = Number(approvalResult.lastInsertRowid);

    await expect(
      decideToolApproval({
        id: approvalId,
        userId: 1,
        approved: false,
        reason: "人工拒绝发布",
      }),
    ).resolves.toMatchObject({ status: "denied", output: null });
    await expect(decideToolApproval({ id: approvalId, userId: 1, approved: true })).rejects.toThrow(
      /已经处理/,
    );

    const approval = (await sqlite
      .prepare(
        `SELECT status, decided_by AS "decidedBy", decided_at AS "decidedAt",
          plan_hash AS "planHash", affected_files_json AS "affectedFilesJson",
          validation_json AS "validationJson"
         FROM sys_ai_tool_approval WHERE id = ?`,
      )
      .get(approvalId)) as Record<string, unknown>;
    expect(approval).toMatchObject({
      status: "denied",
      decidedBy: 1,
      planHash: "b".repeat(64),
    });
    expect(approval.decidedAt).toBeTruthy();
    expect(JSON.parse(String(approval.affectedFilesJson))).toEqual(["src/should-not-exist.ts"]);
    expect(JSON.parse(String(approval.validationJson))).toMatchObject({ passed: true });

    const step = (await sqlite
      .prepare("SELECT status FROM sys_ai_agent_run_step WHERE id = ?")
      .get(fixture.stepId)) as { status: string };
    const run = (await sqlite
      .prepare("SELECT status FROM sys_ai_agent_run WHERE id = ?")
      .get(fixture.runId)) as { status: string };
    expect(step.status).toBe("denied");
    expect(run.status).toBe("stopped");
  });

  it("atomically claims an approval so concurrent decisions execute the tool once", async () => {
    const moduleName = `approval-atomic-${Date.now()}`;
    const fixture = await createApprovalFixture("module_design", {
      contract: {
        name: moduleName,
        title: "并发审批测试",
        fields: [{ name: "name", label: "名称", required: true }],
      },
    });
    const approvalResult = await sqlite
      .prepare(
        `INSERT INTO sys_ai_tool_approval
          (run_id, step_id, session_id, user_id, tool_id, tool_name, tool_call_id, input_json,
           expires_at, status)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, now() + interval '30 minutes', 'pending')
         RETURNING id`,
      )
      .run(
        fixture.runId,
        fixture.stepId,
        fixture.sessionId,
        fixture.tool.id,
        fixture.tool.code,
        `atomic-${Date.now()}`,
        JSON.stringify({
          contract: {
            name: moduleName,
            title: "并发审批测试",
            fields: [{ name: "name", label: "名称", required: true }],
          },
        }),
      );
    const approvalId = Number(approvalResult.lastInsertRowid);

    const decisions = await Promise.allSettled([
      decideToolApproval({ id: approvalId, userId: 1, approved: true }),
      decideToolApproval({ id: approvalId, userId: 1, approved: true }),
    ]);

    expect(decisions.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const rejected = decisions.find((item) => item.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(AiApprovalDecisionConflictError),
    });
    const approval = (await sqlite
      .prepare("SELECT status FROM sys_ai_tool_approval WHERE id = ?")
      .get(approvalId)) as { status: string };
    expect(approval.status).toBe("executed");
    const logs = (await sqlite
      .prepare(
        `SELECT COUNT(1)::int AS total FROM sys_operation_log
         WHERE module = 'system.moduleGenerator.agent'
           AND action = 'module_design'
           AND resource_id = ?`,
      )
      .get(moduleName)) as { total: number };
    expect(logs.total).toBe(1);
    const resultMessages = (await sqlite
      .prepare(
        `SELECT COUNT(1)::int AS total FROM sys_ai_chat_message
         WHERE session_id = ? AND content LIKE '[已审批工具执行结果]%'`,
      )
      .get(fixture.sessionId)) as { total: number };
    expect(resultMessages.total).toBe(1);
  });

  it("preserves MCP gateway config when an approved tool is resumed", async () => {
    const serverId = await saveAiMcpServer({
      userId: 1,
      payload: {
        name: "Approval MCP",
        code: `approval-mcp-${Date.now()}`,
        endpointUrl: "https://approval-mcp.test/rpc",
        transport: "streamable_http",
        oauthMode: "none",
        status: "active",
      },
    });
    const mcpToolResult = await sqlite
      .prepare(
        `INSERT INTO sys_ai_mcp_tool
          (server_id, remote_name, display_name, description, allowlisted, status)
         VALUES (?, 'list_records', 'List records', 'Read records', true, 1)
         RETURNING id`,
      )
      .run(serverId);
    const mcpToolId = Number(mcpToolResult.lastInsertRowid);
    await setAiMcpToolPolicy({
      id: mcpToolId,
      userId: 1,
      allowlisted: true,
      riskLevel: "low",
      approvalRequired: true,
      status: 1,
    });
    const mirroredToolResult = await sqlite
      .prepare(
        `INSERT INTO sys_ai_tool
          (name, code, description, handler_key, config_json, risk_level,
           approval_required, status, is_system, created_by, updated_by)
         VALUES ('List records', ?, 'Read records', 'mcp_gateway', ?, 'low', true, 1, true, 1, 1)
         RETURNING id`,
      )
      .run(
        `approval-mcp-tool-${Date.now()}`,
        JSON.stringify({ serverId, mcpToolId, remoteName: "list_records" }),
      );
    const mirroredToolId = Number(mirroredToolResult.lastInsertRowid);
    const agent = (await sqlite
      .prepare("SELECT id FROM sys_ai_agent WHERE code = 'module-development-agent'")
      .get()) as { id: number };
    const sessionResult = await sqlite
      .prepare(
        `INSERT INTO sys_ai_chat_session (user_id, title, agent_id, status, created_by, updated_by)
         VALUES (1, 'MCP approval resume', ?, 1, 1, 1) RETURNING id`,
      )
      .run(agent.id);
    const sessionId = Number(sessionResult.lastInsertRowid);
    const runId = await createAgentRun({ sessionId, agentId: agent.id, userId: 1 });
    const stepId = await appendAgentRunStep({
      runId,
      stepNo: 1,
      stepType: "approval",
      status: "waiting_approval",
      toolId: mirroredToolId,
      toolName: "approval-mcp-tool",
      toolCallId: `mcp-approval-${Date.now()}`,
      input: { includeHidden: true },
    });
    const approvalResult = await sqlite
      .prepare(
        `INSERT INTO sys_ai_tool_approval
          (run_id, step_id, session_id, user_id, tool_id, tool_name, tool_call_id, input_json,
           expires_at, status)
         VALUES (?, ?, ?, 1, ?, 'approval-mcp-tool', ?, ?, now() + interval '30 minutes', 'pending')
         RETURNING id`,
      )
      .run(
        runId,
        stepId,
        sessionId,
        mirroredToolId,
        `mcp-approval-${Date.now()}`,
        JSON.stringify({ includeHidden: true }),
      );

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body)) as { method: string };
        if (payload.method === "initialize") {
          return Response.json(
            { jsonrpc: "2.0", id: "initialize", result: { protocolVersion: "2025-06-18" } },
            { headers: { "mcp-session-id": "approval-session" } },
          );
        }
        if (payload.method === "notifications/initialized")
          return new Response(null, { status: 202 });
        return Response.json({
          jsonrpc: "2.0",
          id: "call",
          result: { content: [{ type: "text", text: "approved" }] },
        });
      }),
    );

    const result = await decideToolApproval({
      id: Number(approvalResult.lastInsertRowid),
      userId: 1,
      approved: true,
    });
    expect(result).toMatchObject({ status: "executed", sessionId });
    const approval = (await sqlite
      .prepare("SELECT status, reason FROM sys_ai_tool_approval WHERE id = ?")
      .get(approvalResult.lastInsertRowid)) as { status: string; reason: string | null };
    expect(approval).toEqual({ status: "executed", reason: null });
  });

  it("expires pending approvals and leaves the requested tool unexecuted", async () => {
    const fixture = await createApprovalFixture("module_publish", {
      name: "expired-module",
      planHash: "c".repeat(64),
    });
    const approvalResult = await sqlite
      .prepare(
        `INSERT INTO sys_ai_tool_approval
          (run_id, step_id, session_id, user_id, tool_id, tool_name, tool_call_id, input_json,
           plan_hash, expires_at, status)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, now() - interval '1 minute', 'pending')
         RETURNING id`,
      )
      .run(
        fixture.runId,
        fixture.stepId,
        fixture.sessionId,
        fixture.tool.id,
        fixture.tool.code,
        `expired-${Date.now()}`,
        JSON.stringify({ name: "expired-module", planHash: "c".repeat(64) }),
        "c".repeat(64),
      );
    const approvalId = Number(approvalResult.lastInsertRowid);
    const result = await decideToolApproval({ id: approvalId, userId: 1, approved: true });
    expect(result).toMatchObject({ status: "expired", output: null });

    const approval = (await sqlite
      .prepare('SELECT status, executed_at AS "executedAt" FROM sys_ai_tool_approval WHERE id = ?')
      .get(approvalId)) as { status: string; executedAt: string | null };
    expect(approval).toEqual({ status: "expired", executedAt: null });
    const run = (await sqlite
      .prepare('SELECT status, error_message AS "errorMessage" FROM sys_ai_agent_run WHERE id = ?')
      .get(fixture.runId)) as { status: string; errorMessage: string | null };
    expect(run).toMatchObject({ status: "stopped", errorMessage: "审批已过期，未执行工具" });
  });
});
