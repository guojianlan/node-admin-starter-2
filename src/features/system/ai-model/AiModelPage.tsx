"use client";

import { ApiOutlined, CheckCircleOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Modal, Space, Switch, Tag, Tooltip, Typography } from "antd";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import { buildQueryString, request } from "@/lib/request";
import type { PageResult } from "@/lib/response";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { statusOptions } from "../shared/options";

type AiProviderRecord = {
  id: number;
  name: string;
  code: string;
  status: number;
};

type AiModelRecord = {
  id: number;
  providerId: number;
  providerName?: string;
  providerCode?: string;
  providerStatus?: number;
  name: string;
  modelId: string;
  modelType: "chat" | "embedding" | "image" | "rerank";
  capabilitiesJson?: string | null;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  inputPrice?: string | null;
  outputPrice?: string | null;
  currency: string;
  isDefaultChat: boolean;
  isDefaultStructured: boolean;
  isDefaultEmbedding: boolean;
  status: number;
  sort: number;
  remark?: string | null;
  isSystem: boolean;
};

const modelTypeOptions = [
  { label: "Chat", value: "chat" },
  { label: "Embedding", value: "embedding" },
  { label: "Image", value: "image" },
  { label: "Rerank", value: "rerank" },
];

const usageLabels = {
  chat: "Chat",
  structured: "结构化",
  embedding: "Embedding",
} as const;

function normalizePayload(values: Record<string, unknown>) {
  const payload = { ...values };
  delete payload.providerName;
  delete payload.providerCode;
  delete payload.providerStatus;
  delete payload.isDefaultChat;
  delete payload.isDefaultStructured;
  delete payload.isDefaultEmbedding;
  delete payload.isSystem;
  if (!payload.currency) payload.currency = "USD";
  return payload;
}

function capabilityTags(value?: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed as Record<string, unknown>)
        .filter(([, enabled]) => Boolean(enabled))
        .map(([key]) => key);
    }
  } catch {
    return [];
  }
  return [];
}

