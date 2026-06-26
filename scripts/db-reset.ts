import "../src/server/load-dotenv";
import { closeDb, sql } from "../src/server/db";
import { seedDatabase } from "../src/server/db/seed/seed";
import { DEFAULT_DATABASE_URL } from "../src/server/env";

function assertDbResetAllowed() {
  const nodeEnv = process.env.NODE_ENV || "development";
  const databaseUrl = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const explicitAllow = process.env.ADMIN_BASE_ALLOW_DB_RESET === "true";
  const safeNodeEnv = nodeEnv === "development" || nodeEnv === "test";

  let parsed: URL | null = null;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Refusing db:reset because DATABASE_URL is not a valid URL");
  }

  const host = parsed.hostname.toLowerCase();
  const databaseName = parsed.pathname.replace(/^\//, "").toLowerCase();
  const looksLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const looksProduction =
    /prod|production/.test(databaseName) || /prod|production/.test(host) || nodeEnv === "production";

  if (!safeNodeEnv && !explicitAllow) {
    throw new Error(
      `Refusing db:reset in NODE_ENV=${nodeEnv}. Set ADMIN_BASE_ALLOW_DB_RESET=true only for an intentional isolated reset.`,
    );
  }

  if (looksProduction && !explicitAllow) {
    throw new Error(
      `Refusing db:reset because DATABASE_URL looks production-like (${parsed.host}/${databaseName}).`,
    );
  }

  if (!looksLocal && !explicitAllow) {
    throw new Error(
      `Refusing db:reset against non-local database host (${parsed.host}). Set ADMIN_BASE_ALLOW_DB_RESET=true only for an intentional isolated reset.`,
    );
  }
}

assertDbResetAllowed();

await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
await sql.unsafe("CREATE SCHEMA public");
await seedDatabase();
await closeDb();

console.log("Database reset. Default account: admin / 123456");
