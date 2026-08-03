import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import {
  assertModuleGeneratorAllowed,
  buildModulePublishPlan,
  listModuleDrafts,
  moduleGeneratorExampleConfigPath,
  moduleGeneratorInputRoot,
  moduleGeneratorOutputRoot,
  moduleGeneratorRepoRoot,
  moduleGeneratorScriptPath,
  moduleGeneratorTsxBin,
  parseModuleGeneratorConfig,
  publishModuleDraft,
  readGeneratedModuleConfig,
  rollbackModulePublish,
  toPublicModulePublishPlan,
} from "@/server/services/module-generator-service";
import { runWithOperationLog } from "@/server/services/operation-log-service";
import {
  adminModuleGeneratorCapabilities,
  adminModuleJsonSchema,
} from "@/shared/module-generator-contract";

const execFileAsync = promisify(execFile);

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

function parseGeneratedFiles(stdout: string) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => resolve(moduleGeneratorRepoRoot, line.slice(2)));
}

function parseOutputRoot(stdout: string) {
  const line = stdout.split(/\r?\n/).find((item) => item.includes(" module draft at "));
  const relativePath = line?.split(" module draft at ")[1]?.trim();
  if (!relativePath) throw new Error("生成器未返回输出目录");
  return resolve(moduleGeneratorRepoRoot, relativePath);
}

function assertInsideRoot(root: string, candidate: string, label: string) {
  const relativePath = relative(root, candidate);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`${label}越界`);
  }
}

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
      async () => {
        const inputPath = resolve(moduleGeneratorInputRoot, `module-${randomUUID()}.json`);
        try {
          await mkdir(dirname(inputPath), { recursive: true });
          await writeFile(inputPath, JSON.stringify(normalizedConfig, null, 2));
          const args = [
            moduleGeneratorScriptPath,
            "--config",
            inputPath,
            "--out-dir",
            moduleGeneratorOutputRoot,
            ...(payload.force ? ["--force"] : []),
          ];
          const { stdout } = await execFileAsync(moduleGeneratorTsxBin, args, {
            cwd: moduleGeneratorRepoRoot,
            maxBuffer: 2 * 1024 * 1024,
            timeout: 30_000,
          });
          return {
            outputRoot: parseOutputRoot(stdout),
            files: parseGeneratedFiles(stdout),
          };
        } finally {
          await rm(inputPath, { force: true });
        }
      },
    );
    const outputRoot = resolve(result.outputRoot);
    assertInsideRoot(moduleGeneratorOutputRoot, outputRoot, "生成目录");
    const config = await readGeneratedModuleConfig(outputRoot);
    const files = await Promise.all(
      result.files.map(async (file) => {
        const absolutePath = resolve(file);
        assertInsideRoot(outputRoot, absolutePath, "生成文件");
        const content = await readFile(absolutePath, "utf8");
        return {
          path: relative(moduleGeneratorRepoRoot, absolutePath),
          size: Buffer.byteLength(content, "utf8"),
          content:
            content.length > 120_000 ? `${content.slice(0, 120_000)}\n/* truncated */` : content,
        };
      }),
    );
    return c.json(
      success({
        module: {
          name: config.name,
          title: config.title,
          kebabName: config.name,
          schemaName: config.schemaName,
          permission: config.permission,
          frontendPath: config.frontendPath,
          apiPath: config.apiPath,
        },
        outputRoot: relative(moduleGeneratorRepoRoot, outputRoot),
        drafts: await listModuleDrafts(),
        files,
      }),
    );
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
