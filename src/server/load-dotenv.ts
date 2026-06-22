import fs from "node:fs";
import path from "node:path";

let dotenvLoaded = false;

function stripQuotes(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseDotEnv(content: string) {
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    values[match[1]] = stripQuotes(match[2]);
  }
  return values;
}

export function loadDotEnvFiles(
  input: {
    cwd?: string;
    target?: NodeJS.ProcessEnv;
    force?: boolean;
  } = {},
) {
  const target = input.target ?? process.env;
  if (target === process.env && dotenvLoaded && !input.force) return;

  const cwd = input.cwd ?? process.cwd();
  const fileValues: Record<string, string> = {};
  for (const filename of [".env", ".env.local"]) {
    const filepath = path.join(cwd, filename);
    if (!fs.existsSync(filepath)) continue;
    Object.assign(fileValues, parseDotEnv(fs.readFileSync(filepath, "utf8")));
  }

  for (const [key, value] of Object.entries(fileValues)) {
    if (target[key] === undefined) target[key] = value;
  }

  if (target === process.env) dotenvLoaded = true;
}

loadDotEnvFiles();
