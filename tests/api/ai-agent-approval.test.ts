import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, sqlite } from "../helpers/db";
import {
  appendAgentRunStep,
  createAgentRun,
  decideToolApproval,
  executeAgentTool,
  listAiAgents,
  listAiTools,
  saveAiTool,
} from "@/server/services/ai-agent-service";

beforeAll(async () => {
  await resetTestDatabase();
});

async function createApprovalFixture(toolCode: string, toolInput: Record<string, unknown>) {
  const agent = await sqlite
    .prepare("SELECT id FROM sys_ai_agent WHERE code = 'module-development-agent' AND deleted_at IS NULL")
    .get() as { id: number } | undefined;
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
