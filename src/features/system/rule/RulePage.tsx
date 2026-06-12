"use client";

import { Tag } from "antd";
import { useEffect, useState } from "react";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn, FieldOption } from "@/components/admin-fields/types";
import { request } from "@/lib/request";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { ruleTypeOptions, statusOptions } from "../shared/options";

type ParentOption = FieldOption & { parentId?: number };

type RuleRecord = {
  id: number;
  parentId: number;
  type: "menu" | "route" | "action";
  key: string;
  name: string;
  path?: string | null;
  icon?: string | null;
  order: number;
  status: number;
  hidden: number;
  link: number;
  createdAt: string;
};

export function RulePage() {
  const [parentOptions, setParentOptions] = useState<FieldOption[]>([]);

  useEffect(() => {
    void request<ParentOption[]>("/api/system/rule/parent", { silent: true }).then((rows) => {
      setParentOptions([{ label: "顶级", value: 0 }, ...rows]);
    });
  }, []);

  const columns: AdminDataTableColumn<RuleRecord>[] = [
    { title: "ID", dataIndex: "id", hideInForm: true, hideInSearch: true, width: 72 },
    {
      title: "父级",
      dataIndex: "parentId",
      valueType: "select",
      options: parentOptions,
      hideInTable: true,
    },
    {
      title: "类型",
      dataIndex: "type",
      valueType: "select",
      options: ruleTypeOptions,
      render: (value) => {
        const color = value === "menu" ? "blue" : value === "route" ? "green" : "orange";
        return <Tag color={color}>{ruleTypeOptions.find((item) => item.value === value)?.label}</Tag>;
      },
    },
    { title: "名称", dataIndex: "name", required: true },
    { title: "权限 Key", dataIndex: "key", required: true },
    { title: "路径", dataIndex: "path" },
    { title: "图标", dataIndex: "icon", hideInSearch: true },
    { title: "排序", dataIndex: "order", valueType: "digit", hideInSearch: true },
    {
      title: "显示",
      dataIndex: "hidden",
      valueType: "select",
      options: [
        { label: "显示", value: 1 },
        { label: "隐藏", value: 0 },
      ],
      render: (value) => <Tag color={value === 1 ? "green" : "default"}>{value === 1 ? "显示" : "隐藏"}</Tag>,
    },
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
    <PageScaffold title="菜单权限" description="维护菜单、页面路由和按钮权限码">
      <AdminDataTable
        api="/api/system/rule"
        accessName="system.rule"
        rowKey="id"
        columns={columns}
        createTitle="新增菜单权限"
        updateTitle="编辑菜单权限"
      />
    </PageScaffold>
  );
}
