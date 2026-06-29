"use client";

import { ApiOutlined, CheckCircleOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Modal, Space, Switch, Tag, Tooltip, Typography } from "antd";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import { request } from "@/lib/request";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { statusOptions } from "../shared/options";

type AiProviderRecord = {
  id: number;
  name: string;
  code: string;
  providerType: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  hasApiKey?: boolean;
  organization?: string | null;
  project?: string | null;
  isDefault: boolean;
  status: number;
  sort: number;
  optionsJson?: string | null;
  remark?: string | null;
  isSystem: boolean;
};

const providerTypeOptions = [
  { label: "OpenAI-compatible", value: "openai-compatible" },
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic", value: "anthropic" },
  { label: "Google Gemini", value: "google" },
  { label: "Custom", value: "custom" },
];

function normalizePayload(values: Record<string, unknown>) {
  const payload = { ...values };
  delete payload.hasApiKey;
  if (!payload.apiKey) delete payload.apiKey;
  return payload;
}

export function AiProviderPage() {
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-data-table", "/api/system/ai/provider"] });
    void queryClient.invalidateQueries({ queryKey: ["system-settings", "ai-provider"] });
    void queryClient.invalidateQueries({ queryKey: ["system-settings", "ai-model"] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: number }) =>
      request(`/api/system/ai/provider/status/${id}`, {
        method: "PUT",
        body: { status },
      }),
    onSuccess: () => {
      feedback.success("状态更新成功");
      invalidate();
    },
  });

  const defaultMutation = useMutation({
    mutationFn: (id: number) => request(`/api/system/ai/provider/default/${id}`, { method: "PUT" }),
    onSuccess: () => {
      feedback.success("设置成功");
      invalidate();
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: number) =>
      request("/api/system/ai/provider/test", {
        method: "POST",
        body: { id },
      }),
    onSuccess: () => {
      feedback.success("连接正常");
    },
  });

  const columns: AdminDataTableColumn<AiProviderRecord>[] = [
    { title: "ID", dataIndex: "id", hideInForm: true, hideInSearch: true, width: 72 },
    {
      title: "名称",
      dataIndex: "name",
      required: true,
      width: 180,
      render: (value, record) => (
        <Space size={8}>
          <ThunderboltOutlined />
          <Typography.Text strong>{String(value)}</Typography.Text>
          {record.isSystem ? <Tag color="blue">内置模板</Tag> : null}
        </Space>
      ),
    },
    {
      title: "编码",
      dataIndex: "code",
      required: true,
      width: 150,
      formHelp: "系统内置 AI Provider 不能修改编码。业务模块可按编码选择 Provider。",
    },
    {
      title: "类型",
      dataIndex: "providerType",
      valueType: "select",
      options: providerTypeOptions,
      required: true,
      width: 150,
      render: (value) => <Tag>{String(value || "openai-compatible")}</Tag>,
    },
    {
      title: "Base URL",
      dataIndex: "baseUrl",
      width: 280,
      formHelp: "OpenAI-compatible 接口地址，例如 https://api.openai.com/v1 或本地网关 /v1。",
    },
    {
      title: "API Key",
      dataIndex: "apiKey",
      valueType: "password",
      hideInTable: true,
      hideInSearch: true,
      formHelp: "留空时保留原密钥；响应只返回密钥状态。",
    },
    {
      title: "密钥",
      dataIndex: "hasApiKey",
      hideInForm: true,
      hideInSearch: true,
      width: 88,
      render: (value) => <Tag color={value ? "success" : "default"}>{value ? "已配置" : "未配置"}</Tag>,
    },
    { title: "Organization", dataIndex: "organization", hideInSearch: true, width: 160 },
    { title: "Project", dataIndex: "project", hideInSearch: true, width: 160 },
    {
      title: "默认",
      dataIndex: "isDefault",
      hideInForm: true,
      hideInSearch: true,
      width: 80,
      render: (value) => <Tag color={value ? "gold" : "default"}>{value ? "默认" : "-"}</Tag>,
    },
    {
      title: "状态",
      dataIndex: "status",
      valueType: "select",
      options: statusOptions,
      width: 104,
      render: (value, record) => (
        <Switch
          checked={Number(value) === 1}
          loading={statusMutation.isPending}
          checkedChildren="启用"
          unCheckedChildren="停用"
          disabled={record.isDefault}
          onChange={async (checked) => {
            await statusMutation.mutateAsync({ id: record.id, status: checked ? 1 : 0 });
          }}
        />
      ),
    },
    { title: "排序", dataIndex: "sort", valueType: "digit", hideInSearch: true, width: 88 },
    {
      title: "扩展配置 JSON",
      dataIndex: "optionsJson",
      valueType: "textarea",
      hideInTable: true,
      hideInSearch: true,
      fullWidth: true,
      formHelp: "保存 provider 私有配置，例如兼容网关、限额或自定义 header；必须是合法 JSON。",
    },
    {
      title: "备注",
      dataIndex: "remark",
      valueType: "textarea",
      hideInTable: true,
      hideInSearch: true,
      fullWidth: true,
    },
  ];

  return (
    <PageScaffold title="AI Provider" description="维护 AI 服务商、OpenAI-compatible 网关、密钥和默认 Provider">
      <AdminDataTable
        api="/api/system/ai/provider"
        accessName="system.aiProvider"
        rowKey="id"
        columns={columns}
        createTitle="新增 AI Provider"
        updateTitle="编辑 AI Provider"
        canDelete={(record) => !record.isDefault && !record.isSystem}
        beforeSubmit={normalizePayload}
        onDataChanged={invalidate}
        operateRender={(record, reload) => (
          <>
            <Tooltip title="测试连接">
              <Button
                size="small"
                icon={<ApiOutlined />}
                loading={testMutation.isPending}
                onClick={async () => {
                  await testMutation.mutateAsync(record.id);
                }}
              />
            </Tooltip>
            {!record.isDefault ? (
              <Tooltip title="设为默认">
                <Button
                  size="small"
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  loading={defaultMutation.isPending}
                  onClick={() => {
                    Modal.confirm({
                      title: "切换默认 AI Provider",
                      content: `确认将 ${record.name} 设为默认 AI Provider 吗？后续业务可优先使用该配置。`,
                      okText: "设为默认",
                      cancelText: "取消",
                      onOk: async () => {
                        await defaultMutation.mutateAsync(record.id);
                        reload();
                      },
                    });
                  }}
                />
              </Tooltip>
            ) : (
              <Tooltip title="默认 Provider">
                <Button size="small" disabled icon={<ThunderboltOutlined />} />
              </Tooltip>
            )}
          </>
        )}
      />
    </PageScaffold>
  );
}
