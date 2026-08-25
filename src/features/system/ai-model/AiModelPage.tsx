"use client";

import {
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DollarOutlined,
  DownOutlined,
  ExportOutlined,
  SyncOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AutoComplete,
  Button,
  Checkbox,
  Descriptions,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useRef, useState } from "react";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import { StreamingMarkdown } from "@/components/ai/StreamingMarkdown";
import { AuthButton } from "@/components/auth-button/AuthButton";
import { buildQueryString, request, requestTextStream } from "@/lib/request";
import type { PageResult } from "@/lib/response";
import { useNavigationAdapter } from "@/platform/navigation";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { getOfficialAiPricingSource } from "@/shared/ai-pricing-sources";
import { statusOptions } from "../shared/options";

function AiModelCapabilityField({ form }: { form: import("antd").FormInstance }) {
  const modelType = Form.useWatch("modelType", form) as AiModelRecord["modelType"] | undefined;
  const capabilitiesJson = Form.useWatch("capabilitiesJson", form) as string | null | undefined;
  if (modelType === "embedding") {
    const capabilities = parseCapabilities(capabilitiesJson);
    const dimensions = Number(capabilities.dimensions) || undefined;
    const setDimensions = (value: number | null) => {
      const existing = parseCapabilities(form.getFieldValue("capabilitiesJson"));
      form.setFieldValue(
        "capabilitiesJson",
        JSON.stringify({
          ...existing,
          embedding: true,
          ...(value ? { dimensions: value } : { dimensions: undefined }),
        }),
      );
    };
    return (
      <Space.Compact block>
        <InputNumber
          min={64}
          max={65_536}
          step={64}
          value={dimensions}
          placeholder="向量维度，例如 1024"
          style={{ width: "100%" }}
          onChange={setDimensions}
        />
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [512, 768, 1024, 1536, 2048, 3072].map((value) => ({
              key: String(value),
              label: `${value} 维`,
              onClick: () => setDimensions(value),
            })),
          }}
        >
          <Button icon={<DownOutlined />}>常用维度</Button>
        </Dropdown>
      </Space.Compact>
    );
  }
  if ((modelType || "chat") !== "chat") {
    return (
      <Typography.Text type="secondary">
        {modelType === "image" ? "图片生成" : "重排序"}能力会自动配置
      </Typography.Text>
    );
  }
  return (
    <Checkbox.Group
      options={chatCapabilityOptions}
      value={modelCapabilities("chat", form.getFieldValue("capabilitiesJson")).filter(
        (item) => item !== "chat",
      )}
      onChange={(values) => {
        const existing = parseCapabilities(form.getFieldValue("capabilitiesJson"));
        const custom = Object.fromEntries(
          Object.entries(existing).filter(([key]) => !knownCapabilityKeys.has(key)),
        );
        form.setFieldValue(
          "capabilitiesJson",
          JSON.stringify({
            ...custom,
            chat: true,
            ...Object.fromEntries(values.map(String).map((key) => [key, true])),
          }),
        );
      }}
    />
  );
}

type AiProviderRecord = {
  id: number;
  name: string;
  code: string;
  providerType: string;
  baseUrl?: string | null;
  hasApiKey?: boolean;
  status: number;
  deletedAt?: string | null;
};

type AiModelRecord = {
  id: number;
  providerId: number;
  providerName?: string;
  providerCode?: string;
  providerStatus?: number;
  providerDeletedAt?: string | null;
  name: string;
  modelId: string;
  modelType: "chat" | "embedding" | "image" | "rerank";
  capabilitiesJson?: string | null;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  inputPrice?: string | null;
  cachedInputPrice?: string | null;
  cacheWritePrice?: string | null;
  outputPrice?: string | null;
  currency: string;
  pricingSourceUrl?: string | null;
  pricingVerifiedAt?: string | null;
  pricingSourceType: "manual" | "catalog" | "provider";
  pricingCatalogKey?: string | null;
  pricingSourceHash?: string | null;
  pricingSyncedAt?: string | null;
  isDefaultChat: boolean;
  isDefaultStructured: boolean;
  isDefaultEmbedding: boolean;
  status: number;
  sort: number;
  remark?: string | null;
  isSystem: boolean;
};

type AiTestResult = {
  mode: "listModels" | "chat" | "embedding";
  endpoint: string;
  status: number;
  preview: string;
};

const pricingFieldLabels = {
  inputPrice: "普通输入价格",
  cachedInputPrice: "缓存读取价格",
  cacheWritePrice: "缓存写入价格",
  outputPrice: "输出价格",
  contextWindow: "上下文窗口",
  maxOutputTokens: "最大输出 Token",
} as const;

type PricingField = keyof typeof pricingFieldLabels;

