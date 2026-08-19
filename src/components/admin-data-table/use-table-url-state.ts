"use client";

import dayjs from "dayjs";
import { useMemo } from "react";
import { useNavigationAdapter } from "@/platform/navigation";
import type { FieldOption, FieldValueType } from "@/components/admin-fields/types";

export type TableUrlField = {
  name: string;
  valueType?: FieldValueType;
  options?: FieldOption[];
};

export type TableUrlState = {
  page: number;
  pageSize: number;
  keyword?: string;
  sort?: { field: string; order: "asc" | "desc" };
  filters: Record<string, unknown>;
  formValues: Record<string, unknown>;
  query: Record<string, unknown>;
};

type UseTableUrlStateOptions = {
  defaultPageSize?: number;
  fields: TableUrlField[];
  urlStatePrefix?: string;
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

function getParamName(prefix: string | undefined, name: string) {
  return prefix ? `${prefix}.${name}` : name;
}

function encodeFormValue(
  field: TableUrlField,
  value: unknown,
  params: URLSearchParams,
  prefix?: string,
) {
  if (isEmptyValue(value)) return;
  const fieldName = getParamName(prefix, field.name);

  if (field.valueType === "dateRange" && Array.isArray(value)) {
    const [from, to] = value;
    if (from) params.set(`${fieldName}.from`, dayjs(from).format("YYYY-MM-DD"));
    if (to) params.set(`${fieldName}.to`, dayjs(to).format("YYYY-MM-DD"));
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (!isEmptyValue(item)) params.append(fieldName, String(item));
    });
    return;
  }

  params.set(fieldName, String(value));
}

function findOptionValue(
  options: FieldOption[] | undefined,
  rawValue: string,
): FieldOption["value"] | undefined {
  for (const option of options ?? []) {
    if (String(option.value) === rawValue) return option.value;
    const childValue = findOptionValue(option.children, rawValue);
    if (childValue !== undefined) return childValue;
  }
  return undefined;
}

function decodeFormValue(field: TableUrlField, rawValue: string) {
  const optionValue = findOptionValue(field.options, rawValue);
  if (optionValue !== undefined) return optionValue;

  if (field.valueType === "digit") {
    const numericValue = Number(rawValue);
    return Number.isFinite(numericValue) ? numericValue : rawValue;
  }

  return rawValue;
}

function removeTableParams(
  params: URLSearchParams,
  fields: TableUrlField[],
  prefix?: string,
  options: { removeSort?: boolean } = {},
) {
  params.delete(getParamName(prefix, "page"));
  params.delete(getParamName(prefix, "pageSize"));
  params.delete(getParamName(prefix, "keyword"));
  if (options.removeSort !== false) params.delete(getParamName(prefix, "sort"));
  fields.forEach((field) => {
    const fieldName = getParamName(prefix, field.name);
    params.delete(fieldName);
    params.delete(`${fieldName}.from`);
    params.delete(`${fieldName}.to`);
  });
}

function buildUrl(pathname: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function useTableUrlState({
  defaultPageSize = 20,
  fields,
  urlStatePrefix,
}: UseTableUrlStateOptions) {
  const navigation = useNavigationAdapter();

  const state = useMemo<TableUrlState>(() => {
    const params = new URLSearchParams(navigation.search);
    const page = readPositiveInt(params.get(getParamName(urlStatePrefix, "page")), 1);
    const pageSize = readPositiveInt(
      params.get(getParamName(urlStatePrefix, "pageSize")),
      defaultPageSize,
    );
    const keyword = params.get(getParamName(urlStatePrefix, "keyword")) || undefined;
    const sortValue = params.get(getParamName(urlStatePrefix, "sort"));
    const [sortField, sortOrder] = sortValue?.split(".") ?? [];
    const sort: TableUrlState["sort"] =
      sortField && (sortOrder === "asc" || sortOrder === "desc")
        ? { field: sortField, order: sortOrder }
        : undefined;

    const filters: TableUrlState["filters"] = {};
    const formValues: Record<string, unknown> = {};

    fields.forEach((field) => {
      const fieldName = getParamName(urlStatePrefix, field.name);
      if (field.valueType === "dateRange") {
        const from = params.get(`${fieldName}.from`);
        const to = params.get(`${fieldName}.to`);
        if (from || to) {
          filters[`${field.name}.from`] = from ?? undefined;
          filters[`${field.name}.to`] = to ?? undefined;
          formValues[field.name] = [from ? dayjs(from) : undefined, to ? dayjs(to) : undefined];
        }
        return;
      }

      const values = params.getAll(fieldName);
      if (!values.length) return;
      const decodedValues = values.map((value) => decodeFormValue(field, value));
      filters[field.name] = decodedValues.length > 1 ? decodedValues : decodedValues[0];
      formValues[field.name] = decodedValues.length > 1 ? decodedValues : decodedValues[0];
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
  }, [defaultPageSize, fields, navigation.search, urlStatePrefix]);

  const actions = useMemo(
    () => ({
      setSearch(values: Record<string, unknown>) {
        const params = new URLSearchParams(navigation.search);
        removeTableParams(params, fields, urlStatePrefix, { removeSort: false });
        if (values.keyword)
          params.set(getParamName(urlStatePrefix, "keyword"), String(values.keyword));
        fields.forEach((field) =>
          encodeFormValue(field, values[field.name], params, urlStatePrefix),
        );
        if (state.pageSize !== defaultPageSize) {
          params.set(getParamName(urlStatePrefix, "pageSize"), String(state.pageSize));
        }
        navigation.push(buildUrl(navigation.pathname, params));
      },
      setPage(page: number, pageSize?: number) {
        const params = new URLSearchParams(navigation.search);
        if (page > 1) params.set(getParamName(urlStatePrefix, "page"), String(page));
        else params.delete(getParamName(urlStatePrefix, "page"));
        const nextPageSize = pageSize ?? state.pageSize;
        if (nextPageSize !== defaultPageSize) {
          params.set(getParamName(urlStatePrefix, "pageSize"), String(nextPageSize));
        } else {
          params.delete(getParamName(urlStatePrefix, "pageSize"));
        }
        navigation.push(buildUrl(navigation.pathname, params));
      },
      setSort(field?: string, order?: "asc" | "desc") {
        const params = new URLSearchParams(navigation.search);
        params.delete(getParamName(urlStatePrefix, "page"));
        if (field && order) params.set(getParamName(urlStatePrefix, "sort"), `${field}.${order}`);
        else params.delete(getParamName(urlStatePrefix, "sort"));
        navigation.push(buildUrl(navigation.pathname, params));
      },
      reset() {
        const params = new URLSearchParams(navigation.search);
        removeTableParams(params, fields, urlStatePrefix);
        navigation.push(buildUrl(navigation.pathname, params));
      },
    }),
    [defaultPageSize, fields, navigation, state.pageSize, urlStatePrefix],
  );

  return { state, actions };
}
