import "../src/server/load-dotenv";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { closeDb, sqlite } from "../src/server/db";
import { runMigrations } from "../src/server/db/migrations";
import {
  addKnowledgeDocument,
  createKnowledgeBase,
  indexKnowledgeDocument,
  updateKnowledgeBase,
} from "../src/server/services/ai-knowledge-service";
import { recordBackgroundOperationLog } from "../src/server/services/operation-log-service";
import { storeTrustedGeneratedText } from "../src/server/services/storage-service";
import type { AdminUserContext } from "../src/server/context";

const execFileAsync = promisify(execFile);
const defaultProjectRoot = "/Users/apple/Desktop/project";
const knowledgeCode = "local-project-catalog";
const excludedDirectoryNames = new Set([
  ".git",
  ".next",
  ".turbo",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "tmp",
  "temp",
  "data",
  "storage",
  "generated",
  "outputs",
  "playwright-report",
  "test-results",
  "candidate-store-data",
]);

type ProjectMetadata = {
  root: string;
  relativePath: string;
  name: string;
  description: string | null;
  branch: string | null;
  stack: string[];
  packageManager: string | null;
  scripts: string[];
  dependencies: string[];
  readmeDigest: string | null;
};

type ImportDocument = {
  name: string;
  content: string;
  sourcePath: string;
};

function parseArgs() {
  const projectRootArgument = process.argv.find((value) => value.startsWith("--project-root="));
  return {
    projectRoot: path.resolve(
      projectRootArgument?.slice("--project-root=".length) || defaultProjectRoot,
    ),
    generateOnly: process.argv.includes("--generate-only"),
  };
}

function sanitizeText(value: string) {
  return value
    .replace(
      /-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/giu,
      "[REDACTED_PRIVATE_KEY]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/gu, "[REDACTED_API_KEY]")
    .replace(
      /\b([A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|API_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*=\s*([^\s#]+)/giu,
      "$1=[REDACTED]",
    )
    .replace(/(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/giu, "$1[REDACTED]@")
    .replaceAll(/\u0000/g, "");
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function shouldSkipDirectory(directoryPath: string) {
  const name = path.basename(directoryPath).toLowerCase();
  return (
    excludedDirectoryNames.has(name) ||
    name.startsWith(".") ||
    name.includes("backup") ||
    name.includes("备份")
  );
}

async function findProjectRoots(root: string) {
  const gitRoots = new Set<string>();
  async function findGitRoots(directory: string, depth: number) {
    if (depth > 4 || (directory !== root && shouldSkipDirectory(directory))) return;
    if (directory !== root && (await exists(path.join(directory, ".git")))) gitRoots.add(directory);
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => findGitRoots(path.join(directory, entry.name), depth + 1)),
    );
  }
  await findGitRoots(root, 0);

  const roots = new Set(gitRoots);
  const isInsideGitRoot = (directory: string) =>
    [...gitRoots].some(
      (gitRoot) => directory !== gitRoot && directory.startsWith(`${gitRoot}${path.sep}`),
    );
  async function findStandaloneRoots(directory: string, depth: number) {
    if (depth > 3 || (directory !== root && shouldSkipDirectory(directory))) return;
    if (directory !== root && !isInsideGitRoot(directory)) {
      const [hasPackage, hasGo, hasCargo, hasReadme] = await Promise.all([
        exists(path.join(directory, "package.json")),
        exists(path.join(directory, "go.mod")),
        exists(path.join(directory, "Cargo.toml")),
        exists(path.join(directory, "README.md")),
      ]);
      if (hasPackage || hasGo || hasCargo || (depth <= 2 && hasReadme)) roots.add(directory);
    }
    if (isInsideGitRoot(directory)) return;
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => findStandaloneRoots(path.join(directory, entry.name), depth + 1)),
    );
  }
  await findStandaloneRoots(root, 0);
  return [...roots].sort((left, right) => left.localeCompare(right));
}

async function readLimited(filePath: string, maxChars: number) {
  if (!(await exists(filePath))) return null;
  const content = sanitizeText(await fs.readFile(filePath, "utf8"));
  return content.slice(0, maxChars).trim() || null;
}

function readmeDigest(value: string | null) {
  if (!value) return null;
  const cleaned = value
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/<img\b[^>]*>/giu, "")
    .replace(/\[!\[[^\]]*]\([^)]*\)]\([^)]*\)/g, "")
    .trim();
  const sections = cleaned.split(/(?=^#{1,4}\s+)/gmu);
  return sections
    .map((section) => section.trim().slice(0, 1200))
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 8000)
    .trim();
}

