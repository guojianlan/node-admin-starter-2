import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import {
  createAiEvalCase,
  createAiEvalDataset,
  deleteAiEvalCase,
  deleteAiEvalDataset,
  executeAiEvalDataset,
  getAiEvalOptions,
  getAiEvalResult,
  getAiEvalRun,
  getVisibleAiEvalDataset,
  listAiEvalCases,
  listAiEvalDatasets,
  listAiEvalResults,
  listAiEvalRuns,
  saveAiEvalCaseFromRun,
  updateAiEvalCase,
  updateAiEvalDataset,
} from "@/server/services/ai-eval-service";
import { runWithOperationLog } from "@/server/services/operation-log-service";

const idSchema = z.coerce.number().int().positive();
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const datasetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1200).nullable().optional(),
  scopeType: z.enum(["global", "department", "user"]).default("user"),
  deptId: idSchema.nullable().optional(),
  status: z.coerce.number().int().min(0).max(1).default(1),
  sort: z.coerce.number().int().min(0).max(999999).default(0),
});
const assertionsSchema = z.object({
  contains: z.array(z.string().trim().min(1).max(1000)).max(50).optional(),
  notContains: z.array(z.string().trim().min(1).max(1000)).max(50).optional(),
  expectedTools: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  forbiddenTools: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  maxLatencyMs: z.coerce.number().min(0).max(3_600_000).optional(),
  maxInputTokens: z.coerce.number().min(0).max(10_000_000).optional(),
  maxOutputTokens: z.coerce.number().min(0).max(10_000_000).optional(),
  maxEstimatedCost: z.coerce.number().min(0).max(1_000_000).optional(),
});
const caseSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1200).nullable().optional(),
  agentId: idSchema,
  inputText: z.string().trim().min(1).max(50_000),
  expectedText: z.string().trim().max(50_000).nullable().optional(),
  assertions: assertionsSchema.default({}),
  tags: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  judgeEnabled: z.boolean().default(false),
  judgeRubric: z.string().trim().max(4000).nullable().optional(),
  groundednessRequired: z.boolean().default(false),
  status: z.coerce.number().int().min(0).max(1).default(1),
  sort: z.coerce.number().int().min(0).max(999999).default(0),
});
const fromRunSchema = z.object({
  datasetId: idSchema,
  name: z.string().trim().max(160).nullable().optional(),
});

export const aiEvalRoutes = new Hono<{ Variables: HonoVariables }>();

aiEvalRoutes.get("/ai/eval/datasets", authRequired(), ability("system.aiEval.query"), async (c) => {
  const url = new URL(c.req.url);
  const rawStatus = url.searchParams.get("status");
  return c.json(
    success(
      await listAiEvalDatasets({
        userId: c.get("user").id,
        keyword: url.searchParams.get("keyword") ?? undefined,
        status: rawStatus == null || rawStatus === "" ? undefined : Number(rawStatus),
      }),
    ),
  );
});

aiEvalRoutes.get("/ai/eval/options", authRequired(), ability("system.aiEval.query"), async (c) =>
  c.json(success(await getAiEvalOptions(c.get("user").id))),
);

aiEvalRoutes.post(
  "/ai/eval/datasets",
  authRequired(),
  ability("system.aiEval.create"),
  async (c) => {
    const payload = datasetSchema.parse(await c.req.json());
    const id = await runWithOperationLog(
      c,
      {
        module: "system.aiEval",
        action: "createDataset",
        resource: "/ai/eval/datasets",
        riskLevel: "medium",
        details: { scopeType: payload.scopeType, deptId: payload.deptId },
      },
      () => createAiEvalDataset({ payload, user: c.get("user") }),
    );
    return c.json(success({ id }, "Eval 数据集已创建"));
  },
);

aiEvalRoutes.get(
  "/ai/eval/datasets/:id",
  authRequired(),
  ability("system.aiEval.query"),
  async (c) => {
    const dataset = await getVisibleAiEvalDataset(
      idSchema.parse(c.req.param("id")),
      c.get("user").id,
    );
    if (!dataset) return c.json({ success: false, msg: "Eval 数据集不存在或无权访问" }, 404);
    return c.json(success(dataset));
  },
);

aiEvalRoutes.put(
  "/ai/eval/datasets/:id",
  authRequired(),
  ability("system.aiEval.update"),
  async (c) => {
    const id = idSchema.parse(c.req.param("id"));
    const payload = datasetSchema.parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.aiEval",
        action: "updateDataset",
        resource: "/ai/eval/datasets",
        resourceId: id,
        riskLevel: "medium",
        details: { scopeType: payload.scopeType, deptId: payload.deptId, status: payload.status },
      },
      () => updateAiEvalDataset({ id, payload, user: c.get("user") }),
    );
    return c.json(success(null, "Eval 数据集已更新"));
  },
);

