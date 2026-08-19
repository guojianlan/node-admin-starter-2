"use client";

import {
  BorderlessTableOutlined,
  BorderOutlined,
  ColumnHeightOutlined,
  DeleteOutlined,
  EditOutlined,
  FilterOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Dropdown, Input, Popover, Space, Table, Tooltip } from "antd";
import type { TableProps } from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import type { SorterResult, TableCurrentDataSource } from "antd/es/table/interface";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthButton } from "@/components/auth-button/AuthButton";
import { AdminEntityForm } from "@/components/admin-entity-form/AdminEntityForm";
import { AdminSearchForm } from "@/components/admin-search-form/AdminSearchForm";
import type { AdminDataTableColumn, FieldOption } from "@/components/admin-fields/types";
import { buildQueryString, request } from "@/lib/request";
import type { PageResult } from "@/lib/response";
import { feedback } from "@/ui/feedback/feedback";
import { EmptyState } from "@/ui/states/EmptyState";
import { useTableUrlState, type TableUrlField } from "./use-table-url-state";

type AdminDataTableProps<T extends object> = {
  api: string;
  rowKey: keyof T & string;
  accessName: string;
  columns: AdminDataTableColumn<T>[];
  defaultSort?: { field: keyof T & string; order: "asc" | "desc" };
  defaultPageSize?: number;
  createTitle?: string;
  updateTitle?: string;
  enableCreate?: boolean;
  enableUpdate?: boolean;
  enableDelete?: boolean;
  enableActions?: boolean;
  showSearchButton?: boolean;
  showSearchForm?: boolean;
  defaultSearchOpen?: boolean;
  showKeywordSearch?: boolean;
  showToolbarSettings?: boolean;
  cardClassName?: string;
  searchCardClassName?: string;
  searchPlacement?: "inside" | "card";
  toolbarTitle?: React.ReactNode;
  quickFilters?: Array<{
    key: string;
    label: React.ReactNode;
    count?: number;
    values: Record<string, unknown>;
  }>;
  emptyText?: React.ReactNode;
  urlStatePrefix?: string;
  pagination?: false;
  tableMode?: "standard" | "bounded" | "embedded";
  actionColumnWidth?: number;
  tableProps?: Omit<
    TableProps<T>,
    "columns" | "dataSource" | "loading" | "onChange" | "pagination" | "rowKey"
  >;
  canUpdate?: (record: T) => boolean;
  canDelete?: (record: T) => boolean;
  deleteDisabledReason?: (record: T) => React.ReactNode | undefined;
  actionBarRender?: (reload: () => void) => React.ReactNode;
  operateRender?: (record: T, reload: () => void) => React.ReactNode;
  beforeSubmit?: (
    values: Record<string, unknown>,
    mode: "create" | "update",
  ) => Record<string, unknown>;
  handleRequest?: (params: Record<string, unknown>) => Promise<PageResult<T>>;
  queryKeyDeps?: readonly unknown[];
  onFormOpenChange?: (
    open: boolean,
    context: { mode: "create" | "update"; record: T | null },
  ) => void;
  createInitialValues?: Partial<T>;
  formBasicColumns?: 1 | 2;
  formNotice?: React.ReactNode;
  onDataChanged?: (change: {
    action: "create" | "update" | "delete";
    record: T | null;
    values?: Record<string, unknown>;
  }) => void;
};

const emptyQueryKeyDeps: readonly unknown[] = [];

function isConventionallySortableField(field: string) {
  return (
    field === "id" ||
    field === "sort" ||
    field === "order" ||
    field === "priority" ||
    field.endsWith("At")
  );
}

function getRowId<T extends object>(record: T, rowKey: keyof T & string) {
  return String(record[rowKey]);
}

function hasSearchValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.some(hasSearchValue);
  return true;
}

function normalizeFieldOptions(options?: FieldOption[]): FieldOption[] | undefined {
  if (!options?.length) return undefined;
  return options.map((option) => ({
    label: option.label,
    value: option.value,
    children: normalizeFieldOptions(option.children),
  }));
}

function buildSearchFieldSignature<T extends object>(columns: AdminDataTableColumn<T>[]) {
  return columns
    .filter((column) => !column.hideInSearch)
    .map((column) => ({
      name: column.dataIndex,
      valueType: column.valueType,
      options: normalizeFieldOptions(column.options),
    }));
}

