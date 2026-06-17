import { type QueryParam, nowIso, sqlite } from "@/server/db";

export type FieldMap = Record<string, string>;

function toAssignments(fields: string[]) {
  return fields.map((field) => `${field} = ?`).join(", ");
}

export async function insertRecord(
  table: string,
  fieldMap: FieldMap,
  values: Record<string, unknown>,
) {
  const now = nowIso();
  const entries = Object.entries(fieldMap).filter(([field]) => values[field] !== undefined);
  const columns = entries.map(([, column]) => column);
  const placeholders = columns.map(() => "?");
  const params = entries.map(([field]) => values[field] ?? null) as QueryParam[];

  columns.push("created_at", "updated_at");
  placeholders.push("?", "?");
  params.push(now, now);

  const result = await sqlite
    .prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
    )
    .run(...params);

  return Number(result.lastInsertRowid);
}

export async function updateRecord(
  table: string,
  fieldMap: FieldMap,
  id: number,
  values: Record<string, unknown>,
) {
  const entries = Object.entries(fieldMap).filter(([field]) => values[field] !== undefined);
  const columns = entries.map(([, column]) => column);
  const params = entries.map(([field]) => values[field] ?? null) as QueryParam[];
  columns.push("updated_at");
  params.push(nowIso(), id);

  await sqlite.prepare(`UPDATE ${table} SET ${toAssignments(columns)} WHERE id = ?`).run(...params);
}

export async function softDeleteRecord(table: string, id: number) {
  await sqlite
    .prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`)
    .run(nowIso(), nowIso(), id);
}

export async function hardDeleteRecord(table: string, id: number) {
  await sqlite.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

export async function toggleRecordStatus(table: string, id: number, status: number) {
  await sqlite
    .prepare(`UPDATE ${table} SET status = ?, updated_at = ? WHERE id = ?`)
    .run(status, nowIso(), id);
}

export function getNumberParam(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
