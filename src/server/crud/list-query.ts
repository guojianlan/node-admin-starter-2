import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { PageResult } from "@/lib/response";
import { db } from "@/server/db";
import type { CrudListConfig, CrudSearchOperator } from "./types";

type QueryValue = string | number | boolean | Date;
type JoinableQuery = {
  innerJoin(table: PgTable, on: SQL): JoinableQuery;
  leftJoin(table: PgTable, on: SQL): JoinableQuery;
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

function parseFieldValue(column: AnyPgColumn | SQL, value: string): QueryValue {
  const columnDataType = "dataType" in column ? String(column.dataType) : "";
  if (columnDataType === "number") {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : value;
  }
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function parseDateValue(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed;
}

function appendFieldFilter(input: {
  params: URLSearchParams;
  field: string;
  column: AnyPgColumn | SQL;
  operator: CrudSearchOperator;
  where: SQL[];
}) {
  const { params, field, column, operator, where } = input;
  const fieldValues = params.getAll(field).filter((item) => item !== "");

  if (operator === "betweenDate") {
    const from = params.get(`${field}.from`);
    const to = params.get(`${field}.to`);
    if (from) where.push(gte(column as AnyPgColumn, parseDateValue(from)));
    if (to) where.push(lte(column as AnyPgColumn, parseDateValue(to)));
    return;
  }

  if (!fieldValues.length) return;

  if (operator === "like") {
    where.push(ilike(column as AnyPgColumn, `%${fieldValues[0]}%`));
    return;
  }

  const values = fieldValues.map((item) => parseFieldValue(column, item));
  if (values.length > 1) {
    where.push(inArray(column as AnyPgColumn, values));
    return;
  }
  where.push(eq(column as AnyPgColumn, values[0]));
}

function applyJoins<TQuery extends JoinableQuery>(query: TQuery, joins: CrudListConfig["joins"]) {
  return (joins ?? []).reduce((currentQuery, join) => {
    if (join.type === "inner") return currentQuery.innerJoin(join.table, join.on);
    return currentQuery.leftJoin(join.table, join.on);
  }, query as JoinableQuery) as TQuery;
}

export async function buildCrudListQuery<T>(
  url: string,
  table: PgTable,
  config: CrudListConfig,
  options: { softDeleteColumn?: AnyPgColumn | null } = {},
): Promise<PageResult<T>> {
  const params = new URL(url).searchParams;
  const page = normalizePage(params.get("page"), 1);
  const pageSize = Math.min(normalizePage(params.get("pageSize"), 20), 200);
  const offset = (page - 1) * pageSize;

  const where: SQL[] = [...(config.baseWhere ?? [])];
  if (options.softDeleteColumn) where.push(isNull(options.softDeleteColumn));

  const keyword = params.get("keyword")?.trim();
  if (keyword && config.quickSearchFields?.length) {
    const quickWhere = config.quickSearchFields
      .map((field) => config.select[field])
      .filter(Boolean)
      .map((column) => ilike(column as AnyPgColumn, `%${keyword}%`));
    const quickCondition = quickWhere.length ? or(...quickWhere) : undefined;
    if (quickCondition) where.push(quickCondition);
  }

  Object.entries(config.searchable ?? {}).forEach(([field, operator]) => {
    const column = config.select[field];
    if (!column) return;
    appendFieldFilter({ params, field, column: column as AnyPgColumn | SQL, operator, where });
  });

  const whereSql = where.length ? and(...where) : undefined;
  const sort = parseSort(params.get("sort"));
  const sortableFields = new Set(config.sortableFields ?? []);
  const activeSort =
    sort && sortableFields.has(sort.field)
      ? sort
      : (config.defaultSort ?? { field: "id", order: "desc" as const });
  const sortColumn = config.select[activeSort.field] ?? config.select.id;
  const orderBy =
    activeSort.order === "asc" ? asc(sortColumn as AnyPgColumn) : desc(sortColumn as AnyPgColumn);

  let totalQuery = db.select({ total: count() }).from(table).$dynamic();
  totalQuery = applyJoins(totalQuery, config.joins);
  if (whereSql) totalQuery = totalQuery.where(whereSql);
  const totalRows = await totalQuery;

  let dataQuery = db
    .select(config.select as never)
    .from(table)
    .$dynamic();
  dataQuery = applyJoins(dataQuery, config.joins);
  if (whereSql) dataQuery = dataQuery.where(whereSql);
  const data = (await dataQuery.orderBy(orderBy).limit(pageSize).offset(offset)) as T[];

  return {
    data,
    page,
    pageSize,
    total: Number(totalRows[0]?.total ?? 0),
  };
}
