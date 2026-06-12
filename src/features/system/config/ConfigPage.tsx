"use client";

import { Tabs, Tag } from "antd";
import { useEffect, useState } from "react";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn, FieldOption } from "@/components/admin-fields/types";
import { request } from "@/lib/request";
import type { PageResult } from "@/lib/response";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { configTypeOptions, statusOptions } from "../shared/options";

type ConfigGroupRecord = {
  id: number;
  name: string;
  code: string;
  sort: number;
  status: number;
  createdAt: string;
};

type ConfigItemRecord = {
  id: number;
  groupId: number;
  groupName?: string | null;
  key: string;
  title: string;
  describe?: string | null;
  values?: string | null;
  type: string;
  optionsJson?: string | null;
  propsJson?: string | null;
  sort: number;
  status: number;
  createdAt: string;
};

export function ConfigPage() {
  const [groupOptions, setGroupOptions] = useState<FieldOption[]>([]);

  function reloadGroupOptions() {
    void request<PageResult<ConfigGroupRecord>>("/api/system/config/group?pageSize=200", {
      silent: true,
    }).then((page) => setGroupOptions(page.data.map((item) => ({ label: item.name, value: item.id }))));
  }

  useEffect(() => {
    reloadGroupOptions();
  }, []);

  const groupColumns: AdminDataTableColumn<ConfigGroupRecord>[] = [
    { title: "ID", dataIndex: "id", hideInForm: true, hideInSearch: true, width: 72 },
    { title: "分组名称", dataIndex: "name", required: true },
    { title: "分组编码", dataIndex: "code", required: true },
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

  const itemColumns: AdminDataTableColumn<ConfigItemRecord>[] = [
    { title: "ID", dataIndex: "id", hideInForm: true, hideInSearch: true, width: 72 },
    {
      title: "分组",
      dataIndex: "groupId",
      valueType: "select",
      options: groupOptions,
      required: true,
      render: (_, record) => record.groupName ?? "-",
    },
    { title: "配置 Key", dataIndex: "key", required: true },
    { title: "标题", dataIndex: "title", required: true },
    { title: "说明", dataIndex: "describe", valueType: "textarea", fullWidth: true, hideInSearch: true },
    { title: "配置值", dataIndex: "values", valueType: "textarea", fullWidth: true, hideInSearch: true },
    {
      title: "类型",
      dataIndex: "type",
      valueType: "select",
      options: configTypeOptions,
    },
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
    <PageScaffold title="系统配置" description="维护基础配置分组和配置项">
      <Tabs
        destroyOnHidden
        items={[
          {
            key: "group",
            label: "配置分组",
            children: (
              <AdminDataTable
                api="/api/system/config/group"
                accessName="system.config"
                rowKey="id"
                columns={groupColumns}
                createTitle="新增配置分组"
                updateTitle="编辑配置分组"
              />
            ),
          },
          {
            key: "item",
            label: "配置项",
            children: (
              <AdminDataTable
                api="/api/system/config/items"
                accessName="system.config"
                rowKey="id"
                columns={itemColumns}
                createTitle="新增配置项"
                updateTitle="编辑配置项"
              />
            ),
          },
        ]}
      />
    </PageScaffold>
  );
}
