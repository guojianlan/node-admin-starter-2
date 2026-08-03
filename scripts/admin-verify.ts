import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type Mode = "quick" | "module" | "full";

type Command = {
  label: string;
  args: string[];
};

const args = process.argv.slice(2);
let mode: Mode = "quick";
let moduleName = "";
let includeSmoke = false;

function printHelp() {
  console.log(`Admin Base verification

Usage:
  pnpm admin:verify --quick
  pnpm admin:verify --module <module-name>
  pnpm admin:verify --full
  pnpm admin:verify --full --smoke

Scopes:
  --quick            Typecheck, test-case inventory, and route/permission consistency.
  --module <name>    Quick checks plus focused lint and related Vitest tests.
  --full             Typecheck, lint, tests, inventories, route checks, and production build.
  --smoke            Also run the non-destructive smoke script against a running application.
`);
}

for (let index = 0; index < args.length; index += 1) {
  const value = args[index];
  if (value === "--help" || value === "-h") {
    printHelp();
    process.exit(0);
  }
  if (value === "--quick") {
    mode = "quick";
    continue;
  }
  if (value === "--full") {
    mode = "full";
    continue;
  }
  if (value === "--smoke") {
    includeSmoke = true;
    continue;
  }
  if (value === "--module") {
    const name = args[index + 1];
    if (!name || name.startsWith("--")) {
      throw new Error("--module requires a module name");
    }
    mode = "module";
    moduleName = name;
    index += 1;
    continue;
  }
  throw new Error(`Unknown argument: ${value}`);
}

if (includeSmoke && mode !== "full") {
  throw new Error("--smoke must be used with --full");
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command: Command) {
  console.log(`\n[admin:verify] ${command.label}`);
  const result = spawnSync(pnpm, command.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command.label} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function walkFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return walkFiles(entryPath);
    return entry.isFile() ? [entryPath] : [];
  });
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function discoverModuleFiles(name: string) {
  const normalizedName = normalize(name);
  const extensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
  const sourceAndTests = [...walkFiles("src"), ...walkFiles("tests")].filter((file) =>
    extensions.has(path.extname(file)),
  );
  const matched = sourceAndTests.filter((file) => {
    if (!extensions.has(path.extname(file))) return false;
    return normalize(file).includes(normalizedName);
  });
  const relatedTests = sourceAndTests.filter((file) => {
    if (!/\.(test|spec)\.[jt]sx?$/.test(file)) return false;
    if (normalize(file).includes(normalizedName)) return true;
    return normalize(fs.readFileSync(file, "utf8")).includes(normalizedName);
  });
  const sharedContractFiles = [
    "src/router/route-manifest.ts",
    "src/server/db/schema/index.ts",
    "src/server/db/migrations.ts",
    "src/server/db/seed/default-data.ts",
    "src/server/routes/system/index.ts",
    "tests/coverage/api-test-cases.ts",
    "tests/coverage/generated-module-test-cases.ts",
    "tests/coverage/page-test-cases.ts",
  ].filter((file) => fs.existsSync(file));
  return {
    matched,
    lint: [...new Set([...matched, ...relatedTests, ...sharedContractFiles])],
    tests: relatedTests,
  };
}

const quickCommands: Command[] = [
  { label: "TypeScript", args: ["typecheck"] },
  { label: "API and page test-case inventory", args: ["test:check-cases"] },
  { label: "Route and permission consistency", args: ["admin:check-routes"] },
];

if (mode === "quick") {
  quickCommands.forEach(run);
} else if (mode === "module") {
  const moduleFiles = discoverModuleFiles(moduleName);
  if (!moduleFiles.matched.length) {
    throw new Error(`No source or test files found for module: ${moduleName}`);
  }
  quickCommands.forEach(run);
  run({
    label: `ESLint for ${moduleName}`,
    args: ["exec", "eslint", ...moduleFiles.lint, "--max-warnings=0"],
  });
  if (moduleFiles.tests.length) {
    run({
      label: `Focused Vitest tests for ${moduleName}`,
      args: ["exec", "vitest", "run", ...moduleFiles.tests, "--passWithNoTests"],
    });
  } else {
    console.warn(
      `[admin:verify] No focused test file mentions ${moduleName}; global inventory and route checks still passed.`,
    );
  }
} else {
  const fullCommands: Command[] = [
    { label: "TypeScript", args: ["typecheck"] },
    { label: "ESLint", args: ["lint"] },
    { label: "Vitest", args: ["test"] },
    { label: "API and page test-case inventory", args: ["test:check-cases"] },
    { label: "Route and permission consistency", args: ["admin:check-routes"] },
    { label: "Production build", args: ["build"] },
  ];
  if (includeSmoke) fullCommands.push({ label: "Non-destructive smoke", args: ["smoke"] });
  fullCommands.forEach(run);
}

console.log(`\n[admin:verify] ${mode} verification passed${includeSmoke ? " with smoke" : ""}.`);
