"use client";

import dayjs from "dayjs";
import { useMemo } from "react";
import { useNavigationAdapter } from "@/platform/navigation";
import type { FieldValueType } from "@/components/admin-fields/types";

export type TableUrlField = {
  name: string;
  valueType?: FieldValueType;
};

export type TableUrlState = {
  page: number;
  pageSize: number;
  keyword?: string;
  sort?: { field: string; order: "asc" | "desc" };
  filters: Record<string, string | string[] | undefined>;
  formValues: Record<string, unknown>;
  query: Record<string, unknown>;
};

type UseTableUrlStateOptions = {
  defaultPageSize?: number;
  fields: TableUrlField[];
};

function readPositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function isEmptyValue(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function encodeFormValue(field: TableUrlField, value: unknown, params: URLSearchParams) {
  if (isEmptyValue(value)) return;

  if (field.valueType === "dateRange" && Array.isArray(value)) {
    const [from, to] = value;
    if (from) params.set(`${field.name}.from`, dayjs(from).format("YYYY-MM-DD"));
    if (to) params.set(`${field.name}.to`, dayjs(to).format("YYYY-MM-DD"));
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (!isEmptyValue(item)) params.append(field.name, String(item));
    });
    return;
  }

  params.set(field.name, String(value));
}

function removeTableParams(params: URLSearchParams, fields: TableUrlField[]) {
  params.delete("page");
  params.delete("pageSize");
  params.delete("keyword");
  params.delete("sort");
  fields.forEach((field) => {
    params.delete(field.name);
    params.delete(`${field.name}.from`);
    params.delete(`${field.name}.to`);
  });
}

function buildUrl(pathname: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function useTableUrlState({ defaultPageSize = 20, fields }: UseTableUrlStateOptions) {
  const navigation = useNavigationAdapter();

  const state = useMemo<TableUrlState>(() => {
    const params = new URLSearchParams(navigation.search);
    const page = readPositiveInt(params.get("page"), 1);
    const pageSize = readPositiveInt(params.get("pageSize"), defaultPageSize);
    const keyword = params.get("keyword") || undefined;
    const sortValue = params.get("sort");
    const [sortField, sortOrder] = sortValue?.split(".") ?? [];
    const sort: TableUrlState["sort"] =
      sortField && (sortOrder === "asc" || sortOrder === "desc")
        ? { field: sortField, order: sortOrder }
        : undefined;

    const filters: TableUrlState["filters"] = {};
    const formValues: Record<string, unknown> = {};

    fields.forEach((field) => {
      if (field.valueType === "dateRange") {
        const from = params.get(`${field.name}.from`);
        const to = params.get(`${field.name}.to`);
        if (from || to) {
          filters[`${field.name}.from`] = from ?? undefined;
          filters[`${field.name}.to`] = to ?? undefined;
          formValues[field.name] = [from ? dayjs(from) : undefined, to ? dayjs(to) : undefined];
        }
        return;
      }

      const values = params.getAll(field.name);
      if (!values.length) return;
      filters[field.name] = values.length > 1 ? values : values[0];
      formValues[field.name] = values.length > 1 ? values : values[0];
    });

    return {
      page,
      pageSize,
      keyword,
      sort,
      filters,
      formValues,
      query: {
        page,
        pageSize,
        keyword,
        sort: sort ? `${sort.field}.${sort.order}` : undefined,
        ...filters,
      },
    };
  }, [defaultPageSize, fields, navigation.search]);

  const actions = useMemo(
    () => ({
      setSearch(values: Record<string, unknown>) {
        const params = new URLSearchParams(navigation.search);
        removeTableParams(params, fields);
        if (values.keyword) params.set("keyword", String(values.keyword));
        fields.forEach((field) => encodeFormValue(field, values[field.name], params));
        if (state.pageSize !== defaultPageSize) params.set("pageSize", String(state.pageSize));
        navigation.push(buildUrl(navigation.pathname, params));
      },
      setPage(page: number, pageSize?: number) {
        const params = new URLSearchParams(navigation.search);
        if (page > 1) params.set("page", String(page));
        else params.delete("page");
        const nextPageSize = pageSize ?? state.pageSize;
        if (nextPageSize !== defaultPageSize) params.set("pageSize", String(nextPageSize));
        else params.delete("pageSize");
        navigation.push(buildUrl(navigation.pathname, params));
      },
      setSort(field?: string, order?: "asc" | "desc") {
        const params = new URLSearchParams(navigation.search);
        params.delete("page");
        if (field && order) params.set("sort", `${field}.${order}`);
        else params.delete("sort");
        navigation.push(buildUrl(navigation.pathname, params));
      },
      reset() {
        const params = new URLSearchParams(navigation.search);
        removeTableParams(params, fields);
        navigation.push(buildUrl(navigation.pathname, params));
      },
    }),
    [defaultPageSize, fields, navigation, state.pageSize],
  );

  return { state, actions };
}
