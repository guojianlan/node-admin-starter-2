"use client";

import {
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useRef, useState } from "react";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import { StreamingMarkdown } from "@/components/ai/StreamingMarkdown";
import { request, requestTextStream } from "@/lib/request";
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

type AiTestMode = "listModels" | "chat" | "embedding";

type AiTestResult = {
  mode: AiTestMode;
  endpoint: string;
  status: number;
  preview: string;
};

const providerTypeOptions = [
  { label: "OpenAI-compatible 网关", value: "openai-compatible" },
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic Claude", value: "anthropic" },
  { label: "Google Gemini", value: "google" },
  { label: "DeepSeek compatible", value: "deepseek" },
  { label: "Qwen / DashScope compatible", value: "qwen" },
  { label: "Moonshot / Kimi compatible", value: "moonshot" },
  { label: "Zhipu GLM compatible", value: "zhipu" },
  { label: "SiliconFlow compatible", value: "siliconflow" },
  { label: "OpenRouter compatible", value: "openrouter" },
  { label: "Ollama / Local compatible", value: "ollama" },
  { label: "Custom", value: "custom" },
];

const providerTypeExamples: Record<string, string> = {
  "openai-compatible": "https://api.example.com/v1",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  deepseek: "https://api.deepseek.com/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  moonshot: "https://api.moonshot.cn/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  siliconflow: "https://api.siliconflow.cn/v1",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434/v1",
  custom: "https://gateway.example.com/v1",
};

const testModeOptions = [
  { label: "列出模型", value: "listModels" },
  { label: "Chat 调用", value: "chat" },
  { label: "Embedding 调用", value: "embedding" },
];

function normalizePayload(values: Record<string, unknown>) {
  const payload = { ...values };
  delete payload.hasApiKey;
  if (!payload.apiKey) delete payload.apiKey;
  return payload;
}