export function AiModelPage() {
  const queryClient = useQueryClient();
  const providerQuery = useQuery({
    queryKey: ["system-ai-provider-options"],
    queryFn: async () => {
      const page = await request<PageResult<AiProviderRecord>>(
        `/api/system/ai/provider${buildQueryString({ page: 1, pageSize: 200 })}`,
      );
      return page.data;
    },
  });

  const providerOptions = (providerQuery.data ?? []).map((provider) => ({
    label: `${provider.name} (${provider.code})`,
    value: provider.id,
    disabled: provider.status !== 1,
  }));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-data-table", "/api/system/ai/model"] });
    void queryClient.invalidateQueries({ queryKey: ["system-settings", "ai-model"] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: number }) =>
      request(`/api/system/ai/model/status/${id}`, {
        method: "PUT",
        body: { status },
      }),
    onSuccess: () => {
      feedback.success("状态更新成功");
      invalidate();
    },
  });

  const defaultMutation = useMutation({
    mutationFn: ({ id, usage }: { id: number; usage: keyof typeof usageLabels }) =>
      request(`/api/system/ai/model/default/${id}`, {
        method: "PUT",
        body: { usage },
      }),
    onSuccess: () => {
      feedback.success("设置成功");
      invalidate();
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: number) =>
      request("/api/system/ai/model/test", {
        method: "POST",
        body: { id },
      }),
    onSuccess: () => {
      feedback.success("模型调用正常");
    },
  });

  const columns: AdminDataTableColumn<AiModelRecord>[] = [
    { title: "ID", dataIndex: "id", hideInForm: true, hideInSearch: true, width: 72 },
    {
      title: "Provider",
      dataIndex: "providerId",
      valueType: "select",
      options: providerOptions,
      required: true,
      width: 180,
      render: (_, record) => (
        <Space size={6} wrap>
          <Typography.Text strong>{record.providerName || record.providerId}</Typography.Text>
          {record.providerCode ? <Tag color="blue">{record.providerCode}</Tag> : null}
          {record.providerStatus === 1 ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>}
        </Space>
      ),
    },
    {
      title: "名称",
      dataIndex: "name",
      required: true,
      width: 160,
      render: (value, record) => (
        <Space size={8}>
          <ThunderboltOutlined />
          <Typography.Text strong>{String(value)}</Typography.Text>
          {record.isSystem ? <Tag color="blue">内置模板</Tag> : null}
        </Space>
      ),
    },
    {
      title: "模型 ID",
      dataIndex: "modelId",
      required: true,
      width: 190,
      formHelp: "传给 AI Provider 的真实模型名，例如 gpt-4.1-mini 或 text-embedding-3-small。",
    },
    {
      title: "类型",
      dataIndex: "modelType",
      valueType: "select",
      options: modelTypeOptions,
      required: true,
      width: 120,
      render: (value) => <Tag>{String(value || "chat")}</Tag>,
    },
    {
      title: "能力 JSON",
      dataIndex: "capabilitiesJson",
      valueType: "textarea",
      hideInSearch: true,
      width: 220,
      formHelp: '例如 {"chat":true,"structured":true,"toolCalling":true}，后续 agent 会读取这里做能力判断。',
      render: (value) => {
        const tags = capabilityTags(value ? String(value) : "");
        return tags.length ? (
          <Space wrap size={4}>
            {tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Space>
        ) : (
          <Typography.Text type="secondary">未配置</Typography.Text>
        );
      },
    },
    { title: "上下文窗口", dataIndex: "contextWindow", valueType: "digit", hideInSearch: true, width: 120 },
    { title: "最大输出", dataIndex: "maxOutputTokens", valueType: "digit", hideInSearch: true, width: 110 },
    { title: "输入价格", dataIndex: "inputPrice", hideInSearch: true, width: 100 },
    { title: "输出价格", dataIndex: "outputPrice", hideInSearch: true, width: 100 },
    { title: "币种", dataIndex: "currency", hideInSearch: true, width: 88 },
    {
      title: "默认用途",
      dataIndex: "isDefaultChat",
      hideInForm: true,
      hideInSearch: true,
      width: 180,
      render: (_, record) => (
        <Space wrap size={4}>
          {record.isDefaultChat ? <Tag color="gold">Chat</Tag> : null}
          {record.isDefaultStructured ? <Tag color="purple">结构化</Tag> : null}
          {record.isDefaultEmbedding ? <Tag color="cyan">Embedding</Tag> : null}
          {!record.isDefaultChat && !record.isDefaultStructured && !record.isDefaultEmbedding ? (
            <Typography.Text type="secondary">-</Typography.Text>
          ) : null}
        </Space>
      ),
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
          disabled={record.isDefaultChat || record.isDefaultStructured || record.isDefaultEmbedding}
          onChange={async (checked) => {
            await statusMutation.mutateAsync({ id: record.id, status: checked ? 1 : 0 });
          }}
        />
      ),
    },
    { title: "排序", dataIndex: "sort", valueType: "digit", hideInSearch: true, width: 88 },
    {
      title: "备注",
      dataIndex: "remark",
      valueType: "textarea",
      hideInTable: true,
      hideInSearch: true,
      fullWidth: true,
    },
  ];

  const confirmDefault = (record: AiModelRecord, usage: keyof typeof usageLabels) => {
    Modal.confirm({
      title: `设为默认 ${usageLabels[usage]} 模型`,
      content: `确认将 ${record.name} 设为默认 ${usageLabels[usage]} 模型吗？后续业务读取该用途配置时会使用它。`,
      okText: "设为默认",
      cancelText: "取消",
      onOk: async () => {
        await defaultMutation.mutateAsync({ id: record.id, usage });
      },
    });
  };

  return (
    <PageScaffold title="AI 模型" description="维护 Provider 下的模型、能力、价格和默认业务用途">
      <AdminDataTable
        api="/api/system/ai/model"
        accessName="system.aiModel"
        rowKey="id"
        columns={columns}
        createTitle="新增 AI 模型"
        updateTitle="编辑 AI 模型"
        canDelete={(record) =>
          !record.isSystem &&
          !record.isDefaultChat &&
          !record.isDefaultStructured &&
          !record.isDefaultEmbedding
        }
        beforeSubmit={normalizePayload}
        onDataChanged={invalidate}
        operateRender={(record) => (
          <>
            <Tooltip title="测试模型调用">
              <Button
                size="small"
                icon={<ApiOutlined />}
                loading={testMutation.isPending}
                onClick={async () => {
                  await testMutation.mutateAsync(record.id);
                }}
              />
            </Tooltip>
            {record.modelType === "chat" ? (
              <>
                <Tooltip title="设为默认 Chat">
                  <Button
                    size="small"
                    icon={<CheckCircleOutlined />}
                    type={record.isDefaultChat ? "primary" : "default"}
                    loading={defaultMutation.isPending}
                    onClick={() => confirmDefault(record, "chat")}
                  />
                </Tooltip>
                <Tooltip title="设为默认结构化输出">
                  <Button
                    size="small"
                    loading={defaultMutation.isPending}
                    type={record.isDefaultStructured ? "primary" : "default"}
                    onClick={() => confirmDefault(record, "structured")}
                  >
                    JSON
                  </Button>
                </Tooltip>
              </>
            ) : null}
            {record.modelType === "embedding" ? (
              <Tooltip title="设为默认 Embedding">
                <Button
                  size="small"
                  icon={<CheckCircleOutlined />}
                  type={record.isDefaultEmbedding ? "primary" : "default"}
                  loading={defaultMutation.isPending}
                  onClick={() => confirmDefault(record, "embedding")}
                />
              </Tooltip>
            ) : null}
          </>
        )}
      />
    </PageScaffold>
  );
}
