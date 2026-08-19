import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/server/app";
import { sqlite } from "@/server/db";
import { encryptSecret } from "@/server/services/secret";
import { getAdminTestPassword } from "../helpers/auth";
import { resetTestDatabase } from "../helpers/db";

type ApiResponse<T> = { success: boolean; msg: string; data?: T };

async function readJson<T>(response: Response) {
  return (await response.json()) as ApiResponse<T>;
}

async function login() {
  const response = await app.request("/api/system/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: getAdminTestPassword() }),
  });
  const body = await readJson<{ token: string }>(response);
  return String(body.data?.token ?? "");
}

function authHeaders(token: string, requestId?: string) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    ...(requestId ? { "x-request-id": requestId } : {}),
  };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetTestDatabase();
});

describe("Mastra workflow governance", () => {
  it("registers a deterministic preflight and persists failed configuration checks", async () => {
    const unauthorized = await app.request(
      "/api/system/ai/workflow/ai-runtime-preflight/runs",
      { method: "POST", body: JSON.stringify({ agentId: 1 }) },
    );
    expect(unauthorized.status).toBe(401);

    const token = await login();
    const unknown = await app.request("/api/system/ai/workflow/not-registered/runs", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ agentId: 1 }),
    });
    expect(unknown.status).toBe(404);
    const definitions = await readJson<Array<{ code: string; riskLevel: string }>>(
      await app.request("/api/system/ai/workflow/definitions", {
        headers: authHeaders(token),
      }),
    );
    expect(definitions.data).toContainEqual(
      expect.objectContaining({ code: "ai-runtime-preflight", riskLevel: "low" }),
    );

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await app.request("/api/system/ai/workflow/ai-runtime-preflight/runs", {
      method: "POST",
      headers: authHeaders(token, "workflow-preflight-failed"),
      body: JSON.stringify({ agentId: 1 }),
    });
    const body = await readJson<{
      id: number;
      status: string;
      output: { status: string; checks: Array<{ key: string; status: string }> };
      steps: Array<{ stepCode: string; status: string }>;
    }>(response);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ status: "completed", output: { status: "failed" } });
    expect(body.data?.output.checks).toContainEqual(
      expect.objectContaining({ key: "runtime.configuration", status: "fail" }),
    );
    expect(body.data?.steps.map((step) => step.stepCode)).toEqual([
      "inspect-agent",
      "inspect-runtime",
      "inspect-tools",
      "summarize",
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();

    const operation = (await sqlite
      .prepare(
        `SELECT request_id AS "requestId", success, risk_level AS "riskLevel"
         FROM sys_operation_log
         WHERE module = 'system.aiWorkflow' AND action = 'execute'
         ORDER BY id DESC LIMIT 1`,
      )
      .get()) as { requestId: string; success: boolean; riskLevel: string };
    expect(operation).toMatchObject({
      requestId: "workflow-preflight-failed",
      success: true,
      riskLevel: "low",
    });
  });

  it("reports a ready Agent without calling the external Provider", async () => {
    const token = await login();
    const providerResult = await sqlite
      .prepare(
        `INSERT INTO sys_ai_provider
          (name, code, provider_type, base_url, api_key_encrypted, is_default, status)
         VALUES ('Workflow Provider', 'workflow-provider', 'openai-compatible',
           'https://workflow-provider.test/v1', ?, true, 1)
         RETURNING id`,
      )
      .run(encryptSecret("workflow-secret"));
    const providerId = Number(providerResult.lastInsertRowid);
    const modelResult = await sqlite
      .prepare(
        `INSERT INTO sys_ai_model
          (provider_id, name, model_id, model_type, capabilities_json, context_window,
           max_output_tokens, is_default_chat, status)
         VALUES (?, 'Workflow Chat', 'workflow-chat', 'chat', ?, 128000, 16384, true, 1)
         RETURNING id`,
      )
      .run(providerId, JSON.stringify({ chat: true, toolCalling: true }));
    const modelId = Number(modelResult.lastInsertRowid);
    await sqlite
      .prepare("UPDATE sys_ai_agent SET model_id = ?, updated_at = now() WHERE id = 1")
      .run(modelId);

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await app.request("/api/system/ai/workflow/ai-runtime-preflight/runs", {
      method: "POST",
      headers: authHeaders(token, "workflow-preflight-ready"),
      body: JSON.stringify({ agentId: 1 }),
    });
    const body = await readJson<{
      id: number;
      output: {
        status: string;
        orchestrator: string;
        runtime: { provider: { code: string }; model: { modelId: string } };
        summary: { failed: number; warnings: number };
      };
    }>(response);

    expect(response.status).toBe(200);
    expect(body.data?.output).toMatchObject({
      status: "ready",
      orchestrator: "legacy",
      runtime: {
        provider: { code: "workflow-provider" },
        model: { modelId: "workflow-chat" },
      },
      summary: { failed: 0, warnings: 0 },
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    const list = await readJson<Array<{ id: number; output: { status: string } }>>(
      await app.request("/api/system/ai/workflow/runs", { headers: authHeaders(token) }),
    );
    expect(list.data?.[0]).toMatchObject({ id: body.data?.id, output: { status: "ready" } });
    const detail = await app.request(`/api/system/ai/workflow/runs/${body.data?.id}`, {
      headers: authHeaders(token),
    });
    expect(detail.status).toBe(200);
  });
});
