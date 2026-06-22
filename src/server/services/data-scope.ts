import { eq, inArray, or, sql as drizzleSql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Context } from "hono";
import type { HonoVariables } from "@/server/context";
import { sqlite } from "@/server/db";

export type DataScopeValue =
  | "all"
  | "custom_dept"
  | "current_dept"
  | "current_dept_tree"
  | "self";

export type ResolvedDataScope = {
  kind: "all" | "restricted";
  userId: number;
  userDeptId: number | null;
  scopes: DataScopeValue[];
  deptIds: number[];
  selfOnly: boolean;
};

type DeptRow = {
  id: number;
  parentId: number;
};

function uniqueNumbers(values: Array<number | null | undefined>) {
  return [...new Set(values.filter((value): value is number => Number.isFinite(value)))];
}

function collectDescendantIds(rows: DeptRow[], parentId: number): number[] {
  return rows
    .filter((row) => row.parentId === parentId)
    .flatMap((row) => [row.id, ...collectDescendantIds(rows, row.id)]);
}

async function getDeptTreeIds(deptId: number | null) {
  if (!deptId) return [];
  const rows = (await sqlite
    .prepare("SELECT id, parent_id AS parentId FROM sys_dept WHERE deleted_at IS NULL")
    .all()) as DeptRow[];
  return [deptId, ...collectDescendantIds(rows, deptId)];
}

export async function resolveDataScopeForUser(userId: number): Promise<ResolvedDataScope> {
  const user = (await sqlite
    .prepare("SELECT dept_id AS deptId FROM sys_user WHERE id = ? AND deleted_at IS NULL")
    .get(userId)) as { deptId: number | null } | undefined;
  const userDeptId = user?.deptId ?? null;

  if (userId === 1) {
    return {
      kind: "all",
      userId,
      userDeptId,
      scopes: ["all"],
      deptIds: [],
      selfOnly: false,
    };
  }

  const roles = (await sqlite
    .prepare(
      `SELECT role.id, role.data_scope AS dataScope
       FROM sys_role role
       INNER JOIN sys_user_role sur ON sur.role_id = role.id
       WHERE sur.user_id = ?
         AND role.status = 1
         AND role.deleted_at IS NULL`,
    )
    .all(userId)) as Array<{ id: number; dataScope: DataScopeValue | null }>;

  const scopes = roles.map((role) => role.dataScope ?? "self");
  if (scopes.includes("all")) {
    return {
      kind: "all",
      userId,
      userDeptId,
      scopes,
      deptIds: [],
      selfOnly: false,
    };
  }

  const roleIds = roles.map((role) => role.id);
  const deptIds: number[] = [];
  let selfOnly = false;

  if (scopes.includes("custom_dept") && roleIds.length) {
    const placeholders = roleIds.map(() => "?").join(", ");
    const rows = (await sqlite
      .prepare(`SELECT dept_id AS deptId FROM sys_role_dept WHERE role_id IN (${placeholders})`)
      .all(...roleIds)) as Array<{ deptId: number }>;
    deptIds.push(...rows.map((row) => row.deptId));
  }

  if (scopes.includes("current_dept") && userDeptId) {
    deptIds.push(userDeptId);
  }

  if (scopes.includes("current_dept_tree")) {
    deptIds.push(...(await getDeptTreeIds(userDeptId)));
  }

  if (scopes.includes("self") || !scopes.length) {
    selfOnly = true;
  }

  return {
    kind: "restricted",
    userId,
    userDeptId,
    scopes: scopes.length ? scopes : ["self"],
    deptIds: uniqueNumbers(deptIds),
    selfOnly,
  };
}

export async function resolveDataScope(c: Context<{ Variables: HonoVariables }>) {
  return resolveDataScopeForUser(c.get("user").id);
}

export function buildDataScopeCondition(
  scope: ResolvedDataScope,
  columns: {
    deptId?: AnyPgColumn;
    userId?: AnyPgColumn;
    ownerId?: AnyPgColumn;
    createdBy?: AnyPgColumn;
    selfFallbackDept?: AnyPgColumn;
  },
): SQL | undefined {
  if (scope.kind === "all") return undefined;

  const conditions: SQL[] = [];
  if (scope.deptIds.length && columns.deptId) {
    conditions.push(inArray(columns.deptId, scope.deptIds));
  }

  const selfColumn = columns.userId ?? columns.ownerId ?? columns.createdBy;
  if (scope.selfOnly && selfColumn) {
    conditions.push(eq(selfColumn, scope.userId));
  }

  if (!conditions.length && scope.selfOnly && scope.userDeptId && columns.selfFallbackDept) {
    conditions.push(eq(columns.selfFallbackDept, scope.userDeptId));
  }

  if (!conditions.length) return drizzleSql`1 = 0`;
  return conditions.length === 1 ? conditions[0] : or(...conditions);
}

export function buildDataScopeWhereSql(
  scope: ResolvedDataScope,
  columns: {
    deptId?: string;
    userId?: string;
    ownerId?: string;
    createdBy?: string;
    selfFallbackDept?: string;
  },
) {
  if (scope.kind === "all") return null;

  const conditions: string[] = [];
  if (scope.deptIds.length && columns.deptId) {
    conditions.push(`${columns.deptId} IN (${scope.deptIds.join(", ")})`);
  }

  const selfColumn = columns.userId ?? columns.ownerId ?? columns.createdBy;
  if (scope.selfOnly && selfColumn) {
    conditions.push(`${selfColumn} = ${scope.userId}`);
  }

  if (!conditions.length && scope.selfOnly && scope.userDeptId && columns.selfFallbackDept) {
    conditions.push(`${columns.selfFallbackDept} = ${scope.userDeptId}`);
  }

  return conditions.length ? `(${conditions.join(" OR ")})` : "1 = 0";
}