aiEvalRoutes.delete(
  "/ai/eval/datasets/:id",
  authRequired(),
  ability("system.aiEval.delete"),
  async (c) => {
    const id = idSchema.parse(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.aiEval",
        action: "deleteDataset",
        resource: "/ai/eval/datasets",
        resourceId: id,
        riskLevel: "high",
      },
      () => deleteAiEvalDataset(id, c.get("user").id),
    );
    return c.json(success(null, "Eval 数据集已删除"));
  },
);

aiEvalRoutes.get(
  "/ai/eval/datasets/:id/cases",
  authRequired(),
  ability("system.aiEval.query"),
  async (c) =>
    c.json(success(await listAiEvalCases(idSchema.parse(c.req.param("id")), c.get("user").id))),
);

aiEvalRoutes.post(
  "/ai/eval/datasets/:id/cases",
  authRequired(),
  ability("system.aiEval.create"),
  async (c) => {
    const datasetId = idSchema.parse(c.req.param("id"));
    const payload = caseSchema.parse(await c.req.json());
    const id = await runWithOperationLog(
      c,
      {
        module: "system.aiEval",
        action: "createCase",
        resource: "/ai/eval/cases",
        riskLevel: "medium",
        details: { datasetId, agentId: payload.agentId },
      },
      () => createAiEvalCase({ datasetId, payload, userId: c.get("user").id }),
    );
    return c.json(success({ id }, "Eval Case 已创建"));
  },
);

aiEvalRoutes.put(
  "/ai/eval/cases/:id",
  authRequired(),
  ability("system.aiEval.update"),
  async (c) => {
    const id = idSchema.parse(c.req.param("id"));
    const payload = caseSchema.parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.aiEval",
        action: "updateCase",
        resource: "/ai/eval/cases",
        resourceId: id,
        riskLevel: "medium",
        details: { agentId: payload.agentId, status: payload.status },
      },
      () => updateAiEvalCase({ id, payload, userId: c.get("user").id }),
    );
    return c.json(success(null, "Eval Case 已更新"));
  },
);

aiEvalRoutes.delete(
  "/ai/eval/cases/:id",
  authRequired(),
  ability("system.aiEval.delete"),
  async (c) => {
    const id = idSchema.parse(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.aiEval",
        action: "deleteCase",
        resource: "/ai/eval/cases",
        resourceId: id,
        riskLevel: "medium",
      },
      () => deleteAiEvalCase(id, c.get("user").id),
    );
    return c.json(success(null, "Eval Case 已删除"));
  },
);

aiEvalRoutes.post(
  "/ai/eval/cases/from-run/:runId",
  authRequired(),
  ability("system.aiEval.saveCase"),
  async (c) => {
    const runId = idSchema.parse(c.req.param("runId"));
    const payload = fromRunSchema.parse(await c.req.json());
    const id = await runWithOperationLog(
      c,
      {
        module: "system.aiEval",
        action: "saveCaseFromRun",
        resource: "/ai/eval/cases/from-run",
        resourceId: runId,
        riskLevel: "medium",
        details: { datasetId: payload.datasetId },
      },
      () => saveAiEvalCaseFromRun({ runId, ...payload, userId: c.get("user").id }),
    );
    return c.json(success({ id }, "Run 已保存为 Eval Case"));
  },
);

aiEvalRoutes.post(
  "/ai/eval/datasets/:id/runs",
  authRequired(),
  ability("system.aiEval.execute"),
  async (c) => {
    const datasetId = idSchema.parse(c.req.param("id"));
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiEval",
        action: "executeDataset",
        resource: "/ai/eval/runs",
        resourceId: datasetId,
        riskLevel: "high",
        details: { executionMode: "synchronous", unattendedApproval: "deny" },
      },
      () =>
        executeAiEvalDataset({
          datasetId,
          userId: c.get("user").id,
          abilities: c.get("abilities"),
          requestId: c.get("requestId"),
        }),
    );
    return c.json(success(result, "Eval 执行完成"));
  },
);

aiEvalRoutes.get("/ai/eval/runs", authRequired(), ability("system.aiEval.query"), async (c) => {
  const url = new URL(c.req.url);
  const pagination = paginationSchema.parse({
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });
  return c.json(
    success(
      await listAiEvalRuns({
        userId: c.get("user").id,
        datasetId: url.searchParams.get("datasetId")
          ? idSchema.parse(url.searchParams.get("datasetId"))
          : undefined,
        ...pagination,
      }),
    ),
  );
});

aiEvalRoutes.get("/ai/eval/runs/:id", authRequired(), ability("system.aiEval.query"), async (c) =>
  c.json(success(await getAiEvalRun(idSchema.parse(c.req.param("id")), c.get("user").id))),
);

aiEvalRoutes.get(
  "/ai/eval/runs/:id/results",
  authRequired(),
  ability("system.aiEval.query"),
  async (c) =>
    c.json(success(await listAiEvalResults(idSchema.parse(c.req.param("id")), c.get("user").id))),
);

aiEvalRoutes.get(
  "/ai/eval/results/:id",
  authRequired(),
  ability("system.aiEval.query"),
  async (c) =>
    c.json(success(await getAiEvalResult(idSchema.parse(c.req.param("id")), c.get("user").id))),
);
