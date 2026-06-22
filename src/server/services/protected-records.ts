import type { DbClient } from "@/server/db";

type ProtectedRow = {
  id: number;
  isSystem?: boolean | null;
  is_system?: boolean | null;
};

function placeholders(values: unknown[]) {
  return values.map(() => "?").join(", ");
}

export async function assertNotSystemRecords(input: {
  db: DbClient;
  table: string;
  ids: number[];
  message?: string;
}) {
  const ids = [...new Set(input.ids.filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return;

  const rows = (await input.db
    .prepare(
      `SELECT id, is_system AS isSystem
       FROM ${input.table}
       WHERE id IN (${placeholders(ids)})`,
    )
    .all(...ids)) as ProtectedRow[];

  if (rows.some((row) => row.isSystem || row.is_system)) {
    throw new Error(input.message ?? "系统内置记录不能执行当前操作");
  }
}

export async function getSystemFlag(db: DbClient, table: string, id: number) {
  const row = (await db
    .prepare(`SELECT is_system AS isSystem FROM ${table} WHERE id = ?`)
    .get(id)) as { isSystem?: boolean | null; is_system?: boolean | null } | undefined;
  return Boolean(row?.isSystem ?? row?.is_system);
}