export function AdminDataTable<T extends object>({
  api,
  rowKey,
  accessName,
  columns,
  defaultSort,
  defaultPageSize = 10,
  createTitle = "新增",
  updateTitle = "编辑",
  enableCreate = true,
  enableUpdate = true,
  enableDelete = true,
  enableActions = true,
  showSearchForm = true,
  defaultSearchOpen = false,
  showKeywordSearch = true,
  showToolbarSettings = true,
  cardClassName,
  searchCardClassName,
  searchPlacement = "inside",
  toolbarTitle,
  quickFilters,
  emptyText,
  urlStatePrefix,
  pagination,
  tableMode = "bounded",
  actionColumnWidth = 148,
  tableProps,
  canUpdate,
  canDelete,
  deleteDisabledReason,
  actionBarRender,
  operateRender,
  beforeSubmit,
  handleRequest,
  queryKeyDeps = emptyQueryKeyDeps,
  onFormOpenChange,
  createInitialValues,
  formBasicColumns,
  formNotice,
  onDataChanged,
}: AdminDataTableProps<T>) {
  const queryClient = useQueryClient();
  const [editingRecord, setEditingRecord] = useState<T | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "update">("create");
  const [searchOpen, setSearchOpen] = useState(defaultSearchOpen);
  const [draftKeyword, setDraftKeyword] = useState<string | null>(null);
  const [density, setDensity] = useState<TableProps<T>["size"]>();
  const [bordered, setBordered] = useState(Boolean(tableProps?.bordered));
  const [columnsChecked, setColumnsChecked] = useState<string[] | null>(null);

  const fieldSignature = JSON.stringify(buildSearchFieldSignature(columns));
  const fields = useMemo<TableUrlField[]>(
    () => JSON.parse(fieldSignature) as TableUrlField[],
    [fieldSignature],
  );
  const { state, actions } = useTableUrlState({ defaultPageSize, fields, urlStatePrefix });
  const appliedKeyword = state.keyword ?? "";
  const previousAppliedKeyword = useRef(appliedKeyword);
  const activeFilterCount =
    Object.values(state.formValues).filter(hasSearchValue).length + (state.keyword ? 1 : 0);
  const hasActiveSearch = activeFilterCount > 0;
  const defaultColumnKeys = useMemo(
    () => columns.filter((column) => !column.hideInTable).map((column) => column.dataIndex),
    [columns],
  );
  const activeColumnKeys = columnsChecked ?? defaultColumnKeys;
  const keywordText = draftKeyword ?? state.keyword ?? "";
  const shouldShowSearch = showSearchForm && searchOpen;
  const quickFilterFields = useMemo(
    () => Array.from(new Set(quickFilters?.flatMap((item) => Object.keys(item.values)) ?? [])),
    [quickFilters],
  );

  useEffect(() => {
    if (previousAppliedKeyword.current === appliedKeyword) return;
    previousAppliedKeyword.current = appliedKeyword;
    setDraftKeyword(null);
  }, [appliedKeyword]);

  const tableQueryKey = useMemo(
    () => ["admin-data-table", api, state.query, ...queryKeyDeps] as const,
    [api, queryKeyDeps, state.query],
  );

  const tableQuery = useQuery({
    queryKey: tableQueryKey,
    queryFn: () =>
      handleRequest
        ? handleRequest(state.query)
        : request<PageResult<T>>(`${api}${buildQueryString(state.query)}`),
    placeholderData: keepPreviousData,
  });

  const data = tableQuery.data?.data ?? [];
  const total = tableQuery.data?.total ?? 0;
  const loading = tableQuery.isLoading || tableQuery.isFetching;
  const hasRows = data.length > 0;
  const effectiveSort = state.sort ?? defaultSort;
  const effectiveDensity = density ?? tableProps?.size ?? "middle";

  const reload = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["admin-data-table", api] });
  }, [api, queryClient]);

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setEditingRecord(null);
    onFormOpenChange?.(false, { mode: formMode, record: editingRecord });
  }, [editingRecord, formMode, onFormOpenChange]);

  const openForm = useCallback(
    (mode: "create" | "update", record: T | null) => {
      setEditingRecord(record);
      setFormMode(mode);
      setFormOpen(true);
      onFormOpenChange?.(true, { mode, record });
    },
    [onFormOpenChange],
  );

  const deleteMutation = useMutation({
    mutationFn: (record: T) => request(`${api}/${getRowId(record, rowKey)}`, { method: "DELETE" }),
    onSuccess: (_, record) => {
      feedback.success("删除成功");
      onDataChanged?.({ action: "delete", record });
      void queryClient.invalidateQueries({ queryKey: ["admin-data-table", api] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const payload = beforeSubmit ? beforeSubmit(values, formMode) : values;
      if (formMode === "create") {
        await request(api, { method: "POST", body: payload });
        return { message: "创建成功", payload };
      }
      if (editingRecord) {
        await request(`${api}/${getRowId(editingRecord, rowKey)}`, {
          method: "PUT",
          body: payload,
        });
      }
      return { message: "更新成功", payload };
    },
    onSuccess: ({ message, payload }) => {
      feedback.success(message);
      onDataChanged?.({ action: formMode, record: editingRecord, values: payload });
      closeForm();
      void queryClient.invalidateQueries({ queryKey: ["admin-data-table", api] });
    },
  });

  const tableColumns = useMemo(() => {
    const visibleColumns: ColumnsType<T> = columns
      .filter((column) => !column.hideInTable)
      .filter((column) => activeColumnKeys.includes(column.dataIndex))
      .map((column) => {
        const sorter = column.sorter ?? isConventionallySortableField(column.dataIndex);
        return {
          ...column,
          dataIndex: column.dataIndex,
          sorter,
          sortDirections: column.sortDirections ?? ["ascend", "descend"],
          sortOrder:
            sorter && effectiveSort?.field === column.dataIndex
              ? effectiveSort.order === "asc"
                ? "ascend"
                : "descend"
              : null,
          fixed: hasRows ? column.fixed : undefined,
          width: hasRows ? column.width : undefined,
        };
      });

    if (!enableActions) return visibleColumns;

    visibleColumns.push({
      title: "操作栏",
      key: "__operate",
      width: hasRows ? actionColumnWidth : undefined,
      fixed: hasRows ? "right" : undefined,
      align: "center",
      className: "admin-table-action-cell",
      render: (_, record) => (
        <Space size={4}>
          {operateRender?.(record, reload)}
          {enableUpdate && (canUpdate ? canUpdate(record) : true) ? (
            <AuthButton auth={`${accessName}.update`}>
              <Tooltip title="编辑">
                <Button
                  aria-label="编辑"
                  type="primary"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => openForm("update", record)}
                />
              </Tooltip>
            </AuthButton>
          ) : null}
          {enableDelete &&
          ((canDelete ? canDelete(record) : true) || deleteDisabledReason?.(record)) ? (
            <AuthButton auth={`${accessName}.delete`}>
              <Tooltip title={deleteDisabledReason?.(record) ?? "删除"}>
                <Button
                  aria-label="删除"
                  danger
                  type="primary"
                  size="small"
                  icon={<DeleteOutlined />}
                  disabled={Boolean(deleteDisabledReason?.(record))}
                  onClick={() => {
                    if (!window.confirm("确认删除当前记录？")) return;
                    deleteMutation.mutate(record);
                  }}
                />
              </Tooltip>
            </AuthButton>
          ) : null}
        </Space>
      ),
    });

    return visibleColumns;
  }, [
    accessName,
    actionColumnWidth,
    activeColumnKeys,
    columns,
    canDelete,
    canUpdate,
    deleteDisabledReason,
    deleteMutation,
    enableActions,
    enableDelete,
    enableUpdate,
    effectiveSort,
    hasRows,
    openForm,
    operateRender,
    reload,
  ]);

  async function handleFinish(values: Record<string, unknown>) {
    await saveMutation.mutateAsync(values);
  }

  function handleTableChange(
    pagination: TablePaginationConfig,
    _: Record<string, unknown>,
    sorter: SorterResult<T> | SorterResult<T>[],
    extra: TableCurrentDataSource<T>,
  ) {
    if (extra.action === "paginate") {
      actions.setPage(pagination.current ?? 1, pagination.pageSize);
      return;
    }

    const activeSorter = Array.isArray(sorter) ? sorter[0] : sorter;
    if (activeSorter?.field && activeSorter.order) {
      actions.setSort(String(activeSorter.field), activeSorter.order === "ascend" ? "asc" : "desc");
      return;
    }

    if (activeSorter && !activeSorter.order) {
      actions.setSort();
      return;
    }
  }

  function handleKeywordSearch(value: string) {
    actions.setSearch({
      ...state.formValues,
      keyword: value,
    });
  }

  function isQuickFilterActive(values: Record<string, unknown>) {
    if (!quickFilterFields.length) return false;
    return quickFilterFields.every((field) => {
      const expected = values[field];
      const actual = state.formValues[field];
      if (expected === undefined || expected === null || expected === "") {
        return actual === undefined || actual === null || actual === "";
      }
      return String(actual) === String(expected);
    });
  }

  function applyQuickFilter(values: Record<string, unknown>) {
    const nextValues: Record<string, unknown> = {
      ...state.formValues,
      keyword: state.keyword,
    };
    quickFilterFields.forEach((field) => delete nextValues[field]);
    actions.setSearch({ ...nextValues, ...values });
  }

  const searchNode = shouldShowSearch ? (
    <AdminSearchForm
      columns={columns}
      values={state.formValues}
      keyword={state.keyword}
      includeKeyword={false}
      loading={loading}
      onSearch={(values) => {
        setDraftKeyword(keywordText);
        actions.setSearch({ ...values, keyword: keywordText });
      }}
      onReset={() => {
        setDraftKeyword("");
        actions.reset();
      }}
    />
  ) : null;

  const densityMenu = {
    items: [
      { key: "large", label: "宽松", onClick: () => setDensity("large") },
      { key: "middle", label: "标准", onClick: () => setDensity("middle") },
      { key: "small", label: "紧凑", onClick: () => setDensity("small") },
    ],
    selectedKeys: [density ?? tableProps?.size ?? "middle"],
  };

  const tableScroll = useMemo<TableProps<T>["scroll"]>(() => {
    if (!hasRows) return undefined;

    const configuredScroll = tableProps?.scroll;
    if (tableMode !== "bounded") {
      return configuredScroll ?? { x: "max-content" };
    }

    return {
      ...configuredScroll,
      x: configuredScroll?.x ?? "max-content",
      y: configuredScroll?.y ?? "100%",
    };
  }, [hasRows, tableMode, tableProps?.scroll]);

  const tableRowSelection = tableProps?.rowSelection
    ? {
        ...tableProps.rowSelection,
        fixed: hasRows ? tableProps.rowSelection.fixed : false,
      }
    : undefined;

  const columnSettingContent = (
    <div className="admin-column-settings">
      <Checkbox.Group
        value={activeColumnKeys}
        onChange={(values) => setColumnsChecked(values.map(String))}
      >
        {columns
          .filter((column) => !column.hideInTable)
          .map((column) => (
            <Checkbox key={column.dataIndex} value={column.dataIndex}>
              {column.title}
            </Checkbox>
          ))}
      </Checkbox.Group>
    </div>
  );

  const tableCard = (
    <div className={["admin-card", "admin-table-card", cardClassName].filter(Boolean).join(" ")}>
      <div className="admin-toolbar">
        <div className="admin-toolbar-left">
          <div className="admin-toolbar-title">{toolbarTitle ?? "数据列表"}</div>
          <span className="admin-toolbar-total">共 {total} 条</span>
        </div>
        <div className="admin-toolbar-right">
          {showSearchForm ? (
            <Button
              className="admin-search-toggle"
              type={searchOpen || hasActiveSearch ? "primary" : "default"}
              icon={<FilterOutlined />}
              onClick={() => setSearchOpen((value) => !value)}
            >
              <span>筛选</span>
              {activeFilterCount ? (
                <span
                  className="admin-search-toggle-count"
                  aria-label={`${activeFilterCount} 个筛选条件`}
                >
                  {activeFilterCount}
                </span>
              ) : null}
            </Button>
          ) : null}
          {showToolbarSettings ? (
            <>
              <Tooltip title="刷新">
                <Button aria-label="刷新" type="text" icon={<ReloadOutlined />} onClick={reload} />
              </Tooltip>
              <Tooltip title="行间距">
                <Dropdown menu={densityMenu} trigger={["click"]}>
                  <Button aria-label="行间距" type="text" icon={<ColumnHeightOutlined />} />
                </Dropdown>
              </Tooltip>
              <Tooltip title={bordered ? "隐藏边框" : "显示边框"}>
                <Button
                  aria-label={bordered ? "隐藏边框" : "显示边框"}
                  type="text"
                  icon={bordered ? <BorderOutlined /> : <BorderlessTableOutlined />}
                  onClick={() => setBordered((value) => !value)}
                />
              </Tooltip>
              <Popover
                content={columnSettingContent}
                title="列设置"
                trigger="click"
                placement="bottomRight"
              >
                <Tooltip title="列设置">
                  <Button aria-label="列设置" type="text" icon={<SettingOutlined />} />
                </Tooltip>
              </Popover>
            </>
          ) : null}
        </div>
      </div>
      {searchPlacement === "inside" && searchNode ? searchNode : null}
      <div className="admin-table-commandbar">
        <div className="admin-table-quick-filters">
          {quickFilters?.map((filter) => {
            const active = isQuickFilterActive(filter.values);
            return (
              <Button
                key={filter.key}
                type="text"
                className={
                  active ? "admin-table-quick-filter is-active" : "admin-table-quick-filter"
                }
                onClick={() => applyQuickFilter(filter.values)}
              >
                <span>{filter.label}</span>
                {filter.count !== undefined ? (
                  <span className="admin-table-quick-count">{filter.count}</span>
                ) : null}
              </Button>
            );
          })}
        </div>
        <div className="admin-table-command-actions">
          {actionBarRender?.(reload)}
          {showKeywordSearch ? (
            <Input.Search
              className="admin-table-keyword"
              allowClear
              value={keywordText}
              placeholder="搜索表格内容"
              onChange={(event) => setDraftKeyword(event.target.value)}
              onSearch={handleKeywordSearch}
            />
          ) : null}
          {enableCreate ? (
            <AuthButton auth={`${accessName}.create`}>
              <Button
                data-testid="admin-create-button"
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => openForm("create", null)}
              >
                {createTitle}
              </Button>
            </AuthButton>
          ) : null}
        </div>
      </div>
      <div className={["admin-table-wrapper", `admin-table-wrapper--${tableMode}`].join(" ")}>
        <Table<T>
          {...tableProps}
          className={[
            "admin-data-table",
            hasRows ? "admin-data-table--populated" : "admin-data-table--empty",
            `admin-data-table--density-${effectiveDensity}`,
            tableProps?.className,
          ]
            .filter(Boolean)
            .join(" ")}
          rowKey={rowKey}
          columns={tableColumns}
          dataSource={data}
          rowSelection={tableRowSelection}
          loading={loading}
          bordered={bordered}
          size={effectiveDensity}
          locale={{ emptyText: emptyText ?? <EmptyState /> }}
          scroll={tableScroll}
          showSorterTooltip={tableProps?.showSorterTooltip ?? { target: "sorter-icon" }}
          pagination={
            pagination === false
              ? false
              : {
                  current: state.page,
                  pageSize: state.pageSize,
                  total,
                  size: "small",
                  placement: ["bottomEnd"],
                  showQuickJumper: total > state.pageSize * 2,
                  showSizeChanger: true,
                  pageSizeOptions: Array.from(new Set([10, 20, 30, 50, 100, state.pageSize])).sort(
                    (left, right) => left - right,
                  ),
                  showTotal: (count) => `共 ${count} 条`,
                }
          }
          onChange={handleTableChange}
        />
      </div>
      <AdminEntityForm
        open={formOpen}
        mode={formMode}
        title={formMode === "create" ? createTitle : updateTitle}
        columns={columns}
        initialValues={formMode === "create" ? createInitialValues : editingRecord}
        loading={saveMutation.isPending}
        basicColumnCount={formBasicColumns}
        notice={formNotice}
        onCancel={closeForm}
        onFinish={handleFinish}
      />
    </div>
  );

  if (searchPlacement === "card" && searchNode) {
    return (
      <>
        <div
          className={["admin-card", "admin-search-card", searchCardClassName]
            .filter(Boolean)
            .join(" ")}
        >
          {searchNode}
        </div>
        {tableCard}
      </>
    );
  }

  return tableCard;
}
