import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { sqlite } from "@/server/db";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import {
  aiModelPurposes,
  getAiInvocationTrace,
  listAiInvocations,
  listAiProviderHealth,
  listAiPurposeModelOptions,
  listAiPurposeRoutes,
  saveAiPurposeRoute,
} from "@/server/services/ai-reliability-service";
import { runWithOperationLog } from "@/server/services/operation-log-service";

const purposeRouteSchema = z.object({
  modelIds: z.array(z.coerce.number().int().positive()).min(1).max(5),
});

const invocationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  purpose: z.enum(aiModelPurposes).optional(),
  status: z.enum(["running", "completed", "failed", "aborted"]).optional(),
  sourceType: z.string().trim().max(100).optional(),
  providerId: z.coerce.number().int().positive().optional(),
  requestId: z.string().trim().max(200).optional(),
});

export const aiRuntimeRoutes = new Hono<{ Variables: HonoVariables }>();

aiRuntimeRoutes.get(
  "/ai/runtime/purposes",
  authRequired(),
  ability("system.aiRuntime.query"),
  async (c) =>
    c.json(
      success({
        purposes: await listAiPurposeRoutes(),
        models: await listAiPurposeModelOptions(),
      }),
    ),
);

aiRuntimeRoutes.put(
  "/ai/runtime/purposes/:purpose",
  authRequired(),
  ability("system.aiRuntime.update"),
  async (c) => {
    const user = c.get("user");
    const purpose = z.enum(aiModelPurposes).parse(c.req.param("purpose"));
    const payload = purposeRouteSchema.parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.aiRuntime",
        action: "updatePurposeRoute",
        resource: "/ai/runtime/purposes",
        resourceId: purpose,
        riskLevel: "high",
        details: { purpose, modelIds: payload.modelIds },
      },
      async () => {
        await sqlite.transaction((tx) =>
          saveAiPurposeRoute({ purpose, modelIds: payload.modelIds, userId: user.id, dbClient: tx }),
        );
      },
    );
    return c.json(success(null, "用途模型路由已更新"));
  },
);

aiRuntimeRoutes.get(
  "/ai/runtime/provider-health",
  authRequired(),
  ability("system.aiRuntime.query"),
  async (c) => {
    const windowHours = z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 90)
      .default(24)
      .parse(new URL(c.req.url).searchParams.get("windowHours") ?? undefined);
    return c.json(success(await listAiProviderHealth({ windowHours })));
  },
);

aiRuntimeRoutes.get(
  "/ai/runtime/invocations",
  authRequired(),
  ability("system.aiRuntime.query"),
  async (c) => {
    const query = invocationQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
    return c.json(success(await listAiInvocations(query)));
  },
);

aiRuntimeRoutes.get(
  "/ai/runtime/invocations/:id",
  authRequired(),
  ability("system.aiRuntime.query"),
  async (c) => {
    const trace = await getAiInvocationTrace(z.coerce.number().int().positive().parse(c.req.param("id")));
    if (!trace) throw new HTTPException(404, { message: "AI 调用记录不存在" });
    return c.json(success(trace));
  },
);