type PricingCatalogCandidate = {
  id: number;
  catalogKey: string;
  modelIdentifier: string;
  providerType?: string | null;
  mode?: string | null;
  inputPrice?: string | null;
  cachedInputPrice?: string | null;
  cacheWritePrice?: string | null;
  outputPrice?: string | null;
  currency: string;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  sourceHash: string;
  fetchedAt: string;
  diff: Record<
    PricingField,
    {
      current: string | number | null;
      suggested: string | number | null;
      changed: boolean;
      available: boolean;
    }
  >;
};

type PricingPreview = {
  model: AiModelRecord;
  catalog: {
    ready: boolean;
    source: { name: string; url: string; homepage: string; trustLevel: "community" };
    snapshot: null | {
      id: number;
      sourceHash: string;
      modelCount: number;
      fetchedAt: string;
    };
  };
  candidates: PricingCatalogCandidate[];
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

const chatCapabilityOptions = [
  { label: "结构化输出", value: "structured" },
  { label: "工具调用 / Agent", value: "toolCalling" },
  { label: "视觉理解", value: "vision" },
  { label: "推理模式", value: "reasoning" },
];
const knownCapabilityKeys = new Set([
  "chat",
  "embedding",
  "image",
  "rerank",
  ...chatCapabilityOptions.map((item) => item.value),
]);

function parseCapabilities(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

type ProviderModelOption = {
  id: string;
  name: string;
  modelType: AiModelRecord["modelType"];
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
};

const contextWindowPresets = [
  { label: "32K", value: 32768 },
  { label: "64K", value: 65536 },
  { label: "128K", value: 128000 },
  { label: "200K", value: 200000 },
  { label: "256K", value: 262144 },
  { label: "1M", value: 1000000 },
  { label: "2M", value: 2000000 },
];

const outputTokenPresets = [
  { label: "4K", value: 4096 },
  { label: "8K", value: 8192 },
  { label: "16K", value: 16384 },
  { label: "32K", value: 32768 },
  { label: "64K", value: 65536 },
  { label: "128K", value: 131072 },
];

function formatTokenLimit(value?: number | null) {
  if (!value) return "";
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return String(value);
}

function ModelLimitInput({
  form,
  field,
  presets,
  min,
  max,
  placeholder,
}: {
  form: import("antd").FormInstance;
  field: "contextWindow" | "maxOutputTokens";
  presets: Array<{ label: string; value: number }>;
  min: number;
  max?: number;
  placeholder: string;
}) {
  const value = Form.useWatch(field, form) as number | null | undefined;
  return (
    <Space.Compact block>
      <InputNumber
        min={min}
        max={max}
        step={1024}
        value={value ?? undefined}
        placeholder={placeholder}
        style={{ width: "100%" }}
        onChange={(nextValue) => form.setFieldValue(field, nextValue)}
      />
      <Dropdown
        trigger={["click"]}
        menu={{
          items: presets.map((preset) => ({
            key: String(preset.value),
            label: `${preset.label} (${preset.value.toLocaleString()})`,
            onClick: () => form.setFieldValue(field, preset.value),
          })),
        }}
      >
        <Button icon={<DownOutlined />}>常用规格</Button>
      </Dropdown>
    </Space.Compact>
  );
}

function PricingSourceField({
  form,
  providers,
}: {
  form: import("antd").FormInstance;
  providers: AiProviderRecord[];
}) {
  const providerId = Form.useWatch("providerId", form) as number | undefined;
  const value = Form.useWatch("pricingSourceUrl", form) as string | null | undefined;
  const provider = providers.find((item) => Number(item.id) === Number(providerId));
  const official = getOfficialAiPricingSource(provider?.providerType);
  const link = value?.trim() || official?.url;

  return (
    <Space.Compact block>
      <Input
        allowClear
        value={value ?? undefined}
        placeholder={official?.url ?? "填写服务商或网关的价格页 URL"}
        onChange={(event) => form.setFieldValue("pricingSourceUrl", event.target.value)}
      />
      <Tooltip title={link ? `打开${official?.name ?? "价格来源"}` : "当前服务商没有内置价格来源"}>
        <Button
          disabled={!link}
          href={link}
          target="_blank"
          rel="noreferrer"
          icon={<ExportOutlined />}
          aria-label="打开价格来源"
        />
      </Tooltip>
    </Space.Compact>
  );
}

function formatModelPrice(value?: string | null) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : value;
}

function formatPricingValue(field: PricingField, value: string | number | null | undefined) {
  if (value == null || value === "") return "未提供";
  if (field === "contextWindow" || field === "maxOutputTokens") {
    return `${Number(value).toLocaleString()} tokens`;
  }
  return `${formatModelPrice(String(value))} USD / 1M`;
}

function AiModelIdField({
  form,
  providers,
  providersLoading,
}: {
  form: import("antd").FormInstance;
  providers: AiProviderRecord[];
  providersLoading: boolean;
}) {
  const providerIdValue = Form.useWatch("providerId", form) as number | string | undefined;
  const providerId = providerIdValue ? Number(providerIdValue) : undefined;
  const modelId = Form.useWatch("modelId", form) as string | undefined;
  const selectedProvider = providers.find((provider) => Number(provider.id) === providerId);
  const [models, setModels] = useState<ProviderModelOption[]>([]);
  const [syncedProviderId, setSyncedProviderId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const synchronizedModels = syncedProviderId === providerId ? models : [];

  const loadModels = async () => {
    if (!providerId) {
      feedback.warning("请先选择 Provider");
      return;
    }
    setLoading(true);
    try {
      const result = await request<{ models: ProviderModelOption[] }>(
        `/api/system/ai/provider/${providerId}/models`,
      );
      setModels(result.models);
      setSyncedProviderId(providerId);
      setOpen(result.models.length > 0);
      if (result.models.length) {
        feedback.success(`已同步 ${result.models.length} 个模型，请从下拉列表选择`);
      } else {
        feedback.info("服务商没有返回可选模型，请直接输入模型 ID");
      }
    } finally {
      setLoading(false);
    }
  };

  const selectModel = (value: string) => {
    form.setFieldValue("modelId", value);
    const model = synchronizedModels.find((item) => item.id === value);
    if (!model) return;
    form.setFieldValue("name", model.name || model.id);
    form.setFieldValue("modelType", model.modelType);
    form.setFieldValue("contextWindow", model.contextWindow ?? null);
    form.setFieldValue("maxOutputTokens", model.maxOutputTokens ?? null);
    setOpen(false);
  };

  return (
    <Space.Compact block>
      <AutoComplete
        allowClear
        open={open && synchronizedModels.length > 0}
        options={synchronizedModels.map((model) => ({
          label: [
            model.name === model.id ? model.id : `${model.name} (${model.id})`,
            model.contextWindow ? `上下文 ${formatTokenLimit(model.contextWindow)}` : "",
            model.maxOutputTokens ? `输出 ${formatTokenLimit(model.maxOutputTokens)}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
          value: model.id,
        }))}
        placeholder="例如 gpt-4.1-mini、deepseek-chat、qwen-plus"
        value={modelId}
        onChange={(value) => form.setFieldValue("modelId", value)}
        onFocus={() => setOpen(synchronizedModels.length > 0)}
        onOpenChange={setOpen}
        onSelect={selectModel}
        filterOption={(input, option) =>
          String(option?.label ?? option?.value ?? "")
            .toLowerCase()
            .includes(input.toLowerCase())
        }
      />
      <Button
        loading={loading || (providersLoading && !selectedProvider)}
        disabled={!providerId || !selectedProvider || selectedProvider.status !== 1}
        onClick={() => void loadModels()}
      >
        {!providerId
          ? "同步模型"
          : !selectedProvider
            ? providersLoading
              ? "加载服务商"
              : "服务商不可用"
            : selectedProvider.status !== 1
              ? "服务商未启用"
              : "同步模型"}
      </Button>
    </Space.Compact>
  );
}

function providerOptionLabel(provider: AiProviderRecord) {
  const identity = [provider.name, provider.providerType, provider.code]
    .filter(Boolean)
    .join(" · ");
  if (provider.deletedAt) return `${identity}（已删除）`;
  return `${identity}${provider.status === 1 ? "" : "（未启用）"}`;
}

function providersForForm(
  providers: AiProviderRecord[],
  initialValues?: Partial<AiModelRecord> | null,
) {
  const providerId = Number(initialValues?.providerId);
  if (!providerId || providers.some((provider) => Number(provider.id) === providerId)) {
    return providers;
  }
  return [
    {
      id: providerId,
      name: String(initialValues?.providerName || `服务商 #${providerId}`),
      code: String(initialValues?.providerCode || ""),
      providerType: "",
      status: initialValues?.providerDeletedAt ? 0 : Number(initialValues?.providerStatus ?? 0),
      deletedAt: initialValues?.providerDeletedAt,
    },
    ...providers,
  ];
}

function modelCapabilities(modelType: AiModelRecord["modelType"], value: unknown) {
  const fixed =
    modelType === "embedding"
      ? ["embedding"]
      : modelType === "image"
        ? ["image"]
        : modelType === "rerank"
          ? ["rerank"]
          : ["chat"];
  const existing = capabilityTags(typeof value === "string" ? value : null);
  return [...new Set([...fixed, ...existing])];
}

function capabilitiesJson(modelType: AiModelRecord["modelType"], value: unknown) {
  const existing = parseCapabilities(value);
  const custom = Object.fromEntries(
    Object.entries(existing).filter(([key]) => !knownCapabilityKeys.has(key)),
  );
  const capabilities = modelType === "chat" ? modelCapabilities(modelType, value) : [modelType];
  return JSON.stringify({
    ...custom,
    ...Object.fromEntries(capabilities.map((key) => [key, true])),
  });
}

function normalizePayload(values: Record<string, unknown>) {
  const payload = { ...values };
  delete payload.providerName;
  delete payload.providerCode;
  delete payload.providerStatus;
  delete payload.isDefaultChat;
  delete payload.isDefaultStructured;
  delete payload.isDefaultEmbedding;
  delete payload.isSystem;
  payload.capabilitiesJson = capabilitiesJson(
    (payload.modelType || "chat") as AiModelRecord["modelType"],
    payload.capabilitiesJson,
  );
  if (!payload.name && payload.modelId) payload.name = payload.modelId;
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
  const navigation = useNavigationAdapter();
  const queryClient = useQueryClient();
  const [testModel, setTestModel] = useState<AiModelRecord | null>(null);
  const [testInput, setTestInput] = useState("请用一句话回复 OK。");
  const [testMaxOutputTokens, setTestMaxOutputTokens] = useState(4096);
  const [testTimeoutMs, setTestTimeoutMs] = useState(60000);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);
  const [streamContent, setStreamContent] = useState("");
  const [streamEndpoint, setStreamEndpoint] = useState("");
  const [streamStatus, setStreamStatus] = useState<number | null>(null);
  const [streamError, setStreamError] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [pricingModel, setPricingModel] = useState<AiModelRecord | null>(null);
  const [pricingCandidateId, setPricingCandidateId] = useState<number | null>(null);
  const [pricingFields, setPricingFields] = useState<PricingField[] | null>(null);
  const streamControllerRef = useRef<AbortController | null>(null);
  const providerQuery = useQuery({
    queryKey: ["system-ai-provider-options"],
    queryFn: async () => {
      const page = await request<PageResult<AiProviderRecord>>(
        `/api/system/ai/provider${buildQueryString({ page: 1, pageSize: 200 })}`,
      );
      return page.data;
    },
    refetchOnMount: "always",
  });
  const providerOptions = (providerQuery.data ?? []).map((provider) => ({
    label: providerOptionLabel(provider),
    value: Number(provider.id),
  }));
  const activeProviderCount = (providerQuery.data ?? []).filter(
    (provider) => provider.status === 1,
  ).length;
  const pricingPreviewQuery = useQuery({
    queryKey: ["system-ai-model-pricing-preview", pricingModel?.id],
    queryFn: () =>
      request<PricingPreview>(`/api/system/ai/model/${pricingModel?.id}/pricing/preview`),
    enabled: Boolean(pricingModel),
  });
  const pricingCandidates = pricingPreviewQuery.data?.candidates ?? [];
  const pricingCandidate =
    pricingCandidates.find((item) => item.id === pricingCandidateId) ?? pricingCandidates[0] ?? null;
  const selectedPricingFields =
    pricingFields ??
    (pricingCandidate
      ? (Object.keys(pricingFieldLabels) as PricingField[]).filter(
        (field) => pricingCandidate.diff[field].available && pricingCandidate.diff[field].changed,
      )
      : []);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-data-table", "/api/system/ai/model"] });
    void queryClient.invalidateQueries({ queryKey: ["system-ai-setup-summary"] });
    void queryClient.invalidateQueries({ queryKey: ["system-settings", "ai-model"] });
    void queryClient.invalidateQueries({ queryKey: ["system-ai-playground-options"] });
    void queryClient.invalidateQueries({ queryKey: ["system-ai-playground-runtime"] });
    void queryClient.invalidateQueries({ queryKey: ["system-ai-chat-options"] });
    void queryClient.invalidateQueries({ queryKey: ["system-ai-chat-runtime"] });
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
    mutationFn: ({ id, input }: { id: number; input: string }) =>
      request("/api/system/ai/model/test", {
        method: "POST",
        body: { id, input },
      }),
    onSuccess: (result) => {
      setTestResult(result as AiTestResult);
      feedback.success("模型调用正常");
    },
  });

  const refreshPricingMutation = useMutation({
    mutationFn: () =>
      request<{ changed: boolean; modelCount: number }>("/api/system/ai/pricing/catalog/refresh", {
        method: "POST",
      }),
    onSuccess: (result) => {
      feedback.success(
        result.changed
          ? `价格目录已刷新，共 ${result.modelCount} 个模型`
          : "价格目录已是最新版本",
      );
      void pricingPreviewQuery.refetch();
    },
  });

  const applyPricingMutation = useMutation({
    mutationFn: () => {
      if (!pricingModel || !pricingCandidate) throw new Error("请选择价格候选");
      return request(`/api/system/ai/model/${pricingModel.id}/pricing/apply`, {
        method: "PUT",
        body: { catalogItemId: pricingCandidate.id, fields: selectedPricingFields },
      });
    },
    onSuccess: () => {
      feedback.success("目录候选值已应用");
      setPricingModel(null);
      setPricingCandidateId(null);
      invalidate();
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
    if (!testModel) return;
    if (!testInput.trim()) {
      feedback.warning("请输入测试内容");
      return;
    }
    if (testModel.modelType !== "chat") {
      feedback.warning("只有 Chat 模型支持流式测试");
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
      await requestTextStream("/api/system/ai/model/test/stream", {
        method: "POST",
        body: {
          id: testModel.id,
          input: testInput.trim(),
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

  const columns: AdminDataTableColumn<AiModelRecord>[] = [
    {
      title: "ID",
      dataIndex: "id",
      hideInForm: true,
      hideInSearch: true,
      width: 72,
      fixed: "left",
    },
    {
      title: "服务商连接",
      dataIndex: "providerId",
      valueType: "select",
      options: providerOptions,
      required: true,
      width: 180,
      fixed: "left",
      formHelp:
        "选择模型归属的连接实例。选项同时显示连接名称、服务商类型和内部编码，便于区分同一服务商的多个账号或环境。",
      renderFormField: ({ form, initialValues }) => {
        const options = providersForForm(providerQuery.data ?? [], initialValues).map(
          (provider) => ({
            label: providerOptionLabel(provider),
            value: Number(provider.id),
          }),
        );
        return (
          <Select
            showSearch
            loading={providerQuery.isFetching}
            options={options}
            optionFilterProp="label"
            placeholder="选择服务商连接"
            onChange={(value) => {
              const provider = providerQuery.data?.find(
                (item) => Number(item.id) === Number(value),
              );
              form.setFieldValue("providerId", Number(value));
              form.setFieldsValue({
                modelId: undefined,
                name: undefined,
                contextWindow: undefined,
                maxOutputTokens: undefined,
                pricingSourceUrl: getOfficialAiPricingSource(provider?.providerType)?.url,
                pricingVerifiedAt: undefined,
              });
            }}
          />
        );
      },
      render: (_, record) => (
        <Space size={6} wrap>
          <Typography.Text strong>{record.providerName || record.providerId}</Typography.Text>
          {record.providerCode ? <Tag color="blue">{record.providerCode}</Tag> : null}
          {record.providerDeletedAt ? (
            <Tag color="error">已删除，请重新绑定</Tag>
          ) : record.providerStatus === 1 ? (
            <Tag color="success">启用</Tag>
          ) : (
            <Tag>停用</Tag>
          )}
        </Space>
      ),
    },
    {
      title: "显示名称",
      dataIndex: "name",
      required: false,
      width: 220,
      formSection: "advanced",
      formHelp: "可选。留空时自动使用模型 ID 作为显示名称。",
      fieldProps: { placeholder: "可选，例如 GPT-4.1 Mini" },
      render: (value, record) => (
        <Space size={6} wrap>
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
      formHelp:
        "服务商调用模型时使用的准确标识。点击“同步模型”后会自动展开可选列表；接口不支持模型列表时也可以直接输入。",
      renderFormField: ({ form, initialValues }) => (
        <AiModelIdField
          form={form}
          providers={providersForForm(providerQuery.data ?? [], initialValues)}
          providersLoading={providerQuery.isFetching}
        />
      ),
    },
    {
      title: "类型",
      dataIndex: "modelType",
      valueType: "select",
      options: modelTypeOptions,
      required: true,
      width: 120,
      fieldProps: { placeholder: "选择模型用途" },
      render: (value) => <Tag>{String(value || "chat")}</Tag>,
    },
    {
      title: "附加能力",
      dataIndex: "capabilitiesJson",
      hideInSearch: true,
      width: 220,
      formSection: "advanced",
      formHelp:
        "Chat 模型在这里声明结构化输出、Agent 工具调用、图片理解或推理能力；Embedding 模型在这里填写服务商要求的向量维度，例如 text-embedding-v4 使用 1024。",
      renderFormField: ({ form }) => <AiModelCapabilityField form={form} />,
      render: (value) => {
        const parsed = parseCapabilities(value);
        const tags = capabilityTags(value ? String(value) : "").filter(
          (tag) => tag !== "dimensions",
        );
        return tags.length || Number(parsed.dimensions) > 0 ? (
          <Space wrap size={4}>
            {tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
            {Number(parsed.dimensions) > 0 ? <Tag>{Number(parsed.dimensions)} 维</Tag> : null}
          </Space>
        ) : (
          <Typography.Text type="secondary">未配置</Typography.Text>
        );
      },
    },
    {
      title: "上下文窗口",
      dataIndex: "contextWindow",
      valueType: "digit",
      hideInSearch: true,
      width: 120,
      formSection: "advanced",
      formHelp:
        "一次请求可容纳的总 Token 数，包括 System Prompt、历史消息、当前输入和模型输出。1M 上下文模型填写 1000000；AI Chat 会据此自动裁剪或压缩历史。该值不是单次回答长度。",
      renderFormField: ({ form }) => (
        <ModelLimitInput
          form={form}
          field="contextWindow"
          presets={contextWindowPresets}
          min={4096}
          placeholder="例如 128000 或 1000000"
        />
      ),
    },
    {
      title: "最大输出",
      dataIndex: "maxOutputTokens",
      valueType: "digit",
      hideInSearch: true,
      width: 110,
      formSection: "advanced",
      formHelp:
        "单次回答最多可生成的 Token 数，与上下文窗口不同。请填写服务商公布的输出上限；正式 AI Chat 按此值运行，留空时使用 16384，并保留 131072 的系统安全上限。",
      renderFormField: ({ form }) => (
        <ModelLimitInput
          form={form}
          field="maxOutputTokens"
          presets={outputTokenPresets}
          min={16}
          max={131072}
          placeholder="可选，例如 16384"
        />
      ),
    },
    {
      title: "价格 / 1M tokens",
      dataIndex: "inputPrice",
      hideInSearch: true,
      width: 280,
      formSection: "advanced",
      formHelp:
        "每 100 万非缓存输入 Token 的价格。价格只用于费用账本估算，不影响模型调用；实际费用以服务商账单为准。",
      fieldProps: { placeholder: "普通输入，例如 2.5" },
      render: (_, record) => {
        const hasPrice = [
          record.inputPrice,
          record.cachedInputPrice,
          record.cacheWritePrice,
          record.outputPrice,
        ].some((value) => value != null && value !== "");
        return (
          <Space orientation="vertical" size={2}>
            {hasPrice ? (
              <Typography.Text>
                输入 {formatModelPrice(record.inputPrice)} · 缓存读{" "}
                {formatModelPrice(record.cachedInputPrice)} · 输出{" "}
                {formatModelPrice(record.outputPrice)} {record.currency || "USD"}
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary">未配置</Typography.Text>
            )}
            {record.cacheWritePrice ? (
              <Typography.Text type="secondary">
                缓存写 {formatModelPrice(record.cacheWritePrice)} {record.currency || "USD"}
              </Typography.Text>
            ) : null}
            {record.pricingSourceUrl ? (
              <Typography.Link href={record.pricingSourceUrl} target="_blank" rel="noreferrer">
                价格来源{record.pricingVerifiedAt ? ` · 核验于 ${record.pricingVerifiedAt}` : ""}
              </Typography.Link>
            ) : null}
            {record.pricingSourceType === "catalog" ? (
              <Typography.Text type="secondary">
                <Tag color="blue">目录同步</Tag>
                {record.pricingCatalogKey}
              </Typography.Text>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: "缓存读取价格",
      dataIndex: "cachedInputPrice",
      hideInSearch: true,
      hideInTable: true,
      formSection: "advanced",
      formHelp:
        "每 100 万缓存读取 Token 的价格。留空时账本回退使用普通输入价，避免把缓存命中错误地计为免费。",
      fieldProps: { placeholder: "缓存读取，例如 0.25" },
    },
    {
      title: "缓存写入价格",
      dataIndex: "cacheWritePrice",
      hideInSearch: true,
      hideInTable: true,
      formSection: "advanced",
      formHelp:
        "每 100 万缓存写入 Token 的价格，主要用于 Anthropic 等显式收取缓存创建费用的服务。留空时使用普通输入价估算。",
      fieldProps: { placeholder: "可选，例如 3.125" },
    },
    {
      title: "输出价格",
      dataIndex: "outputPrice",
      hideInSearch: true,
      hideInTable: true,
      formSection: "advanced",
      formHelp:
        "每 100 万输出 Token 的价格，仅用于成本估算，不参与模型调用。不需要成本核算时留空。",
    },
    {
      title: "币种",
      dataIndex: "currency",
      hideInSearch: true,
      width: 88,
      formSection: "advanced",
      fieldProps: { placeholder: "USD" },
    },
    {
      title: "价格来源",
      dataIndex: "pricingSourceUrl",
      hideInSearch: true,
      hideInTable: true,
      fullWidth: true,
      formSection: "advanced",
      formHelp:
        "常见官方 Provider 会自动带出官方价格页；兼容网关应填写网关自己的价格页。/models 通常不返回价格，因此系统不把模型同步结果当作价格真值。",
      renderFormField: ({ form, initialValues }) => (
        <PricingSourceField
          form={form}
          providers={providersForForm(providerQuery.data ?? [], initialValues)}
        />
      ),
    },
    {
      title: "价格核验日期",
      dataIndex: "pricingVerifiedAt",
      hideInSearch: true,
      hideInTable: true,
      formSection: "advanced",
      fieldProps: { placeholder: "YYYY-MM-DD" },
      formHelp: "记录管理员最后一次对照价格来源的日期。系统不会声称网页价格已经自动同步。",
      formItemProps: {
        rules: [
          {
            pattern: /^\d{4}-\d{2}-\d{2}$/,
            message: "请输入 YYYY-MM-DD 格式日期",
          },
        ],
      },
    },
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
      formSection: "advanced",
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
    {
      title: "排序",
      dataIndex: "sort",
      valueType: "digit",
      hideInSearch: true,
      width: 88,
      formSection: "advanced",
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
    <PageScaffold
      title="模型管理"
      description="同步并登记服务商连接下可调用的模型，配置用途、能力与运行限制"
      hideHeader
    >
      <AdminDataTable
        api="/api/system/ai/model"
        accessName="system.aiModel"
        rowKey="id"
        columns={columns}
        toolbarTitle="模型列表"
        quickFilters={[
          { key: "all", label: "全部", count: undefined, values: {} },
          { key: "enabled", label: "已启用", values: { status: 1 } },
          { key: "disabled", label: "已停用", values: { status: 0 } },
          { key: "chat", label: "Chat", values: { modelType: "chat" } },
          { key: "embedding", label: "Embedding", values: { modelType: "embedding" } },
        ]}
        createTitle="添加模型"
        updateTitle="编辑模型"
        formBasicColumns={1}
        formNotice={
          <Alert
            showIcon
            type={activeProviderCount ? "info" : "warning"}
            title={
              activeProviderCount
                ? "先选择服务商连接，再同步或填写模型 ID"
                : "当前没有已启用的服务商连接"
            }
            description={
              activeProviderCount
                ? "服务商连接保存 Base URL 和 API Key；模型管理登记该连接下具体可调用的模型。同步后会立即展开模型列表。"
                : "可以选择未启用模板预先登记模型，但测试和业务调用前必须先配置 API Key 并启用 Provider。"
            }
            action={
              <Button size="small" onClick={() => navigation.push("/system/ai/provider")}>
                配置 Provider
              </Button>
            }
          />
        }
        actionColumnWidth={248}
        canDelete={(record) =>
          !record.isSystem &&
          !record.isDefaultChat &&
          !record.isDefaultStructured &&
          !record.isDefaultEmbedding
        }
        deleteDisabledReason={(record) =>
          record.isSystem
            ? "系统内置模型不能删除，可以停用"
            : record.isDefaultChat || record.isDefaultStructured || record.isDefaultEmbedding
              ? "默认模型不能删除，请先切换对应用途的默认模型"
              : undefined
        }
        beforeSubmit={normalizePayload}
        createInitialValues={{
          modelType: "chat",
          capabilitiesJson: '{"chat":true}',
          currency: "USD",
          status: 1,
          sort: 0,
        }}
        onDataChanged={invalidate}
        actionBarRender={() => (
          <Button onClick={() => navigation.push("/system/ai/provider")}>管理服务商连接</Button>
        )}
        operateRender={(record) => (
          <>
            <Tooltip title="从价格目录获取候选值">
              <AuthButton
                auth="system.aiModel.syncPricing"
              >
                <Button
                  size="small"
                  icon={<DollarOutlined />}
                  onClick={() => {
                    setPricingCandidateId(null);
                    setPricingFields(null);
                    setPricingModel(record);
                  }}
                />
              </AuthButton>
            </Tooltip>
            <Tooltip title="测试模型调用">
              <Button
                size="small"
                icon={<ApiOutlined />}
                loading={testMutation.isPending && testModel?.id === record.id}
                onClick={() => {
                  setTestModel(record);
                  setTestInput(
                    record.modelType === "embedding"
                      ? "Admin Base AI embedding test"
                      : "请用一句话回复 OK。",
                  );
                  setTestMaxOutputTokens(record.maxOutputTokens ?? 4096);
                  setTestTimeoutMs(60000);
                  setTestResult(null);
                  resetStreamState();
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
      <Modal
        title={pricingModel ? `获取定价 · ${pricingModel.name}` : "获取定价"}
        open={Boolean(pricingModel)}
        width={860}
        okText="应用选中字段"
        cancelText="关闭"
        confirmLoading={applyPricingMutation.isPending}
        okButtonProps={{ disabled: !pricingCandidate || selectedPricingFields.length === 0 }}
        onOk={() => void applyPricingMutation.mutateAsync()}
        onCancel={() => {
          setPricingModel(null);
          setPricingCandidateId(null);
          setPricingFields(null);
        }}
      >
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            showIcon
            type="warning"
            title="目录价格是社区维护的候选值"
            description="应用前请核对服务商官方价格页。目录刷新和应用都不会填写“价格核验日期”，实际结算仍以服务商账单为准。"
            action={
              <AuthButton
                auth="system.aiModel.syncPricing"
              >
                <Button
                  icon={<SyncOutlined />}
                  loading={refreshPricingMutation.isPending}
                  onClick={() => void refreshPricingMutation.mutateAsync()}
                >
                  刷新目录
                </Button>
              </AuthButton>
            }
          />
          {pricingPreviewQuery.isLoading ? (
            <Alert showIcon type="info" title="正在读取价格目录" />
          ) : !pricingPreviewQuery.data?.catalog.ready ? (
            <Empty description="价格目录尚未初始化，请先刷新目录" />
          ) : !pricingCandidate ? (
            <Empty description="最新目录中没有与当前 Provider 和模型 ID 确定匹配的候选" />
          ) : (
            <>
              <Descriptions size="small" column={2} bordered>
                <Descriptions.Item label="当前模型">{pricingModel?.modelId}</Descriptions.Item>
                <Descriptions.Item label="目录候选">
                  <Select
                    value={pricingCandidate.id}
                    style={{ width: "100%" }}
                    options={pricingCandidates.map((item) => ({
                      value: item.id,
                      label: `${item.catalogKey}${item.providerType ? ` · ${item.providerType}` : ""}`,
                    }))}
                    onChange={(value) => {
                      setPricingCandidateId(value);
                      setPricingFields(null);
                    }}
                  />
                </Descriptions.Item>
                <Descriptions.Item label="目录模型数">
                  {pricingPreviewQuery.data.catalog.snapshot?.modelCount.toLocaleString()}
                </Descriptions.Item>
                <Descriptions.Item label="目录时间">
                  {pricingPreviewQuery.data.catalog.snapshot?.fetchedAt
                    ? new Date(pricingPreviewQuery.data.catalog.snapshot.fetchedAt).toLocaleString()
                    : "-"}
                </Descriptions.Item>
                <Descriptions.Item label="来源版本" span={2}>
                  <Typography.Text code>
                    {pricingPreviewQuery.data.catalog.snapshot?.sourceHash.slice(0, 16)}
                  </Typography.Text>
                  <Typography.Link
                    href={pricingPreviewQuery.data.catalog.source.homepage}
                    target="_blank"
                    rel="noreferrer"
                    style={{ marginInlineStart: 8 }}
                  >
                    LiteLLM
                  </Typography.Link>
                </Descriptions.Item>
              </Descriptions>
              <Table
                size="small"
                pagination={false}
                rowKey="field"
                dataSource={(Object.keys(pricingFieldLabels) as PricingField[]).map((field) => ({
                  field,
                  label: pricingFieldLabels[field],
                  ...pricingCandidate.diff[field],
                }))}
                columns={[
                  { title: "字段", dataIndex: "label", width: 150 },
                  {
                    title: "当前生效值",
                    dataIndex: "current",
                    render: (value, row) => formatPricingValue(row.field, value),
                  },
                  {
                    title: "目录候选值",
                    dataIndex: "suggested",
                    render: (value, row) =>
                      row.available ? (
                        formatPricingValue(row.field, value)
                      ) : (
                        <Typography.Text type="secondary">未提供</Typography.Text>
                      ),
                  },
                  {
                    title: "变化",
                    dataIndex: "changed",
                    width: 88,
                    render: (changed, row) =>
                      row.available ? (
                        <Tag color={changed ? "gold" : "default"}>
                          {changed ? "有变化" : "相同"}
                        </Tag>
                      ) : (
                        "-"
                      ),
                  },
                ]}
              />
              <Checkbox.Group
                value={selectedPricingFields}
                options={(Object.keys(pricingFieldLabels) as PricingField[]).map((field) => ({
                  label: pricingFieldLabels[field],
                  value: field,
                  disabled: !pricingCandidate.diff[field].available,
                }))}
                onChange={(values) => setPricingFields(values as PricingField[])}
              />
            </>
          )}
        </Space>
      </Modal>
      <Modal
        title="测试 AI 模型"
        open={Boolean(testModel)}
        width={760}
        okText={testModel?.modelType === "chat" ? "开始流式测试" : "开始测试"}
        cancelText="关闭"
        confirmLoading={testMutation.isPending || isStreaming}
        okButtonProps={{ disabled: isStreaming }}
        onOk={() => {
          if (!testModel) return;
          if (!testInput.trim()) {
            feedback.warning("请输入测试内容");
            return;
          }
          if (testModel.modelType === "chat") {
            void runStreamTest();
            return;
          }
          void testMutation.mutateAsync({ id: testModel.id, input: testInput.trim() });
        }}
        onCancel={() => {
          resetStreamState();
          setTestModel(null);
          setTestResult(null);
        }}
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          {testModel ? (
            <Alert
              showIcon
              type="info"
              title={`${testModel.name} / ${testModel.modelId}`}
              description={`${testModel.providerName ?? testModel.providerId} / ${testModel.modelType}`}
            />
          ) : null}
          <Input.TextArea
            rows={5}
            value={testInput}
            onChange={(event) => setTestInput(event.target.value)}
            placeholder={
              testModel?.modelType === "embedding" ? "输入要向量化的文本" : "输入测试 prompt"
            }
          />
          {testModel?.modelType === "chat" ? (
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
                  max={300000}
                  step={5000}
                  value={testTimeoutMs}
                  onChange={(value) => setTestTimeoutMs(Number(value ?? 60000))}
                />
              </Space>
            </Space>
          ) : null}
          {testModel?.modelType === "chat" && (isStreaming || streamContent || streamError) ? (
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
