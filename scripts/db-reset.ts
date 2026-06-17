import { closeDb, sql } from "../src/server/db";
import { seedDatabase } from "../src/server/db/seed/seed";

await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
await sql.unsafe("CREATE SCHEMA public");
await seedDatabase();
await closeDb();

console.log("Database reset. Default account: admin / 123456");
