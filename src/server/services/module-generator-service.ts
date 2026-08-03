import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { getAdminBaseEnv } from "@/server/env";
import { parseAdminModuleConfig, type AdminModuleConfig } from "@/shared/module-generator-contract";

const execFileAsync = promisify(execFile);

function repoPath(...segments: string[]) {
  return resolve(/* turbopackIgnore: true */ process.cwd(), ...segments);
}

export const moduleGeneratorRepoRoot = repoPath();
export const moduleGeneratorOutputRoot = repoPath("generated/module-drafts");
export const moduleGeneratorInputRoot = repoPath("tmp/generated/module-generator-inputs");
export const moduleGeneratorExampleConfigPath = repoPath(
  "templates/module-crud/example.config.json",
);
export const moduleGeneratorScriptPath = repoPath("scripts/generate-module.ts");
export const moduleGeneratorTsxBin = repoPath("node_modules/.bin/tsx");

type PublishChangeStatus = "create" | "modify" | "unchanged" | "conflict";
type PublishChangeSource = "generated-file" | "integration";

type PublishChange = {
  path: string;
  source: PublishChangeSource;
  status: PublishChangeStatus;
  beforeContent: string | null;
  afterContent: string;
  beforeHash: string | null;
  afterHash: string;
  additions: number;
  deletions: number;
};

export type ModulePublishPlan = {
  name: string;
  module: AdminModuleConfig;
  migrationId: string;
  planHash: string;
  ready: boolean;
  issues: string[];
  changes: PublishChange[];
};

type PublishRecordFile = {
  path: string;
  action: "create" | "modify";
  beforeHash: string | null;
  afterHash: string;
  backupPath: string | null;
};

type PublishRecord = {
  version: 1;
  publishId: string;
  moduleName: string;
  planHash: string;
  migrationId: string;
  status: "preflighting" | "failed" | "published" | "rolled_back";
  createdAt: string;
  publishedAt: string | null;
  rolledBackAt: string | null;
  validation: {
    command: string;
    passed: boolean;
    output: string;
  } | null;
  error: string | null;
  appliedPaths: string[];
  files: PublishRecordFile[];
};

type PublishValidation = NonNullable<PublishRecord["validation"]>;

class ModulePublishPreflightError extends Error {
  constructor(
    message: string,
    readonly validation: PublishValidation,
  ) {
    super(message);
    this.name = "ModulePublishPreflightError";
  }
}

function pathExists(path: string) {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}

async function readTextIfExists(path: string) {
  return (await pathExists(path)) ? readFile(path, "utf8") : "";
}

async function readDraftTextFile(outputRoot: string, relativePath: string) {
  const absolutePath = resolve(outputRoot, relativePath);
  const draftRelativePath = toProjectPath(relative(outputRoot, absolutePath));
  if (!draftRelativePath || draftRelativePath.startsWith("..") || isAbsolute(draftRelativePath)) {
    throw new Error(`模块草稿文件路径越界：${relativePath}`);
  }
  const fileStat = await lstat(absolutePath).catch(() => null);
  if (!fileStat?.isFile() || fileStat.isSymbolicLink()) {
    throw new Error(`模块草稿文件无效：${relativePath}`);
  }
  return readFile(absolutePath, "utf8");
}

function hashContent(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function toProjectPath(path: string) {
  return path.replaceAll("\\", "/");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertSafeRelativePath(path: string) {
  const absolutePath = resolve(moduleGeneratorRepoRoot, path);
  const relativePath = toProjectPath(relative(moduleGeneratorRepoRoot, absolutePath));
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath) ||
    (!relativePath.startsWith("src/") && !relativePath.startsWith("tests/"))
  ) {
    throw new Error(`模块发布路径越界：${path}`);
  }
  return absolutePath;
}

function resolveDraftRoot(name: string) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("模块名称无效");
  const outputRoot = resolve(moduleGeneratorOutputRoot, name);
  const relativePath = toProjectPath(relative(moduleGeneratorOutputRoot, outputRoot));
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("模块草稿路径越界");
  }
  return outputRoot;
}

