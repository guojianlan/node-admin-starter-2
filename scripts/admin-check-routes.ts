import { adminRoutes } from "../src/router/route-manifest";
import { sqlite } from "../src/server/db";
import { runMigrations } from "../src/server/db/migrations";

runMigrations(sqlite);

const dbRoutes = sqlite
  .prepare("SELECT key, path, link FROM sys_rule WHERE type = 'route' AND path IS NOT NULL")
  .all() as Array<{ key: string; path: string; link: number }>;
const dbActions = sqlite.prepare("SELECT key FROM sys_rule WHERE type = 'action'").all() as Array<{
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

if (missingInManifest.length || missingInDatabase.length || missingAuthRules.length) {
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
  process.exit(1);
}

console.log("Route consistency check passed");
