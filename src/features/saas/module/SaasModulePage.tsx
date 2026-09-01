"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn, FieldOption } from "@/components/admin-fields/types";
import { AuthButton } from "@/components/auth-button/AuthButton";
import { request } from "@/lib/request";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";

type Page<T> = { data: T[]; page: number; pageSize: number; total: number };
type Tenant = { id: number; name: string; code: string };
type ModuleRecord = {
  id: number;
  code: string;
  name: string;
  version: string;
  description?: string | null;
  status: "draft" | "active" | "disabled" | "retired";
  routeKey: string;
  routePath: string;
  requiredAbility: string;
  dependenciesCsv: string;
  capabilitiesCsv: string;
  isSystem: boolean;
  createdAt: string;
};
type Entitlement = {
  id: number;
  tenantId: number;
  tenantName: string;
  moduleId: number;
  moduleName: string;
  moduleCode: string;
  status: "trial" | "active" | "suspended" | "expired";
  source: "manual" | "trial" | "plan";
  startsAt: string;
  expiresAt: string | null;
  memberLimitOverride: number | null;
  monthlyTaskLimitOverride: number | null;
  maxConcurrentTaskOverride: number | null;
  exportProfileOverride: string | null;
  notes: string | null;
};
type EntitlementForm = {
  tenantId: number;
  moduleId: number;
  status: Entitlement["status"];
  source: Entitlement["source"];
  startsAt?: Dayjs;
  expiresAt?: Dayjs | null;
  memberLimitOverride?: number | null;
  monthlyTaskLimitOverride?: number | null;
  maxConcurrentTaskOverride?: number | null;
  exportProfileOverride?: string | null;
  notes?: string | null;
};

const moduleStatusOptions = [
  { label: "规划草稿", value: "draft" },
  { label: "已上架", value: "active" },
  { label: "已停用", value: "disabled" },
  { label: "已退役", value: "retired" },
];
const entitlementStatusOptions = [
  { label: "试用", value: "trial" },
  { label: "启用", value: "active" },
  { label: "停用", value: "suspended" },
  { label: "过期", value: "expired" },
];
const entitlementSourceOptions = [
  { label: "人工开通", value: "manual" },
  { label: "试用", value: "trial" },
  { label: "套餐", value: "plan" },
];

function stateTag(value: string) {
  const color =
    value === "active"
      ? "success"
      : value === "trial"
        ? "processing"
        : value === "draft"
          ? "warning"
          : "default";
  return <Tag color={color}>{value}</Tag>;
}

