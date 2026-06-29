import { execFile } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
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
const generatorOutputRoot = repoPath("generated/module-drafts");
const generatorInputRoot = repoPath("tmp/generated/module-generator-inputs");
const exampleConfigPath = repoPath("templates/module-crud/example.config.json");
const generatorScriptPath = repoPath("scripts/generate-module.ts");
const tsxBin = repoPath("node_modules/.bin/tsx");

const generateSchema = z.object({
  config: z.union([z.string(), z.record(z.string(), z.unknown())]),
  force: z.coerce.boolean().default(false),
});

const publishSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
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
    domain?: string;
    permission?: string;
    frontendPath?: string;
    apiPath?: string;
    schemaName?: string;
    routeExportName?: string;
  };
}

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(path: string) {
  return (await pathExists(path)) ? readFile(path, "utf8") : "";
}

async function listDrafts() {
  if (!(await pathExists(generatorOutputRoot))) return [];
  const entries = await readdir(generatorOutputRoot, { withFileTypes: true });
  const drafts = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const outputRoot = resolve(generatorOutputRoot, entry.name);
    const configPath = resolve(outputRoot, "module.config.json");
    if (!(await pathExists(configPath))) continue;
    const config = await readGeneratedConfig(outputRoot);
    const manifest = await readTextIfExists(repoPath("src/router/route-manifest.ts"));
    drafts.push({
      name: entry.name,
      title: config.title,
      domain: config.domain,
      permission: config.permission,
      frontendPath: config.frontendPath,
      apiPath: config.apiPath,
      outputRoot: relative(repoRoot, outputRoot),
      status: config.permission && manifest.includes(`key: "${config.permission}"`) ? "published" : "draft",
    });
  }
  return drafts;
}

async function appendGeneratedBlock(input: {
  filePath: string;
  name: string;
  content: string;
  alreadyIncludes: string;
}) {
  const current = await readTextIfExists(input.filePath);
  if (current.includes(input.alreadyIncludes)) return false;
  const block = [
    "",
    `// admin-base-generator:start ${input.name}`,
    input.content.trimEnd(),
    `// admin-base-generator:end ${input.name}`,
    "",
  ].join("\n");
  await writeFile(input.filePath, `${current.trimEnd()}\n${block}`);
  return true;
}

async function insertBefore(input: {
  filePath: string;
  marker: string;
  name: string;
  content: string;
  alreadyIncludes: string;
}) {
  const current = await readTextIfExists(input.filePath);
  if (current.includes(input.alreadyIncludes)) return false;
  const block = [
    `  // admin-base-generator:start ${input.name}`,
    input.content.trimEnd(),
    `  // admin-base-generator:end ${input.name}`,
    "",
  ].join("\n");
  const index = current.lastIndexOf(input.marker);
  if (index < 0) throw new Error(`未找到插入位置：${input.marker}`);
  await writeFile(input.filePath, `${current.slice(0, index)}${block}${current.slice(index)}`);
  return true;
}

function splitSnippetImport(content: string) {
  const lines = content.trim().split(/\r?\n/);
  const importLine = lines.find((line) => line.startsWith("import "));
  const body = lines.filter((line) => line !== importLine).join("\n").trim();
  return { importLine, body };
}

function ensureArrayEntryComma(content: string) {
  const trimmed = content.trimEnd();
  return trimmed.endsWith(",") ? trimmed : `${trimmed},`;
}

async function insertImportAndRoute(input: {
  filePath: string;
  name: string;
  importLine: string;
  routeLine: string;
  routeBefore: string;
  alreadyIncludes: string;
}) {
  let current = await readTextIfExists(input.filePath);
  if (current.includes(input.alreadyIncludes)) return false;
  const lastImport = Array.from(current.matchAll(/^import .+;$/gm)).at(-1);
  if (!lastImport || lastImport.index == null) throw new Error("未找到 import 插入位置");
  const importEnd = lastImport.index + lastImport[0].length;
  current = `${current.slice(0, importEnd)}\n${input.importLine}${current.slice(importEnd)}`;
  const routeIndex = current.indexOf(input.routeBefore);
  if (routeIndex < 0) throw new Error(`未找到路由插入位置：${input.routeBefore}`);
  const routeBlock = [
    `// admin-base-generator:start ${input.name}`,
    input.routeLine,
    `// admin-base-generator:end ${input.name}`,
    "",
  ].join("\n");
  await writeFile(input.filePath, `${current.slice(0, routeIndex)}${routeBlock}${current.slice(routeIndex)}`);
  return true;
}

type GeneratedSourceFile = {
  source: string;
  target: string;
  relativePath: string;
};

async function collectGeneratedSourceFiles(outputRoot: string) {
  const files: GeneratedSourceFile[] = [];
  async function walk(root: string) {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = resolve(root, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      const relativePath = relative(outputRoot, absolutePath);
      if (!relativePath.startsWith("src/") && !relativePath.startsWith("tests/")) continue;
      const target = repoPath(relativePath);
      if (await pathExists(target)) {
        const [sourceContent, targetContent] = await Promise.all([
          readFile(absolutePath, "utf8"),
          readFile(target, "utf8"),
        ]);
        if (sourceContent !== targetContent) {
          throw new Error(`发布目标已存在且内容不同：${relative(repoRoot, target)}`);
        }
      }
      files.push({ source: absolutePath, target, relativePath: relative(repoRoot, target) });
    }
  }
  await walk(outputRoot);
  return files;
}

