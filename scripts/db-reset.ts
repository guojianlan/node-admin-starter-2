import fs from "node:fs";
import path from "node:path";

const dbUrl = process.env.DATABASE_URL || "data/admin-base.sqlite";
const dbPath = path.isAbsolute(dbUrl) ? dbUrl : path.join(process.cwd(), dbUrl);

for (const file of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
  if (fs.existsSync(file)) fs.rmSync(file);
}

const { sqlite } = await import("../src/server/db");
const { seedDatabase } = await import("../src/server/db/seed/seed");

await seedDatabase(sqlite);
console.log("Database reset. Default account: admin / 123456");
