import bcrypt from "bcryptjs";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "@/server/app";
import { nowIso, sqlite } from "@/server/db";
import {
  appendAgentRunStep,
  createAgentRun,
  createToolApproval,
  listAiTools,
} from "@/server/services/ai-agent-service";
import { getAdminTestPassword } from "../helpers/auth";
import { resetTestDatabase } from "../helpers/db";

type ApiResponse<T = unknown> = { success: boolean; msg: string; data?: T };

async function readJson<T>(response: Response) {
  return (await response.json()) as ApiResponse<T>;
}

async function login(username = "admin", password = getAdminTestPassword()) {
  const response = await app.request("/api/system/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return String((await readJson<{ token: string }>(response)).data?.token ?? "");
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function createClientToolFixture(toolCode = "browser-location", userId = 1) {
  const agent = (await sqlite
    .prepare("SELECT id FROM sys_ai_agent WHERE code = 'general-assistant' AND deleted_at IS NULL")
    .get()) as { id: number } | undefined;
  if (!agent) throw new Error("Missing general assistant");
  const sessionResult = await sqlite
    .prepare(
      `INSERT INTO sys_ai_chat_session (user_id, title, agent_id, status, created_by, updated_by)
       VALUES (?, ?, ?, 1, ?, ?) RETURNING id`,
    )
    .run(userId, `location-${Date.now()}-${Math.random()}`, agent.id, userId, userId);
  const sessionId = Number(sessionResult.lastInsertRowid);
  const runId = await createAgentRun({ sessionId, agentId: agent.id, userId });
  const tool = (await listAiTools({ activeOnly: true })).find((item) => item.code === toolCode);
  if (!tool) throw new Error(`Missing seeded tool: ${toolCode}`);
  const toolCallId = `call-${toolCode}-${Date.now()}-${Math.random()}`;
  const stepId = await appendAgentRunStep({
    runId,
    stepNo: 1,
    stepType: "approval",
    status: "waiting_approval",
    toolId: tool.id,
    toolName: tool.code,
    toolCallId,
    input: { reason: "查询当前位置的实时天气" },
  });
  const approvalId = await createToolApproval({
    runId,
    stepId,
    sessionId,
    userId,
    tool,
    toolName: tool.code,
    toolCallId,
    toolInput: { reason: "查询当前位置的实时天气" },
  });
  await sqlite
    .prepare("UPDATE sys_ai_agent_run SET status = 'waiting_approval' WHERE id = ?")
    .run(runId);
  return { sessionId, runId, stepId, approvalId, tool };
}

beforeAll(async () => {
  await resetTestDatabase();
});

describe("AI browser location Client Tool", () => {
  it("seeds the system Client Tool and binds it to the general assistant with always approval", async () => {
    const agent = (await sqlite
      .prepare(
        "SELECT id, instructions FROM sys_ai_agent WHERE code = 'general-assistant' AND deleted_at IS NULL",
      )
      .get()) as { id: number; instructions: string };
    const tools = await listAiTools({ activeOnly: true, agentId: agent.id });
    expect(tools.find((item) => item.code === "browser-location")).toMatchObject({
      handlerKey: "browser_location",
      approvalRequired: true,
      approvalMode: "always",
      riskLevel: "medium",
      isSystem: true,
    });
    expect(agent.instructions).toContain("browser-location");
    expect(agent.instructions).toContain("web-search");
  });

  it("accepts a granted browser result, persists only coarse coordinates and resumes the run", async () => {
    const token = await login();
    const fixture = await createClientToolFixture();
    const response = await app.request(
      `/api/system/ai/chat/sessions/${fixture.sessionId}/client-actions/${fixture.approvalId}/result`,
      {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          status: "granted",
          latitude: 22.531234,
          longitude: 113.934567,
          accuracy: 119.8,
        }),
      },
    );
    const body = await readJson<{
      status: string;
      output: { status: string; latitude: number; longitude: number; accuracy: number };
    }>(response);
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      status: "executed",
      output: { status: "granted", latitude: 22.53, longitude: 113.93, accuracy: 120 },
    });

    const approval = (await sqlite
      .prepare('SELECT status, output_json AS "outputJson" FROM sys_ai_tool_approval WHERE id = ?')
      .get(fixture.approvalId)) as { status: string; outputJson: string };
    expect(approval.status).toBe("executed");
    expect(JSON.parse(approval.outputJson)).toEqual({
      status: "granted",
      latitude: 22.53,
      longitude: 113.93,
      accuracy: 120,
    });
    expect(approval.outputJson).not.toContain("22.531234");
    expect(approval.outputJson).not.toContain("113.934567");

    const step = (await sqlite
      .prepare('SELECT status, output_json AS "outputJson" FROM sys_ai_agent_run_step WHERE id = ?')
      .get(fixture.stepId)) as { status: string; outputJson: string };
    const run = (await sqlite
      .prepare("SELECT status FROM sys_ai_agent_run WHERE id = ?")
      .get(fixture.runId)) as { status: string };
    expect(step.status).toBe("completed");
    expect(JSON.parse(step.outputJson)).toMatchObject({ latitude: 22.53, longitude: 113.93 });
    expect(run.status).toBe("waiting_continuation");

    const message = (await sqlite
      .prepare(
        `SELECT content FROM sys_ai_chat_message
         WHERE session_id = ? AND role = 'system' ORDER BY id DESC LIMIT 1`,
      )
      .get(fixture.sessionId)) as { content: string };
    expect(message.content).toContain("纬度 22.53，经度 113.93");
    expect(message.content).toContain("web-search");
    expect(message.content).not.toContain("22.531234");

    const log = (await sqlite
      .prepare(
        `SELECT details_json AS "detailsJson" FROM sys_operation_log
         WHERE module = 'system.aiChat' AND action = 'submitClientToolResult'
         ORDER BY id DESC LIMIT 1`,
      )
      .get()) as { detailsJson: string };
    expect(JSON.parse(log.detailsJson)).toEqual({
      capability: "browser_location",
      resultStatus: "granted",
      granted: true,
    });
    expect(log.detailsJson).not.toContain("22.531234");
    expect(log.detailsJson).not.toContain("113.934567");
  });

  it("treats denial as a completed Client Tool result and continues by asking for a city", async () => {
    const token = await login();
    const fixture = await createClientToolFixture();
    const response = await app.request(
      `/api/system/ai/chat/sessions/${fixture.sessionId}/client-actions/${fixture.approvalId}/result`,
      {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ status: "denied", reason: "用户选择手动输入城市" }),
      },
    );
    expect(response.status).toBe(200);
    const run = (await sqlite
      .prepare("SELECT status FROM sys_ai_agent_run WHERE id = ?")
      .get(fixture.runId)) as { status: string };
    const message = (await sqlite
      .prepare(
        `SELECT content FROM sys_ai_chat_message
         WHERE session_id = ? AND role = 'system' ORDER BY id DESC LIMIT 1`,
      )
      .get(fixture.sessionId)) as { content: string };
    expect(run.status).toBe("waiting_continuation");
    expect(message.content).toContain("询问用户所在城市或地区");
    expect(message.content).toContain("不得虚构位置");
  });

  it("rejects missing auth, missing ability, cross-session use, non-client tools and replay", async () => {
    const fixture = await createClientToolFixture();
    const endpoint = `/api/system/ai/chat/sessions/${fixture.sessionId}/client-actions/${fixture.approvalId}/result`;
    expect(
      (
        await app.request(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "denied" }),
        })
      ).status,
    ).toBe(401);

    const now = nowIso();
    const passwordHash = await bcrypt.hash("123456", 10);
    await sqlite
      .prepare(
        `INSERT INTO sys_user
          (username, password_hash, nickname, sex, dept_id, status, created_at, updated_at)
         VALUES ('location-viewer', ?, '定位无权限用户', 0, 1, 1, ?, ?)`,
      )
      .run(passwordHash, now, now);
    const viewerToken = await login("location-viewer", "123456");
    expect(
      (
        await app.request(endpoint, {
          method: "POST",
          headers: authHeaders(viewerToken),
          body: JSON.stringify({ status: "denied" }),
        })
      ).status,
    ).toBe(403);

    const token = await login();
    expect(
      (
        await app.request(
          `/api/system/ai/chat/sessions/${fixture.sessionId + 999}/client-actions/${fixture.approvalId}/result`,
          {
            method: "POST",
            headers: authHeaders(token),
            body: JSON.stringify({ status: "denied" }),
          },
        )
      ).status,
    ).toBe(409);

    const nonClient = await createClientToolFixture("current-time");
    expect(
      (
        await app.request(
          `/api/system/ai/chat/sessions/${nonClient.sessionId}/client-actions/${nonClient.approvalId}/result`,
          {
            method: "POST",
            headers: authHeaders(token),
            body: JSON.stringify({ status: "denied" }),
          },
        )
      ).status,
    ).toBe(409);

    const first = await app.request(endpoint, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ status: "denied", reason: "manual city" }),
    });
    expect(first.status).toBe(200);
    const replay = await app.request(endpoint, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ status: "denied", reason: "manual city" }),
    });
    expect(replay.status).toBe(409);
  });

  it("rejects expired location requests without accepting a late browser result", async () => {
    const token = await login();
    const fixture = await createClientToolFixture();
    await sqlite
      .prepare(
        "UPDATE sys_ai_tool_approval SET expires_at = now() - interval '1 minute' WHERE id = ?",
      )
      .run(fixture.approvalId);
    const response = await app.request(
      `/api/system/ai/chat/sessions/${fixture.sessionId}/client-actions/${fixture.approvalId}/result`,
      {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ status: "denied" }),
      },
    );
    expect(response.status).toBe(409);
    const approval = (await sqlite
      .prepare("SELECT status FROM sys_ai_tool_approval WHERE id = ?")
      .get(fixture.approvalId)) as { status: string };
    expect(approval.status).toBe("expired");
    const run = (await sqlite
      .prepare('SELECT status, error_message AS "errorMessage" FROM sys_ai_agent_run WHERE id = ?')
      .get(fixture.runId)) as { status: string; errorMessage: string };
    expect(run).toEqual({ status: "stopped", errorMessage: "浏览器位置授权已过期" });
  });
});
