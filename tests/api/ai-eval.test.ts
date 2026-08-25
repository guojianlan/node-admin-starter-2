import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/server/app";
import { sqlite } from "@/server/db";
import { seedDatabase } from "@/server/db/seed/seed";
import { createAiEvalDataset, getVisibleAiEvalDataset } from "@/server/services/ai-eval-service";
import { encryptSecret } from "@/server/services/secret";
import { getAdminTestPassword } from "../helpers/auth";
import { resetTestDatabase } from "../helpers/db";

type ApiResponse<T> = { success: boolean; msg: string; data?: T };
type PageResult<T> = { data: T[]; total: number; page: number; pageSize: number };

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

function openAiTextStream(text: string) {
  const body = [
    `data: ${JSON.stringify({
      id: "chatcmpl-eval",
      object: "chat.completion.chunk",
      created: 0,
      model: "eval-chat",
      choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
    })}`,
    `data: ${JSON.stringify({
      id: "chatcmpl-eval",
      object: "chat.completion.chunk",
      created: 0,
      model: "eval-chat",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
    })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

function openAiToolCallStream(toolName: string, input: Record<string, unknown>) {
  const body = [
    `data: ${JSON.stringify({
      id: "chatcmpl-eval-tool",
      object: "chat.completion.chunk",
      created: 0,
      model: "eval-chat",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call-eval-approval",
                type: "function",
                function: { name: toolName, arguments: JSON.stringify(input) },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    })}`,
    `data: ${JSON.stringify({
      id: "chatcmpl-eval-tool",
      object: "chat.completion.chunk",
      created: 0,
      model: "eval-chat",
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

async function configureEvalModel() {
  const provider = await sqlite
    .prepare(
      `INSERT INTO sys_ai_provider
       (name, code, provider_type, base_url, api_key_encrypted, timeout_ms, status, sort)
       VALUES ('Eval Provider', 'eval-provider', 'openai-compatible',
         'https://eval.test/v1', ?, 30000, 1, 1) RETURNING id`,
    )
    .run(encryptSecret("eval-secret"));
  const model = await sqlite
    .prepare(
      `INSERT INTO sys_ai_model
       (provider_id, name, model_id, model_type, capabilities_json, context_window,
        max_output_tokens, input_price, output_price, currency, status, sort)
       VALUES (?, 'Eval Chat', 'eval-chat', 'chat', '{"chat":true,"toolCalling":true}',
        128000, 4096, '0.001', '0.002', 'USD', 1, 1) RETURNING id`,
    )
    .run(provider.lastInsertRowid);
  await sqlite
    .prepare("UPDATE sys_ai_agent SET model_id = ? WHERE id = 1")
    .run(model.lastInsertRowid);
  return Number(model.lastInsertRowid);
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await resetTestDatabase();
}, 120000);

describe("AI Eval and Trace v1", () => {
  it("fails groundedness deterministically when an enabled case has no Knowledge evidence", async () => {
    await configureEvalModel();
    const fetchMock = vi.fn(async () => openAiTextStream("没有引用的普通回答"));
    vi.stubGlobal("fetch", fetchMock);
    const token = await login();
    const dataset = await readJson<{ id: number }>(
      await app.request("/api/system/ai/eval/datasets", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ name: "Groundedness 回归", scopeType: "user", status: 1 }),
      }),
    );
    const datasetId = Number(dataset.data?.id);
    const created = await app.request(`/api/system/ai/eval/datasets/${datasetId}/cases`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        name: "必须有知识证据",
        agentId: 1,
        inputText: "基于知识库回答",
        judgeEnabled: true,
        groundednessRequired: true,
      }),
    });
    expect(created.status).toBe(200);

    const run = await readJson<{ id: number; failedCases: number; errorCases: number }>(
      await app.request(`/api/system/ai/eval/datasets/${datasetId}/runs`, {
        method: "POST",
        headers: authHeaders(token),
      }),
    );
    expect(run.data).toMatchObject({ failedCases: 1, errorCases: 0 });
    const results = await readJson<
      Array<{
        judgeScore: number;
        groundednessScore: string;
        judgeInvocationId: number | null;
        assertions: Array<{ key: string; passed: boolean }>;
      }>
    >(
      await app.request(`/api/system/ai/eval/runs/${run.data?.id}/results`, {
        headers: authHeaders(token),
      }),
    );
    expect(results.data?.[0]).toMatchObject({
      judgeScore: 0,
      groundednessScore: "0",
      judgeInvocationId: null,
    });
    expect(results.data?.[0].assertions).toContainEqual(
      expect.objectContaining({ key: "groundedness", passed: false }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("seeds an idempotent Agent baseline dataset with durable regression cases", async () => {
    await seedDatabase();
    const datasets = (await sqlite
      .prepare(
        `SELECT id, scope_type AS "scopeType", status
         FROM sys_ai_eval_dataset
         WHERE name = 'Admin Base Agent 基线回归' AND deleted_at IS NULL`,
      )
      .all()) as Array<{ id: number; scopeType: string; status: number }>;
    expect(datasets).toEqual([expect.objectContaining({ scopeType: "global", status: 1 })]);

    const cases = (await sqlite
      .prepare(
        `SELECT name, assertions_json AS "assertionsJson", tags_json AS "tagsJson"
         FROM sys_ai_eval_case WHERE dataset_id = ? AND deleted_at IS NULL ORDER BY sort`,
      )
      .all(datasets[0].id)) as Array<{
      name: string;
      assertionsJson: string;
      tagsJson: string;
    }>;
    expect(cases.map((item) => item.name)).toEqual([
      "基础指令遵循",
      "计算器工具调用",
      "联网搜索工具调用",
    ]);
    expect(JSON.parse(cases[1].assertionsJson)).toMatchObject({
      expectedTools: ["calculator"],
    });
    expect(JSON.parse(cases[2].tagsJson)).toContain("external");
  });

  it("executes deterministic cases, preserves rerun history and links results to Trace", async () => {
    await configureEvalModel();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => openAiTextStream("Eval answer OK")),
    );
    const token = await login();

    expect((await app.request("/api/system/ai/eval/datasets")).status).toBe(401);
    const created = await readJson<{ id: number }>(
      await app.request("/api/system/ai/eval/datasets", {
        method: "POST",
        headers: authHeaders(token, "eval-dataset-create"),
        body: JSON.stringify({ name: "Agent 回归", scopeType: "user", status: 1 }),
      }),
    );
    const datasetId = Number(created.data?.id);
    expect(datasetId).toBeGreaterThan(0);

    for (const payload of [
      {
        name: "通过用例",
        agentId: 1,
        inputText: "返回 OK",
        assertions: { contains: ["OK"], maxLatencyMs: 30000, maxOutputTokens: 100 },
      },
      {
        name: "失败用例",
        agentId: 1,
        inputText: "返回另一个结果",
        assertions: { contains: ["MUST_NOT_MATCH"], forbiddenTools: ["web-search"] },
      },
    ]) {
      const response = await app.request(`/api/system/ai/eval/datasets/${datasetId}/cases`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify(payload),
      });
      expect(response.status).toBe(200);
    }

    const firstRun = await readJson<{
      id: number;
      totalCases: number;
      passedCases: number;
      failedCases: number;
      errorCases: number;
    }>(
      await app.request(`/api/system/ai/eval/datasets/${datasetId}/runs`, {
        method: "POST",
        headers: authHeaders(token, "eval-run-first"),
      }),
    );
    expect(firstRun.data).toMatchObject({
      totalCases: 2,
      passedCases: 1,
      failedCases: 1,
      errorCases: 0,
    });
    const firstRunId = Number(firstRun.data?.id);
    const firstResults = await readJson<
      Array<{
        id: number;
        status: string;
        agentRunId: number;
        assertions: Array<{ key: string; passed: boolean }>;
        metrics: { invocationIds: number[]; modelIds: number[] };
      }>
    >(
      await app.request(`/api/system/ai/eval/runs/${firstRunId}/results`, {
        headers: authHeaders(token),
      }),
    );
    expect(firstResults.data?.map((item) => item.status)).toEqual(["passed", "failed"]);
    expect(firstResults.data?.[0]).toMatchObject({
      agentRunId: expect.any(Number),
      metrics: { invocationIds: [expect.any(Number)], modelIds: [expect.any(Number)] },
    });

    const detail = await readJson<{
      trace: {
        id: number;
        status: string;
        invocations: Array<{ attempts: Array<{ providerName: string; modelName: string }> }>;
      };
    }>(
      await app.request(`/api/system/ai/eval/results/${firstResults.data?.[0]?.id}`, {
        headers: authHeaders(token),
      }),
    );
    expect(detail.data?.trace).toMatchObject({
      id: firstResults.data?.[0]?.agentRunId,
      status: "completed",
      invocations: [
        expect.objectContaining({
          attempts: [
            expect.objectContaining({ providerName: "Eval Provider", modelName: "Eval Chat" }),
          ],
        }),
      ],
    });

    const rerun = await readJson<{ id: number }>(
      await app.request(`/api/system/ai/eval/datasets/${datasetId}/runs`, {
        method: "POST",
        headers: authHeaders(token, "eval-run-second"),
      }),
    );
    expect(rerun.data?.id).not.toBe(firstRunId);
    const runs = await readJson<PageResult<{ id: number }>>(
      await app.request(`/api/system/ai/eval/runs?datasetId=${datasetId}`, {
        headers: authHeaders(token),
      }),
    );
    expect(runs.data?.total).toBe(2);
    expect(runs.data?.data.map((run) => run.id)).toEqual(
      expect.arrayContaining([firstRunId, Number(rerun.data?.id)]),
    );

    const saveFromRun = await readJson<{ id: number }>(
      await app.request(
        `/api/system/ai/eval/cases/from-run/${firstResults.data?.[0]?.agentRunId}`,
        {
          method: "POST",
          headers: authHeaders(token, "eval-case-from-run"),
          body: JSON.stringify({ datasetId, name: "来自真实 Run" }),
        },
      ),
    );
    expect(saveFromRun.data?.id).toBeGreaterThan(0);
    const cases = await readJson<Array<{ sourceRunId: number; expectedText: string }>>(
      await app.request(`/api/system/ai/eval/datasets/${datasetId}/cases`, {
        headers: authHeaders(token),
      }),
    );
    expect(cases.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceRunId: firstResults.data?.[0]?.agentRunId,
          expectedText: "Eval answer OK",
        }),
      ]),
    );

    const actions = (await sqlite
      .prepare(
        `SELECT action, request_id AS "requestId" FROM sys_operation_log
         WHERE module = 'system.aiEval' AND success = true ORDER BY id`,
      )
      .all()) as Array<{ action: string; requestId: string | null }>;
    expect(actions.map((item) => item.action)).toEqual(
      expect.arrayContaining(["createDataset", "createCase", "executeDataset", "saveCaseFromRun"]),
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "executeDataset", requestId: "eval-run-first" }),
      ]),
    );
  });

  it("denies approval-required tools during unattended Eval instead of executing them", async () => {
    await configureEvalModel();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => openAiToolCallStream("browser-location", { reason: "获取天气所需位置" })),
    );
    const token = await login();
    const dataset = await readJson<{ id: number }>(
      await app.request("/api/system/ai/eval/datasets", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ name: "审批回归", scopeType: "user" }),
      }),
    );
    const datasetId = Number(dataset.data?.id);
    await app.request(`/api/system/ai/eval/datasets/${datasetId}/cases`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ name: "位置工具", agentId: 1, inputText: "深圳天气" }),
    });
    const run = await readJson<{ id: number; failedCases: number; errorCases: number }>(
      await app.request(`/api/system/ai/eval/datasets/${datasetId}/runs`, {
        method: "POST",
        headers: authHeaders(token),
      }),
    );
    expect(run.data).toMatchObject({ failedCases: 1, errorCases: 0 });
    type Assertion = { key: string; passed: boolean };
    const results = await readJson<
      Array<{ status: string; agentRunId: number; assertions: Assertion[] }>
    >(
      await app.request(`/api/system/ai/eval/runs/${run.data?.id}/results`, {
        headers: authHeaders(token),
      }),
    );
    type ApprovalRow = { status: string; executedAt: string | null };
    const evalResult = results.data?.[0];
    if (!evalResult) throw new Error("Missing Eval result");
    const approval = (await sqlite
      .prepare(
        `SELECT status, executed_at AS "executedAt" FROM sys_ai_tool_approval
         WHERE run_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(evalResult.agentRunId)) as ApprovalRow;
    expect(approval).toEqual({ status: "denied", executedAt: null });
    expect(evalResult).toMatchObject({
      status: "failed",
      assertions: [expect.objectContaining({ key: "unattendedApproval", passed: false })],
    });
    const agentRun = (await sqlite
      .prepare("SELECT status FROM sys_ai_agent_run WHERE id = ?")
      .get(evalResult.agentRunId)) as { status: string };
    expect(agentRun.status).toBe("stopped");
  });

  it("enforces department and user ownership for Eval datasets", async () => {
    const deptA = await sqlite
      .prepare(
        "INSERT INTO sys_dept (parent_id, name, code, status) VALUES (0, '研发部', 'eval-a', 1) RETURNING id",
      )
      .run();
    const deptB = await sqlite
      .prepare(
        "INSERT INTO sys_dept (parent_id, name, code, status) VALUES (0, '财务部', 'eval-b', 1) RETURNING id",
      )
      .run();
    const role = await sqlite
      .prepare(
        "INSERT INTO sys_role (name, code, data_scope, status) VALUES ('Eval 部门用户', 'eval-dept-user', 'current_dept', 1) RETURNING id",
      )
      .run();
    const user = await sqlite
      .prepare(
        "INSERT INTO sys_user (username, password_hash, nickname, dept_id, status) VALUES ('eval-user', 'unused', 'Eval 用户', ?, 1) RETURNING id",
      )
      .run(deptA.lastInsertRowid);
    await sqlite
      .prepare("INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?)")
      .run(user.lastInsertRowid, role.lastInsertRowid);
    const hidden = await sqlite
      .prepare(
        `INSERT INTO sys_ai_eval_dataset
         (name, scope_type, dept_id, status, created_by, updated_by)
         VALUES ('财务 Eval', 'department', ?, 1, 1, 1) RETURNING id`,
      )
      .run(deptB.lastInsertRowid);
    const userId = Number(user.lastInsertRowid);
    expect(await getVisibleAiEvalDataset(Number(hidden.lastInsertRowid), userId)).toBeUndefined();

    const ownedId = await createAiEvalDataset({
      payload: { name: "个人 Eval", scopeType: "user" },
      user: {
        id: userId,
        username: "eval-user",
        nickname: "Eval 用户",
        deptId: Number(deptA.lastInsertRowid),
        status: 1,
      },
    });
    expect(await getVisibleAiEvalDataset(ownedId, userId)).toMatchObject({
      scopeType: "user",
      ownerId: userId,
      deptId: null,
    });
  });
});
