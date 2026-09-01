import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import "../../src/server/routes/system/index";
import { crudMetas } from "../../src/server/crud/registry";

export type HttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export type ApiOperation = {
  method: HttpMethod;
  path: string;
  source: string;
};

const httpMethods = new Set(["delete", "get", "patch", "post", "put"]);

function listTypeScriptFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(entryPath);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [entryPath] : [];
  });
}

function normalizeApiPath(value: string) {
  const pathValue = value.replace(/\/+/g, "/").replace(/:([A-Za-z0-9_]+)/g, "{$1}");
  return pathValue !== "/" && pathValue.endsWith("/") ? pathValue.slice(0, -1) : pathValue;
}

function operationKey(operation: Pick<ApiOperation, "method" | "path">) {
  return `${operation.method} ${operation.path}`;
}

function rootIdentifier(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isCallExpression(expression)) return rootIdentifier(expression.expression);
  if (ts.isPropertyAccessExpression(expression)) return rootIdentifier(expression.expression);
  return null;
}

function containsHonoConstructor(node: ts.Node): boolean {
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Hono") {
    return true;
  }
  return node.getChildren().some(containsHonoConstructor);
}

function collectExplicitOperations() {
  const root = process.cwd();
  const appFile = path.join(root, "src/server/app.ts");
  const authFile = path.join(root, "src/server/routes/auth.ts");
  const systemDirectory = path.join(root, "src/server/routes/system");
  const saasDirectory = path.join(root, "src/server/routes/saas");
  const files = [
    { filePath: appFile, prefix: "/api" },
    { filePath: authFile, prefix: "/api/system" },
    ...listTypeScriptFiles(systemDirectory).map((filePath) => ({
      filePath,
      prefix: "/api/system",
    })),
    ...listTypeScriptFiles(saasDirectory).map((filePath) => ({
      filePath,
      prefix: "/api/saas",
    })),
  ];
  const operations: ApiOperation[] = [];

  for (const { filePath, prefix } of files) {
    const sourceText = fs.readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
    const relativeFile = path.relative(root, filePath);
    const routeReceivers = new Set<string>();

    sourceFile.statements.forEach((statement) => {
      if (!ts.isVariableStatement(statement)) return;
      statement.declarationList.declarations.forEach((declaration) => {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          containsHonoConstructor(declaration.initializer)
        ) {
          routeReceivers.add(declaration.name.text);
        }
      });
    });

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const receiver = rootIdentifier(node.expression.expression);
        const isRouteReceiver = Boolean(receiver && routeReceivers.has(receiver));
        const firstArgument = node.arguments[0];
        if (
          httpMethods.has(method) &&
          isRouteReceiver &&
          firstArgument &&
          (ts.isStringLiteral(firstArgument) || ts.isNoSubstitutionTemplateLiteral(firstArgument))
        ) {
          operations.push({
            method: method.toUpperCase() as HttpMethod,
            path: normalizeApiPath(`${prefix}${firstArgument.text}`),
            source: `${relativeFile}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`,
          });
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return operations;
}

function collectNextRouteOperations() {
  const root = process.cwd();
  const appDirectory = path.join(root, "src/app");
  const honoAdapterFile = path.join(appDirectory, "api", "[[...route]]", "route.ts");
  const operations: ApiOperation[] = [];
  const routeFiles = listTypeScriptFiles(appDirectory).filter(
    (filePath) => path.basename(filePath) === "route.ts" && filePath !== honoAdapterFile,
  );

  for (const filePath of routeFiles) {
    const sourceText = fs.readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
    const routePath = appRouteFromFile(filePath);
    sourceFile.statements.forEach((statement) => {
      const exported =
        ts.canHaveModifiers(statement) &&
        ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      if (!exported) return;
      const methods: string[] = [];
      if (ts.isFunctionDeclaration(statement) && statement.name) methods.push(statement.name.text);
      if (ts.isVariableStatement(statement)) {
        statement.declarationList.declarations.forEach((declaration) => {
          if (ts.isIdentifier(declaration.name)) methods.push(declaration.name.text);
        });
      }
      methods.filter((method) => httpMethods.has(method.toLowerCase())).forEach((method) => {
        operations.push({
          method: method as HttpMethod,
          path: normalizeApiPath(routePath),
          source: `${path.relative(root, filePath)}:${sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1}`,
        });
      });
    });
  }

  return operations;
}

const crudActionRoutes: Record<string, Array<{ method: HttpMethod; suffix: string }>> = {
  query: [{ method: "GET", suffix: "" }],
  create: [{ method: "POST", suffix: "" }],
  update: [{ method: "PUT", suffix: "/{id}" }],
  delete: [{ method: "DELETE", suffix: "/{id}" }],
  batchDelete: [{ method: "POST", suffix: "/batch-delete" }],
  restore: [
    { method: "PUT", suffix: "/restore/{id}" },
    { method: "POST", suffix: "/batch-restore" },
  ],
  forceDelete: [
    { method: "DELETE", suffix: "/force/{id}" },
    { method: "POST", suffix: "/batch-force" },
  ],
  status: [{ method: "PUT", suffix: "/status/{id}" }],
};

function collectCrudOperations() {
  return crudMetas.flatMap((meta) =>
    Object.keys(meta.actions).flatMap((action) => {
      const definitions = crudActionRoutes[action];
      if (!definitions) {
        throw new Error(`Test-case inventory does not know CRUD action ${meta.basePath}:${action}`);
      }
      return definitions.map<ApiOperation>((definition) => ({
        method: definition.method,
        path: normalizeApiPath(`/api/system${meta.basePath}${definition.suffix}`),
        source: `CRUD ${meta.basePath}:${action}`,
      }));
    }),
  );
}

export function collectApiOperations() {
  const operations = [...collectExplicitOperations(), ...collectCrudOperations(), ...collectNextRouteOperations()];
  const unique = new Map<string, ApiOperation>();
  for (const operation of operations) {
    const key = operationKey(operation);
    const existing = unique.get(key);
    if (existing && existing.source !== operation.source) {
      throw new Error(`Duplicate API operation ${key}: ${existing.source}, ${operation.source}`);
    }
    unique.set(key, operation);
  }
  return [...unique.values()].sort((left, right) => operationKey(left).localeCompare(operationKey(right)));
}

function appRouteFromFile(filePath: string) {
  const relative = path.relative(path.join(process.cwd(), "src/app"), filePath);
  const segments = relative
    .split(path.sep)
    .slice(0, -1)
    .filter((segment) => !/^\(.+\)$/.test(segment))
    .map((segment) => segment.replace(/^\[(\.\.\.)?(.+)\]$/, "{$2}"));
  return segments.length ? `/${segments.join("/")}` : "/";
}

export function collectPageRoutes() {
  const appDirectory = path.join(process.cwd(), "src/app");
  return listTypeScriptFiles(appDirectory)
    .filter((filePath) => path.basename(filePath) === "page.tsx")
    .map(appRouteFromFile)
    .sort();
}

export function apiOperationKey(operation: Pick<ApiOperation, "method" | "path">) {
  return operationKey(operation);
}
