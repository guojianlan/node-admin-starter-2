import "../src/server/load-dotenv";
import { closeDb } from "../src/server/db";
import { runMigrations } from "../src/server/db/migrations";

await runMigrations();
await closeDb();
console.log("Database migrated");
