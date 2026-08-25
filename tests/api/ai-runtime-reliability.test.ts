import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/server/app";
import { sqlite } from "@/server/db";
import { generateAiText } from "@/server/services/ai-runtime-service";
import { getAiRuntimeConfig } from "@/server/services/ai-provider-service";
import { estimateAiCost, normalizeAiTokenUsage } from "@/server/services/ai-reliability-service";
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
  return String((await readJson<{ token: string }>(response)).data?.token ?? "");
}

function authHeaders(token: string, requestId?: string) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    ...(requestId ? { "x-request-id": requestId } : {}),
  };
}

async function createProviderModel(input: {
  code: string;
  modelId: string;
  inputPrice: string;
  cachedInputPrice?: string;
  cacheWritePrice?: string;
  outputPrice: string;
}) {
  const provider = await sqlite
    .prepare(
      `INSERT INTO sys_ai_provider
       (name, code, provider_type, base_url, api_key_encrypted, timeout_ms, status, sort)
       VALUES (?, ?, 'openai-compatible', ?, ?, 30000, 1, 1) RETURNING id`,
    )
    .run(
      `Provider ${input.code}`,
      input.code,
      `https://${input.code}.test/v1`,
      encryptSecret(`${input.code}-secret`),
    );
  const model = await sqlite
    .prepare(
      `INSERT INTO sys_ai_model
       (provider_id, name, model_id, model_type, capabilities_json, context_window,
        max_output_tokens, input_price, cached_input_price, cache_write_price, output_price,
        currency, status, sort)
       VALUES (?, ?, ?, 'chat', ?, 128000, 8192, ?, ?, ?, ?, 'USD', 1, 1) RETURNING id`,
    )
    .run(
      provider.lastInsertRowid,
      `Model ${input.modelId}`,
      input.modelId,
      JSON.stringify({ chat: true, structured: true, toolCalling: true }),
      input.inputPrice,
      input.cachedInputPrice ?? null,
      input.cacheWritePrice ?? null,
      input.outputPrice,
    );
  return { providerId: Number(provider.lastInsertRowid), modelId: Number(model.lastInsertRowid) };
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  await resetTestDatabase();
});

