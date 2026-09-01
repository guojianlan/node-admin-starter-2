import "../src/server/load-dotenv";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { adminRoutes } from "../src/router/route-manifest";
import "../src/server/routes/system/index";
import { closeDb, sqlite } from "../src/server/db";
import { seedDatabase } from "../src/server/db/seed/seed";
import { crudMetas } from "../src/server/crud/registry";

await seedDatabase();

const dbRoutes = (await sqlite
  .prepare("SELECT key, path, link FROM sys_rule WHERE type = 'route' AND path IS NOT NULL")
  .all()) as Array<{ key: string; path: string; link: number }>;
const dbActions = (await sqlite
  .prepare("SELECT key FROM sys_rule WHERE type = 'action'")
  .all()) as Array<{
  key: string;
}>;

const manifestPaths = new Set(adminRoutes.map((item) => item.path));
const actionKeys = new Set(dbActions.map((item) => item.key));
const internalDbRoutes = dbRoutes.filter(
  (item) => item.link !== 1 && !/^https?:\/\//.test(item.path),
);
const missingInManifest = internalDbRoutes.filter((item) => !manifestPaths.has(item.path));

const dbPathSet = new Set(internalDbRoutes.map((item) => item.path));
const missingInDatabase = adminRoutes.filter(
  (item) => !item.adminHidden && !dbPathSet.has(item.path),
);
const missingAuthRules = adminRoutes.filter((item) => item.auth && !actionKeys.has(item.auth));
const missingRouteAuth = adminRoutes.filter(
  (item) => !item.adminHidden && item.path !== "/dashboard" && !item.auth,
);
const invalidCrudPermissions = crudMetas.flatMap((meta) =>
  Object.entries(meta.actions)
    .filter(([, permission]) => permission !== false && !actionKeys.has(permission))
    .map(([action, permission]) => ({
      basePath: meta.basePath,
      action,
      permission,
    })),
);
const missingCrudPermissions = crudMetas.flatMap((meta) =>
  Object.entries(meta.actions)
    .filter(([, permission]) => permission === undefined || permission === "")
    .map(([action]) => ({
      basePath: meta.basePath,
      action,
    })),
);

type MutationRouteIssue = {
  file: string;
  method: string;
  path: string;
  line: number;
  missing: Array<"ability" | "operationLog">;
};

const mutationMethods = new Set(["post", "put", "patch", "delete"]);
const explicitRouteAllowlist = new Map(
  [
    {
      key: "profile.ts:PUT /profile",
      allowMissingAbility: true,
      allowMissingOperationLog: false,
      reason: "current-user profile update is scoped by authRequired and writes an operation log",
    },
    {
      key: "profile.ts:PUT /profile/password",
      allowMissingAbility: true,
      allowMissingOperationLog: false,
      reason: "current-user password change is scoped by authRequired and writes an operation log",
    },
    {
      key: "profile.ts:POST /profile/avatar",
      allowMissingAbility: true,
      allowMissingOperationLog: false,
      reason: "current-user avatar upload is scoped by authRequired and writes an operation log",
    },
    {
      key: "profile.ts:POST /profile/oauth/:provider/bind",
      allowMissingAbility: true,
      allowMissingOperationLog: true,
      reason:
        "starts a current-user OAuth bind redirect and does not mutate managed resources directly",
    },
    {
      key: "profile.ts:DELETE /profile/oauth/:provider/unbind",
      allowMissingAbility: true,
      allowMissingOperationLog: false,
      reason: "current-user OAuth unbind is scoped by authRequired and writes an operation log",
    },
    {
      key: "notice.ts:POST /notice/my/:id/read",
      allowMissingAbility: true,
      allowMissingOperationLog: true,
      reason: "current-user read receipt action",
    },
    {
      key: "notice.ts:POST /notice/my/read-all",
      allowMissingAbility: true,
      allowMissingOperationLog: true,
      reason: "current-user bulk read receipt action",
    },
    {
      key: "saas/index.ts:POST /invitations/accept",
      allowMissingAbility: true,
      allowMissingOperationLog: false,
      reason:
        "current-user invitation acceptance is bound to auth, one-time token hash, expiry and matching account email",
    },
    {
      key: "file.ts:POST /file/chunk/init",
      allowMissingAbility: false,
      allowMissingOperationLog: true,
      reason: "chunk upload init is high-volume upload plumbing; complete action is audited",
    },
    {
      key: "file.ts:POST /file/chunk/part",
      allowMissingAbility: false,
      allowMissingOperationLog: true,
      reason: "chunk upload part is high-volume upload plumbing; complete action is audited",
    },
    {
      key: "ai-governance.ts:POST /ai/governance/mcp/internal/oauth/token",
      allowMissingAbility: true,
      allowMissingOperationLog: true,
      reason:
        "internal OAuth token exchange uses MCP client credentials instead of admin auth; provisioning is audited",
    },
    {
      key: "ai-governance.ts:POST /ai/governance/mcp/internal",
      allowMissingAbility: true,
      allowMissingOperationLog: true,
      reason:
        "read-only MCP JSON-RPC validates its signed access token and invoking user query ability",
    },
  ].map((item) => [item.key, item]),
);

function listRouteFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listRouteFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
  });
}

function routePathFromArg(arg: ts.Expression | undefined) {
  if (!arg) return "<unknown>";
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  return "<dynamic>";
}

function collectExplicitMutationRouteIssues() {
  const routeDirectories = [
    { directory: path.join(process.cwd(), "src/server/routes/system"), prefix: "" },
    { directory: path.join(process.cwd(), "src/server/routes/saas"), prefix: "saas" },
  ];
  const issues: MutationRouteIssue[] = [];
  for (const { directory, prefix } of routeDirectories) {
    for (const filePath of listRouteFiles(directory)) {
      const sourceText = fs.readFileSync(filePath, "utf8");
      const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
      const relativeFile = path.relative(directory, filePath);
      const file = prefix ? `${prefix}/${relativeFile}` : relativeFile;

      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const method = node.expression.name.text;
          if (mutationMethods.has(method)) {
            const routePath = routePathFromArg(node.arguments[0]);
            const allowlistFile = prefix ? file : relativeFile;
            const key = `${allowlistFile}:${method.toUpperCase()} ${routePath}`;
            const allow = explicitRouteAllowlist.get(key);
            const callText = node.getText(sourceFile);
            const missing: MutationRouteIssue["missing"] = [];
            if (!/\bability\s*\(/.test(callText) && !allow?.allowMissingAbility) {
              missing.push("ability");
            }
            if (!/\brunWithOperationLog\s*\(/.test(callText) && !allow?.allowMissingOperationLog) {
              missing.push("operationLog");
            }
            if (missing.length) {
              const line =
                sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
              issues.push({ file, method: method.toUpperCase(), path: routePath, line, missing });
            }
          }
        }
        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }
  }
  return issues;
}

const explicitMutationRouteIssues = collectExplicitMutationRouteIssues();

if (
  missingInManifest.length ||
  missingInDatabase.length ||
  missingAuthRules.length ||
  missingRouteAuth.length ||
  invalidCrudPermissions.length ||
  missingCrudPermissions.length ||
  explicitMutationRouteIssues.length
) {
  console.error("Route consistency check failed");
  if (missingInManifest.length) {
    console.error("DB routes missing in manifest:", missingInManifest);
  }
  if (missingInDatabase.length) {
    console.error("Manifest routes missing in DB:", missingInDatabase);
  }
  if (missingAuthRules.length) {
    console.error("Manifest auth rules missing in DB:", missingAuthRules);
  }
  if (missingRouteAuth.length) {
    console.error("Manifest routes missing auth binding:", missingRouteAuth);
  }
  if (invalidCrudPermissions.length) {
    console.error("CRUD permissions missing in DB:", invalidCrudPermissions);
  }
  if (missingCrudPermissions.length) {
    console.error("CRUD actions missing permission config:", missingCrudPermissions);
  }
  if (explicitMutationRouteIssues.length) {
    console.error(
      "Explicit mutation routes missing ability or operation log:",
      explicitMutationRouteIssues,
    );
  }
  await closeDb();
  process.exit(1);
}

console.log("Route consistency check passed");
await closeDb();
