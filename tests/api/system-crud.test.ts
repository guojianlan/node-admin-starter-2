import { beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { app } from "@/server/app";
import { nowIso } from "@/server/db";
import { getAdminTestPassword } from "../helpers/auth";
import { resetTestDatabase, sqlite } from "../helpers/db";

type ApiResponse<T = unknown> = {
  success: boolean;
  msg: string;
  data?: T;
};

type Page<T> = {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
};

async function readJson<T = unknown>(response: Response) {
  return (await response.json()) as ApiResponse<T>;
}

async function login(username = "admin", password?: string) {
  const resolvedPassword = password ?? (username === "admin" ? getAdminTestPassword() : "123456");
  const response = await app.request("/api/system/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: resolvedPassword }),
  });
  const body = await readJson<{ token: string }>(response);
  return { response, body, token: String(body.data?.token ?? "") };
}

function authHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function createQueryOnlyUser() {
  const now = nowIso();
  const passwordHash = await bcrypt.hash("123456", 10);
  const roleResult = await sqlite
    .prepare(
      `INSERT INTO sys_role
        (name, code, remark, sort, status, created_at, updated_at)
       VALUES
        ('字典查询员', 'dict_query_only', '', 20, 1, ?, ?)
       RETURNING id`,
    )
    .run(now, now);
  const roleId = Number(roleResult.lastInsertRowid);
  const ruleIds = (
    (await sqlite
      .prepare(
        `SELECT id FROM sys_rule
         WHERE key IN ('system', 'system.dict', 'system.dict.query')
         ORDER BY id ASC`,
      )
      .all()) as Array<{ id: number }>
  ).map((item) => item.id);
  const insertRoleRule = sqlite.prepare(
    "INSERT INTO sys_role_rule (role_id, rule_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
  );
  for (const ruleId of ruleIds) {
    await insertRoleRule.run(roleId, ruleId);
  }

  await sqlite
    .prepare(
      `INSERT INTO sys_user
        (username, password_hash, nickname, sex, dept_id, status, created_at, updated_at)
       VALUES
        ('dictviewer', ?, '字典查询员', 0, 1, 1, ?, ?)
       RETURNING id`,
    )
    .run(passwordHash, now, now);
  await sqlite
    .prepare(
      "INSERT INTO sys_user_role (user_id, role_id) VALUES ((SELECT id FROM sys_user WHERE username = ?), ?)",
    )
    .run("dictviewer", roleId);
}

async function createScopedUserManager() {
  const now = nowIso();
  const password = "ScopedDemo123!";
  const passwordHash = await bcrypt.hash(password, 10);
  const southDept = await sqlite
    .prepare(
      `INSERT INTO sys_dept
        (parent_id, name, code, sort, status, is_system, created_at, updated_at)
       VALUES (1, '测试华南部门', 'TEST_SCOPE_SOUTH', 100, 1, false, ?, ?)
       RETURNING id`,
    )
    .run(now, now);
  const northDept = await sqlite
    .prepare(
      `INSERT INTO sys_dept
        (parent_id, name, code, sort, status, is_system, created_at, updated_at)
       VALUES (1, '测试华北部门', 'TEST_SCOPE_NORTH', 101, 1, false, ?, ?)
       RETURNING id`,
    )
    .run(now, now);
  const southDeptId = Number(southDept.lastInsertRowid);
  const northDeptId = Number(northDept.lastInsertRowid);
  const role = await sqlite
    .prepare(
      `INSERT INTO sys_role
        (name, code, remark, sort, status, data_scope, is_system, created_at, updated_at)
       VALUES ('测试部门用户管理员', 'test_scoped_user_manager', '', 100, 1, 'current_dept', false, ?, ?)
       RETURNING id`,
    )
    .run(now, now);
  const roleId = Number(role.lastInsertRowid);
  const ruleRows = (await sqlite
    .prepare(
      `SELECT id
       FROM sys_rule
       WHERE key IN (
         'system',
         'system.access',
         'system.user',
         'system.user.query',
         'system.user.create',
         'system.user.update',
         'system.user.delete',
         'system.user.resetPassword'
       )
         AND deleted_at IS NULL`,
    )
    .all()) as Array<{ id: number }>;
  for (const rule of ruleRows) {
    await sqlite
      .prepare("INSERT INTO sys_role_rule (role_id, rule_id) VALUES (?, ?) ON CONFLICT DO NOTHING")
      .run(roleId, rule.id);
  }

  async function insertUser(username: string, nickname: string, deptId: number) {
    const result = await sqlite
      .prepare(
        `INSERT INTO sys_user
          (username, password_hash, nickname, sex, dept_id, status, is_system,
           force_password_change, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, 1, false, false, ?, ?)
         RETURNING id`,
      )
      .run(username, passwordHash, nickname, deptId, now, now);
    return Number(result.lastInsertRowid);
  }

  const managerId = await insertUser("scope_manager", "部门管理员", southDeptId);
  const sameDeptUserId = await insertUser("scope_same_user", "同部门用户", southDeptId);
  const otherDeptUserId = await insertUser("scope_other_user", "跨部门用户", northDeptId);
  await sqlite
    .prepare("INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?)")
    .run(managerId, roleId);

  return {
    password,
    northDeptId,
    managerId,
    sameDeptUserId,
    otherDeptUserId,
  };
}

