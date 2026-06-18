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
import { Button, Checkbox, Divider, Dropdown, Input, Popover, Space, Table, Tooltip } from "antd";
import type { TableProps } from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import type { SorterResult, TableCurrentDataSource } from "antd/es/table/interface";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  showKeywordSearch?: boolean;
  showToolbarSettings?: boolean;
  cardClassName?: string;
  searchCardClassName?: string;
  searchPlacement?: "inside" | "card";
  toolbarTitle?: React.ReactNode;
  urlStatePrefix?: string;
  pagination?: false;
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
};

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
  showKeywordSearch = true,
  showToolbarSettings = true,
  cardClassName,
  searchCardClassName,
  searchPlacement = "inside",
  toolbarTitle,
  urlStatePrefix,
  pagination,
  tableProps,
  canUpdate,
  canDelete,
  actionBarRender,
  operateRender,
  beforeSubmit,
  handleRequest,
}: AdminDataTableProps<T>) {
  const [data, setData] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [editingRecord, setEditingRecord] = useState<T | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "update">("create");
  const [searchOpen, setSearchOpen] = useState(true);
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

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const page = handleRequest
        ? await handleRequest(state.query)
        : await request<PageResult<T>>(`${api}${buildQueryString(state.query)}`);
      setData(page.data);
      setTotal(page.total);
    } finally {
      setLoading(false);
    }
  }, [api, handleRequest, state.query]);

  useEffect(() => {
    void Promise.resolve().then(loadData);
  }, [loadData, reloadKey]);

  const reload = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  const tableColumns = useMemo(() => {
    const visibleColumns: ColumnsType<T> = columns
      .filter((column) => !column.hideInTable)
      .filter((column) => activeColumnKeys.includes(column.dataIndex))
      .map((column) => ({
        ...column,
        dataIndex: column.dataIndex,
        sorter: column.sorter,
      }));

    if (!enableActions) return visibleColumns;

    visibleColumns.push({
      title: "操作栏",
      key: "__operate",
      width: 132,
      align: "center",
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
                  onClick={() => {
                    setEditingRecord(record);
                    setFormMode("update");
                    setFormOpen(true);
                  }}
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
                    void request(`${api}/${getRowId(record, rowKey)}`, { method: "DELETE" }).then(
                      () => {
                        feedback.success("删除成功");
                        reload();
                      },
                    );
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
    api,
    activeColumnKeys,
    columns,
    canDelete,
    canUpdate,
    enableActions,
    enableDelete,
    enableUpdate,
    operateRender,
    reload,
    rowKey,
  ]);

  async function handleFinish(values: Record<string, unknown>) {
    setFormLoading(true);
    try {
      const payload = beforeSubmit ? beforeSubmit(values, formMode) : values;
      if (formMode === "create") {
        await request(api, { method: "POST", body: payload });
        feedback.success("创建成功");
      } else if (editingRecord) {
        await request(`${api}/${getRowId(editingRecord, rowKey)}`, {
          method: "PUT",
          body: payload,
        });
        feedback.success("更新成功");
      }
      setFormOpen(false);
      setEditingRecord(null);
      reload();
    } finally {
      setFormLoading(false);
    }
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
                onClick={() => {
                  setEditingRecord(null);
                  setFormMode("create");
                  setFormOpen(true);
                }}
              >
                新增
              </Button>
            </AuthButton>
          ) : null}
          {showSearchButton ? (
            <Button
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
      <div className="admin-table-wrapper">
        <Table<T>
          {...tableProps}
          rowKey={rowKey}
          columns={tableColumns}
          dataSource={data}
          loading={loading}
          bordered={tableProps?.bordered ?? bordered}
          size={tableProps?.size ?? density}
          locale={{ emptyText: <EmptyState /> }}
          scroll={tableProps?.scroll ?? { x: "max-content" }}
          pagination={
            pagination === false
              ? false
              : {
                  current: state.page,
                  pageSize: state.pageSize,
                  total,
                  size: "small",
                  showQuickJumper: true,
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
        loading={formLoading}
        onCancel={() => {
          setFormOpen(false);
          setEditingRecord(null);
        }}
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