async function copyGeneratedSourceFiles(files: GeneratedSourceFile[]) {
  const copied: string[] = [];
  for (const file of files) {
    await mkdir(dirname(file.target), { recursive: true });
    await copyFile(file.source, file.target);
    copied.push(file.relativePath);
  }
  return copied;
}

async function publishDraft(name: string) {
  const outputRoot = resolve(generatorOutputRoot, name);
  if (!outputRoot.startsWith(generatorOutputRoot) || !(await pathExists(outputRoot))) {
    throw new Error("模块草稿不存在");
  }
  const config = await readGeneratedConfig(outputRoot);
  if (config.domain !== "system") {
    throw new Error("当前自动发布仅支持 domain=system；业务域模块需要先建立后端 domain 挂载约定");
  }
  const sourceFiles = await collectGeneratedSourceFiles(outputRoot);
  const schemaSnippet = await readFile(resolve(outputRoot, "snippets/schema.entry.ts"), "utf8");
  const migrationSnippet = await readFile(resolve(outputRoot, "snippets/migration.sql"), "utf8");
  const seedSnippet = await readFile(resolve(outputRoot, "snippets/seed-rule.entry.ts"), "utf8");
  const routeSnippet = await readFile(resolve(outputRoot, "snippets/system-route.entry.ts"), "utf8");
  const manifestSnippet = await readFile(resolve(outputRoot, "snippets/route-manifest.entry.ts"), "utf8");
  const applied: string[] = [];

  if (
    await appendGeneratedBlock({
      filePath: repoPath("src/server/db/schema/index.ts"),
      name,
      content: schemaSnippet,
      alreadyIncludes: `export const ${config.schemaName}`,
    })
  ) {
    applied.push("src/server/db/schema/index.ts");
  }

  const migrationId = `generated_${name.replaceAll("-", "_")}_${Date.now()}`;
  const migrationBlock = `  {\n    id: "${migrationId}",\n    sql: \`\n${migrationSnippet.trimEnd()}\n\`,\n  },`;
  if (
    await insertBefore({
      filePath: repoPath("src/server/db/migrations.ts"),
      marker: "];\n\nexport async function runMigrations",
      name,
      content: migrationBlock,
      alreadyIncludes: migrationSnippet.trim().split(/\r?\n/)[0] ?? migrationId,
    })
  ) {
    applied.push("src/server/db/migrations.ts");
  }

  if (
    await insertBefore({
      filePath: repoPath("src/server/db/seed/default-data.ts"),
      marker: "] as const;",
      name,
      content: seedSnippet,
      alreadyIncludes: `key: "${config.permission}"`,
    })
  ) {
    applied.push("src/server/db/seed/default-data.ts");
  }

  const routeParts = splitSnippetImport(routeSnippet);
  if (!routeParts.importLine) throw new Error("路由注册 snippet 缺少 import");
  if (
    await insertImportAndRoute({
      filePath: repoPath("src/server/routes/system/index.ts"),
      name,
      importLine: routeParts.importLine,
      routeLine: routeParts.body,
      routeBefore: 'systemRoutes.route("/", operationLogRoutes);',
      alreadyIncludes: routeParts.body,
    })
  ) {
    applied.push("src/server/routes/system/index.ts");
  }

  const manifestParts = splitSnippetImport(manifestSnippet);
  if (!manifestParts.importLine) throw new Error("路由 manifest snippet 缺少 import");
  if (
    await insertImportAndRoute({
      filePath: repoPath("src/router/route-manifest.ts"),
      name,
      importLine: manifestParts.importLine,
      routeLine: ensureArrayEntryComma(manifestParts.body),
      routeBefore: "  {\n    path: \"/profile\",",
      alreadyIncludes: `key: "${config.permission}"`,
    })
  ) {
    applied.push("src/router/route-manifest.ts");
  }

  applied.push(...(await copyGeneratedSourceFiles(sourceFiles)));

  return {
    module: config,
    applied: [...new Set(applied)].sort(),
  };
}

export const moduleGeneratorRoutes = new Hono<{ Variables: HonoVariables }>();

moduleGeneratorRoutes.get(
  "/module/generator/drafts",
  authRequired(),
  ability("system.moduleGenerator.query"),
  async (c) => {
    return c.json(success(await listDrafts()));
  },
);

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
        drafts: await listDrafts(),
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
    assertGeneratorAllowed();
    const payload = publishSchema.parse(await c.req.json());
    const result = await runWithOperationLog(
      c,
      {
        module: "system.moduleGenerator",
        action: "publish",
        resource: "/module/generator",
        resourceId: payload.name,
        riskLevel: "high",
      },
      async () => publishDraft(payload.name),
    );
    return c.json(success(result, "发布成功"));
  },
);