export function parseModuleGeneratorConfig(value: string | Record<string, unknown>) {
  let rawConfig: unknown = value;
  if (typeof value === "string") {
    try {
      rawConfig = JSON.parse(value) as unknown;
    } catch (error) {
      throw new Error(`配置 JSON 无效：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return parseAdminModuleConfig(rawConfig);
}

export function assertModuleGeneratorAllowed() {
  if (getAdminBaseEnv().isProduction) {
    throw new Error("模块生成器仅允许在非生产环境生成、发布或回滚源码");
  }
}

export async function readGeneratedModuleConfig(outputRoot: string) {
  const content = await readDraftTextFile(outputRoot, "module.config.json");
  return parseAdminModuleConfig(JSON.parse(content) as unknown);
}

function publishRecordsRoot(outputRoot: string) {
  return resolve(outputRoot, ".admin-base/publish");
}

function publishRecordPath(outputRoot: string, publishId: string) {
  return resolve(publishRecordsRoot(outputRoot), publishId, "record.json");
}

function resolvePublishBackupPath(outputRoot: string, publishId: string, backupPath: string) {
  if (!backupPath.startsWith("backups/") || isAbsolute(backupPath)) {
    throw new Error("发布记录备份路径无效");
  }
  const recordRoot = resolve(publishRecordsRoot(outputRoot), publishId);
  const absolutePath = resolve(recordRoot, backupPath);
  const relativePath = toProjectPath(relative(recordRoot, absolutePath));
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("发布记录备份路径越界");
  }
  return absolutePath;
}

async function readPublishRecord(outputRoot: string, publishId: string) {
  if (!/^[a-z0-9-]+$/.test(publishId)) throw new Error("发布记录 ID 无效");
  const content = await readFile(publishRecordPath(outputRoot, publishId), "utf8");
  const record = JSON.parse(content) as PublishRecord;
  if (record.publishId !== publishId) throw new Error("发布记录 ID 不一致");
  return record;
}

async function readLatestPublishRecord(outputRoot: string) {
  const root = publishRecordsRoot(outputRoot);
  if (!(await pathExists(root))) return null;
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const publishId of entries) {
    try {
      return await readPublishRecord(outputRoot, publishId);
    } catch {
      continue;
    }
  }
  return null;
}

async function writePublishRecord(outputRoot: string, record: PublishRecord) {
  const path = publishRecordPath(outputRoot, record.publishId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
}

async function withModuleSourceMutationLock<T>(callback: () => Promise<T>) {
  const lockPath = resolve(moduleGeneratorOutputRoot, ".admin-base/source-mutation.lock");
  await mkdir(dirname(lockPath), { recursive: true });
  const acquire = async () => {
    try {
      await mkdir(lockPath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      throw new Error(
        "另一个模块正在发布或回滚源码，请稍后重新检查差异；若进程异常退出，请人工确认后清理 generated/module-drafts/.admin-base/source-mutation.lock",
      );
    }
  };

  await acquire();
  try {
    return await callback();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

export async function listModuleDrafts() {
  if (!(await pathExists(moduleGeneratorOutputRoot))) return [];
  const entries = await readdir(moduleGeneratorOutputRoot, { withFileTypes: true });
  const manifest = await readTextIfExists(repoPath("src/router/route-manifest.ts"));
  const drafts = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const outputRoot = resolve(moduleGeneratorOutputRoot, entry.name);
    const configPath = resolve(outputRoot, "module.config.json");
    if (!(await pathExists(configPath))) continue;
    const config = await readGeneratedModuleConfig(outputRoot);
    const latestPublish = await readLatestPublishRecord(outputRoot);
    const published = manifest.includes(`admin-base-generator:start ${entry.name}`);
    drafts.push({
      name: entry.name,
      title: config.title,
      domain: config.domain,
      permission: config.permission,
      frontendPath: config.frontendPath,
      apiPath: config.apiPath,
      outputRoot: toProjectPath(relative(moduleGeneratorRepoRoot, outputRoot)),
      status: published ? "published" : "draft",
      publishId: latestPublish?.publishId ?? null,
      publishStatus: latestPublish?.status ?? null,
      publishedAt: latestPublish?.publishedAt ?? null,
      canRollback: published && latestPublish?.status === "published",
    });
  }
  return drafts;
}

function splitSnippetImport(content: string) {
  const lines = content.trim().split(/\r?\n/);
  const importLine = lines.find((line) => line.startsWith("import "));
  const body = lines
    .filter((line) => line !== importLine)
    .join("\n")
    .trim();
  return { importLine, body };
}

function ensureArrayEntryComma(content: string) {
  const trimmed = content.trimEnd();
  return trimmed.endsWith(",") ? trimmed : `${trimmed},`;
}

function appendGeneratedBlockContent(input: {
  current: string;
  name: string;
  content: string;
  alreadyIncludes: string;
}) {
  if (input.current.includes(input.alreadyIncludes)) return input.current;
  const block = [
    "",
    `// admin-base-generator:start ${input.name}`,
    input.content.trimEnd(),
    `// admin-base-generator:end ${input.name}`,
    "",
  ].join("\n");
  return `${input.current.trimEnd()}\n${block}`;
}

function insertBeforeContent(input: {
  current: string;
  marker: string;
  name: string;
  content: string;
  alreadyIncludes: string;
}) {
  if (input.current.includes(input.alreadyIncludes)) return input.current;
  const block = [
    `  // admin-base-generator:start ${input.name}`,
    input.content.trimEnd(),
    `  // admin-base-generator:end ${input.name}`,
    "",
  ].join("\n");
  const index = input.current.lastIndexOf(input.marker);
  if (index < 0) throw new Error(`未找到插入位置：${input.marker}`);
  return `${input.current.slice(0, index)}${block}${input.current.slice(index)}`;
}

function insertImportAndRouteContent(input: {
  current: string;
  name: string;
  importLine: string;
  routeLine: string;
  routeBefore: string;
  alreadyIncludes: string;
}) {
  if (input.current.includes(input.alreadyIncludes)) return input.current;
  const lastImport = Array.from(input.current.matchAll(/^import .+;$/gm)).at(-1);
  if (!lastImport || lastImport.index == null) throw new Error("未找到 import 插入位置");
  const importEnd = lastImport.index + lastImport[0].length;
  const withImport = `${input.current.slice(0, importEnd)}\n${input.importLine}${input.current.slice(importEnd)}`;
  const routeIndex = withImport.indexOf(input.routeBefore);
  if (routeIndex < 0) throw new Error(`未找到路由插入位置：${input.routeBefore}`);
  const routeBlock = [
    `// admin-base-generator:start ${input.name}`,
    input.routeLine,
    `// admin-base-generator:end ${input.name}`,
    "",
  ].join("\n");
  return `${withImport.slice(0, routeIndex)}${routeBlock}${withImport.slice(routeIndex)}`;
}

function isSubsequence(left: string[], right: string[]) {
  let leftIndex = 0;
  for (const line of right) {
    if (line === left[leftIndex]) leftIndex += 1;
    if (leftIndex === left.length) return true;
  }
  return left.length === 0;
}

function lineChangeStats(beforeContent: string | null, afterContent: string) {
  const before = beforeContent?.split(/\r?\n/) ?? [];
  const after = afterContent.split(/\r?\n/);
  if (isSubsequence(before, after))
    return { additions: after.length - before.length, deletions: 0 };
  if (isSubsequence(after, before))
    return { additions: 0, deletions: before.length - after.length };
  let previous = new Uint32Array(after.length + 1);
  for (const beforeLine of before) {
    const current = new Uint32Array(after.length + 1);
    for (let index = 1; index <= after.length; index += 1) {
      current[index] =
        beforeLine === after[index - 1]
          ? previous[index - 1] + 1
          : Math.max(previous[index], current[index - 1]);
    }
    previous = current;
  }
  const common = previous[after.length];
  return { additions: after.length - common, deletions: before.length - common };
}

async function createPublishChange(input: {
  path: string;
  source: PublishChangeSource;
  afterContent: string;
  conflictWhenDifferent?: boolean;
}) {
  const target = assertSafeRelativePath(input.path);
  const exists = await pathExists(target);
  const beforeContent = exists ? await readFile(target, "utf8") : null;
  const status: PublishChangeStatus =
    beforeContent === input.afterContent
      ? "unchanged"
      : input.conflictWhenDifferent && beforeContent !== null
        ? "conflict"
        : beforeContent === null
          ? "create"
          : "modify";
  return {
    path: input.path,
    source: input.source,
    status,
    beforeContent,
    afterContent: input.afterContent,
    beforeHash: beforeContent === null ? null : hashContent(beforeContent),
    afterHash: hashContent(input.afterContent),
    ...lineChangeStats(beforeContent, input.afterContent),
  } satisfies PublishChange;
}

async function collectGeneratedSourceChanges(outputRoot: string) {
  const changes: PublishChange[] = [];
  async function walk(root: string) {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = resolve(root, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`模块草稿不允许符号链接：${entry.name}`);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      const relativePath = toProjectPath(relative(outputRoot, absolutePath));
      if (!relativePath.startsWith("src/") && !relativePath.startsWith("tests/")) continue;
      changes.push(
        await createPublishChange({
          path: relativePath,
          source: "generated-file",
          afterContent: await readDraftTextFile(outputRoot, relativePath),
          conflictWhenDifferent: true,
        }),
      );
    }
  }
  await walk(outputRoot);
  return changes;
}

async function collectIdentityIssues(name: string, config: AdminModuleConfig, seedSnippet: string) {
  const ownMarker = `admin-base-generator:start ${name}`;
  const routeSources: string[] = [];
  const routeRoot = repoPath("src/server/routes/system");
  const collectRouteSources = async (root: string) => {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const path = resolve(root, entry.name);
      if (entry.isDirectory()) await collectRouteSources(path);
      else if (entry.isFile() && entry.name.endsWith(".ts"))
        routeSources.push(await readFile(path, "utf8"));
    }
  };
  await collectRouteSources(routeRoot);
  const [manifest, seedRules, schema, migrations] = await Promise.all([
    readTextIfExists(repoPath("src/router/route-manifest.ts")),
    readTextIfExists(repoPath("src/server/db/seed/default-data.ts")),
    readTextIfExists(repoPath("src/server/db/schema/index.ts")),
    readTextIfExists(repoPath("src/server/db/migrations.ts")),
  ]);
  if (manifest.includes(ownMarker)) return [];
  const issues: string[] = [];
  if (config.permission && manifest.includes(`key: "${config.permission}"`)) {
    issues.push(`权限标识已存在：${config.permission}`);
  }
  if (config.frontendPath && manifest.includes(`path: "${config.frontendPath}"`)) {
    issues.push(`页面路由已存在：${config.frontendPath}`);
  }
  if (config.permission && seedRules.includes(`key: "${config.permission}"`)) {
    issues.push(`Seed 权限已存在：${config.permission}`);
  }
  if (config.schemaName && schema.includes(`export const ${config.schemaName}`)) {
    issues.push(`Schema 标识已存在：${config.schemaName}`);
  }
  if (
    config.table &&
    (new RegExp(`pgTable\\(\\s*["']${escapeRegExp(config.table)}["']`).test(schema) ||
      new RegExp(`CREATE TABLE(?: IF NOT EXISTS)?\\s+${escapeRegExp(config.table)}\\b`, "i").test(
        migrations,
      ))
  ) {
    issues.push(`数据库表已存在：${config.table}`);
  }
  const backendBasePath = config.backendBasePath;
  if (
    backendBasePath &&
    routeSources.some((source) =>
      new RegExp(`basePath:\\s*["']${escapeRegExp(backendBasePath)}["']`).test(source),
    )
  ) {
    issues.push(`后端 CRUD 路径已存在：${backendBasePath}`);
  }
  const seedIds = Array.from(seedSnippet.matchAll(/\bid:\s*(\d+)/g), (match) => Number(match[1]));
  for (const id of seedIds) {
    if (new RegExp(`\\bid:\\s*${id}\\b`).test(seedRules)) issues.push(`Seed ID 已存在：${id}`);
  }
  return [...new Set(issues)];
}

