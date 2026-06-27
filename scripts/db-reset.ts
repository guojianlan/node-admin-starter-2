import "../src/server/load-dotenv";
import { closeDb, sql } from "../src/server/db";
import { seedDatabase } from "../src/server/db/seed/seed";
import { DEFAULT_DATABASE_URL } from "../src/server/env";

function assertDbResetAllowed() {
  const nodeEnv = process.env.NODE_ENV || "development";
  const databaseUrl = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const explicitAllow = process.env.ADMIN_BASE_ALLOW_DB_RESET === "true";
  const destructiveConfirmation =
    process.env.ADMIN_BASE_CONFIRM_PRODUCTION_RESET === "I_KNOW_THIS_WILL_DESTROY_DATA";
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
      `Refusing db:reset because DATABASE_URL looks production-like (NODE_ENV=${nodeEnv}, host=${parsed.host}, database=${databaseName}).`,
    );
  }

  if (!looksLocal && !explicitAllow) {
    throw new Error(
      `Refusing db:reset against non-local database host (NODE_ENV=${nodeEnv}, host=${parsed.host}, database=${databaseName}). Set ADMIN_BASE_ALLOW_DB_RESET=true only for an intentional isolated reset.`,
    );
  }

  if ((looksProduction || !looksLocal) && !destructiveConfirmation) {
    throw new Error(
      `Refusing db:reset for high-risk target (NODE_ENV=${nodeEnv}, host=${parsed.host}, database=${databaseName}). Set ADMIN_BASE_CONFIRM_PRODUCTION_RESET=I_KNOW_THIS_WILL_DESTROY_DATA only for an intentional isolated reset.`,
    );
  }
}

assertDbResetAllowed();

await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
await sql.unsafe("CREATE SCHEMA public");
await seedDatabase();
await closeDb();

console.log("Database reset. Default account: admin / 123456");
