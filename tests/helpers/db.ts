import { seedDatabase } from "@/server/db/seed/seed";
import { sql, sqlite } from "@/server/db";

export async function resetTestDatabase() {
  await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
  await sql.unsafe("CREATE SCHEMA public");
  await seedDatabase();
}

export { sqlite };
