import "../src/server/load-dotenv";
import bcrypt from "bcryptjs";
import { closeDb, type DbClient, sqlite } from "../src/server/db";
import { getAdminBaseEnv } from "../src/server/env";

const DEMO_PASSWORD = "ScopeDemo123!";

function assertLocalDevelopmentDatabase() {
  const env = getAdminBaseEnv();
  const databaseUrl = new URL(env.databaseUrl);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (env.isProduction || !localHosts.has(databaseUrl.hostname)) {
    throw new Error(
      `Refusing data-scope demo seed outside a local development database (NODE_ENV=${env.nodeEnv}, host=${databaseUrl.host}).`,
    );
  }
}

async function upsertDept(dbClient: DbClient, input: {
  code: string;
  name: string;
  parentId: number;
  sort: number;
}) {
  const existing = (await dbClient
    .prepare("SELECT id FROM sys_dept WHERE code = ? AND deleted_at IS NULL LIMIT 1")
    .get(input.code)) as { id: number } | undefined;
  if (existing) {
    await dbClient
      .prepare(
        `UPDATE sys_dept
         SET name = ?, parent_id = ?, sort = ?, status = 1, updated_at = now()
         WHERE id = ?`,
      )
      .run(input.name, input.parentId, input.sort, existing.id);
    return existing.id;
  }

  const result = await dbClient
    .prepare(
      `INSERT INTO sys_dept
        (parent_id, name, code, sort, status, is_system, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, false, now(), now())
       RETURNING id`,
    )
    .run(input.parentId, input.name, input.code, input.sort);
  return result.lastInsertRowid;
}

async function upsertRole(dbClient: DbClient, input: {
  code: string;
  name: string;
  dataScope: "all" | "custom_dept" | "current_dept" | "current_dept_tree" | "self";
  sort: number;
  customDeptIds?: number[];
}) {
  const existing = (await dbClient
    .prepare("SELECT id FROM sys_role WHERE code = ? AND deleted_at IS NULL LIMIT 1")
    .get(input.code)) as { id: number } | undefined;
  let roleId = existing?.id;
  if (roleId) {
    await dbClient
      .prepare(
        `UPDATE sys_role
         SET name = ?, remark = ?, sort = ?, status = 1, data_scope = ?, updated_at = now()
         WHERE id = ?`,
      )
      .run(
        input.name,
        "数据范围演示角色，仅用于本地验收",
        input.sort,
        input.dataScope,
        roleId,
      );
  } else {
    const result = await dbClient
      .prepare(
        `INSERT INTO sys_role
          (name, code, remark, sort, status, data_scope, is_system, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, false, now(), now())
         RETURNING id`,
      )
      .run(input.name, input.code, "数据范围演示角色，仅用于本地验收", input.sort, input.dataScope);
    roleId = result.lastInsertRowid;
  }

  await dbClient.prepare("DELETE FROM sys_role_dept WHERE role_id = ?").run(roleId);
  for (const deptId of input.customDeptIds ?? []) {
    await dbClient
      .prepare(
        "INSERT INTO sys_role_dept (role_id, dept_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
      )
      .run(roleId, deptId);
  }
  return roleId;
}

async function upsertUser(dbClient: DbClient, input: {
  username: string;
  nickname: string;
  deptId: number;
  passwordHash: string;
  roleId?: number;
}) {
  const existing = (await dbClient
    .prepare("SELECT id FROM sys_user WHERE username = ? AND deleted_at IS NULL LIMIT 1")
    .get(input.username)) as { id: number } | undefined;
  let userId = existing?.id;
  if (userId) {
    await dbClient
      .prepare(
        `UPDATE sys_user
         SET nickname = ?, dept_id = ?, password_hash = ?, password_updated_at = now(),
             force_password_change = false, failed_login_attempts = 0, locked_until = NULL,
             status = 1, updated_at = now()
         WHERE id = ?`,
      )
      .run(input.nickname, input.deptId, input.passwordHash, userId);
  } else {
    const result = await dbClient
      .prepare(
        `INSERT INTO sys_user
          (username, password_hash, nickname, sex, dept_id, status, is_system,
           password_updated_at, force_password_change, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, 1, false, now(), false, now(), now())
         RETURNING id`,
      )
      .run(input.username, input.passwordHash, input.nickname, input.deptId);
    userId = result.lastInsertRowid;
  }

  const demoRoleRows = (await dbClient
    .prepare("SELECT id FROM sys_role WHERE code LIKE 'scope_demo_%' AND deleted_at IS NULL")
    .all()) as Array<{ id: number }>;
  for (const role of demoRoleRows) {
    await dbClient
      .prepare("DELETE FROM sys_user_role WHERE user_id = ? AND role_id = ?")
      .run(userId, role.id);
  }
  if (input.roleId) {
    await dbClient
      .prepare(
        "INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
      )
      .run(userId, input.roleId);
  }
  return userId;
}

