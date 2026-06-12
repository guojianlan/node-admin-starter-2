import { sqlite } from "../src/server/db";
import { runMigrations } from "../src/server/db/migrations";

runMigrations(sqlite);
console.log("Database migrated");
