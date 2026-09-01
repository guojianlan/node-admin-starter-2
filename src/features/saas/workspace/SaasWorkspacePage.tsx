"use client";

import { useQuery } from "@tanstack/react-query";
import { Tag } from "antd";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn, FieldOption } from "@/components/admin-fields/types";
import { request } from "@/lib/request";
import { PageScaffold } from "@/ui/page/PageScaffold";

type TenantOption = { id: number; name: string; code: string };
type TenantPage = { data: TenantOption[] };

type WorkspaceRecord = {
  id: number;
  tenantId: number;
  tenantName: string;
  name: string;
  code: string;
  description?: string | null;
  status: "active" | "archived";
  memberRole?: string | null;
  isSystem: boolean;
  createdAt: string;
};

const workspaceStatusOptions = [
  { label: "启用", value: "active" },
  { label: "归档", value: "archived" },
];

export function SaasWorkspacePage() {
  const tenantQuery = useQuery({
    queryKey: ["saas-tenant-options"],
    queryFn: () => request<TenantPage>("/api/saas/tenants?page=1&pageSize=100&status=active"),
  });
  const tenantOptions: FieldOption[] = (tenantQuery.data?.data ?? []).map((tenant) => ({
    label: `${tenant.name} (${tenant.code})`,
    value: tenant.id,
  }));

  const columns: AdminDataTableColumn<WorkspaceRecord>[] = [
    {
      title: "ID",
      dataIndex: "id",
      hideInForm: true,
      hideInSearch: true,
      width: 72,
      fixed: "left",
    },
    {
      title: "Tenant",
      dataIndex: "tenantId",
      valueType: "select",
      options: tenantOptions,
      required: true,
      hideInUpdate: true,
      width: 180,
      render: (_value, record) => record.tenantName,
    },
    { title: "Workspace 名称", dataIndex: "name", required: true, width: 180, fixed: "left" },
    {
      title: "编码",
      dataIndex: "code",
      required: true,
      hideInUpdate: true,
      width: 150,
      formHelp: "编码在 Tenant 内唯一，创建后不可修改。",
    },
    {
      title: "说明",
      dataIndex: "description",
      valueType: "textarea",
      hideInSearch: true,
      hideInTable: true,
      fullWidth: true,
    },
    {
      title: "状态",
      dataIndex: "status",
      valueType: "select",
      options: workspaceStatusOptions,
      width: 108,
      render: (value) => (
        <Tag color={value === "active" ? "success" : "default"}>
          {value === "active" ? "启用" : "归档"}
        </Tag>
      ),
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
      title="Workspace 管理"
      description="维护 Tenant 内的项目空间、业务线和团队工作区"
      hideHeader
    >
      <AdminDataTable
        api="/api/saas/workspaces"
        accessName="saas.workspace"
        rowKey="id"
        columns={columns}
        toolbarTitle="Workspace 列表"
        createTitle="创建 Workspace"
        updateTitle="编辑 Workspace"
        canDelete={() => false}
        actionColumnWidth={96}
      />
    </PageScaffold>
  );
}