async function gitBranch(root: string) {
  try {
    const result = await execFileAsync("git", ["-C", root, "branch", "--show-current"], {
      timeout: 3000,
    });
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

async function inspectProject(root: string, projectRoot: string): Promise<ProjectMetadata> {
  const packagePath = path.join(root, "package.json");
  const packageContent = await readLimited(packagePath, 200_000);
  let packageJson: Record<string, unknown> = {};
  if (packageContent) {
    try {
      packageJson = JSON.parse(packageContent) as Record<string, unknown>;
    } catch {
      packageJson = {};
    }
  }
  const dependencies = [
    ...Object.keys((packageJson.dependencies as Record<string, unknown> | undefined) ?? {}),
    ...Object.keys((packageJson.devDependencies as Record<string, unknown> | undefined) ?? {}),
  ];
  const stack = new Set<string>();
  const dependencySet = new Set(dependencies);
  if (dependencySet.has("next")) stack.add("Next.js");
  if (dependencySet.has("react")) stack.add("React");
  if (dependencySet.has("vue")) stack.add("Vue");
  if (dependencySet.has("@mastra/core")) stack.add("Mastra");
  if (dependencySet.has("drizzle-orm")) stack.add("Drizzle ORM");
  if (dependencySet.has("antd")) stack.add("Ant Design");
  if (dependencySet.has("hono")) stack.add("Hono");
  if (await exists(path.join(root, "go.mod"))) stack.add("Go");
  if (await exists(path.join(root, "Cargo.toml"))) stack.add("Rust");
  if (packageContent) stack.add("Node.js");
  const readme =
    (await readLimited(path.join(root, "README.md"), 40_000)) ??
    (await readLimited(path.join(root, "README"), 40_000));
  const relativePath = path.relative(projectRoot, root) || path.basename(root);
  return {
    root,
    relativePath,
    name: String(packageJson.name || path.basename(root)),
    description:
      typeof packageJson.description === "string" ? sanitizeText(packageJson.description) : null,
    branch: await gitBranch(root),
    stack: [...stack],
    packageManager:
      typeof packageJson.packageManager === "string" ? packageJson.packageManager : null,
    scripts: Object.keys((packageJson.scripts as Record<string, unknown> | undefined) ?? {}).sort(),
    dependencies: [...new Set(dependencies)].sort().slice(0, 60),
    readmeDigest: readmeDigest(readme),
  };
}

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replaceAll(path.sep, "-")
      .replaceAll(/[^a-z0-9_-]+/g, "-")
      .replaceAll(/-+/g, "-")
      .replaceAll(/^-|-$/g, "") || "project"
  );
}

