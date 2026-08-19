"use client";

import {
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AutoComplete,
  Button,
  Dropdown,
  Form,
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
  timeoutMs: number;
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

type ProviderModelOption = {
  id: string;
  name: string;
  modelType: "chat" | "embedding" | "image" | "rerank";
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
};

const providerTypeOptions = [
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic Claude", value: "anthropic" },
  { label: "Google Gemini", value: "google" },
  { label: "DeepSeek", value: "deepseek" },
  { label: "通义千问 / DashScope", value: "qwen" },
  { label: "Moonshot / Kimi", value: "moonshot" },
  { label: "智谱 GLM", value: "zhipu" },
  { label: "SiliconFlow", value: "siliconflow" },
  { label: "OpenRouter", value: "openrouter" },
  { label: "Ollama 本地模型", value: "ollama" },
  { label: "OpenAI 兼容服务", value: "openai-compatible" },
  { label: "其他兼容服务", value: "custom" },
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

const timeoutPresets = [
  { label: "30 秒", value: 30_000 },
  { label: "1 分钟", value: 60_000 },
  { label: "2 分钟", value: 120_000 },
  { label: "5 分钟", value: 300_000 },
  { label: "10 分钟", value: 600_000 },
  { label: "15 分钟", value: 900_000 },
  { label: "30 分钟", value: 1_800_000 },
  { label: "60 分钟", value: 3_600_000 },
];

function ProviderTimeoutField({ form }: { form: import("antd").FormInstance }) {
  const timeoutMs = Form.useWatch("timeoutMs", form) as number | undefined;
  return (
    <Space.Compact block>
      <InputNumber
        min={0.1}
        max={60}
        step={0.5}
        precision={2}
        addonAfter="分钟"
        value={(timeoutMs ?? 300000) / 60000}
        style={{ width: "100%" }}
        onChange={(value) =>
          form.setFieldValue("timeoutMs", Math.round(Number(value ?? 5) * 60000))
        }
      />
      <Dropdown
        trigger={["click"]}
        menu={{
          items: timeoutPresets.map((preset) => ({
            key: String(preset.value),
            label: preset.label,
            onClick: () => form.setFieldValue("timeoutMs", preset.value),
          })),
        }}
      >
        <Button icon={<DownOutlined />}>常用时间</Button>
      </Dropdown>
    </Space.Compact>
  );
}

function normalizePayload(values: Record<string, unknown>) {
  const payload = { ...values };
  delete payload.code;
  delete payload.hasApiKey;
  if (!payload.apiKey) delete payload.apiKey;
  return payload;
}

function applyProviderDefaults(
  providerType: string,
  form: { setFieldsValue: (values: Record<string, unknown>) => void },
  currentName?: unknown,
) {
  const option = providerTypeOptions.find((item) => item.value === providerType);
  form.setFieldsValue({
    baseUrl: providerTypeExamples[providerType] ?? providerTypeExamples.custom,
    ...(currentName ? {} : { name: option?.label ?? providerType }),
  });
}

export function AiProviderPage() {
  const queryClient = useQueryClient();
  const [testProvider, setTestProvider] = useState<AiProviderRecord | null>(null);
  const [testMode, setTestMode] = useState<AiTestMode>("listModels");
  const [testModelId, setTestModelId] = useState("");
  const [testModels, setTestModels] = useState<ProviderModelOption[]>([]);
  const [testModelsOpen, setTestModelsOpen] = useState(false);
  const [testModelsLoading, setTestModelsLoading] = useState(false);
  const [testInput, setTestInput] = useState("请用一句话回复 OK。");
  const [testMaxOutputTokens, setTestMaxOutputTokens] = useState(4096);
  const [testTimeoutMs, setTestTimeoutMs] = useState(300000);
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
    void queryClient.invalidateQueries({ queryKey: ["system-ai-setup-summary"] });
    void queryClient.invalidateQueries({ queryKey: ["system-ai-provider-options"] });
    void queryClient.invalidateQueries({ queryKey: ["system-settings", "ai-provider"] });
    void queryClient.invalidateQueries({ queryKey: ["system-settings", "ai-model"] });
    void queryClient.invalidateQueries({ queryKey: ["system-ai-playground-options"] });
    void queryClient.invalidateQueries({ queryKey: ["system-ai-playground-runtime"] });
    void queryClient.invalidateQueries({ queryKey: ["system-ai-chat-options"] });
    void queryClient.invalidateQueries({ queryKey: ["system-ai-chat-runtime"] });
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

  const loadTestModels = async () => {
    if (!testProvider) return;
    setTestModelsLoading(true);
    try {
      const result = await request<{ models: ProviderModelOption[] }>(
        `/api/system/ai/provider/${testProvider.id}/test-models`,
      );
      setTestModels(result.models);
      setTestModelsOpen(result.models.length > 0);
      if (result.models.length) {
        feedback.success(`已同步 ${result.models.length} 个模型，请选择测试模型`);
      } else {
        feedback.info("服务商没有返回模型，请手工输入模型 ID");
      }
    } finally {
      setTestModelsLoading(false);
    }
  };

  const visibleTestModels = testModels.filter((model) => {
    if (testMode === "embedding") return model.modelType === "embedding";
    if (testMode === "chat") return model.modelType === "chat";
    return true;
  });

  const columns: AdminDataTableColumn<AiProviderRecord>[] = [
    {
      title: "ID",
      dataIndex: "id",
      hideInForm: true,
      hideInSearch: true,
      width: 72,
      fixed: "left",
    },
    {
      title: "服务商",
      dataIndex: "providerType",
      valueType: "select",
      options: providerTypeOptions,
      required: true,
      width: 150,
      renderFormField: ({ form }) => (
        <Select
          options={providerTypeOptions}
          placeholder="选择服务商"
          onChange={(value) =>
            applyProviderDefaults(String(value), form, form.getFieldValue("name"))
          }
        />
      ),
      render: (value) => (
        <Tag>
          {providerTypeOptions.find((item) => item.value === value)?.label ??
            String(value || "openai-compatible")}
        </Tag>
      ),
    },
    {
      title: "连接名称",
      dataIndex: "name",
      required: true,
      width: 210,
      fixed: "left",
      formHelp: "同一服务商可以创建多套连接，请用名称区分账号、环境或代理网关。",
      fieldProps: { placeholder: "例如 OpenAI 生产账号" },
      render: (value, record) => (
        <Space size={6} wrap>
          <ThunderboltOutlined />
          <Typography.Text strong>{String(value)}</Typography.Text>
          {record.isSystem ? <Tag color="blue">内置模板</Tag> : null}
        </Space>
      ),
    },
    {
      title: "内部编码",
      dataIndex: "code",
      hideInForm: true,
      hideInSearch: true,
      width: 150,
      formHelp: "由系统自动生成，业务代码可用它稳定引用 Provider。",
    },
    {
      title: "Base URL",
      dataIndex: "baseUrl",
      width: 280,
      formHelp:
        "OpenAI-compatible 使用 /v1；Claude 使用 Anthropic /v1；Gemini 使用 Google Generative Language API /v1beta。",
      fieldProps: { placeholder: "选择服务商后自动填写，也可以粘贴自己的 Base URL" },
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
      title: "请求超时",
      dataIndex: "timeoutMs",
      valueType: "digit",
      hideInSearch: true,
      width: 112,
      formSection: "advanced",
      formHelp:
        "该连接下的正式 Chat、Agent、结构化输出和向量调用默认使用此超时；测试弹窗与 Playground 可以临时覆盖。",
      renderFormField: ({ form }) => <ProviderTimeoutField form={form} />,
      render: (value) => `${Number((Number(value || 300000) / 60000).toFixed(1))} min`,
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
    {
      title: "Organization",
      dataIndex: "organization",
      hideInSearch: true,
      width: 160,
      formSection: "advanced",
      formHelp: "仅 OpenAI Organization 场景需要。普通账号留空。",
    },
    {
      title: "Project",
      dataIndex: "project",
      hideInSearch: true,
      width: 160,
      formSection: "advanced",
      formHelp: "仅 OpenAI Project 场景需要。普通账号留空。",
    },
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
      formSection: "advanced",
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
    {
      title: "排序",
      dataIndex: "sort",
      valueType: "digit",
      hideInSearch: true,
      width: 88,
      formSection: "advanced",
    },
    {
      title: "扩展配置 JSON",
      dataIndex: "optionsJson",
      valueType: "textarea",
      hideInTable: true,
      hideInSearch: true,
      fullWidth: true,
      formSection: "advanced",
      formHelp: "保存 provider 私有配置，例如兼容网关、限额或自定义 header；必须是合法 JSON。",
    },
    {
      title: "备注",
      dataIndex: "remark",
      valueType: "textarea",
      hideInTable: true,
      hideInSearch: true,
      fullWidth: true,
      formSection: "advanced",
    },
  ];

  return (
    <PageScaffold
      title="AI 服务商"
      description="管理外部 AI 服务连接与凭据；同一服务商可配置多个账号、环境或代理网关"
      hideHeader
    >
      <AdminDataTable
        api="/api/system/ai/provider"
        accessName="system.aiProvider"
        rowKey="id"
        columns={columns}
        toolbarTitle="服务商连接"
        createTitle="添加 AI 服务商"
        updateTitle="编辑 AI 服务商"
        formBasicColumns={1}
        formNotice={
          <Alert
            showIcon
            type="info"
            title="一条记录代表一个独立连接"
            description="连接名称用于区分同一服务商的不同账号、环境或网关。系统会生成唯一内部编码；保存并启用后，再到模型管理同步模型。"
          />
        }
        actionColumnWidth={176}
        canDelete={(record) => !record.isDefault && !record.isSystem}
        deleteDisabledReason={(record) =>
          record.isSystem
            ? "系统内置服务商连接不能删除，可以停用"
            : record.isDefault
              ? "默认服务商连接不能删除，请先切换默认连接"
              : undefined
        }
        beforeSubmit={normalizePayload}
        createInitialValues={{
          timeoutMs: 300000,
          status: 1,
          sort: 0,
        }}
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
                  setTestModels([]);
                  setTestModelsOpen(false);
                  setTestInput("请用一句话回复 OK。");
                  setTestMaxOutputTokens(4096);
                  setTestTimeoutMs(record.timeoutMs ?? 300000);
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
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            showIcon
            type="info"
            title={testProvider ? `${testProvider.name} / ${testProvider.providerType}` : ""}
            description={`Base URL 示例：${providerTypeExamples[testProvider?.providerType ?? "custom"] ?? providerTypeExamples.custom}`}
          />
          <Select
            value={testMode}
            options={testModeOptions}
            onChange={(value) => {
              setTestMode(value);
              setTestModelId("");
              setTestModelsOpen(false);
              setTestResult(null);
              resetStreamState();
            }}
          />
          {testMode !== "listModels" ? (
            <>
              <Space.Compact block>
                <AutoComplete
                  allowClear
                  open={testModelsOpen && visibleTestModels.length > 0}
                  options={visibleTestModels.map((model) => ({
                    value: model.id,
                    label: model.name === model.id ? model.id : `${model.name} (${model.id})`,
                  }))}
                  value={testModelId}
                  onChange={setTestModelId}
                  onFocus={() => setTestModelsOpen(visibleTestModels.length > 0)}
                  onOpenChange={setTestModelsOpen}
                  onSelect={(value) => {
                    setTestModelId(value);
                    setTestModelsOpen(false);
                  }}
                  filterOption={(input, option) =>
                    String(option?.label ?? option?.value ?? "")
                      .toLowerCase()
                      .includes(input.toLowerCase())
                  }
                  placeholder="同步后选择模型，或手工输入模型 ID"
                />
                <Button loading={testModelsLoading} onClick={() => void loadTestModels()}>
                  同步模型
                </Button>
              </Space.Compact>
              <Input.TextArea
                rows={4}
                value={testInput}
                onChange={(event) => setTestInput(event.target.value)}
                placeholder="测试输入内容"
              />
              {testMode === "chat" ? (
                <Space size={12} wrap>
                  <Space orientation="vertical" size={4}>
                    <Typography.Text type="secondary">最大输出 tokens</Typography.Text>
                    <InputNumber
                      min={16}
                      max={131072}
                      step={512}
                      value={testMaxOutputTokens}
                      onChange={(value) => setTestMaxOutputTokens(Number(value ?? 4096))}
                    />
                  </Space>
                  <Space orientation="vertical" size={4}>
                    <Typography.Text type="secondary">超时 ms</Typography.Text>
                    <InputNumber
                      min={5000}
                      max={3600000}
                      step={5000}
                      value={testTimeoutMs}
                      onChange={(value) =>
                        setTestTimeoutMs(Number(value ?? testProvider?.timeoutMs ?? 300000))
                      }
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
              title={
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
                <Space orientation="vertical" size={8} style={{ width: "100%" }}>
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
              title={`HTTP ${testResult.status} / ${testResult.endpoint}`}
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
