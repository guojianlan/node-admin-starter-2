import { seedDatabase } from "@/server/db/seed/seed";
import { sqlite } from "@/server/db";

const tables = [
  "sys_file",
  "sys_file_group",
  "sys_config_items",
  "sys_config_group",
  "sys_dict_item",
  "sys_dict",
  "sys_login_record",
  "sys_access_token",
  "sys_role_rule",
  "sys_rule",
  "sys_user_role",
  "sys_dept",
  "sys_role",
  "sys_user",
];

export async function resetTestDatabase() {
  sqlite.exec("PRAGMA foreign_keys = OFF");
  tables.forEach((table) => {
    sqlite.prepare(`DELETE FROM ${table}`).run();
  });
  sqlite
    .prepare(`DELETE FROM sqlite_sequence WHERE name IN (${tables.map(() => "?").join(",")})`)
    .run(...tables);
  sqlite.exec("PRAGMA foreign_keys = ON");
  await seedDatabase(sqlite);
}

export { sqlite };