async function findDictByCode(code: string) {
  return (await sqlite
    .prepare(
      `SELECT
        id,
        name,
        code,
        created_by AS createdBy,
        updated_by AS updatedBy,
        deleted_by AS deletedBy,
        deleted_at AS deletedAt
       FROM sys_dict
       WHERE code = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(code)) as
    | {
        id: number;
        name: string;
        code: string;
        createdBy: number | null;
        updatedBy: number | null;
        deletedBy: number | null;
        deletedAt: string | Date | null;
      }
    | undefined;
}

describe("system CRUD factory API", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("enforces per-action permissions on factory routes", async () => {
    await createQueryOnlyUser();
    const { token } = await login("dictviewer", "123456");

    const list = await app.request("/api/system/dict/list", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.status).toBe(200);

    const create = await app.request("/api/system/dict/list", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ name: "无权限字典", code: "no_permission" }),
    });
    const createBody = await readJson(create);
    expect(create.status).toBe(403);
    expect(createBody.msg).toBe("No Permission");
  });

  it("enforces data scope on user list and every user mutation", async () => {
    const fixture = await createScopedUserManager();
    const { token } = await login("scope_manager", fixture.password);

    const list = await app.request("/api/system/user?page=1&pageSize=100", {
      headers: { authorization: `Bearer ${token}` },
    });
    const listBody = await readJson<Page<{ id: number; username: string }>>(list);
    expect(list.status).toBe(200);
    expect(listBody.data?.data.map((item) => item.username)).toEqual(
      expect.arrayContaining(["scope_manager", "scope_same_user"]),
    );
    expect(listBody.data?.data.map((item) => item.username)).not.toContain("scope_other_user");

    const createOutsideScope = await app.request("/api/system/user", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        username: "scope_created_outside",
        password: "CreatedDemo123!",
        nickname: "跨部门新用户",
        deptId: fixture.northDeptId,
      }),
    });
    expect(createOutsideScope.status).toBe(403);

    const updateOutsideScope = await app.request(`/api/system/user/${fixture.otherDeptUserId}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ nickname: "越权修改" }),
    });
    expect(updateOutsideScope.status).toBe(404);
    expect((await readJson(updateOutsideScope)).msg).toBe("记录不存在或无数据权限");

    const moveOutsideScope = await app.request(`/api/system/user/${fixture.sameDeptUserId}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ deptId: fixture.northDeptId }),
    });
    expect(moveOutsideScope.status).toBe(403);

    const deleteOutsideScope = await app.request(`/api/system/user/${fixture.otherDeptUserId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleteOutsideScope.status).toBe(404);

    const mixedBatchDelete = await app.request("/api/system/user/batch-delete", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ ids: [fixture.sameDeptUserId, fixture.otherDeptUserId] }),
    });
    expect(mixedBatchDelete.status).toBe(404);

    const resetOutsideScope = await app.request("/api/system/user/resetPassword", {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ id: fixture.otherDeptUserId, password: "ChangedDemo123!" }),
    });
    expect(resetOutsideScope.status).toBe(404);
    expect((await readJson(resetOutsideScope)).msg).toBe("用户不存在或无数据权限");

    const rows = (await sqlite
      .prepare(
        `SELECT id, nickname, deleted_at AS "deletedAt"
         FROM sys_user
         WHERE id IN (?, ?)
         ORDER BY id ASC`,
      )
      .all(fixture.sameDeptUserId, fixture.otherDeptUserId)) as Array<{
      id: number;
      nickname: string;
      deletedAt: string | null;
    }>;
    expect(rows).toEqual([
      expect.objectContaining({ id: fixture.sameDeptUserId, deletedAt: null }),
      expect.objectContaining({
        id: fixture.otherDeptUserId,
        nickname: "跨部门用户",
        deletedAt: null,
      }),
    ]);

    const updateInsideScope = await app.request(`/api/system/user/${fixture.sameDeptUserId}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ nickname: "同部门已更新" }),
    });
    expect(updateInsideScope.status).toBe(200);
  });

  it("creates, updates, soft-deletes and batch-deletes dictionaries with audit fields", async () => {
    const { token } = await login();
    const create = await app.request("/api/system/dict/list", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        name: "测试字典",
        code: "crud_test",
        remark: "factory",
        status: 1,
        sort: 99,
      }),
    });
    expect(create.status).toBe(200);

    const created = await findDictByCode("crud_test");
    expect(created).toMatchObject({
      name: "测试字典",
      createdBy: 1,
      updatedBy: 1,
      deletedAt: null,
    });

    const list = await app.request(
      "/api/system/dict/list?page=1&pageSize=10&keyword=crud&status=1&sort=sort.asc",
      { headers: { authorization: `Bearer ${token}` } },
    );
    const listBody = await readJson<Page<{ code: string; status: number }>>(list);
    expect(list.status).toBe(200);
    expect(listBody.data?.data).toEqual([
      expect.objectContaining({ code: "crud_test", status: 1 }),
    ]);

    const update = await app.request(`/api/system/dict/list/${created?.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ name: "测试字典-更新" }),
    });
    expect(update.status).toBe(200);
    const updated = await findDictByCode("crud_test");
    expect(updated).toMatchObject({ name: "测试字典-更新", updatedBy: 1 });

    const remove = await app.request(`/api/system/dict/list/${created?.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(remove.status).toBe(200);
    const deleted = await findDictByCode("crud_test");
    expect(deleted?.deletedBy).toBe(1);
    expect(deleted?.deletedAt).toBeTruthy();

    const recreate = await app.request("/api/system/dict/list", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        name: "测试字典-重建",
        code: "crud_test",
        status: 1,
        sort: 100,
      }),
    });
    expect(recreate.status).toBe(200);
    const activeCount = (await sqlite
      .prepare("SELECT COUNT(1)::int AS total FROM sys_dict WHERE code = ? AND deleted_at IS NULL")
      .get("crud_test")) as { total: number };
    expect(activeCount.total).toBe(1);

    const recreated = await findDictByCode("crud_test");
    const batchDelete = await app.request("/api/system/dict/list/batch-delete", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ ids: [recreated?.id] }),
    });
    expect(batchDelete.status).toBe(200);
    const batchDeleted = await findDictByCode("crud_test");
    expect(batchDeleted?.deletedBy).toBe(1);
    expect(batchDeleted?.deletedAt).toBeTruthy();
  });

  it("lists and mutates config groups and items through factory routes", async () => {
    const { token } = await login();
    const groupCreate = await app.request("/api/system/config/group", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ name: "高级配置", code: "advanced", sort: 8, status: 1 }),
    });
    expect(groupCreate.status).toBe(200);
    const group = (await sqlite
      .prepare("SELECT id, created_by AS createdBy FROM sys_config_group WHERE code = ?")
      .get("advanced")) as { id: number; createdBy: number };
    expect(group.createdBy).toBe(1);

    const itemCreate = await app.request("/api/system/config/items", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        groupId: group.id,
        key: "advanced_switch",
        title: "高级开关",
        values: "on",
        type: "switch",
        sort: 2,
        status: 1,
      }),
    });
    expect(itemCreate.status).toBe(200);

    const items = await app.request(
      `/api/system/config/items?page=1&pageSize=10&groupId=${group.id}&type=switch&keyword=advanced`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const itemsBody = await readJson<Page<{ key: string; groupName: string }>>(items);
    expect(items.status).toBe(200);
    expect(itemsBody.data?.data).toEqual([
      expect.objectContaining({ key: "advanced_switch", groupName: "高级配置" }),
    ]);

    const item = (await sqlite
      .prepare("SELECT id FROM sys_config_items WHERE key = ?")
      .get("advanced_switch")) as { id: number };
    const update = await app.request(`/api/system/config/items/${item.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ title: "高级开关-更新" }),
    });
    expect(update.status).toBe(200);
    const updated = (await sqlite
      .prepare("SELECT title, updated_by AS updatedBy FROM sys_config_items WHERE id = ?")
      .get(item.id)) as { title: string; updatedBy: number };
    expect(updated).toMatchObject({ title: "高级开关-更新", updatedBy: 1 });
  });

  it("keeps custom dictionary all endpoint and department protections working", async () => {
    const { token } = await login();
    const dictAll = await app.request("/api/system/dict/list/all", {
      headers: { authorization: `Bearer ${token}` },
    });
    const dictAllBody =
      await readJson<Record<string, Array<{ label: string; value: string }>>>(dictAll);
    expect(dictAll.status).toBe(200);
    expect(dictAllBody.data?.status).toEqual([
      expect.objectContaining({ label: "启用", value: "1" }),
      expect.objectContaining({ label: "停用", value: "0" }),
    ]);

    const deptCreate = await app.request("/api/system/dept", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        parentId: 1,
        name: "测试部门",
        code: "QA",
        sort: 9,
        leader: "qa",
        phone: "13800000001",
        status: 1,
      }),
    });
    expect(deptCreate.status).toBe(200);

    const deptList = await app.request("/api/system/dept?keyword=测试&status=1", {
      headers: { authorization: `Bearer ${token}` },
    });
    const deptListBody = await readJson<Page<{ code: string; name: string }>>(deptList);
    expect(deptList.status).toBe(200);
    expect(deptListBody.data?.data).toEqual([
      expect.objectContaining({ code: "QA", name: "测试部门" }),
    ]);

    const dept = (await sqlite.prepare("SELECT id FROM sys_dept WHERE code = ?").get("QA")) as {
      id: number;
    };
    const deptDelete = await app.request(`/api/system/dept/${dept.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deptDelete.status).toBe(200);
    const deletedDept = (await sqlite
      .prepare("SELECT deleted_by AS deletedBy, deleted_at AS deletedAt FROM sys_dept WHERE id = ?")
      .get(dept.id)) as { deletedBy: number; deletedAt: string | Date | null };
    expect(deletedDept.deletedBy).toBe(1);
    expect(deletedDept.deletedAt).toBeTruthy();

    const defaultDeptDelete = await app.request("/api/system/dept/1", {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    const defaultDeptDeleteBody = await readJson(defaultDeptDelete);
    expect(defaultDeptDelete.status).toBe(500);
    expect(defaultDeptDeleteBody.success).toBe(false);
    expect(defaultDeptDeleteBody.msg).toBe("不能删除默认部门");
  });
});
