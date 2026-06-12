"use client";

import { Tag } from "antd";
import { useEffect, useState } from "react";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn, FieldOption } from "@/components/admin-fields/types";
import { request } from "@/lib/request";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { statusOptions, toFieldOptions } from "../shared/options";

type RoleRecord = {
  id: number;
  name: string;
  code: string;
  remark?: string | null;
  sort: number;
  status: number;
  ruleIds?: number[];
  createdAt: string;
};

export function RolePage() {
  const [ruleOptions, setRuleOptions] = useState<FieldOption[]>([]);

  useEffect(() => {
    void request<Parameters<typeof toFieldOptions>[0]>("/api/system/role/ruleList", {
      silent: true,
    }).then((rows) => setRuleOptions(toFieldOptions(rows)));
  }, []);

  const columns: AdminDataTableColumn<RoleRecord>[] = [
    { title: "ID", dataIndex: "id", hideInForm: true, hideInSearch: true, width: 72 },
    { title: "角色名称", dataIndex: "name", required: true },
    { title: "角色编码", dataIndex: "code", required: true },
    { title: "备注", dataIndex: "remark", valueType: "textarea", fullWidth: true },
    { title: "排序", dataIndex: "sort", valueType: "digit", hideInSearch: true },
    {
      title: "权限",
      dataIndex: "ruleIds",
      valueType: "treeSelect",
      options: ruleOptions,
      hideInTable: true,
      hideInSearch: true,
      fullWidth: true,
      fieldProps: {
        treeCheckable: true,
        showCheckedStrategy: "SHOW_PARENT",
      },
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
    <PageScaffold title="角色管理" description="配置角色和菜单权限">
      <AdminDataTable
        api="/api/system/role"
        accessName="system.role"
        rowKey="id"
        columns={columns}
        createTitle="新增角色"
        updateTitle="编辑角色"
      />
    </PageScaffold>
  );
}
