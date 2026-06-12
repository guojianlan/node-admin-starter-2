import { nowIso, sqlite } from "@/server/db";

export type FieldMap = Record<string, string>;

function toAssignments(fields: string[]) {
  return fields.map((field) => `${field} = ?`).join(", ");
}

export function insertRecord(table: string, fieldMap: FieldMap, values: Record<string, unknown>) {
  const now = nowIso();
  const entries = Object.entries(fieldMap).filter(([field]) => values[field] !== undefined);
  const columns = entries.map(([, column]) => column);
  const placeholders = columns.map(() => "?");
  const params = entries.map(([field]) => values[field]);

  columns.push("created_at", "updated_at");
  placeholders.push("?", "?");
  params.push(now, now);

  const result = sqlite
    .prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`)
    .run(...params);

  return Number(result.lastInsertRowid);
}

export function updateRecord(
  table: string,
  fieldMap: FieldMap,
  id: number,
  values: Record<string, unknown>,
) {
  const entries = Object.entries(fieldMap).filter(([field]) => values[field] !== undefined);
  const columns = entries.map(([, column]) => column);
  const params = entries.map(([field]) => values[field]);
  columns.push("updated_at");
  params.push(nowIso(), id);

  sqlite.prepare(`UPDATE ${table} SET ${toAssignments(columns)} WHERE id = ?`).run(...params);
}

export function softDeleteRecord(table: string, id: number) {
  sqlite
    .prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`)
    .run(nowIso(), nowIso(), id);
}

export function hardDeleteRecord(table: string, id: number) {
  sqlite.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

export function toggleRecordStatus(table: string, id: number, status: number) {
  sqlite
    .prepare(`UPDATE ${table} SET status = ?, updated_at = ? WHERE id = ?`)
    .run(status, nowIso(), id);
}

export function getNumberParam(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
