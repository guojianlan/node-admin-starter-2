import type { PageResult } from "@/lib/response";
import { sqlite } from "@/server/db";

type QueryValue = string | number | boolean | null | Date | Uint8Array;
type SearchOperator = "=" | "like" | "betweenDate";

export type ListQueryConfig = {
  table: string;
  select: string;
  fieldMap: Record<string, string>;
  searchable?: Record<string, SearchOperator>;
  quickSearchFields?: string[];
  sortableFields?: string[];
  defaultSort?: {
    field: string;
    order: "asc" | "desc";
  };
  baseWhere?: string[];
};

function normalizePage(value: string | null, fallback: number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return fallback;
  return Math.floor(numberValue);
}

function parseSort(value: string | null) {
  if (!value) return null;
  const [field, order] = value.split(".");
  if (!field || (order !== "asc" && order !== "desc")) return null;
  return { field, order };
}

function isConventionallySortableField(field: string) {
  return (
    field === "id" ||
    field === "sort" ||
    field === "order" ||
    field === "priority" ||
    field.endsWith("At")
  );
}

export function resolveListOrder(input: {
  params: URLSearchParams;
  fieldMap: Record<string, string>;
  sortableFields?: string[];
  defaultSort?: { field: string; order: "asc" | "desc" };
}) {
  const sortableFields = new Set([
    ...(input.sortableFields ?? []),
    ...Object.keys(input.fieldMap).filter(isConventionallySortableField),
  ]);
  const requestedSort = parseSort(input.params.get("sort"));
  const activeSort =
    requestedSort && sortableFields.has(requestedSort.field)
      ? requestedSort
      : (input.defaultSort ?? { field: "id", order: "desc" as const });
  const sortColumn = input.fieldMap[activeSort.field] ?? input.fieldMap.id ?? "id";
  const direction = activeSort.order.toUpperCase();
  const tieBreaker =
    activeSort.field !== "id" && input.fieldMap.id ? `, ${input.fieldMap.id} ${direction}` : "";
  return {
    ...activeSort,
    sql: `ORDER BY ${sortColumn} ${direction}${tieBreaker}`,
  };
}

function appendFieldFilter(input: {
  params: URLSearchParams;
  field: string;
  column: string;
  operator: SearchOperator;
  where: string[];
  values: QueryValue[];
}) {
  const { params, field, column, operator, where, values } = input;
  const fieldValues = params.getAll(field).filter((item) => item !== "");

  if (operator === "betweenDate") {
    const from = params.get(`${field}.from`);
    const to = params.get(`${field}.to`);
    if (from) {
      where.push(`${column} >= ?`);
      values.push(from);
    }
    if (to) {
      where.push(`${column} <= ?`);
      values.push(to);
    }
    return;
  }

  if (!fieldValues.length) return;

  if (fieldValues.length > 1) {
    where.push(`${column} IN (${fieldValues.map(() => "?").join(", ")})`);
    values.push(...fieldValues);
    return;
  }

  if (operator === "like") {
    where.push(`${column} LIKE ?`);
    values.push(`%${fieldValues[0]}%`);
    return;
  }

  where.push(`${column} = ?`);
  values.push(fieldValues[0]);
}

export async function buildListQuery<T>(
  url: string,
  config: ListQueryConfig,
): Promise<PageResult<T>> {
  const params = new URL(url).searchParams;
  const page = normalizePage(params.get("page"), 1);
  const pageSize = Math.min(normalizePage(params.get("pageSize"), 20), 200);
  const offset = (page - 1) * pageSize;

  const where = [...(config.baseWhere ?? [])];
  const values: QueryValue[] = [];

  const keyword = params.get("keyword")?.trim();
  if (keyword && config.quickSearchFields?.length) {
    const quickColumns = config.quickSearchFields
      .map((field) => config.fieldMap[field])
      .filter(Boolean);
    if (quickColumns.length) {
      where.push(`(${quickColumns.map((column) => `${column} LIKE ?`).join(" OR ")})`);
      values.push(...quickColumns.map(() => `%${keyword}%`));
    }
  }

  Object.entries(config.searchable ?? {}).forEach(([field, operator]) => {
    const column = config.fieldMap[field];
    if (!column) return;
    appendFieldFilter({ params, field, column, operator, where, values });
  });

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderSql = resolveListOrder({
    params,
    fieldMap: config.fieldMap,
    sortableFields: config.sortableFields,
    defaultSort: config.defaultSort,
  }).sql;

  const totalRow = (await sqlite
    .prepare(`SELECT COUNT(1) AS total FROM ${config.table} ${whereSql}`)
    .get(...values)) as { total: number | string } | undefined;

  const data = (await sqlite
    .prepare(
      `SELECT ${config.select}
       FROM ${config.table}
       ${whereSql}
       ${orderSql}
       LIMIT ? OFFSET ?`,
    )
    .all(...values, pageSize, offset)) as T[];

  return {
    data,
    page,
    pageSize,
    total: Number(totalRow?.total ?? 0),
  };
}