describe("AI runtime reliability", () => {
  it("normalizes AI SDK cache usage and prices regular input, cache reads, cache writes, and output separately", async () => {
    const model = await createProviderModel({
      code: "cache-ledger",
      modelId: "cache-ledger-model",
      inputPrice: "0.10",
      cachedInputPrice: "0.02",
      cacheWritePrice: "0.125",
      outputPrice: "0.40",
    });
    const usage = normalizeAiTokenUsage({
      inputTokens: 1000,
      inputTokenDetails: {
        noCacheTokens: 600,
        cacheReadTokens: 300,
        cacheWriteTokens: 100,
      },
      outputTokens: 500,
    });

    expect(usage).toEqual({
      inputTokens: 1000,
      outputTokens: 500,
      cachedInputTokens: 300,
      cacheWriteTokens: 100,
    });
    const config = await getAiRuntimeConfig("chat", model.modelId);
    expect(Number(estimateAiCost(config, usage))).toBeCloseTo(0.0002785, 8);
  });

  it("manages ordered purpose routes with compatibility checks and operation logs", async () => {
    const token = await login();
    const first = await createProviderModel({
      code: "route-primary",
      modelId: "route-primary-model",
      inputPrice: "0.10",
      outputPrice: "0.40",
    });
    const second = await createProviderModel({
      code: "route-fallback",
      modelId: "route-fallback-model",
      inputPrice: "0.20",
      outputPrice: "0.80",
    });

    const unauthorized = await app.request("/api/system/ai/runtime/purposes");
    expect(unauthorized.status).toBe(401);
    const save = await app.request("/api/system/ai/runtime/purposes/agent", {
      method: "PUT",
      headers: authHeaders(token, "purpose-route-update"),
      body: JSON.stringify({ modelIds: [second.modelId, first.modelId] }),
    });
    expect(save.status).toBe(200);

    const routes = await readJson<{
      purposes: Array<{
        purpose: string;
        candidates: Array<{ modelId: number; priority: number }>;
      }>;
    }>(await app.request("/api/system/ai/runtime/purposes", { headers: authHeaders(token) }));
    expect(routes.data?.purposes.find((item) => item.purpose === "agent")?.candidates).toEqual([
      expect.objectContaining({ modelId: second.modelId, priority: 1 }),
      expect.objectContaining({ modelId: first.modelId, priority: 2 }),
    ]);

    const operation = (await sqlite
      .prepare(
        `SELECT request_id AS "requestId", risk_level AS "riskLevel", details_json AS "detailsJson"
         FROM sys_operation_log WHERE module = 'system.aiRuntime' ORDER BY id DESC LIMIT 1`,
      )
      .get()) as { requestId: string; riskLevel: string; detailsJson: string };
    expect(operation).toMatchObject({ requestId: "purpose-route-update", riskLevel: "high" });
    expect(JSON.parse(operation.detailsJson)).toMatchObject({ purpose: "agent" });
  });

  it("falls back in priority order and records cost, health, and sanitized attempts", async () => {
    const token = await login();
    const primary = await createProviderModel({
      code: "ledger-primary",
      modelId: "ledger-primary-model",
      inputPrice: "0.10",
      outputPrice: "0.40",
    });
    const fallback = await createProviderModel({
      code: "ledger-fallback",
      modelId: "ledger-fallback-model",
      inputPrice: "0.20",
      outputPrice: "0.80",
    });
    await app.request("/api/system/ai/runtime/purposes/chat", {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ modelIds: [primary.modelId, fallback.modelId] }),
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("ledger-primary.test")) {
        return new Response('upstream rejected Bearer sk-private-ledger api_key="private-key"', {
          status: 503,
          headers: { "content-type": "text/plain" },
        });
      }
      return Response.json({
        id: "chatcmpl-ledger",
        object: "chat.completion",
        created: 1,
        model: "ledger-fallback-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "fallback ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateAiText({
      purpose: "chat",
      input: "Do not persist this prompt",
      trace: {
        sourceType: "test_business",
        sourceId: "case-1",
        requestId: "ai-ledger-fallback",
        userId: 1,
      },
    });
    expect(result.text).toBe("fallback ok");
    expect(result.provider.code).toBe("ledger-fallback");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const invocation = (await sqlite
      .prepare(
        `SELECT id, status, attempt_count AS "attemptCount", fallback_used AS "fallbackUsed",
          input_tokens AS "inputTokens", output_tokens AS "outputTokens",
          estimated_cost AS "estimatedCost", request_id AS "requestId"
         FROM sys_ai_invocation WHERE request_id = ?`,
      )
      .get("ai-ledger-fallback")) as Record<string, unknown>;
    expect(invocation).toMatchObject({
      status: "completed",
      attemptCount: 2,
      fallbackUsed: true,
      inputTokens: 1000,
      outputTokens: 500,
      requestId: "ai-ledger-fallback",
    });
    expect(Number(invocation.estimatedCost)).toBeCloseTo(0.0006, 8);

    const attempts = (await sqlite
      .prepare(
        `SELECT attempt_no AS "attemptNo", status, provider_code AS "providerCode",
          error_message AS "errorMessage" FROM sys_ai_invocation_attempt
         WHERE invocation_id = ? ORDER BY attempt_no`,
      )
      .all(Number(invocation.id))) as Array<Record<string, unknown>>;
    expect(attempts).toMatchObject([
      { attemptNo: 1, status: "failed", providerCode: "ledger-primary" },
      { attemptNo: 2, status: "completed", providerCode: "ledger-fallback" },
    ]);
    expect(String(attempts[0].errorMessage)).not.toContain("sk-private-ledger");
    expect(String(attempts[0].errorMessage)).not.toContain("private-key");

    const health = await readJson<Array<ProviderHealth>>(
      await app.request("/api/system/ai/runtime/provider-health?windowHours=24", {
        headers: authHeaders(token),
      }),
    );
    expect(health.data?.find((item) => item.code === "ledger-primary")).toMatchObject({
      businessCalls: 1,
      businessSuccesses: 0,
    });
    expect(health.data?.find((item) => item.code === "ledger-fallback")).toMatchObject({
      businessCalls: 1,
      businessSuccesses: 1,
    });

    const traces = await readJson<{
      data: Array<{ id: number; fallbackUsed: boolean }>;
      total: number;
    }>(
      await app.request("/api/system/ai/runtime/invocations?requestId=ai-ledger-fallback", {
        headers: authHeaders(token),
      }),
    );
    expect(traces.data?.total).toBe(1);
    expect(traces.data?.data[0]).toMatchObject({ id: invocation.id, fallbackUsed: true });
    const detail = await readJson<{ attempts: Attempt[] }>(
      await app.request(`/api/system/ai/runtime/invocations/${invocation.id}`, {
        headers: authHeaders(token),
      }),
    );
    expect(detail.data?.attempts).toHaveLength(2);

    const stored = JSON.stringify({ invocation, attempts, detail: detail.data });
    expect(stored).not.toContain("Do not persist this prompt");
  });
});

type ProviderHealth = { code: string; businessCalls: number; businessSuccesses: number };
type Attempt = { attemptNo: number; status: string };
