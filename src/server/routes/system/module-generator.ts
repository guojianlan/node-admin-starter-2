import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import {
  assertModuleGeneratorAllowed,
  buildModulePublishPlan,
  generateModuleDraft,
  listModuleDrafts,
  moduleGeneratorExampleConfigPath,
  parseModuleGeneratorConfig,
  publishModuleDraft,
  rollbackModulePublish,
  toPublicModulePublishPlan,
} from "@/server/services/module-generator-service";
import { runWithOperationLog } from "@/server/services/operation-log-service";
import {
  adminModuleGeneratorCapabilities,
  adminModuleJsonSchema,
} from "@/shared/module-generator-contract";

const generateSchema = z
  .object({
    config: z.union([z.string(), z.record(z.string(), z.unknown())]),
    force: z.coerce.boolean().default(false),
  })
  .strict();

const publishSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9-]+$/),
    planHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();

const rollbackSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9-]+$/),
    publishId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .optional(),
  })
  .strict();

export const moduleGeneratorRoutes = new Hono<{ Variables: HonoVariables }>();

moduleGeneratorRoutes.get(
  "/module/generator/drafts",
  authRequired(),
  ability("system.moduleGenerator.query"),
  async (c) => c.json(success(await listModuleDrafts())),
);

moduleGeneratorRoutes.get(
  "/module/generator/example",
  authRequired(),
  ability("system.moduleGenerator.query"),
  async (c) => {
    const content = await readFile(moduleGeneratorExampleConfigPath, "utf8");
    return c.json(success(parseModuleGeneratorConfig(content)));
  },
);

moduleGeneratorRoutes.get(
  "/module/generator/capabilities",
  authRequired(),
  ability("system.moduleGenerator.query"),
  async (c) => c.json(success(adminModuleGeneratorCapabilities)),
);

moduleGeneratorRoutes.get(
  "/module/generator/schema",
  authRequired(),
  ability("system.moduleGenerator.query"),
  async (c) => c.json(success(adminModuleJsonSchema)),
);

moduleGeneratorRoutes.get(
  "/module/generator/drafts/:name/diff",
  authRequired(),
  ability("system.moduleGenerator.query"),
  async (c) => {
    assertModuleGeneratorAllowed();
    const name = z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .parse(c.req.param("name"));
    return c.json(success(toPublicModulePublishPlan(await buildModulePublishPlan(name))));
  },
);

moduleGeneratorRoutes.post(
  "/module/generator/generate",
  authRequired(),
  ability("system.moduleGenerator.generate"),
  async (c) => {
    assertModuleGeneratorAllowed();
    const payload = generateSchema.parse(await c.req.json());
    const normalizedConfig = parseModuleGeneratorConfig(payload.config);
    const result = await runWithOperationLog(
      c,
      {
        module: "system.moduleGenerator",
        action: "generate",
        resource: "/module/generator",
        details: { force: payload.force, moduleName: normalizedConfig.name },
      },
      async () => generateModuleDraft({ config: normalizedConfig, force: payload.force }),
    );
    return c.json(success(result));
  },
);

moduleGeneratorRoutes.post(
  "/module/generator/publish",
  authRequired(),
  ability("system.moduleGenerator.publish"),
  async (c) => {
    assertModuleGeneratorAllowed();
    const payload = publishSchema.parse(await c.req.json());
    const result = await runWithOperationLog(
      c,
      {
        module: "system.moduleGenerator",
        action: "publish",
        resource: "/module/generator",
        resourceId: payload.name,
        riskLevel: "high",
        details: { planHash: payload.planHash ?? null },
      },
      async () => publishModuleDraft(payload.name, payload.planHash),
    );
    return c.json(success(result, "发布和隔离预检已完成"));
  },
);

moduleGeneratorRoutes.post(
  "/module/generator/rollback",
  authRequired(),
  ability("system.moduleGenerator.publish"),
  async (c) => {
    assertModuleGeneratorAllowed();
    const payload = rollbackSchema.parse(await c.req.json());
    const result = await runWithOperationLog(
      c,
      {
        module: "system.moduleGenerator",
        action: "rollback",
        resource: "/module/generator",
        resourceId: payload.name,
        riskLevel: "high",
        details: { publishId: payload.publishId ?? null },
      },
      async () => rollbackModulePublish(payload.name, payload.publishId),
    );
    return c.json(success(result, "源码已回滚；数据库 migration 不会自动逆向删除"));
  },
);
