"use client";

import { Tag } from "antd";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import { PageScaffold } from "@/ui/page/PageScaffold";

type TenantRecord = {
  id: number;
  name: string;
  code: string;
  region: string;
  status: "active" | "suspended" | "archived";
  retentionDays: number;
  memberRole?: string | null;
  isSystem: boolean;
  createdAt: string;
};

const tenantStatusOptions = [
  { label: "启用", value: "active" },
  { label: "停用", value: "suspended" },
  { label: "归档", value: "archived" },
];

export function SaasTenantPage() {
  const columns: AdminDataTableColumn<TenantRecord>[] = [
    {
      title: "ID",
      dataIndex: "id",
      hideInForm: true,
      hideInSearch: true,
      width: 72,
      fixed: "left",
    },
    { title: "Tenant 名称", dataIndex: "name", required: true, width: 180, fixed: "left" },
    {
      title: "编码",
      dataIndex: "code",
      required: true,
      hideInUpdate: true,
      width: 150,
      formHelp: "创建后不可修改，用于存储前缀、审计和外部标识。",
    },
    { title: "区域", dataIndex: "region", required: true, width: 120, hideInSearch: true },
    {
      title: "状态",
      dataIndex: "status",
      valueType: "select",
      options: tenantStatusOptions,
      width: 108,
      render: (value) => {
        const status = String(value);
        const color = status === "active" ? "success" : status === "suspended" ? "warning" : "default";
        return <Tag color={color}>{tenantStatusOptions.find((item) => item.value === status)?.label ?? status}</Tag>;
      },
    },
    {
      title: "保留天数",
      dataIndex: "retentionDays",
      valueType: "digit",
      required: true,
      hideInSearch: true,
      width: 110,
      fieldProps: { min: 1, max: 3650 },
    },
    {
      title: "成员角色",
      dataIndex: "memberRole",
      hideInForm: true,
      hideInSearch: true,
      width: 110,
      render: (value) => <Tag>{String(value ?? "平台运营")}</Tag>,
    },
    {
      title: "系统默认",
      dataIndex: "isSystem",
      hideInForm: true,
      hideInSearch: true,
      width: 100,
      render: (value) => <Tag color={value ? "blue" : "default"}>{value ? "是" : "否"}</Tag>,
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      valueType: "datetime",
      hideInForm: true,
      hideInSearch: true,
      width: 180,
    },
  ];

  return (
    <PageScaffold
      title="Tenant 管理"
      description="维护 SaaS 客户组织、区域、保留策略和生命周期"
      hideHeader
    >
      <AdminDataTable
        api="/api/saas/tenants"
        accessName="saas.tenant"
        rowKey="id"
        columns={columns}
        toolbarTitle="Tenant 列表"
        createTitle="创建 Tenant"
        updateTitle="编辑 Tenant"
        canDelete={() => false}
        actionColumnWidth={96}
      />
    </PageScaffold>
  );
}
