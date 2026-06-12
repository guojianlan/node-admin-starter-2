"use client";

import { Tabs, Tag } from "antd";
import { useEffect, useState } from "react";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn, FieldOption } from "@/components/admin-fields/types";
import { request } from "@/lib/request";
import type { PageResult } from "@/lib/response";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { statusOptions } from "../shared/options";

type DictRecord = {
  id: number;
  name: string;
  code: string;
  remark?: string | null;
  status: number;
  sort: number;
  createdAt: string;
};

type DictItemRecord = {
  id: number;
  dictId: number;
  label: string;
  value: string;
  color?: string | null;
  status: number;
  sort: number;
  createdAt: string;
};

export function DictPage() {
  const [dictOptions, setDictOptions] = useState<FieldOption[]>([]);

  function reloadDictOptions() {
    void request<PageResult<DictRecord>>("/api/system/dict/list?pageSize=200", { silent: true }).then(
      (page) => setDictOptions(page.data.map((item) => ({ label: item.name, value: item.id }))),
    );
  }

  useEffect(() => {
    reloadDictOptions();
  }, []);

  const dictColumns: AdminDataTableColumn<DictRecord>[] = [
    { title: "ID", dataIndex: "id", hideInForm: true, hideInSearch: true, width: 72 },
    { title: "字典名称", dataIndex: "name", required: true },
    { title: "字典编码", dataIndex: "code", required: true },
    { title: "备注", dataIndex: "remark", valueType: "textarea", fullWidth: true },
    { title: "排序", dataIndex: "sort", valueType: "digit", hideInSearch: true },
    {
      title: "状态",
      dataIndex: "status",
      valueType: "select",
      options: statusOptions,
      render: (value) => <Tag color={value === 1 ? "green" : "red"}>{value === 1 ? "启用" : "停用"}</Tag>,
    },
    { title: "创建时间", dataIndex: "createdAt", hideInForm: true, hideInSearch: true },
  ];

  const itemColumns: AdminDataTableColumn<DictItemRecord>[] = [
    { title: "ID", dataIndex: "id", hideInForm: true, hideInSearch: true, width: 72 },
    {
      title: "字典类型",
      dataIndex: "dictId",
      valueType: "select",
      options: dictOptions,
      required: true,
    },
    { title: "标签", dataIndex: "label", required: true },
    { title: "值", dataIndex: "value", required: true },
    { title: "颜色", dataIndex: "color", hideInSearch: true },
    { title: "排序", dataIndex: "sort", valueType: "digit", hideInSearch: true },
    {
      title: "状态",
      dataIndex: "status",
      valueType: "select",
      options: statusOptions,
      render: (value) => <Tag color={value === 1 ? "green" : "red"}>{value === 1 ? "启用" : "停用"}</Tag>,
    },
    { title: "创建时间", dataIndex: "createdAt", hideInForm: true, hideInSearch: true },
  ];

  return (
    <PageScaffold title="字典管理" description="维护通用字典类型和字典项">
      <Tabs
        destroyOnHidden
        items={[
          {
            key: "dict",
            label: "字典类型",
            children: (
              <AdminDataTable
                api="/api/system/dict/list"
                accessName="system.dict"
                rowKey="id"
                columns={dictColumns}
                createTitle="新增字典"
                updateTitle="编辑字典"
                actionBarRender={() => null}
              />
            ),
          },
          {
            key: "item",
            label: "字典项",
            children: (
              <AdminDataTable
                api="/api/system/dict/item"
                accessName="system.dict"
                rowKey="id"
                columns={itemColumns}
                createTitle="新增字典项"
                updateTitle="编辑字典项"
              />
            ),
          },
        ]}
      />
    </PageScaffold>
  );
}