async function buildIntegrationChanges(
  name: string,
  outputRoot: string,
  config: AdminModuleConfig,
  migrationId: string,
) {
  const requiredSnippets = [
    "schema.entry.ts",
    "migration.sql",
    "seed-rule.entry.ts",
    "system-route.entry.ts",
    "route-manifest.entry.ts",
    "api-test-cases.entry.ts",
    "page-test-cases.entry.ts",
  ];
  const missingSnippets = [];
  for (const snippet of requiredSnippets) {
    if (!(await pathExists(resolve(outputRoot, "snippets", snippet))))
      missingSnippets.push(snippet);
  }
  if (missingSnippets.length) {
    throw new Error(
      `模块草稿版本过旧或不完整，请重新生成草稿。缺少：${missingSnippets.join("、")}`,
    );
  }
  const [
    schemaSnippet,
    migrationSnippet,
    seedSnippet,
    routeSnippet,
    manifestSnippet,
    apiTestCasesSnippet,
    pageTestCasesSnippet,
  ] = await Promise.all(
    requiredSnippets.map((snippet) => readDraftTextFile(outputRoot, `snippets/${snippet}`)),
  );
  const issues = await collectIdentityIssues(name, config, seedSnippet);
  const changes: PublishChange[] = [];

  const schemaPath = "src/server/db/schema/index.ts";
  const schemaCurrent = await readTextIfExists(repoPath(schemaPath));
  changes.push(
    await createPublishChange({
      path: schemaPath,
      source: "integration",
      afterContent: appendGeneratedBlockContent({
        current: schemaCurrent,
        name,
        content: schemaSnippet,
        alreadyIncludes: `export const ${config.schemaName}`,
      }),
    }),
  );

  const migrationPath = "src/server/db/migrations.ts";
  const migrationCurrent = await readTextIfExists(repoPath(migrationPath));
  const migrationBlock = `  {\n    id: "${migrationId}",\n    sql: \`\n${migrationSnippet.trimEnd()}\n\`,\n  },`;
  changes.push(
    await createPublishChange({
      path: migrationPath,
      source: "integration",
      afterContent: insertBeforeContent({
        current: migrationCurrent,
        marker: "];\n\nexport async function runMigrations",
        name,
        content: migrationBlock,
        alreadyIncludes: migrationSnippet.trim().split(/\r?\n/)[0] ?? migrationId,
      }),
    }),
  );

  const seedPath = "src/server/db/seed/default-data.ts";
  const seedCurrent = await readTextIfExists(repoPath(seedPath));
  changes.push(
    await createPublishChange({
      path: seedPath,
      source: "integration",
      afterContent: insertBeforeContent({
        current: seedCurrent,
        marker: "] as const;",
        name,
        content: seedSnippet,
        alreadyIncludes: `key: "${config.permission}"`,
      }),
    }),
  );

  const routeParts = splitSnippetImport(routeSnippet);
  if (!routeParts.importLine) throw new Error("路由注册 snippet 缺少 import");
  const routePath = "src/server/routes/system/index.ts";
  const routeCurrent = await readTextIfExists(repoPath(routePath));
  changes.push(
    await createPublishChange({
      path: routePath,
      source: "integration",
      afterContent: insertImportAndRouteContent({
        current: routeCurrent,
        name,
        importLine: routeParts.importLine,
        routeLine: routeParts.body,
        routeBefore: 'systemRoutes.route("/", operationLogRoutes);',
        alreadyIncludes: routeParts.body,
      }),
    }),
  );

  const manifestParts = splitSnippetImport(manifestSnippet);
  if (!manifestParts.importLine) throw new Error("路由 manifest snippet 缺少 import");
  const manifestPath = "src/router/route-manifest.ts";
  const manifestCurrent = await readTextIfExists(repoPath(manifestPath));
  changes.push(
    await createPublishChange({
      path: manifestPath,
      source: "integration",
      afterContent: insertImportAndRouteContent({
        current: manifestCurrent,
        name,
        importLine: manifestParts.importLine,
        routeLine: ensureArrayEntryComma(manifestParts.body),
        routeBefore: '  {\n    path: "/profile",',
        alreadyIncludes: `key: "${config.permission}"`,
      }),
    }),
  );

  const generatedCasesPath = "tests/coverage/generated-module-test-cases.ts";
  const generatedCasesCurrent = await readTextIfExists(repoPath(generatedCasesPath));
  const withApiCases = insertBeforeContent({
    current: generatedCasesCurrent,
    marker: "  // admin-base-generator:api-operations",
    name: `${name}-api-cases`,
    content: apiTestCasesSnippet,
    alreadyIncludes: `admin-base-generator:start ${name}-api-cases`,
  });
  changes.push(
    await createPublishChange({
      path: generatedCasesPath,
      source: "integration",
      afterContent: insertBeforeContent({
        current: withApiCases,
        marker: "  // admin-base-generator:page-test-cases",
        name: `${name}-page-cases`,
        content: pageTestCasesSnippet,
        alreadyIncludes: `admin-base-generator:start ${name}-page-cases`,
      }),
    }),
  );

  return { changes, issues };
}

