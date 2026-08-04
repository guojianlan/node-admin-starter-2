"use client";

import {
  BorderlessTableOutlined,
  BorderOutlined,
  ColumnHeightOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Divider, Dropdown, Input, Popover, Space, Table, Tooltip } from "antd";
import type { TableProps } from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import type { SorterResult, TableCurrentDataSource } from "antd/es/table/interface";
import { useCallback, useMemo, useState } from "react";
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
  onDataChanged?: () => void;
};

const emptyQueryKeyDeps: readonly unknown[] = [];

function getRowId<T extends object>(record: T, rowKey: keyof T & string) {
  return String(record[rowKey]);
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
  defaultPageSize = 10,
  createTitle = "新增",
  updateTitle = "编辑",
  enableCreate = true,
  enableUpdate = true,
  enableDelete = true,
  enableActions = true,
  showSearchButton = false,
  showSearchForm = true,
  defaultSearchOpen = true,
  showKeywordSearch = true,
  showToolbarSettings = true,
  cardClassName,
  searchCardClassName,
  searchPlacement = "inside",
  toolbarTitle,
  emptyText,
  urlStatePrefix,
  pagination,
  tableMode = "bounded",
  actionColumnWidth = 148,
  tableProps,
  canUpdate,
  canDelete,
  actionBarRender,
  operateRender,
  beforeSubmit,
  handleRequest,
  queryKeyDeps = emptyQueryKeyDeps,
  onFormOpenChange,
  onDataChanged,
}: AdminDataTableProps<T>) {
  const queryClient = useQueryClient();
  const [editingRecord, setEditingRecord] = useState<T | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "update">("create");
  const [searchOpen, setSearchOpen] = useState(defaultSearchOpen);
  const [draftKeyword, setDraftKeyword] = useState<string | null>(null);
  const [density, setDensity] = useState<TableProps<T>["size"]>();
  const [bordered, setBordered] = useState(false);
  const [columnsChecked, setColumnsChecked] = useState<string[] | null>(null);

  const fieldSignature = JSON.stringify(buildSearchFieldSignature(columns));
  const fields = useMemo<TableUrlField[]>(
    () => JSON.parse(fieldSignature) as TableUrlField[],
    [fieldSignature],
  );
  const { state, actions } = useTableUrlState({ defaultPageSize, fields, urlStatePrefix });
  const hasActiveSearch = Boolean(state.keyword || Object.keys(state.filters).length);
  const defaultColumnKeys = useMemo(
    () => columns.filter((column) => !column.hideInTable).map((column) => column.dataIndex),
    [columns],
  );
  const activeColumnKeys = columnsChecked ?? defaultColumnKeys;
  const keywordText = draftKeyword ?? state.keyword ?? "";
  const shouldShowSearch = showSearchForm && (searchOpen || hasActiveSearch);

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
    onSuccess: () => {
      feedback.success("删除成功");
      onDataChanged?.();
      void queryClient.invalidateQueries({ queryKey: ["admin-data-table", api] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const payload = beforeSubmit ? beforeSubmit(values, formMode) : values;
      if (formMode === "create") {
        await request(api, { method: "POST", body: payload });
        return "创建成功";
      }
      if (editingRecord) {
        await request(`${api}/${getRowId(editingRecord, rowKey)}`, {
          method: "PUT",
          body: payload,
        });
      }
      return "更新成功";
    },
    onSuccess: (message) => {
      feedback.success(message);
      closeForm();
      onDataChanged?.();
      void queryClient.invalidateQueries({ queryKey: ["admin-data-table", api] });
    },
  });

  const tableColumns = useMemo(() => {
    const visibleColumns: ColumnsType<T> = columns
      .filter((column) => !column.hideInTable)
      .filter((column) => activeColumnKeys.includes(column.dataIndex))
      .map((column) => ({
        ...column,
        dataIndex: column.dataIndex,
        sorter: column.sorter,
        fixed: hasRows ? column.fixed : undefined,
        width: hasRows ? column.width : undefined,
      }));

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
          {enableDelete && (canDelete ? canDelete(record) : true) ? (
            <AuthButton auth={`${accessName}.delete`}>
              <Tooltip title="删除">
                <Button
                  aria-label="删除"
                  danger
                  type="primary"
                  size="small"
                  icon={<DeleteOutlined />}
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
    deleteMutation,
    enableActions,
    enableDelete,
    enableUpdate,
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
    setDraftKeyword(null);
    actions.setSearch({
      ...state.formValues,
      keyword: value,
    });
  }

  const searchNode = shouldShowSearch ? (
    <AdminSearchForm
      columns={columns}
      values={state.formValues}
      keyword={state.keyword}
      includeKeyword={false}
      loading={loading}
      onSearch={(values) => actions.setSearch({ ...values, keyword: keywordText })}
      onReset={() => {
        setDraftKeyword(null);
        actions.reset();
      }}
    />
  ) : null;

  const densityMenu = {
    items: [
      { key: "large", label: "默认", onClick: () => setDensity("large") },
      { key: "middle", label: "中等", onClick: () => setDensity("middle") },
      { key: "small", label: "紧凑", onClick: () => setDensity("small") },
    ],
    selectedKeys: [density ?? "large"],
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
      {searchPlacement === "inside" && searchNode ? (
        <>
          {searchNode}
          <Divider className="admin-search-divider" />
        </>
      ) : null}
      <div className="admin-toolbar">
        <div className="admin-toolbar-left">
          {toolbarTitle ? <div className="admin-toolbar-title">{toolbarTitle}</div> : null}
          {enableCreate ? (
            <AuthButton auth={`${accessName}.create`}>
              <Button
                data-testid="admin-create-button"
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => openForm("create", null)}
              >
                新增
              </Button>
            </AuthButton>
          ) : null}
          {showSearchButton ? (
            <Button
              className="admin-search-toggle"
              type="primary"
              icon={<SearchOutlined />}
              onClick={() => setSearchOpen((value) => !value)}
            >
              搜索
            </Button>
          ) : null}
          {showKeywordSearch ? (
            <Input.Search
              className="admin-table-keyword"
              allowClear
              value={keywordText}
              placeholder="请输入关键字"
              onChange={(event) => {
                const value = event.target.value;
                setDraftKeyword(value);
                if (!value && state.keyword) {
                  handleKeywordSearch("");
                }
              }}
              onSearch={handleKeywordSearch}
            />
          ) : null}
          {actionBarRender?.(reload)}
        </div>
        {showToolbarSettings ? (
          <div className="admin-toolbar-right">
            <Tooltip title="刷新">
              <Button type="text" icon={<ReloadOutlined />} onClick={reload} />
            </Tooltip>
            <Dropdown menu={densityMenu} trigger={["click"]}>
              <Button type="text" icon={<ColumnHeightOutlined />} />
            </Dropdown>
            <Tooltip title={bordered ? "隐藏边框" : "显示边框"}>
              <Button
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
                <Button type="text" icon={<SettingOutlined />} />
              </Tooltip>
            </Popover>
          </div>
        ) : null}
      </div>
      <div className={["admin-table-wrapper", `admin-table-wrapper--${tableMode}`].join(" ")}>
        <Table<T>
          {...tableProps}
          className={[
            "admin-data-table",
            hasRows ? "admin-data-table--populated" : "admin-data-table--empty",
            tableProps?.className,
          ]
            .filter(Boolean)
            .join(" ")}
          rowKey={rowKey}
          columns={tableColumns}
          dataSource={data}
          rowSelection={tableRowSelection}
          loading={loading}
          bordered={tableProps?.bordered ?? bordered}
          size={tableProps?.size ?? density}
          locale={{ emptyText: emptyText ?? <EmptyState /> }}
          scroll={tableScroll}
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
        initialValues={editingRecord}
        loading={saveMutation.isPending}
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