export function SaasModulePage() {
  const queryClient = useQueryClient();
  const [tenantId, setTenantId] = useState<number>();
  const [editingEntitlement, setEditingEntitlement] = useState<Entitlement | "create">();
  const [entitlementForm] = Form.useForm<EntitlementForm>();

  const tenantQuery = useQuery({
    queryKey: ["saas-entitlement-tenants"],
    queryFn: () => request<Page<Tenant>>("/api/saas/tenants?page=1&pageSize=100"),
  });
  const tenants = tenantQuery.data?.data ?? [];
  const currentTenantId = tenantId ?? tenants[0]?.id;

  const moduleQuery = useQuery({
    queryKey: ["saas-entitlement-modules"],
    queryFn: () => request<Page<ModuleRecord>>("/api/saas/modules?page=1&pageSize=100"),
  });
  const modules = moduleQuery.data?.data ?? [];
  const activeModules = modules.filter((item) => item.status === "active");

  const entitlementQuery = useQuery({
    queryKey: ["saas-entitlements", currentTenantId],
    enabled: Boolean(currentTenantId),
    queryFn: () =>
      request<Page<Entitlement>>(
        `/api/saas/entitlements?tenantId=${currentTenantId}&page=1&pageSize=100`,
      ),
  });

  const entitlementMutation = useMutation({
    mutationFn: async (values: EntitlementForm) => {
      const body = {
        ...values,
        startsAt: values.startsAt?.toISOString(),
        expiresAt: values.expiresAt?.toISOString() ?? null,
      };
      if (editingEntitlement === "create") {
        await request("/api/saas/entitlements", { method: "POST", body });
      } else if (editingEntitlement) {
        const updateBody = {
          status: body.status,
          source: body.source,
          startsAt: body.startsAt,
          expiresAt: body.expiresAt,
          memberLimitOverride: body.memberLimitOverride,
          monthlyTaskLimitOverride: body.monthlyTaskLimitOverride,
          maxConcurrentTaskOverride: body.maxConcurrentTaskOverride,
          exportProfileOverride: body.exportProfileOverride,
          notes: body.notes,
        };
        await request(`/api/saas/entitlements/${editingEntitlement.id}`, {
          method: "PUT",
          body: updateBody,
        });
      }
    },
    onSuccess: async () => {
      feedback.success(
        editingEntitlement === "create" ? "Entitlement 已开通" : "Entitlement 已更新",
      );
      setEditingEntitlement(undefined);
      entitlementForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["saas-entitlements"] });
    },
  });

  const openCreateEntitlement = () => {
    setEditingEntitlement("create");
    entitlementForm.setFieldsValue({
      tenantId: currentTenantId,
      status: "trial",
      source: "trial",
      startsAt: dayjs(),
    });
  };
  const openEditEntitlement = (record: Entitlement) => {
    setEditingEntitlement(record);
    entitlementForm.setFieldsValue({
      ...record,
      startsAt: dayjs(record.startsAt),
      expiresAt: record.expiresAt ? dayjs(record.expiresAt) : null,
    });
  };

  const moduleColumns = useMemo<AdminDataTableColumn<ModuleRecord>[]>(
    () => [
      {
        title: "ID",
        dataIndex: "id",
        hideInForm: true,
        hideInSearch: true,
        width: 70,
        fixed: "left",
      },
      { title: "模块名称", dataIndex: "name", required: true, width: 170, fixed: "left" },
      { title: "编码", dataIndex: "code", required: true, hideInUpdate: true, width: 150 },
      { title: "版本", dataIndex: "version", required: true, hideInSearch: true, width: 110 },
      {
        title: "状态",
        dataIndex: "status",
        valueType: "select",
        options: moduleStatusOptions,
        required: true,
        width: 110,
        render: (value) => stateTag(String(value)),
      },
      { title: "路由 Key", dataIndex: "routeKey", required: true, hideInSearch: true, width: 180 },
      { title: "入口路由", dataIndex: "routePath", required: true, hideInSearch: true, width: 190 },
      {
        title: "Required Ability",
        dataIndex: "requiredAbility",
        required: true,
        hideInSearch: true,
        width: 210,
      },
      {
        title: "依赖模块",
        dataIndex: "dependenciesCsv",
        valueType: "textarea",
        hideInTable: true,
        hideInSearch: true,
        fullWidth: true,
        formHelp: "使用逗号分隔 module code；依赖未开通时模块不会进入有效菜单合同。",
      },
      {
        title: "能力声明",
        dataIndex: "capabilitiesCsv",
        valueType: "textarea",
        hideInTable: true,
        hideInSearch: true,
        fullWidth: true,
        formHelp: "使用逗号分隔能力 code，不直接暴露 Provider 私有参数。",
      },
      {
        title: "说明",
        dataIndex: "description",
        valueType: "textarea",
        hideInTable: true,
        hideInSearch: true,
        fullWidth: true,
      },
      {
        title: "系统预置",
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
        width: 190,
      },
    ],
    [],
  );

  const tenantOptions: FieldOption[] = tenants.map((tenant) => ({
    label: `${tenant.name} (${tenant.code})`,
    value: tenant.id,
  }));
  const moduleOptions: FieldOption[] = activeModules.map((module) => ({
    label: `${module.name} (${module.code})`,
    value: module.id,
  }));

  const entitlementColumns: ColumnsType<Entitlement> = [
    {
      title: "模块",
      dataIndex: "moduleName",
      width: 170,
      fixed: "left",
      render: (value, record) => `${value} (${record.moduleCode})`,
    },
    { title: "状态", dataIndex: "status", width: 100, render: stateTag },
    { title: "来源", dataIndex: "source", width: 100 },
    { title: "开始时间", dataIndex: "startsAt", width: 190 },
    { title: "过期时间", dataIndex: "expiresAt", width: 190, render: (value) => value || "长期" },
    {
      title: "成员上限",
      dataIndex: "memberLimitOverride",
      width: 110,
      render: (value) => value ?? "默认",
    },
    {
      title: "月任务上限",
      dataIndex: "monthlyTaskLimitOverride",
      width: 120,
      render: (value) => value ?? "默认",
    },
    {
      title: "并发上限",
      dataIndex: "maxConcurrentTaskOverride",
      width: 110,
      render: (value) => value ?? "默认",
    },
    {
      title: "导出规格",
      dataIndex: "exportProfileOverride",
      width: 130,
      render: (value) => value || "默认",
    },
    {
      title: "操作",
      key: "actions",
      width: 90,
      fixed: "right",
      render: (_value, record) => (
        <AuthButton auth="saas.module.entitlementUpdate">
          <Button size="small" onClick={() => openEditEntitlement(record)}>
            编辑
          </Button>
        </AuthButton>
      ),
    },
  ];

  return (
    <PageScaffold
      title="模块与 Entitlement"
      description="维护可组合产品目录和 Tenant 模块开通状态"
      hideHeader
    >
      <Tabs
        items={[
          {
            key: "modules",
            label: "模块目录",
            children: (
              <AdminDataTable<ModuleRecord>
                api="/api/saas/modules"
                accessName="saas.module"
                rowKey="id"
                columns={moduleColumns}
                toolbarTitle="SaaS 模块目录"
                createTitle="创建模块定义"
                updateTitle="编辑模块定义"
                createInitialValues={{ version: "0.1.0", status: "draft" }}
                canDelete={() => false}
                actionColumnWidth={96}
                onDataChanged={() =>
                  void queryClient.invalidateQueries({ queryKey: ["saas-entitlement-modules"] })
                }
              />
            ),
          },
          {
            key: "entitlements",
            label: "Tenant Entitlement",
            children: (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <Space wrap>
                  <Select
                    aria-label="选择 Tenant"
                    loading={tenantQuery.isLoading}
                    value={currentTenantId}
                    onChange={setTenantId}
                    options={tenantOptions}
                    style={{ minWidth: 250 }}
                    placeholder="选择 Tenant"
                  />
                  <AuthButton auth="saas.module.entitlementCreate">
                    <Button
                      type="primary"
                      onClick={openCreateEntitlement}
                      disabled={!currentTenantId || activeModules.length === 0}
                    >
                      开通模块
                    </Button>
                  </AuthButton>
                </Space>
                <Table<Entitlement>
                  rowKey="id"
                  loading={entitlementQuery.isLoading}
                  dataSource={entitlementQuery.data?.data ?? []}
                  columns={entitlementColumns}
                  pagination={false}
                  scroll={{ x: 1350, y: 500 }}
                />
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={
          editingEntitlement === "create" ? "开通 Tenant Entitlement" : "编辑 Tenant Entitlement"
        }
        open={Boolean(editingEntitlement)}
        onCancel={() => setEditingEntitlement(undefined)}
        onOk={() => entitlementForm.submit()}
        confirmLoading={entitlementMutation.isPending}
        width={720}
        destroyOnHidden
      >
        <Form
          form={entitlementForm}
          layout="vertical"
          onFinish={(values) => entitlementMutation.mutate(values)}
        >
          <Space size="middle" align="start" style={{ width: "100%" }} wrap>
            <Form.Item
              label="Tenant"
              name="tenantId"
              rules={[{ required: true }]}
              style={{ minWidth: 300 }}
            >
              <Select options={tenantOptions} disabled={editingEntitlement !== "create"} />
            </Form.Item>
            <Form.Item
              label="模块"
              name="moduleId"
              rules={[{ required: true }]}
              style={{ minWidth: 300 }}
            >
              <Select options={moduleOptions} disabled={editingEntitlement !== "create"} />
            </Form.Item>
          </Space>
          <Space size="middle" align="start" style={{ width: "100%" }} wrap>
            <Form.Item
              label="状态"
              name="status"
              rules={[{ required: true }]}
              style={{ minWidth: 180 }}
            >
              <Select options={entitlementStatusOptions} />
            </Form.Item>
            <Form.Item
              label="来源"
              name="source"
              rules={[{ required: true }]}
              style={{ minWidth: 180 }}
            >
              <Select options={entitlementSourceOptions} />
            </Form.Item>
            <Form.Item label="开始时间" name="startsAt" rules={[{ required: true }]}>
              <DatePicker showTime />
            </Form.Item>
            <Form.Item label="过期时间" name="expiresAt">
              <DatePicker showTime allowClear />
            </Form.Item>
          </Space>
          <Space size="middle" align="start" style={{ width: "100%" }} wrap>
            <Form.Item label="成员上限覆盖" name="memberLimitOverride">
              <InputNumber min={1} />
            </Form.Item>
            <Form.Item label="月任务上限覆盖" name="monthlyTaskLimitOverride">
              <InputNumber min={0} />
            </Form.Item>
            <Form.Item label="并发上限覆盖" name="maxConcurrentTaskOverride">
              <InputNumber min={1} />
            </Form.Item>
            <Form.Item label="导出规格覆盖" name="exportProfileOverride">
              <Input placeholder="例如 1080p" />
            </Form.Item>
          </Space>
          <Form.Item label="备注" name="notes">
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </PageScaffold>
  );
}
