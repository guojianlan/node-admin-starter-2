import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { getAdminBaseEnv } from "@/server/env";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { runWithOperationLog } from "@/server/services/operation-log-service";

const execFileAsync = promisify(execFile);

function repoPath(...segments: string[]) {
  return resolve(/* turbopackIgnore: true */ process.cwd(), ...segments);
}

const repoRoot = repoPath();
const generatorOutputRoot = repoPath("tmp/generated/modules");
const generatorInputRoot = repoPath("tmp/generated/module-generator-inputs");
const exampleConfigPath = repoPath("templates/module-crud/example.config.json");
const generatorScriptPath = repoPath("scripts/generate-module.ts");
const tsxBin = repoPath("node_modules/.bin/tsx");

const generateSchema = z.object({
  config: z.union([z.string(), z.record(z.string(), z.unknown())]),
  force: z.coerce.boolean().default(false),
});

function parseConfig(value: string | Record<string, unknown>) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`配置 JSON 无效：${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertGeneratorAllowed() {
  if (getAdminBaseEnv().isProduction) {
    throw new Error("模块生成器仅允许在非生产环境生成草稿");
  }
}

function parseGeneratedFiles(stdout: string) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => resolve(repoRoot, line.slice(2)));
}

function parseOutputRoot(stdout: string) {
  const line = stdout.split(/\r?\n/).find((item) => item.includes(" module draft at "));
  const relativePath = line?.split(" module draft at ")[1]?.trim();
  if (!relativePath) throw new Error("生成器未返回输出目录");
  return resolve(repoRoot, relativePath);
}

async function readGeneratedConfig(outputRoot: string) {
  const content = await readFile(resolve(outputRoot, "module.config.json"), "utf8");
  return JSON.parse(content) as {
    name?: string;
    title?: string;
    permission?: string;
    frontendPath?: string;
    apiPath?: string;
    schemaName?: string;
  };
}

export const moduleGeneratorRoutes = new Hono<{ Variables: HonoVariables }>();

moduleGeneratorRoutes.get(
  "/module/generator/example",
  authRequired(),
  ability("system.moduleGenerator.query"),
  async (c) => {
    const content = await readFile(exampleConfigPath, "utf8");
    return c.json(success(JSON.parse(content)));
  },
);

moduleGeneratorRoutes.post(
  "/module/generator/generate",
  authRequired(),
  ability("system.moduleGenerator.generate"),
  async (c) => {
    assertGeneratorAllowed();
    const payload = generateSchema.parse(await c.req.json());
    const rawConfig = parseConfig(payload.config);
    const result = await runWithOperationLog(
      c,
      {
        module: "system.moduleGenerator",
        action: "generate",
        resource: "/module/generator",
        details: { force: payload.force },
      },
      async () => {
        const inputPath = resolve(generatorInputRoot, `module-${Date.now()}.json`);
        await mkdir(dirname(inputPath), { recursive: true });
        await writeFile(inputPath, JSON.stringify(rawConfig, null, 2));
        const args = [
          generatorScriptPath,
          "--config",
          inputPath,
          "--out-dir",
          generatorOutputRoot,
          ...(payload.force ? ["--force"] : []),
        ];
        const { stdout } = await execFileAsync(tsxBin, args, {
          cwd: repoRoot,
          maxBuffer: 2 * 1024 * 1024,
          timeout: 30_000,
        });
        return {
          outputRoot: parseOutputRoot(stdout),
          files: parseGeneratedFiles(stdout),
        };
      },
    );
    const outputRoot = resolve(result.outputRoot);
    if (!outputRoot.startsWith(generatorOutputRoot)) throw new Error("生成目录越界");
    const config = await readGeneratedConfig(outputRoot);
    const files = await Promise.all(
      result.files.map(async (file) => {
        const absolutePath = resolve(file);
        if (!absolutePath.startsWith(outputRoot)) throw new Error("生成文件越界");
        const content = await readFile(absolutePath, "utf8");
        return {
          path: relative(repoRoot, absolutePath),
          size: Buffer.byteLength(content, "utf8"),
          content: content.length > 120_000 ? `${content.slice(0, 120_000)}\n/* truncated */` : content,
        };
      }),
    );
    return c.json(
      success({
        module: {
          name: config.name,
          title: config.title,
          kebabName: String(config.name ?? ""),
          schemaName: config.schemaName,
          permission: config.permission,
          frontendPath: config.frontendPath,
          apiPath: config.apiPath,
        },
        outputRoot: relative(repoRoot, outputRoot),
        files,
      }),
    );
  },
);
