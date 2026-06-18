import { adminRoutes } from "../src/router/route-manifest";
import "../src/server/routes/system/index";
import { closeDb, sqlite } from "../src/server/db";
import { seedDatabase } from "../src/server/db/seed/seed";
import { crudMetas } from "../src/server/crud/registry";

await seedDatabase();

const dbRoutes = (await sqlite
  .prepare("SELECT key, path, link FROM sys_rule WHERE type = 'route' AND path IS NOT NULL")
  .all()) as Array<{ key: string; path: string; link: number }>;
const dbActions = (await sqlite
  .prepare("SELECT key FROM sys_rule WHERE type = 'action'")
  .all()) as Array<{
  key: string;
}>;

const manifestPaths = new Set(adminRoutes.map((item) => item.path));
const actionKeys = new Set(dbActions.map((item) => item.key));
const internalDbRoutes = dbRoutes.filter(
  (item) => item.link !== 1 && !/^https?:\/\//.test(item.path),
);
const missingInManifest = internalDbRoutes.filter((item) => !manifestPaths.has(item.path));

const dbPathSet = new Set(internalDbRoutes.map((item) => item.path));
const missingInDatabase = adminRoutes.filter(
  (item) => !item.adminHidden && !dbPathSet.has(item.path),
);
const missingAuthRules = adminRoutes.filter((item) => item.auth && !actionKeys.has(item.auth));
const invalidCrudPermissions = crudMetas.flatMap((meta) =>
  Object.entries(meta.actions)
    .filter(([, permission]) => permission !== false && !actionKeys.has(permission))
    .map(([action, permission]) => ({
      basePath: meta.basePath,
      action,
      permission,
    })),
);
const missingCrudPermissions = crudMetas.flatMap((meta) =>
  Object.entries(meta.actions)
    .filter(([, permission]) => permission === undefined || permission === "")
    .map(([action]) => ({
      basePath: meta.basePath,
      action,
    })),
);

if (
  missingInManifest.length ||
  missingInDatabase.length ||
  missingAuthRules.length ||
  invalidCrudPermissions.length ||
  missingCrudPermissions.length
) {
  console.error("Route consistency check failed");
  if (missingInManifest.length) {
    console.error("DB routes missing in manifest:", missingInManifest);
  }
  if (missingInDatabase.length) {
    console.error("Manifest routes missing in DB:", missingInDatabase);
  }
  if (missingAuthRules.length) {
    console.error("Manifest auth rules missing in DB:", missingAuthRules);
  }
  if (invalidCrudPermissions.length) {
    console.error("CRUD permissions missing in DB:", invalidCrudPermissions);
  }
  if (missingCrudPermissions.length) {
    console.error("CRUD actions missing permission config:", missingCrudPermissions);
  }
  await closeDb();
  process.exit(1);
}

console.log("Route consistency check passed");
await closeDb();
