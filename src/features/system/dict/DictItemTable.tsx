"use client";

import { Badge, Tag } from "antd";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import { buildQueryString, request } from "@/lib/request";
import type { PageResult } from "@/lib/response";
import { statusOptions } from "../shared/options";

export type DictSummary = {
  id: number;
  name: string;
  code: string;
};

type DictItemRecord = {
  id: number;
  dictId: number;
  label: string;
  value: string;
  status: number;
  sort: number;
  createdAt: string;
};

const dictItemNameHelp = (
  <div className="admin-json-help-content">
    <div>展示给用户看的文案。</div>
    <div>例如状态字典中可以填写“启用”“停用”。</div>
  </div>
);

const dictItemValueHelp = (
  <div className="admin-json-help-content">
    <div>系统实际保存和筛选使用的值，通常会进入数据库或 URL 查询条件。</div>
    <div>例如状态字典推荐使用：</div>
    <pre>{`启用 = 1
停用 = 0`}</pre>
  </div>
);

const dictItemSortHelp = (
  <div className="admin-json-help-content">
    <div>控制字典项展示顺序，数字越小越靠前。</div>
    <div>例如“启用”排序 1，“停用”排序 2。</div>
  </div>
);

const dictItemStatusHelp = (
  <div className="admin-json-help-content">
    <div>只有启用的字典项会进入前端字典缓存，供下拉框、单选框等控件使用。</div>
    <div>停用后不会删除数据，只是不再作为可选项返回。</div>
  </div>
);

type DictItemTableProps = {
  dict: DictSummary;
  showTitle?: boolean;
  urlStatePrefix?: string;
};

export function DictItemTable({ dict, showTitle = true, urlStatePrefix }: DictItemTableProps) {
  const columns: AdminDataTableColumn<DictItemRecord>[] = [
    {
      title: "ID",
      dataIndex: "id",
      hideInForm: true,
      hideInSearch: true,
      hideInTable: true,
      width: 80,
      align: "center",
    },
    {
      title: "名称",
      dataIndex: "label",
      required: true,
      width: 160,
      fixed: "left",
      formHelp: dictItemNameHelp,
      fieldProps: { placeholder: "例如：启用" },
    },
    {
      title: "值",
      dataIndex: "value",
      required: true,
      formHelp: dictItemValueHelp,
      fieldProps: { placeholder: "例如：1" },
    },
    {
      title: "排序",
      dataIndex: "sort",
      valueType: "digit",
      hideInSearch: true,
      hideInTable: true,
      align: "center",
      formHelp: dictItemSortHelp,
      fieldProps: { min: 0, precision: 0, placeholder: "数字越小越靠前" },
      render: (value) => <Tag color="purple">{String(value)}</Tag>,
    },
    {
      title: "状态",
      dataIndex: "status",
      valueType: "select",
      options: statusOptions,
      align: "center",
      formHelp: dictItemStatusHelp,
      render: (value) =>
        Number(value) === 1 ? (
          <Badge status="success" text="启用" />
        ) : (
          <Badge status="error" text="停用" />
        ),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      hideInForm: true,
      hideInSearch: true,
      hideInTable: true,
      width: 180,
    },
  ];

  return (
    <AdminDataTable
      api="/api/system/dict/item"
      accessName="system.dict"
      rowKey="id"
      columns={columns}
      cardClassName="system-dict-detail-card"
      createTitle="新增字典项"
      updateTitle="编辑字典项"
      tableMode="embedded"
      showSearchForm={false}
      toolbarTitle={
        showTitle ? (
          <div className="system-dict-title system-dict-item-title">
            字典项管理
            <span>（{dict.name}</span>
            <Tag>{dict.code}</Tag>
            <span>）</span>
          </div>
        ) : null
      }
      urlStatePrefix={urlStatePrefix}
      tableProps={{ size: "small", bordered: true }}
      beforeSubmit={(values) => ({ ...values, dictId: dict.id })}
      queryKeyDeps={[dict.id]}
      handleRequest={async (params) =>
        request<PageResult<DictItemRecord>>(
          `/api/system/dict/item${buildQueryString({ ...params, dictId: dict.id })}`,
          { silent: true },
        )
      }
    />
  );
}
