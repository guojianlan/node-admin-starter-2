import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

function resolveDatabasePath() {
  const url = process.env.DATABASE_URL;
  if (!url || url === "data/admin-base.sqlite") {
    return path.join(process.cwd(), "data", "admin-base.sqlite");
  }
  if (url.startsWith("file:")) {
    return new URL(url).pathname;
  }
  return path.isAbsolute(url) ? url : path.join(/* turbopackIgnore: true */ process.cwd(), url);
}

const dbPath = resolveDatabasePath();
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

export function nowIso() {
  return new Date().toISOString();
}