async function seedDataScopeDemo() {
  assertLocalDevelopmentDatabase();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await sqlite.transaction(async (dbClient) => {
    const rootId = await upsertDept(dbClient, {
      code: "SCOPE_DEMO_ROOT",
      name: "[数据范围] 演示总部",
      parentId: 0,
      sort: 900,
    });
    const southId = await upsertDept(dbClient, {
      code: "SCOPE_DEMO_SOUTH",
      name: "[数据范围] 华南中心",
      parentId: rootId,
      sort: 901,
    });
    const shenzhenId = await upsertDept(dbClient, {
      code: "SCOPE_DEMO_SZ",
      name: "[数据范围] 深圳研发部",
      parentId: southId,
      sort: 902,
    });
    const guangzhouId = await upsertDept(dbClient, {
      code: "SCOPE_DEMO_GZ",
      name: "[数据范围] 广州运营部",
      parentId: southId,
      sort: 903,
    });
    const eastId = await upsertDept(dbClient, {
      code: "SCOPE_DEMO_EAST",
      name: "[数据范围] 华东中心",
      parentId: rootId,
      sort: 904,
    });
    const shanghaiId = await upsertDept(dbClient, {
      code: "SCOPE_DEMO_SH",
      name: "[数据范围] 上海销售部",
      parentId: eastId,
      sort: 905,
    });

    const roles = {
      all: await upsertRole(dbClient, {
        code: "scope_demo_all",
        name: "[数据范围] 全部数据",
        dataScope: "all",
        sort: 900,
      }),
      currentDept: await upsertRole(dbClient, {
        code: "scope_demo_current_dept",
        name: "[数据范围] 本部门",
        dataScope: "current_dept",
        sort: 901,
      }),
      currentTree: await upsertRole(dbClient, {
        code: "scope_demo_current_tree",
        name: "[数据范围] 本部门及子部门",
        dataScope: "current_dept_tree",
        sort: 902,
      }),
      custom: await upsertRole(dbClient, {
        code: "scope_demo_custom",
        name: "[数据范围] 指定上海销售部",
        dataScope: "custom_dept",
        sort: 903,
        customDeptIds: [shanghaiId],
      }),
      self: await upsertRole(dbClient, {
        code: "scope_demo_self",
        name: "[数据范围] 仅本人",
        dataScope: "self",
        sort: 904,
      }),
    };

    const permissionKeys = [
      "dashboard",
      "system",
      "system.access",
      "system.user",
      "system.user.query",
      "system.dept",
      "system.dept.query",
      "profile",
      "profile.query",
    ];
    const placeholders = permissionKeys.map(() => "?").join(", ");
    const permissionRows = (await dbClient
      .prepare(
        `SELECT id FROM sys_rule
         WHERE key IN (${placeholders}) AND status = 1 AND deleted_at IS NULL`,
      )
      .all(...permissionKeys)) as Array<{ id: number }>;
    for (const roleId of Object.values(roles)) {
      await dbClient.prepare("DELETE FROM sys_role_rule WHERE role_id = ?").run(roleId);
      for (const permission of permissionRows) {
        await dbClient
          .prepare(
            "INSERT INTO sys_role_rule (role_id, rule_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
          )
          .run(roleId, permission.id);
      }
    }

    await upsertUser(dbClient, {
      username: "scope_demo_all",
      nickname: "[数据范围] 全部数据观察员",
      deptId: southId,
      passwordHash,
      roleId: roles.all,
    });
    await upsertUser(dbClient, {
      username: "scope_demo_dept",
      nickname: "[数据范围] 本部门观察员",
      deptId: southId,
      passwordHash,
      roleId: roles.currentDept,
    });
    await upsertUser(dbClient, {
      username: "scope_demo_tree",
      nickname: "[数据范围] 部门树观察员",
      deptId: southId,
      passwordHash,
      roleId: roles.currentTree,
    });
    await upsertUser(dbClient, {
      username: "scope_demo_custom",
      nickname: "[数据范围] 指定部门观察员",
      deptId: southId,
      passwordHash,
      roleId: roles.custom,
    });
    await upsertUser(dbClient, {
      username: "scope_demo_self",
      nickname: "[数据范围] 仅本人观察员",
      deptId: shenzhenId,
      passwordHash,
      roleId: roles.self,
    });

    for (const user of [
      { username: "scope_demo_root_user", nickname: "[样本] 演示总部用户", deptId: rootId },
      { username: "scope_demo_south_user", nickname: "[样本] 华南中心用户", deptId: southId },
      { username: "scope_demo_sz_user", nickname: "[样本] 深圳研发用户", deptId: shenzhenId },
      { username: "scope_demo_gz_user", nickname: "[样本] 广州运营用户", deptId: guangzhouId },
      { username: "scope_demo_east_user", nickname: "[样本] 华东中心用户", deptId: eastId },
      { username: "scope_demo_sh_user", nickname: "[样本] 上海销售用户", deptId: shanghaiId },
    ]) {
      await upsertUser(dbClient, { ...user, passwordHash });
    }
  });

  return {
    password: DEMO_PASSWORD,
    accounts: [
      "scope_demo_all",
      "scope_demo_dept",
      "scope_demo_tree",
      "scope_demo_custom",
      "scope_demo_self",
    ],
  };
}

try {
  const result = await seedDataScopeDemo();
  console.log("Data-scope demo seeded in the local database.");
  console.log(`Accounts: ${result.accounts.join(", ")}`);
  console.log(`Shared password: ${result.password}`);
} finally {
  await closeDb();
}
