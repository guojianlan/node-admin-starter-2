import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import {
  aiPricingApplyFields,
  applyAiModelPricing,
  getAiModelPricingPreview,
  getAiPricingCatalogStatus,
  listAiPricingCatalogItems,
  refreshAiPricingCatalog,
} from "@/server/services/ai-pricing-catalog-service";
import { runWithOperationLog } from "@/server/services/operation-log-service";

const catalogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().trim().max(200).optional(),
  providerType: z.string().trim().max(80).optional(),
  modelId: z.string().trim().max(240).optional(),
});

const applyPricingSchema = z.object({
  catalogItemId: z.coerce.number().int().positive(),
  fields: z.array(z.enum(aiPricingApplyFields)).min(1).max(aiPricingApplyFields.length),
});

export const aiPricingRoutes = new Hono<{ Variables: HonoVariables }>();

aiPricingRoutes.get(
  "/ai/pricing/catalog/status",
  authRequired(),
  ability("system.aiModel.query"),
  async (c) => c.json(success(await getAiPricingCatalogStatus())),
);

aiPricingRoutes.get(
  "/ai/pricing/catalog/models",
  authRequired(),
  ability("system.aiModel.query"),
  async (c) => {
    const query = catalogQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
    return c.json(success(await listAiPricingCatalogItems(query)));
  },
);

aiPricingRoutes.post(
  "/ai/pricing/catalog/refresh",
  authRequired(),
  ability("system.aiModel.syncPricing"),
  async (c) => {
    const user = c.get("user");
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiModel",
        action: "refreshPricingCatalog",
        resource: "/ai/pricing/catalog",
        riskLevel: "medium",
        details: { sourceType: "litellm" },
      },
      async () => {
        try {
          return await refreshAiPricingCatalog({ userId: user.id });
        } catch (error) {
          throw new HTTPException(502, {
            message: error instanceof Error ? error.message : "价格目录刷新失败",
            cause: error,
          });
        }
      },
    );
    return c.json(success(result, result.changed ? "价格目录已刷新" : "价格目录已是最新版本"));
  },
);

aiPricingRoutes.get(
  "/ai/model/:id/pricing/preview",
  authRequired(),
  ability("system.aiModel.query"),
  async (c) => {
    const modelId = z.coerce.number().int().positive().parse(c.req.param("id"));
    const preview = await getAiModelPricingPreview(modelId);
    if (!preview) throw new HTTPException(404, { message: "AI 模型不存在" });
    return c.json(success(preview));
  },
);

aiPricingRoutes.put(
  "/ai/model/:id/pricing/apply",
  authRequired(),
  ability("system.aiModel.syncPricing"),
  async (c) => {
    const modelId = z.coerce.number().int().positive().parse(c.req.param("id"));
    const payload = applyPricingSchema.parse(await c.req.json());
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiModel",
        action: "applyCatalogPricing",
        resource: "/ai/model/pricing",
        resourceId: modelId,
        riskLevel: "high",
        details: {
          catalogItemId: payload.catalogItemId,
          fields: payload.fields,
        },
      },
      async () => {
        try {
          return await applyAiModelPricing({ modelId, ...payload });
        } catch (error) {
          throw new HTTPException(409, {
            message: error instanceof Error ? error.message : "目录价格无法应用",
            cause: error,
          });
        }
      },
    );
    return c.json(success(result, "目录价格已应用"));
  },
);