export async function buildModulePublishPlan(name: string): Promise<ModulePublishPlan> {
  const outputRoot = resolveDraftRoot(name);
  if (!(await pathExists(outputRoot))) throw new Error("模块草稿不存在");
  const outputStat = await lstat(outputRoot);
  if (!outputStat.isDirectory() || outputStat.isSymbolicLink()) throw new Error("模块草稿目录无效");
  const config = await readGeneratedModuleConfig(outputRoot);
  if (config.domain !== "system") {
    throw new Error("当前自动发布仅支持 domain=system；业务域模块需要先建立后端 domain 挂载约定");
  }
  const configHash = hashContent(JSON.stringify(config));
  const migrationId = `generated_${name.replaceAll("-", "_")}_${configHash.slice(0, 12)}`;
  const sourceChanges = await collectGeneratedSourceChanges(outputRoot);
  const integration = await buildIntegrationChanges(name, outputRoot, config, migrationId);
  const changes = [...integration.changes, ...sourceChanges].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  const issues = [
    ...integration.issues,
    ...changes
      .filter((change) => change.status === "conflict")
      .map((change) => `发布目标已存在且内容不同：${change.path}`),
  ];
  const planHash = hashContent(
    JSON.stringify({
      name,
      migrationId,
      changes: changes.map((change) => ({
        path: change.path,
        status: change.status,
        beforeHash: change.beforeHash,
        afterHash: change.afterHash,
      })),
    }),
  );
  return {
    name,
    module: config,
    migrationId,
    planHash,
    ready: issues.length === 0,
    issues,
    changes,
  };
}