export function AiProviderPage() {
  const queryClient = useQueryClient();
  const [testProvider, setTestProvider] = useState<AiProviderRecord | null>(null);
  const [testMode, setTestMode] = useState<AiTestMode>("listModels");
  const [testModelId, setTestModelId] = useState("");
  const [testInput, setTestInput] = useState("请用一句话回复 OK。");
  const [testMaxOutputTokens, setTestMaxOutputTokens] = useState(4096);
  const [testTimeoutMs, setTestTimeoutMs] = useState(60000);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);
  const [streamContent, setStreamContent] = useState("");
  const [streamEndpoint, setStreamEndpoint] = useState("");
  const [streamStatus, setStreamStatus] = useState<number | null>(null);
  const [streamError, setStreamError] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const streamControllerRef = useRef<AbortController | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ["admin-data-table", "/api/system/ai/provider"],
    });
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
    mutationFn: (payload: { id: number; mode: AiTestMode; modelId?: string; input?: string }) =>
      request("/api/system/ai/provider/test", {
        method: "POST",
        body: payload,
      }),
    onSuccess: (result) => {
      setTestResult(result as AiTestResult);
      feedback.success("测试完成");
    },
  });

  const resetStreamState = () => {
    streamControllerRef.current?.abort();
    streamControllerRef.current = null;
    setStreamContent("");
    setStreamEndpoint("");
    setStreamStatus(null);
    setStreamError("");
    setIsStreaming(false);
  };

  const runStreamTest = async () => {
    if (!testProvider) return;
    if (!testModelId.trim()) {
      feedback.warning("请输入模型 ID");
      return;
    }
    const controller = new AbortController();
    streamControllerRef.current = controller;
    setTestResult(null);
    setStreamContent("");
    setStreamEndpoint("");
    setStreamStatus(null);
    setStreamError("");
    setIsStreaming(true);
    try {
      await requestTextStream("/api/system/ai/provider/test/stream", {
        method: "POST",
        body: {
          id: testProvider.id,
          mode: "chat",
          modelId: testModelId.trim(),
          input: testInput.trim() || undefined,
          maxOutputTokens: testMaxOutputTokens,
          timeoutMs: testTimeoutMs,
        },
        signal: controller.signal,
        silent: true,
        onResponse: (response) => {
          setStreamStatus(response.status);
          setStreamEndpoint(response.headers.get("x-ai-test-endpoint") ?? "");
        },
        onChunk: (chunk) => {
          setStreamContent((previous) => previous + chunk);
        },
      });
      feedback.success("流式测试完成");
    } catch (error) {
      if (controller.signal.aborted) {
        feedback.info("已停止流式测试");
      } else {
        const message = error instanceof Error ? error.message : "流式测试失败";
        setStreamError(message);
        feedback.error(message);
      }
    } finally {
      if (streamControllerRef.current === controller) {
        streamControllerRef.current = null;
      }
      setIsStreaming(false);
    }
  };

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
      formHelp:
        "OpenAI-compatible 使用 /v1；Claude 使用 Anthropic /v1；Gemini 使用 Google Generative Language API /v1beta。",
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
      render: (value) => (
        <Tag color={value ? "success" : "default"}>{value ? "已配置" : "未配置"}</Tag>
      ),
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
    <PageScaffold
      title="AI Provider"
      description="维护 AI 服务商、OpenAI-compatible 网关、密钥和默认 Provider"
    >
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
                loading={testMutation.isPending && testProvider?.id === record.id}
                onClick={() => {
                  setTestProvider(record);
                  setTestMode("listModels");
                  setTestModelId("");
                  setTestInput("请用一句话回复 OK。");
                  setTestMaxOutputTokens(4096);
                  setTestTimeoutMs(60000);
                  setTestResult(null);
                  resetStreamState();
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
      <Modal
        title="测试 AI Provider"
        open={Boolean(testProvider)}
        width={760}
        okText={testMode === "chat" ? "开始流式测试" : "开始测试"}
        cancelText="关闭"
        confirmLoading={testMutation.isPending || isStreaming}
        okButtonProps={{ disabled: isStreaming }}
        onOk={() => {
          if (!testProvider) return;
          if (testMode !== "listModels" && !testModelId.trim()) {
            feedback.warning("请输入模型 ID");
            return;
          }
          if (testMode === "chat") {
            void runStreamTest();
            return;
          }
          void testMutation.mutateAsync({
            id: testProvider.id,
            mode: testMode,
            modelId: testModelId.trim() || undefined,
            input: testInput.trim() || undefined,
          });
        }}
        onCancel={() => {
          resetStreamState();
          setTestProvider(null);
          setTestResult(null);
        }}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            showIcon
            type="info"
            message={testProvider ? `${testProvider.name} / ${testProvider.providerType}` : ""}
            description={`Base URL 示例：${providerTypeExamples[testProvider?.providerType ?? "custom"] ?? providerTypeExamples.custom}`}
          />
          <Select
            value={testMode}
            options={testModeOptions}
            onChange={(value) => {
              setTestMode(value);
              setTestResult(null);
              resetStreamState();
            }}
          />
          {testMode !== "listModels" ? (
            <>
              <Input
                value={testModelId}
                onChange={(event) => setTestModelId(event.target.value)}
                placeholder="模型 ID，例如 gpt-4.1-mini / deepseek-chat / qwen-plus / gemini-2.5-flash"
              />
              <Input.TextArea
                rows={4}
                value={testInput}
                onChange={(event) => setTestInput(event.target.value)}
                placeholder="测试输入内容"
              />
              {testMode === "chat" ? (
                <Space size={12} wrap>
                  <Space direction="vertical" size={4}>
                    <Typography.Text type="secondary">最大输出 tokens</Typography.Text>
                    <InputNumber
                      min={16}
                      max={32768}
                      step={512}
                      value={testMaxOutputTokens}
                      onChange={(value) => setTestMaxOutputTokens(Number(value ?? 4096))}
                    />
                  </Space>
                  <Space direction="vertical" size={4}>
                    <Typography.Text type="secondary">超时 ms</Typography.Text>
                    <InputNumber
                      min={5000}
                      max={300000}
                      step={5000}
                      value={testTimeoutMs}
                      onChange={(value) => setTestTimeoutMs(Number(value ?? 60000))}
                    />
                  </Space>
                </Space>
              ) : null}
            </>
          ) : null}
          {testMode === "chat" && (isStreaming || streamContent || streamError) ? (
            <Alert
              showIcon
              type={streamError ? "error" : isStreaming ? "info" : "success"}
              message={
                streamEndpoint
                  ? `AI SDK stream / ${streamStatus ?? "-"} / ${streamEndpoint}`
                  : `AI SDK stream / ${streamStatus ?? "-"}`
              }
              action={
                isStreaming ? (
                  <Button
                    size="small"
                    danger
                    icon={<CloseCircleOutlined />}
                    onClick={() => streamControllerRef.current?.abort()}
                  >
                    停止
                  </Button>
                ) : null
              }
              description={
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  {streamError ? (
                    <Typography.Text type="danger">{streamError}</Typography.Text>
                  ) : null}
                  <StreamingMarkdown content={streamContent} />
                </Space>
              }
            />
          ) : null}
          {testResult ? (
            <Alert
              showIcon
              type="success"
              message={`HTTP ${testResult.status} / ${testResult.endpoint}`}
              description={
                <Typography.Paragraph
                  code
                  style={{ maxHeight: 260, overflow: "auto", whiteSpace: "pre-wrap" }}
                >
                  {testResult.preview || "测试接口无响应正文"}
                </Typography.Paragraph>
              }
            />
          ) : null}
        </Space>
      </Modal>
    </PageScaffold>
  );
}