function projectDocument(project: ProjectMetadata) {
  return sanitizeText(`# ${project.name}

## 项目标识

- 本机路径：\`${project.root}\`
- 相对目录：\`${project.relativePath}\`
- 当前分支：${project.branch ? `\`${project.branch}\`` : "未检测到 Git 分支"}
- 技术栈：${project.stack.length ? project.stack.join("、") : "未从顶层元数据识别"}
- 包管理器：${project.packageManager ? `\`${project.packageManager}\`` : "未声明"}

## 项目说明

${project.description || "顶层 package metadata 未提供 description。"}

## 可用命令

${project.scripts.length ? project.scripts.map((item) => `- \`${item}\``).join("\n") : "未从顶层 package.json 识别脚本。"}

## 主要依赖

${project.dependencies.length ? project.dependencies.map((item) => `- \`${item}\``).join("\n") : "未从顶层元数据识别依赖。"}

## README 摘要

${project.readmeDigest || "项目根目录没有可读取的 README 摘要。"}
`);
}

function overviewDocument(projects: ProjectMetadata[], projectRoot: string) {
  const groups = new Map<string, ProjectMetadata[]>();
  for (const project of projects) {
    const group = project.relativePath.split(path.sep)[0] || "root";
    groups.set(group, [...(groups.get(group) ?? []), project]);
  }
  const sections = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([group, entries]) => `## ${group}

${entries
  .map(
    (project) =>
      `- **${project.name}**：\`${project.relativePath}\`；${project.description || project.stack.join("、") || "待补充说明"}`,
  )
  .join("\n")}`,
    )
    .join("\n\n");
  return sanitizeText(`# 本机项目目录总览

本知识文档由 Admin Base 本地导入脚本生成。扫描根目录为 \`${projectRoot}\`，只读取项目根目录的 Git 分支、README、package.json、go.mod 和 Cargo.toml 等白名单元数据，不读取源码、环境变量、数据库、日志、构建产物、候选人数据或备份目录。

共识别 ${projects.length} 个项目或独立子项目。文档用于本机 Knowledge/RAG 搜索，不代表项目当前已经通过构建、测试或生产验收。

${sections}
`);
}