function truncatePreview(content: string | null) {
  if (content === null) return null;
  return content.length > 80_000 ? `${content.slice(0, 80_000)}\n/* truncated */` : content;
}

export function toPublicModulePublishPlan(plan: ModulePublishPlan) {
  return {
    name: plan.name,
    module: {
      name: plan.module.name,
      title: plan.module.title,
      domain: plan.module.domain,
      permission: plan.module.permission,
      frontendPath: plan.module.frontendPath,
      apiPath: plan.module.apiPath,
    },
    migrationId: plan.migrationId,
    planHash: plan.planHash,
    ready: plan.ready,
    hasChanges: plan.changes.some((change) => ["create", "modify"].includes(change.status)),
    issues: plan.issues,
    changes: plan.changes.map((change) => ({
      path: change.path,
      source: change.source,
      status: change.status,
      additions: change.additions,
      deletions: change.deletions,
      beforeHash: change.beforeHash,
      afterHash: change.afterHash,
      beforeContent: truncatePreview(change.beforeContent),
      afterContent: truncatePreview(change.afterContent),
    })),
  };
}

async function copyPreflightProject(stageRoot: string) {
  const directories = ["src", "scripts", "tests", "templates", "docs", "schemas", "public"];
  for (const directory of directories) {
    const source = repoPath(directory);
    if (await pathExists(source))
      await cp(source, resolve(stageRoot, directory), { recursive: true });
  }
  const rootFiles = [
    "AGENTS.md",
    "README.md",
    "drizzle.config.ts",
    "eslint.config.mjs",
    "next-env.d.ts",
    "next-env.typecheck.d.ts",
    "next.config.ts",
    "package.json",
    "pnpm-lock.yaml",
    "prettier.config.mjs",
    "tsconfig.json",
    "tsconfig.typecheck.json",
    "vitest.config.ts",
  ];
  for (const file of rootFiles) {
    const source = repoPath(file);
    if (await pathExists(source)) await cp(source, resolve(stageRoot, file));
  }
  await symlink(
    repoPath("node_modules"),
    resolve(stageRoot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
}

async function applyPlanToRoot(plan: ModulePublishPlan, root: string) {
  for (const change of plan.changes) {
    if (!(["create", "modify"] as PublishChangeStatus[]).includes(change.status)) continue;
    const target = resolve(root, change.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, change.afterContent);
  }
}

async function executePnpm(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  if (process.env.npm_execpath) {
    return execFileAsync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd,
      env,
      timeout: 240_000,
      maxBuffer: 8 * 1024 * 1024,
    });
  }
  return execFileAsync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, {
    cwd,
    env,
    timeout: 240_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

async function runModulePublishPreflight(plan: ModulePublishPlan) {
  const stageRoot = repoPath(
    "tmp/module-publish-preflight",
    `${plan.name}-${randomUUID()}-${plan.planHash.slice(0, 8)}`,
  );
  const args =
    process.env.NODE_ENV === "test" ? ["typecheck"] : ["admin:verify", "--module", plan.name];
  const command = `pnpm ${args.join(" ")}`;
  await rm(stageRoot, { recursive: true, force: true });
  await mkdir(stageRoot, { recursive: true });
  try {
    await copyPreflightProject(stageRoot);
    await applyPlanToRoot(plan, stageRoot);
    const databaseUrl =
      process.env.TEST_DATABASE_URL ??
      "postgres://admin_base:admin_base@localhost:5432/admin_base_test";
    const result = await executePnpm(args, stageRoot, {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      ADMIN_BASE_SECRET_KEY: "module-publish-preflight-secret",
      LOG_LEVEL: "silent",
    });
    return {
      command,
      passed: true,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-120_000),
    };
  } catch (error) {
    const details = error as Error & { stdout?: string; stderr?: string };
    const output = `${details.stdout ?? ""}${details.stderr ?? ""}${details.message}`.slice(
      -120_000,
    );
    const validation = {
      command,
      passed: false,
      output,
    } satisfies PublishValidation;
    throw new ModulePublishPreflightError(`发布预检失败：${output}`, validation);
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

async function assertPlanStillCurrent(plan: ModulePublishPlan) {
  for (const change of plan.changes) {
    if (!(["create", "modify"] as PublishChangeStatus[]).includes(change.status)) continue;
    const target = assertSafeRelativePath(change.path);
    const current = (await pathExists(target)) ? await readFile(target, "utf8") : null;
    const currentHash = current === null ? null : hashContent(current);
    if (currentHash !== change.beforeHash) {
      throw new Error(`预检期间文件已发生变化，请重新检查差异：${change.path}`);
    }
  }
}

async function restoreRecordFiles(
  outputRoot: string,
  record: PublishRecord,
  verifyHashes: boolean,
) {
  const files = record.files.filter((file) => record.appliedPaths.includes(file.path));
  if (verifyHashes) {
    for (const file of files) {
      const target = assertSafeRelativePath(file.path);
      const current = (await pathExists(target)) ? await readFile(target, "utf8") : null;
      const currentHash = current === null ? null : hashContent(current);
      if (currentHash !== file.afterHash) {
        throw new Error(`发布后文件已被修改，拒绝自动回滚：${file.path}`);
      }
    }
  }
  for (const file of [...files].reverse()) {
    const target = assertSafeRelativePath(file.path);
    if (file.action === "create") {
      await rm(target, { force: true });
      continue;
    }
    if (!file.backupPath) throw new Error(`回滚备份缺失：${file.path}`);
    const backup = resolvePublishBackupPath(outputRoot, record.publishId, file.backupPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(backup));
  }
}

async function publishModuleDraftUnlocked(name: string, expectedPlanHash?: string) {
  const outputRoot = resolveDraftRoot(name);
  const plan = await buildModulePublishPlan(name);
  if (!plan.ready) throw new Error(`发布计划存在冲突：${plan.issues.join("；")}`);
  if (!plan.changes.some((change) => ["create", "modify"].includes(change.status))) {
    throw new Error("当前草稿没有需要发布的变更");
  }
  if (expectedPlanHash && expectedPlanHash !== plan.planHash) {
    throw new Error("草稿或项目源码已变化，请重新检查发布差异");
  }

  const publishId = `${Date.now()}-${randomUUID()}`;
  const record: PublishRecord = {
    version: 1,
    publishId,
    moduleName: name,
    planHash: plan.planHash,
    migrationId: plan.migrationId,
    status: "preflighting",
    createdAt: new Date().toISOString(),
    publishedAt: null,
    rolledBackAt: null,
    validation: null,
    error: null,
    appliedPaths: [],
    files: plan.changes
      .filter((change) => ["create", "modify"].includes(change.status))
      .map((change) => ({
        path: change.path,
        action: change.status as "create" | "modify",
        beforeHash: change.beforeHash,
        afterHash: change.afterHash,
        backupPath: change.beforeContent === null ? null : `backups/${change.path}`,
      })),
  };
  await writePublishRecord(outputRoot, record);

  try {
    record.validation = await runModulePublishPreflight(plan);
    await assertPlanStillCurrent(plan);
    for (const change of plan.changes) {
      if (!(["create", "modify"] as PublishChangeStatus[]).includes(change.status)) continue;
      const recordFile = record.files.find((file) => file.path === change.path);
      if (change.beforeContent !== null && recordFile?.backupPath) {
        const backup = resolvePublishBackupPath(outputRoot, publishId, recordFile.backupPath);
        await mkdir(dirname(backup), { recursive: true });
        await writeFile(backup, change.beforeContent);
      }
      const target = assertSafeRelativePath(change.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, change.afterContent);
      record.appliedPaths.push(change.path);
      await writePublishRecord(outputRoot, record);
    }
    record.status = "published";
    record.publishedAt = new Date().toISOString();
    await writePublishRecord(outputRoot, record);
  } catch (error) {
    if (error instanceof ModulePublishPreflightError) record.validation = error.validation;
    record.error = error instanceof Error ? error.message : String(error);
    if (record.appliedPaths.length) {
      await restoreRecordFiles(outputRoot, record, false);
      record.status = "rolled_back";
      record.rolledBackAt = new Date().toISOString();
    } else {
      record.status = "failed";
    }
    await writePublishRecord(outputRoot, record);
    throw error;
  }

  return {
    module: plan.module,
    publishId,
    planHash: plan.planHash,
    migrationId: plan.migrationId,
    applied: record.appliedPaths,
    validation: record.validation,
  };
}

export async function publishModuleDraft(name: string, expectedPlanHash?: string) {
  return withModuleSourceMutationLock(() => publishModuleDraftUnlocked(name, expectedPlanHash));
}

async function rollbackModulePublishUnlocked(name: string, publishId?: string) {
  const outputRoot = resolveDraftRoot(name);
  const record = publishId
    ? await readPublishRecord(outputRoot, publishId)
    : await readLatestPublishRecord(outputRoot);
  if (!record || record.status !== "published") throw new Error("没有可回滚的已发布记录");
  if (record.moduleName !== name) throw new Error("发布记录与模块不匹配");
  await restoreRecordFiles(outputRoot, record, true);
  record.status = "rolled_back";
  record.rolledBackAt = new Date().toISOString();
  await writePublishRecord(outputRoot, record);
  return {
    moduleName: name,
    publishId: record.publishId,
    rolledBack: record.appliedPaths,
    databaseNotice: "源码已回滚；已经执行过的数据库 migration 不会自动逆向删除",
  };
}

export async function rollbackModulePublish(name: string, publishId?: string) {
  return withModuleSourceMutationLock(() => rollbackModulePublishUnlocked(name, publishId));
}
