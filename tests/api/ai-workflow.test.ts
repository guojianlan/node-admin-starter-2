import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/server/app";
import { sqlite } from "@/server/db";
import { encryptSecret } from "@/server/services/secret";
import { getAdminTestPassword } from "../helpers/auth";
import { resetTestDatabase } from "../helpers/db";
import {
  compileVisualWorkflowToMastraBuilder,
  createVisualWorkflowVersion,
  executeVisualWorkflow,
  publishVisualWorkflowVersion,
} from "@/server/services/ai-visual-workflow-service";
import { processNextAiJob } from "@/server/services/ai-job-service";

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
  it("seeds visual workflow examples with explicit runtime requirements", async () => {
    const rows = (await sqlite
      .prepare(
        `SELECT definition.code, definition.status,
          definition.description, version.graph_json AS "graphJson",
          version.compatibility_json AS "compatibilityJson"
         FROM sys_ai_workflow_definition definition
         INNER JOIN sys_ai_workflow_definition_version version
           ON version.definition_id = definition.id
          AND version.version = definition.current_version
         WHERE definition.code LIKE 'demo-%'
         ORDER BY definition.code ASC`,
      )
      .all()) as Array<{ code: string; status: string; description: string; graphJson: string; compatibilityJson: string }>;

    expect(rows.map((row) => row.code)).toEqual([
      "demo-ai-parallel-review",
      "demo-customer-priority-routing",
      "demo-delayed-notification",
      "demo-foreach-batch-calculation",
      "demo-loop-until-result",
      "demo-parallel-system-snapshot",
    ]);
    expect(rows.find((row) => row.code === "demo-ai-parallel-review")?.status).toBe("draft");
    expect(JSON.parse(rows.find((row) => row.code === "demo-ai-parallel-review")?.compatibilityJson ?? "{}")).toMatchObject({
      runtime: "ai-sdk-7",
      requires: expect.arrayContaining(["enabled chat provider", "enabled chat model"]),
    });
    expect(rows.filter((row) => row.code !== "demo-ai-parallel-review").every((row) => row.status === "published")).toBe(true);

    const genericCompiled = compileVisualWorkflowToMastraBuilder(
      {
        nodes: [
          { id: "input", type: "input", position: { x: 0, y: 0 } },
          { id: "passthrough", type: "transform", position: { x: 160, y: 0 } },
          { id: "output", type: "output", position: { x: 320, y: 0 } },
        ],
        edges: [
          { source: "input", target: "passthrough" },
          { source: "passthrough", target: "output" },
        ],
      },
      "generic-input-schema",
      "通用输入 Schema 不应继承图片字段",
    );
    expect(genericCompiled.inputSchema).toEqual({
      type: "object",
      properties: {},
      additionalProperties: true,
    });

    const condition = rows.find((row) => row.code === "demo-customer-priority-routing");
    const compiled = compileVisualWorkflowToMastraBuilder(
      JSON.parse(condition?.graphJson ?? "{}"),
      condition?.code ?? "missing",
      condition?.description ?? "条件分支示例",
      { agents: new Set(), tools: new Set(["calculator"]), workflows: new Set() },
    );
    expect(compiled.graph).toEqual([
      expect.objectContaining({
        type: "conditional",
        steps: expect.arrayContaining([
          expect.objectContaining({ type: "tool", toolId: "calculator" }),
        ]),
        predicates: expect.any(Array),
      }),
    ]);
  });

  it("executes condition, parallel, foreach, loop and sleep examples without a Provider", async () => {
    const runExample = async (code: string, value: unknown) => {
      const definition = (await sqlite
        .prepare("SELECT id FROM sys_ai_workflow_definition WHERE code = ? AND deleted_at IS NULL")
        .get(code)) as { id: number };
      return executeVisualWorkflow({ definitionId: definition.id, userId: 1, value: JSON.stringify(value) });
    };

    const highPriority = await runExample("demo-customer-priority-routing", {
      route: "high",
      expression: "1200*0.92",
    });
    expect(highPriority.value).toMatchObject({ expression: "1200*0.92", result: 1104 });

    const defaultPriority = await runExample("demo-customer-priority-routing", {
      route: "normal",
      expression: "20+22",
    });
    expect(defaultPriority.value).toMatchObject({ expression: "20+22", result: 42 });

    const parallel = await runExample("demo-parallel-system-snapshot", { scope: "overview" });
    expect(parallel.value).toMatchObject({
      "branch-1": { timezone: "Asia/Shanghai" },
      "branch-2": { hiddenMetrics: expect.any(Array) },
    });

    const foreach = await runExample("demo-foreach-batch-calculation", [
      { expression: "12*3" },
      { expression: "99/3" },
      { expression: "(18+6)*2" },
    ]);
    expect(foreach.value).toEqual([
      { expression: "12*3", result: 36 },
      { expression: "99/3", result: 33 },
      { expression: "(18+6)*2", result: 48 },
    ]);

    const loop = await runExample("demo-loop-until-result", { expression: "21*2" });
    expect(loop.value).toEqual({ expression: "21*2", result: 42 });

    const delayed = await runExample("demo-delayed-notification", { message: "订单已进入处理队列" });
    expect(delayed.value).toEqual({ status: "completed", message: "订单已进入处理队列" });

    const runIds = [highPriority, defaultPriority, parallel, foreach, loop, delayed].map((run) => run.runId);
    const persistedRuns = (await sqlite
      .prepare(
        `SELECT run.id, run.status,
          COUNT(step.id)::int AS "stepCount",
          COUNT(step.id) FILTER (WHERE step.status <> 'completed')::int AS "incompleteSteps"
         FROM sys_ai_workflow_run run
         LEFT JOIN sys_ai_workflow_run_step step ON step.run_id = run.id
         WHERE run.id IN (${runIds.map(() => "?").join(", ")})
         GROUP BY run.id, run.status`,
      )
      .all(...runIds)) as Array<{ id: number; status: string; stepCount: number; incompleteSteps: number }>;
    expect(persistedRuns).toHaveLength(runIds.length);
    expect(persistedRuns.every((run) => run.status === "completed" && run.stepCount >= 3 && run.incompleteSteps === 0)).toBe(true);
  });

  it("compiles the visual canvas to Mastra JSON-safe Agent, Mapping and Parallel entries", () => {
    const definition = compileVisualWorkflowToMastraBuilder(
      {
        nodes: [
          { id: "input", type: "input", position: { x: 0, y: 0 } },
          { id: "prompt", type: "mapping", position: { x: 160, y: 0 }, data: { mapConfig: JSON.stringify({ prompt: { template: "${inputData}" } }) } },
          { id: "fanout", type: "parallel", position: { x: 320, y: 0 }, data: { children: JSON.stringify([
            { type: "tool", id: "lookup", toolId: "1" },
            { type: "agent", id: "review", agentId: "1" },
          ]) } },
          { id: "output", type: "output", position: { x: 480, y: 0 } },
        ],
        edges: [
          { source: "input", target: "prompt" },
          { source: "prompt", target: "fanout" },
          { source: "fanout", target: "output" },
        ],
      },
      "workflow-builder-test",
      "受控 Mastra Workflow 测试",
    );

    expect(definition.graph.map((entry) => entry.type)).toEqual(["mapping", "parallel"]);
    expect(definition.graph.at(-1)).toMatchObject({ type: "parallel" });
    expect(JSON.stringify(definition)).not.toContain("function");
  });

  it("rejects legacy model nodes and unknown Registry references at the publish boundary", () => {
    expect(() => compileVisualWorkflowToMastraBuilder(
      {
        nodes: [
          { id: "input", type: "input", position: { x: 0, y: 0 } },
          { id: "model", type: "model", position: { x: 160, y: 0 }, data: { modelId: 1 } },
          { id: "output", type: "output", position: { x: 320, y: 0 } },
        ],
        edges: [{ source: "input", target: "model" }, { source: "model", target: "output" }],
      },
      "legacy-model",
      "旧模型节点",
    )).toThrow("请改用 Agent 节点");

    expect(() => compileVisualWorkflowToMastraBuilder(
      {
        nodes: [
          { id: "input", type: "input", position: { x: 0, y: 0 } },
          { id: "prompt", type: "mapping", position: { x: 80, y: 0 }, data: { mapConfig: JSON.stringify({ prompt: { template: "${inputData}" } }) } },
          { id: "agent", type: "agent", position: { x: 160, y: 0 }, data: { agentId: "missing" } },
          { id: "output", type: "output", position: { x: 320, y: 0 } },
        ],
        edges: [{ source: "input", target: "prompt" }, { source: "prompt", target: "agent" }, { source: "agent", target: "output" }],
      },
      "missing-agent",
      "未知 Agent",
      { agents: new Set(["1"]), tools: new Set(), workflows: new Set() },
    )).toThrow("不存在或已停用的 Agent");
  });

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

  it("executes a persisted linear graph through the Mastra Workflow runtime", async () => {
    const draft = await createVisualWorkflowVersion({
      code: `mastra-linear-${Date.now()}`,
      name: "Mastra 线性编排测试",
      userId: 1,
      graph: {
        nodes: [
          { id: "input", type: "input", position: { x: 0, y: 0 } },
          { id: "transform", type: "transform", position: { x: 200, y: 0 }, data: { template: "结果: {{value}}" } },
          { id: "output", type: "output", position: { x: 400, y: 0 } },
        ],
        edges: [
          { source: "input", target: "transform" },
          { source: "transform", target: "output" },
        ],
      },
    });
    await publishVisualWorkflowVersion({ definitionId: draft.definitionId, version: draft.version, userId: 1 });
    const result = await executeVisualWorkflow({ definitionId: draft.definitionId, userId: 1, value: "hello" });
    expect(result).toMatchObject({ orchestrator: "mastra", value: "结果: hello" });
    const steps = (await sqlite.prepare("SELECT step_code AS \"stepCode\", status FROM sys_ai_workflow_run_step WHERE run_id = ?").all(result.runId)) as Array<{ stepCode: string; status: string }>;
    expect(steps).toEqual([expect.objectContaining({ stepCode: "transform", status: "completed" })]);
  });

  it("executes a branched graph by dependency order instead of canvas coordinates", async () => {
    const draft = await createVisualWorkflowVersion({
      code: `visual-branch-${Date.now()}`,
      name: "分支依赖顺序测试",
      userId: 1,
      graph: {
        nodes: [
          { id: "input", type: "input", position: { x: 0, y: 0 } },
          {
            id: "left",
            type: "transform",
            position: { x: 200, y: 100 },
            data: { template: "左支: {{value}}" },
          },
          {
            id: "right",
            type: "transform",
            position: { x: 200, y: 200 },
            data: { template: "右支: {{value}}" },
          },
          // This output is visually above its inputs on purpose. It must still run last.
          { id: "output", type: "output", position: { x: 400, y: -100 } },
        ],
        edges: [
          { source: "input", target: "left" },
          { source: "input", target: "right" },
          { source: "left", target: "output" },
          { source: "right", target: "output" },
        ],
      },
    });
    await publishVisualWorkflowVersion({ definitionId: draft.definitionId, version: draft.version, userId: 1 });

    const result = await executeVisualWorkflow({ definitionId: draft.definitionId, userId: 1, value: "hello" });

    expect(result).toMatchObject({ value: "左支: hello" });
    const steps = (await sqlite
      .prepare(
        `SELECT step_no AS "stepNo", step_code AS "stepCode"
         FROM sys_ai_workflow_run_step WHERE run_id = ? ORDER BY step_no ASC`,
      )
      .all(result.runId)) as Array<{ stepNo: number; stepCode: string }>;
    expect(steps.map((step) => step.stepCode)).toEqual(["input", "left", "right", "output"]);
  });

  it("compiles governed P0 and P1 nodes without reviving the legacy model node", () => {
    const definition = compileVisualWorkflowToMastraBuilder(
      {
        nodes: [
          { id: "input", type: "input", position: { x: 0, y: 0 } },
          { id: "llm", type: "llm", position: { x: 120, y: 0 }, data: { prompt: "${inputData}", modelSelection: "fixed", modelId: 9 } },
          { id: "state", type: "state", position: { x: 240, y: 0 }, data: { stateKey: "answer" } },
          { id: "approval", type: "approval", position: { x: 360, y: 0 }, data: { title: "确认结果" } },
          { id: "output", type: "output", position: { x: 480, y: 0 } },
        ],
        edges: [
          { source: "input", target: "llm" },
          { source: "llm", target: "state" },
          { source: "state", target: "approval" },
          { source: "approval", target: "output" },
        ],
      },
      "governed-p0-p1",
      "P0/P1 节点编译测试",
      { agents: new Set(), tools: new Set(), workflows: new Set(), models: new Set(["9"]), knowledgeBases: new Set() },
    );
    expect(definition.graph).toHaveLength(3);
    expect(definition.graph.every((entry) => entry.type === "mapping")).toBe(true);
    expect(JSON.stringify(definition)).toContain("__adminBaseRuntimeNode");
  });

  it("merges multiple upstream values and creates a governed Memory candidate", async () => {
    const draft = await createVisualWorkflowVersion({
      code: `aggregate-memory-${Date.now()}`,
      name: "聚合和 Memory 候选测试",
      userId: 1,
      graph: {
        nodes: [
          { id: "input", type: "input", position: { x: 0, y: 0 } },
          { id: "left", type: "transform", position: { x: 120, y: 0 }, data: { template: "我喜欢咖啡" } },
          { id: "right", type: "transform", position: { x: 120, y: 100 }, data: { template: "我喜欢安静办公" } },
          { id: "merge", type: "aggregate", position: { x: 260, y: 50 }, data: { aggregateMode: "array" } },
          { id: "memory", type: "memoryCandidate", position: { x: 400, y: 50 }, data: { contentTemplate: "${inputData}" } },
          { id: "output", type: "output", position: { x: 540, y: 50 } },
        ],
        edges: [
          { source: "input", target: "left" },
          { source: "input", target: "right" },
          { source: "left", target: "merge" },
          { source: "right", target: "merge" },
          { source: "merge", target: "memory" },
          { source: "memory", target: "output" },
        ],
      },
    });
    await publishVisualWorkflowVersion({ definitionId: draft.definitionId, version: draft.version, userId: 1 });
    const result = await executeVisualWorkflow({ definitionId: draft.definitionId, userId: 1, value: "ignored" });
    expect(result).toMatchObject({ status: "completed", value: { status: "proposed" } });
    const candidate = await sqlite.prepare("SELECT content, status FROM sys_ai_memory_candidate ORDER BY id DESC LIMIT 1").get() as { content: string; status: string };
    expect(candidate.status).toBe("proposed");
    expect(candidate.content).toContain("咖啡");
    expect(candidate.content).toContain("安静办公");
  });

  it("retries a failed Tool and executes a published sub Workflow as fallback", async () => {
    const child = await createVisualWorkflowVersion({
      code: `retry-child-${Date.now()}`,
      name: "重试兜底子流程",
      userId: 1,
      graph: {
        nodes: [
          { id: "input", type: "input", position: { x: 0, y: 0 } },
          { id: "fallback", type: "transform", position: { x: 160, y: 0 }, data: { template: "fallback: {{value}}" } },
          { id: "output", type: "output", position: { x: 320, y: 0 } },
        ],
        edges: [{ source: "input", target: "fallback" }, { source: "fallback", target: "output" }],
      },
    });
    await publishVisualWorkflowVersion({ definitionId: child.definitionId, version: child.version, userId: 1 });
    const parent = await createVisualWorkflowVersion({
      code: `retry-parent-${Date.now()}`,
      name: "重试与子流程执行测试",
      userId: 1,
      graph: {
        nodes: [
          { id: "input", type: "input", position: { x: 0, y: 0 } },
          {
            id: "retry",
            type: "retry",
            position: { x: 180, y: 0 },
            data: {
              retries: 1,
              backoffMs: 0,
              timeoutMs: 5000,
              body: { type: "tool", id: "calculate", toolId: "calculator" },
              fallback: { type: "workflow", id: "fallback-workflow", workflowId: String(child.definitionId) },
            },
          },
          { id: "output", type: "output", position: { x: 360, y: 0 } },
        ],
        edges: [{ source: "input", target: "retry" }, { source: "retry", target: "output" }],
      },
    });
    await publishVisualWorkflowVersion({ definitionId: parent.definitionId, version: parent.version, userId: 1 });
    const result = await executeVisualWorkflow({ definitionId: parent.definitionId, userId: 1, value: JSON.stringify({ expression: "not-valid" }) });
    expect(result).toMatchObject({ status: "completed", value: { attempts: 2, fallbackUsed: true } });
    expect((result.value as { value: string }).value).toContain("fallback");
  });

  it("queues document parsing through the persistent Worker contract", async () => {
    const draft = await createVisualWorkflowVersion({
      code: `document-parser-${Date.now()}`,
      name: "文档解析任务测试",
      userId: 1,
      graph: {
        nodes: [
          { id: "input", type: "input", position: { x: 0, y: 0 } },
          { id: "parser", type: "documentParser", position: { x: 160, y: 0 }, data: { documentIdPath: "inputData.documentId" } },
          { id: "output", type: "output", position: { x: 320, y: 0 } },
        ],
        edges: [{ source: "input", target: "parser" }, { source: "parser", target: "output" }],
      },
    });
    await publishVisualWorkflowVersion({ definitionId: draft.definitionId, version: draft.version, userId: 1 });
    const result = await executeVisualWorkflow({ definitionId: draft.definitionId, userId: 1, value: JSON.stringify({ documentId: 999999 }) });
    expect(result).toMatchObject({ status: "completed", value: { documentId: 999999, status: "queued" } });
    const job = await sqlite.prepare("SELECT job_type AS \"jobType\", status FROM sys_ai_job WHERE id = ?").get(Number((result.value as { jobId: number }).jobId)) as { jobType: string; status: string };
    expect(job).toEqual({ jobType: "knowledge_parser", status: "queued" });
  });

  it("persists an approval wait and resumes the same Run after a decision", async () => {
    const token = await login();
    const draft = await createVisualWorkflowVersion({
      code: `approval-resume-${Date.now()}`,
      name: "审批恢复测试",
      userId: 1,
      graph: {
        nodes: [
          { id: "input", type: "input", position: { x: 0, y: 0 } },
          { id: "approval", type: "approval", position: { x: 160, y: 0 }, data: { title: "确认继续", timeoutMs: 60000 } },
          { id: "output", type: "output", position: { x: 320, y: 0 } },
        ],
        edges: [{ source: "input", target: "approval" }, { source: "approval", target: "output" }],
      },
    });
    await publishVisualWorkflowVersion({ definitionId: draft.definitionId, version: draft.version, userId: 1 });
    const started = await executeVisualWorkflow({ definitionId: draft.definitionId, userId: 1, value: JSON.stringify({ orderId: 42 }) });
    expect(started.status).toBe("suspended");
    const detail = await readJson<{ waits: Array<{ id: number; status: string; waitType: string }> }>(
      await app.request(`/api/system/ai/workflow/runs/${started.runId}`, { headers: authHeaders(token) }),
    );
    expect(detail.data?.waits[0]).toMatchObject({ status: "pending", waitType: "approval" });
    const waitId = Number(detail.data?.waits[0]?.id);
    const decisionResponse = await app.request(`/api/system/ai/workflow/runs/${started.runId}/waits/${waitId}/decision`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ approved: true, reason: "测试通过" }),
      });
    expect(decisionResponse.status, await decisionResponse.clone().text()).toBe(200);
    const decision = await readJson<{ runId: number; status: string; value: { approved: boolean; value: { orderId: number } } }>(decisionResponse);
    expect(decision.data).toMatchObject({ runId: started.runId, status: "completed", value: { approved: true, value: { orderId: 42 } } });
    const steps = await sqlite.prepare("SELECT status FROM sys_ai_workflow_run_step WHERE run_id = ? ORDER BY step_no").all(started.runId) as Array<{ status: string }>;
    expect(steps.every((step) => step.status === "completed")).toBe(true);
  });

  it("requires the exact event correlation key before resuming", async () => {
    const token = await login();
    const draft = await createVisualWorkflowVersion({
      code: `event-resume-${Date.now()}`,
      name: "事件恢复测试",
      userId: 1,
      graph: {
        nodes: [
          { id: "input", type: "input", position: { x: 0, y: 0 } },
          { id: "event", type: "waitEvent", position: { x: 160, y: 0 }, data: { correlationKey: "order:42", timeoutMs: 60000 } },
          { id: "output", type: "output", position: { x: 320, y: 0 } },
        ],
        edges: [{ source: "input", target: "event" }, { source: "event", target: "output" }],
      },
    });
    await publishVisualWorkflowVersion({ definitionId: draft.definitionId, version: draft.version, userId: 1 });
    const started = await executeVisualWorkflow({ definitionId: draft.definitionId, userId: 1, value: JSON.stringify({ orderId: 42 }) });
    const run = await readJson<{ waits: Array<{ id: number }> }>(await app.request(`/api/system/ai/workflow/runs/${started.runId}`, { headers: authHeaders(token) }));
    const waitId = Number(run.data?.waits[0]?.id);
    const wrongDecision = await app.request(`/api/system/ai/workflow/runs/${started.runId}/waits/${waitId}/decision`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ approved: true }),
    });
    expect(wrongDecision.status).toBe(409);
    const wrong = await app.request(`/api/system/ai/workflow/runs/${started.runId}/events`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ waitId, correlationKey: "order:wrong", data: { status: "paid" } }),
    });
    expect(wrong.status, await wrong.clone().text()).toBe(404);
    const resumed = await readJson<{ status: string; value: { event: { data: { status: string } } } }>(
      await app.request(`/api/system/ai/workflow/runs/${started.runId}/events`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ waitId, correlationKey: "order:42", data: { status: "paid" } }),
      }),
    );
    expect(resumed.data).toMatchObject({ status: "completed", value: { event: { data: { status: "paid" } } } });
  });

  it("collects schema-backed human input and resumes the same Run", async () => {
    const token = await login();
    const draft = await createVisualWorkflowVersion({
      code: `human-input-${Date.now()}`,
      name: "人工输入恢复测试",
      userId: 1,
      graph: {
        nodes: [
          { id: "input", type: "input", position: { x: 0, y: 0 } },
          {
            id: "contact",
            type: "humanInput",
            position: { x: 160, y: 0 },
            data: {
              title: "补充联系人",
              description: "请输入联系人姓名和手机号",
              timeoutMs: 60000,
              schema: JSON.stringify({
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string", title: "姓名" },
                  phone: { type: "string", title: "手机号" },
                },
              }),
            },
          },
          { id: "output", type: "output", position: { x: 320, y: 0 } },
        ],
        edges: [{ source: "input", target: "contact" }, { source: "contact", target: "output" }],
      },
    });
    await publishVisualWorkflowVersion({ definitionId: draft.definitionId, version: draft.version, userId: 1 });

    const started = await executeVisualWorkflow({
      definitionId: draft.definitionId,
      userId: 1,
      value: JSON.stringify({ customerId: 7 }),
    });
    expect(started.status).toBe("suspended");

    const detail = await readJson<{
      waits: Array<{
        id: number;
        status: string;
        waitType: string;
        correlationKey: string;
        input: { title: string; schema: { required: string[] } };
      }>;
    }>(await app.request(`/api/system/ai/workflow/runs/${started.runId}`, { headers: authHeaders(token) }));
    const wait = detail.data?.waits[0];
    expect(wait).toMatchObject({
      status: "pending",
      waitType: "event",
      correlationKey: `human-input:${started.runId}:contact`,
      input: { title: "补充联系人", schema: { required: ["name"] } },
    });

    const invalid = await app.request(`/api/system/ai/workflow/runs/${started.runId}/events`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        waitId: wait?.id,
        correlationKey: wait?.correlationKey,
        data: { phone: "13800000000" },
      }),
    });
    expect(invalid.status).toBe(400);

    const response = await app.request(`/api/system/ai/workflow/runs/${started.runId}/events`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        waitId: wait?.id,
        correlationKey: wait?.correlationKey,
        data: { name: "张三", phone: "13800000000" },
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const resumed = await readJson<{ runId: number; status: string; value: { event: { data: { name: string } } } }>(response);
    expect(resumed.data).toMatchObject({
      runId: started.runId,
      status: "completed",
      value: { event: { data: { name: "张三" } } },
    });
    const steps = await sqlite
      .prepare("SELECT status FROM sys_ai_workflow_run_step WHERE run_id = ? ORDER BY step_no")
      .all(started.runId) as Array<{ status: string }>;
    expect(steps.every((step) => step.status === "completed")).toBe(true);
  });

  it("propagates a suspended child Workflow and resumes its parent through the Worker", async () => {
    const token = await login();
    const child = await createVisualWorkflowVersion({
      code: `suspended-child-${Date.now()}`,
      name: "可暂停子流程",
      userId: 1,
      graph: {
        nodes: [
          { id: "input", type: "input", position: { x: 0, y: 0 } },
          {
            id: "confirm-data",
            type: "humanInput",
            position: { x: 160, y: 0 },
            data: {
              title: "补充处理结果",
              timeoutMs: 60000,
              schema: JSON.stringify({
                type: "object",
                required: ["result"],
                properties: { result: { type: "string", title: "处理结果" } },
              }),
            },
          },
          { id: "output", type: "output", position: { x: 320, y: 0 } },
        ],
        edges: [{ source: "input", target: "confirm-data" }, { source: "confirm-data", target: "output" }],
      },
    });
    await publishVisualWorkflowVersion({ definitionId: child.definitionId, version: child.version, userId: 1 });
    const parent = await createVisualWorkflowVersion({
      code: `suspended-parent-${Date.now()}`,
      name: "等待子流程的父流程",
      userId: 1,
      graph: {
        nodes: [
          { id: "input", type: "input", position: { x: 0, y: 0 } },
          { id: "child", type: "workflow", position: { x: 160, y: 0 }, data: { workflowId: String(child.definitionId) } },
          { id: "output", type: "output", position: { x: 320, y: 0 } },
        ],
        edges: [{ source: "input", target: "child" }, { source: "child", target: "output" }],
      },
    });
    await publishVisualWorkflowVersion({ definitionId: parent.definitionId, version: parent.version, userId: 1 });

    const started = await executeVisualWorkflow({ definitionId: parent.definitionId, userId: 1, value: JSON.stringify({ caseId: 9 }) });
    expect(started.status).toBe("suspended");
    const parentDetail = await readJson<{ waits: Array<{ id: number; waitType: string; childRunId: number }> }>(
      await app.request(`/api/system/ai/workflow/runs/${started.runId}`, { headers: authHeaders(token) }),
    );
    const childWait = parentDetail.data?.waits[0];
    expect(childWait).toMatchObject({ waitType: "child_workflow", childRunId: expect.any(Number) });
    const childRunId = Number(childWait?.childRunId);
    const childRun = await sqlite
      .prepare(
        `SELECT parent_run_id AS "parentRunId", parent_node_id AS "parentNodeId", call_depth AS "callDepth", status
         FROM sys_ai_workflow_run WHERE id = ?`,
      )
      .get(childRunId) as { parentRunId: number; parentNodeId: string; callDepth: number; status: string };
    expect(childRun).toEqual({ parentRunId: started.runId, parentNodeId: "child", callDepth: 1, status: "suspended" });

    const childDetail = await readJson<{ waits: Array<{ id: number; correlationKey: string }> }>(
      await app.request(`/api/system/ai/workflow/runs/${childRunId}`, { headers: authHeaders(token) }),
    );
    const humanWait = childDetail.data?.waits[0];
    const childResponse = await app.request(`/api/system/ai/workflow/runs/${childRunId}/events`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        waitId: humanWait?.id,
        correlationKey: humanWait?.correlationKey,
        data: { result: "accepted" },
      }),
    });
    expect(childResponse.status, await childResponse.clone().text()).toBe(200);
    expect((await readJson<{ status: string }>(childResponse)).data?.status).toBe("completed");

    const processed = await processNextAiJob("workflow-parent-resume-test");
    expect(processed).toMatchObject({ status: "completed" });
    const completedParent = await sqlite
      .prepare("SELECT status, output_json AS \"outputJson\" FROM sys_ai_workflow_run WHERE id = ?")
      .get(started.runId) as { status: string; outputJson: string };
    expect(completedParent.status).toBe("completed");
    expect(JSON.parse(completedParent.outputJson)).toMatchObject({ value: { event: { data: { result: "accepted" } } } });
    const parentSteps = await sqlite
      .prepare("SELECT status FROM sys_ai_workflow_run_step WHERE run_id = ? ORDER BY step_no")
      .all(started.runId) as Array<{ status: string }>;
    expect(parentSteps.every((step) => step.status === "completed")).toBe(true);
  });

  it("resumes a due persistent timer through the PostgreSQL Worker", async () => {
    const draft = await createVisualWorkflowVersion({
      code: `worker-timer-${Date.now()}`,
      name: "Worker 定时恢复测试",
      userId: 1,
      graph: {
        nodes: [
          { id: "input", type: "input", position: { x: 0, y: 0 } },
          { id: "delay", type: "sleep", position: { x: 160, y: 0 }, data: { duration: 31000 } },
          { id: "output", type: "output", position: { x: 320, y: 0 } },
        ],
        edges: [{ source: "input", target: "delay" }, { source: "delay", target: "output" }],
      },
    });
    await publishVisualWorkflowVersion({ definitionId: draft.definitionId, version: draft.version, userId: 1 });
    const started = await executeVisualWorkflow({ definitionId: draft.definitionId, userId: 1, value: "继续处理" });
    expect(started.status).toBe("suspended");

    const wait = await sqlite
      .prepare("SELECT id FROM sys_ai_workflow_wait WHERE run_id = ? AND wait_type = 'timer'")
      .get(started.runId) as { id: number };
    await sqlite
      .prepare("UPDATE sys_ai_workflow_wait SET resume_at = now() - interval '1 second' WHERE id = ?")
      .run(wait.id);
    await sqlite
      .prepare("UPDATE sys_ai_job SET available_at = now() - interval '1 second' WHERE job_type = 'workflow_resume' AND resource_id = ?")
      .run(String(started.runId));

    const processed = await processNextAiJob("workflow-timer-test");
    expect(processed).toMatchObject({ status: "completed" });
    const run = await sqlite
      .prepare("SELECT status, output_json AS \"outputJson\" FROM sys_ai_workflow_run WHERE id = ?")
      .get(started.runId) as { status: string; outputJson: string };
    expect(run.status).toBe("completed");
    expect(JSON.parse(run.outputJson)).toMatchObject({ value: "继续处理" });
    const resolvedWait = await sqlite
      .prepare("SELECT status FROM sys_ai_workflow_wait WHERE id = ?")
      .get(wait.id) as { status: string };
    expect(resolvedWait.status).toBe("resolved");
  });
});