async function buildDocuments(projectRoot: string) {
  const roots = await findProjectRoots(projectRoot);
  const projects: ProjectMetadata[] = [];
  for (const root of roots) projects.push(await inspectProject(root, projectRoot));
  const documents: ImportDocument[] = [
    {
      name: "00-local-project-catalog-overview.md",
      content: overviewDocument(projects, projectRoot),
      sourcePath: projectRoot,
    },
    ...projects.map((project, index) => ({
      name: `${String(index + 1).padStart(2, "0")}-${slug(project.relativePath)}.md`,
      content: projectDocument(project),
      sourcePath: project.root,
    })),
  ];
  const curatedRoot = path.resolve(process.cwd(), "docs/knowledge");
  const curatedFiles = (await fs.readdir(curatedRoot, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of curatedFiles) {
    const sourcePath = path.join(curatedRoot, entry.name);
    documents.push({
      name: `admin-base-${entry.name}`,
      content: sanitizeText(await fs.readFile(sourcePath, "utf8")),
      sourcePath,
    });
  }
  return { projects, documents };
}

async function writeGeneratedDocuments(documents: ImportDocument[]) {
  const outputRoot = path.resolve(process.cwd(), "generated/knowledge/local-project-catalog");
  await fs.rm(outputRoot, { recursive: true, force: true });
  await fs.mkdir(outputRoot, { recursive: true });
  for (const document of documents) {
    await fs.writeFile(path.join(outputRoot, document.name), document.content, "utf8");
  }
  return outputRoot;
}

async function getAdminUser(): Promise<AdminUserContext> {
  const admin = (await sqlite
    .prepare(
      `SELECT id, username, nickname, email, mobile, dept_id AS "deptId", status
       FROM sys_user WHERE deleted_at IS NULL AND status = 1
       ORDER BY is_system DESC, id ASC LIMIT 1`,
    )
    .get()) as AdminUserContext | undefined;
  if (!admin) throw new Error("没有可用于知识库归属和审计的启用管理员");
  return admin;
}

async function upsertKnowledgeBase(user: AdminUserContext) {
  const payload = {
    name: "本机项目知识库",
    code: knowledgeCode,
    description: "项目目录的安全元数据、README 摘要与 Admin Base 框架文档。",
    scopeType: "global" as const,
    chunkPreset: "documentation" as const,
    chunkSize: 1600,
    chunkOverlap: 160,
    status: 1,
    sort: 0,
  };
  const existing = (await sqlite
    .prepare("SELECT id FROM sys_ai_knowledge_base WHERE code = ? AND deleted_at IS NULL LIMIT 1")
    .get(knowledgeCode)) as { id: number } | undefined;
  if (existing) {
    await updateKnowledgeBase({ id: existing.id, payload, user });
    return existing.id;
  }
  return createKnowledgeBase({ payload, user });
}

async function importDocument(input: {
  knowledgeBaseId: number;
  document: ImportDocument;
  user: AdminUserContext;
}) {
  const sha256 = crypto.createHash("sha256").update(input.document.content).digest("hex");
  const existing = (await sqlite
    .prepare(
      `SELECT id, status FROM sys_ai_document
       WHERE knowledge_base_id = ? AND sha256 = ? AND deleted_at IS NULL LIMIT 1`,
    )
    .get(input.knowledgeBaseId, sha256)) as
    | { id: number; status: "pending" | "processing" | "ready" | "failed" | "disabled" }
    | undefined;
  if (existing?.status === "ready") return "skipped" as const;
  let documentId = existing?.id;
  if (existing?.status === "disabled") {
    await sqlite
      .prepare(
        `UPDATE sys_ai_document SET status = 'pending', updated_by = ?, updated_at = now()
         WHERE id = ?`,
      )
      .run(input.user.id, existing.id);
  }
  if (!documentId) {
    const uploaded = await storeTrustedGeneratedText({
      name: input.document.name,
      content: input.document.content,
      groupId: null,
      userId: input.user.id,
      source: "local-project-knowledge-import",
    });
    documentId = await addKnowledgeDocument({
      knowledgeBaseId: input.knowledgeBaseId,
      fileId: uploaded.id,
      userId: input.user.id,
    });
  }
  await indexKnowledgeDocument({ documentId, userId: input.user.id });
  return existing ? ("reindexed" as const) : ("imported" as const);
}

async function main() {
  const args = parseArgs();
  const startedAt = performance.now();
  await runMigrations();
  const { projects, documents } = await buildDocuments(args.projectRoot);
  const outputRoot = await writeGeneratedDocuments(documents);
  if (args.generateOnly) {
    console.log(
      JSON.stringify({
        success: true,
        generateOnly: true,
        projectCount: projects.length,
        documentCount: documents.length,
        outputRoot,
      }),
    );
    return;
  }
  const user = await getAdminUser();
  const counts = { imported: 0, reindexed: 0, skipped: 0 };
  try {
    const knowledgeBaseId = await upsertKnowledgeBase(user);
    for (const document of documents) {
      const result = await importDocument({ knowledgeBaseId, document, user });
      counts[result] += 1;
    }
    await recordBackgroundOperationLog({
      userId: user.id,
      username: user.username,
      module: "system.aiKnowledge",
      action: "importLocalProjects",
      resource: "/ai/knowledge",
      resourceId: knowledgeBaseId,
      method: "CLI",
      path: "scripts/import-local-project-knowledge.ts",
      riskLevel: "medium",
      durationMs: performance.now() - startedAt,
      details: {
        projectRoot: args.projectRoot,
        projectCount: projects.length,
        documentCount: documents.length,
        ...counts,
      },
    });
    console.log(
      JSON.stringify({
        success: true,
        knowledgeBaseId,
        projectCount: projects.length,
        documentCount: documents.length,
        ...counts,
        outputRoot,
      }),
    );
  } catch (error) {
    await recordBackgroundOperationLog({
      userId: user.id,
      username: user.username,
      module: "system.aiKnowledge",
      action: "importLocalProjects",
      resource: "/ai/knowledge",
      method: "CLI",
      path: "scripts/import-local-project-knowledge.ts",
      riskLevel: "medium",
      success: false,
      status: 500,
      message: error instanceof Error ? error.message : String(error),
      durationMs: performance.now() - startedAt,
      details: {
        projectRoot: args.projectRoot,
        projectCount: projects.length,
        documentCount: documents.length,
        ...counts,
      },
    });
    throw error;
  }
}

try {
  await main();
} finally {
  await closeDb();
}
