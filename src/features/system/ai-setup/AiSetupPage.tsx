"use client";

import {
  ApiOutlined,
  CheckCircleOutlined,
  ExperimentOutlined,
  PlusOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Result,
  Select,
  Space,
  Steps,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import { useMemo, useState } from "react";
import { AuthButton } from "@/components/auth-button/AuthButton";
import { request } from "@/lib/request";
import { useNavigationAdapter } from "@/platform/navigation";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";

type ProviderType =
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "qwen"
  | "moonshot"
  | "zhipu"
  | "siliconflow"
  | "openrouter"
  | "ollama"
  | "openai-compatible"
  | "custom";

type ProviderFormValues = {
  providerType: ProviderType;
  name: string;
  baseUrl: string;
  apiKey?: string;
  organization?: string;
  project?: string;
  timeoutMinutes: number;
};

type SetupModel = {
  modelId: string;
  name: string;
  modelType: "chat" | "embedding" | "image" | "rerank";
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  toolCalling: boolean;
  source: "provider" | "manual";
};

type SetupSummary = {
  providerCount: number;
  activeProviderCount: number;
  modelCount: number;
  activeModelCount: number;
  defaults: {
    chat: DefaultModelSummary | null;
    structured: DefaultModelSummary | null;
    embedding: DefaultModelSummary | null;
  };
};

type DefaultModelSummary = {
  name: string;
  modelId: string;
  providerName: string;
};

type SetupResult = {
  providerId: number;
  providerCode: string;
  importedModels: Array<{ id: number; modelId: string }>;
};

const providerOptions: Array<{ label: string; value: ProviderType }> = [
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

const providerBaseUrls: Record<ProviderType, string> = {
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
  "openai-compatible": "https://api.example.com/v1",
  custom: "https://gateway.example.com/v1",
};

const modelTypeLabels: Record<SetupModel["modelType"], string> = {
  chat: "Chat",
  embedding: "Embedding",
  image: "Image",
  rerank: "Rerank",
};

function formatTokenLimit(value?: number | null) {
  if (!value) return "未知";
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return String(value);
}

function providerPayload(values: ProviderFormValues) {
  return {
    name: values.name.trim(),
    providerType: values.providerType,
    baseUrl: values.baseUrl.trim(),
    apiKey: values.apiKey?.trim() || null,
    organization: values.organization?.trim() || null,
    project: values.project?.trim() || null,
    timeoutMs: Math.round(values.timeoutMinutes * 60_000),
  };
}

function DefaultModelLine({ label, model }: { label: string; model: DefaultModelSummary | null }) {
  return (
    <div className="ai-setup-default-line">
      <span>{label}</span>
      {model ? (
        <span>
          <Typography.Text strong>{model.name}</Typography.Text>
          <Typography.Text type="secondary"> · {model.providerName}</Typography.Text>
        </span>
      ) : (
        <Tag>未配置</Tag>
      )}
    </div>
  );
}

export function AiSetupPage() {
  const navigation = useNavigationAdapter();
  const queryClient = useQueryClient();
  const [providerForm] = Form.useForm<ProviderFormValues>();
  const providerType = Form.useWatch("providerType", providerForm);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [providerDraft, setProviderDraft] = useState<ProviderFormValues | null>(null);
  const [models, setModels] = useState<SetupModel[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [modelKeyword, setModelKeyword] = useState("");
  const [manualModelId, setManualModelId] = useState("");
  const [manualModelType, setManualModelType] = useState<SetupModel["modelType"]>("chat");
  const [defaultChat, setDefaultChat] = useState<string>();
  const [defaultStructured, setDefaultStructured] = useState<string>();
  const [defaultEmbedding, setDefaultEmbedding] = useState<string>();
  const [makeDefaultProvider, setMakeDefaultProvider] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completed, setCompleted] = useState<SetupResult | null>(null);

  const summaryQuery = useQuery({
    queryKey: ["system-ai-setup-summary"],
    queryFn: () => request<SetupSummary>("/api/system/ai/setup/summary"),
  });

  const selectedModels = models.filter((model) => selectedModelIds.includes(model.modelId));
  const chatModels = selectedModels.filter((model) => model.modelType === "chat");
  const embeddingModels = selectedModels.filter((model) => model.modelType === "embedding");
  const filteredModels = useMemo(() => {
    const keyword = modelKeyword.trim().toLowerCase();
    if (!keyword) return models;
    return models.filter((model) =>
      `${model.name} ${model.modelId} ${model.modelType}`.toLowerCase().includes(keyword),
    );
  }, [modelKeyword, models]);

  const resetWizard = () => {
    setStep(0);
    setProviderDraft(null);
    setModels([]);
    setSelectedModelIds([]);
    setModelKeyword("");
    setManualModelId("");
    setManualModelType("chat");
    setDefaultChat(undefined);
    setDefaultStructured(undefined);
    setDefaultEmbedding(undefined);
    setMakeDefaultProvider(true);
    setCompleted(null);
    providerForm.resetFields();
    providerForm.setFieldsValue({
      providerType: "openai",
      name: "OpenAI",
      baseUrl: providerBaseUrls.openai,
      timeoutMinutes: 5,
    });
  };

  const openWizard = () => {
    resetWizard();
    setOpen(true);
  };

  const readProviderDraft = async () => {
    const values = await providerForm.validateFields();
    setProviderDraft(values);
    return values;
  };

  const discoverModels = async () => {
    const values = await readProviderDraft();
    setDiscovering(true);
    try {
      const result = await request<{
        endpoint: string;
        models: Array<Omit<SetupModel, "modelId" | "source"> & { id: string }>;
      }>("/api/system/ai/setup/discover", {
        method: "POST",
        body: { provider: providerPayload(values) },
      });
      const nextModels = result.models.map((model) => ({
        modelId: model.id,
        name: model.name || model.id,
        modelType: model.modelType,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
        toolCalling: false,
        source: "provider" as const,
      }));
      setModels(nextModels);
      setSelectedModelIds([]);
      setStep(1);
      if (!nextModels.length) feedback.info("连接正常，但服务商没有返回模型，请手工添加模型 ID");
    } finally {
      setDiscovering(false);
    }
  };

  const skipDiscovery = async () => {
    await readProviderDraft();
    setModels([]);
    setSelectedModelIds([]);
    setStep(1);
  };

  const addManualModel = () => {
    const modelId = manualModelId.trim();
    if (!modelId) {
      feedback.warning("请输入模型 ID");
      return;
    }
    if (models.some((model) => model.modelId === modelId)) {
      feedback.warning("该模型已在列表中");
      return;
    }
    setModels((current) => [
      ...current,
      {
        modelId,
        name: modelId,
        modelType: manualModelType,
        contextWindow: null,
        maxOutputTokens: null,
        toolCalling: false,
        source: "manual",
      },
    ]);
    setSelectedModelIds((current) => [...current, modelId]);
    setManualModelId("");
  };

  const confirmModels = () => {
    if (!selectedModels.length) {
      feedback.warning("至少选择一个要导入的模型");
      return;
    }
    const firstChat = chatModels[0]?.modelId;
    const firstEmbedding = embeddingModels[0]?.modelId;
    setDefaultChat((current) =>
      current && chatModels.some((model) => model.modelId === current) ? current : firstChat,
    );
    setDefaultStructured((current) =>
      current && chatModels.some((model) => model.modelId === current) ? current : firstChat,
    );
    setDefaultEmbedding((current) =>
      current && embeddingModels.some((model) => model.modelId === current)
        ? current
        : firstEmbedding,
    );
    setStep(2);
  };

  const completeSetup = async () => {
    if (!providerDraft) return;
    setCompleting(true);
    try {
      const result = await request<SetupResult>("/api/system/ai/setup/complete", {
        method: "POST",
        body: {
          provider: providerPayload(providerDraft),
          models: selectedModels.map((model) => ({
            modelId: model.modelId,
            name: model.name,
            modelType: model.modelType,
            contextWindow: model.contextWindow,
            maxOutputTokens: model.maxOutputTokens,
            toolCalling: model.toolCalling,
          })),
          defaults: {
            chat: defaultChat || null,
            structured: defaultStructured || null,
            embedding: defaultEmbedding || null,
          },
          makeDefaultProvider,
        },
      });
      setCompleted(result);
      setStep(4);
      await queryClient.invalidateQueries({ queryKey: ["system-ai-setup-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["system-ai-provider-options"] });
      await queryClient.invalidateQueries({
        queryKey: ["admin-data-table", "/api/system/ai/provider"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["admin-data-table", "/api/system/ai/model"],
      });
      await queryClient.invalidateQueries({ queryKey: ["system-settings", "ai-provider"] });
      await queryClient.invalidateQueries({ queryKey: ["system-settings", "ai-model"] });
      await queryClient.invalidateQueries({ queryKey: ["system-ai-playground-options"] });
      await queryClient.invalidateQueries({ queryKey: ["system-ai-playground-runtime"] });
      await queryClient.invalidateQueries({ queryKey: ["system-ai-chat-options"] });
      await queryClient.invalidateQueries({ queryKey: ["system-ai-chat-runtime"] });
      feedback.success("AI 服务接入完成");
    } finally {
      setCompleting(false);
    }
  };

  const closeWizard = () => {
    if (discovering || completing) return;
    setOpen(false);
  };

  const footer = (() => {
    if (step === 0) {
      return (
        <Space>
          <Button onClick={closeWizard}>取消</Button>
          <Button onClick={() => void skipDiscovery()}>手工配置模型</Button>
          <Button type="primary" loading={discovering} onClick={() => void discoverModels()}>
            测试并同步模型
          </Button>
        </Space>
      );
    }
    if (step === 1) {
      return (
        <Space>
          <Button onClick={() => setStep(0)}>上一步</Button>
          <Button type="primary" onClick={confirmModels}>
            下一步
          </Button>
        </Space>
      );
    }
    if (step === 2) {
      return (
        <Space>
          <Button onClick={() => setStep(1)}>上一步</Button>
          <Button type="primary" onClick={() => setStep(3)}>
            检查配置
          </Button>
        </Space>
      );
    }
    if (step === 3) {
      return (
        <Space>
          <Button onClick={() => setStep(2)}>上一步</Button>
          <Button type="primary" loading={completing} onClick={() => void completeSetup()}>
            完成接入
          </Button>
        </Space>
      );
    }
    return (
      <Button type="primary" onClick={closeWizard}>
        关闭
      </Button>
    );
  })();

  const summary = summaryQuery.data;
  return (
    <PageScaffold
      title="AI 接入"
      description="快速完成服务商连接、模型导入和默认用途配置；高级参数仍可在独立管理页面维护"
      actions={
        <Space wrap>
          <Button icon={<SettingOutlined />} onClick={() => navigation.push("/system/ai/provider")}>
            服务商连接
          </Button>
          <Button icon={<ApiOutlined />} onClick={() => navigation.push("/system/ai/model")}>
            模型管理
          </Button>
          <AuthButton auth="system.aiSetup.configure">
            <Button type="primary" icon={<PlusOutlined />} onClick={openWizard}>
              接入 AI 服务
            </Button>
          </AuthButton>
        </Space>
      }
    >
      <div className="ai-setup-workspace">
        {summaryQuery.isError ? (
          <Alert
            showIcon
            type="error"
            title="AI 配置状态读取失败"
            action={<Button onClick={() => void summaryQuery.refetch()}>重试</Button>}
          />
        ) : null}
        {!summaryQuery.isLoading && summary && !summary.defaults.chat ? (
          <Alert
            showIcon
            type="warning"
            title="尚未配置默认 Chat 模型"
            description="完成一次 AI 接入后，AI Chat、Agent 和业务能力才能使用默认模型。"
          />
        ) : null}

        <section className="ai-setup-summary" aria-label="AI 接入状态">
          <div className="ai-setup-metric">
            <Typography.Text type="secondary">可用连接</Typography.Text>
            <strong>{summaryQuery.isLoading ? "-" : (summary?.activeProviderCount ?? 0)}</strong>
            <Typography.Text type="secondary">
              共 {summaryQuery.isLoading ? "-" : (summary?.providerCount ?? 0)} 个
            </Typography.Text>
          </div>
          <div className="ai-setup-metric">
            <Typography.Text type="secondary">可用模型</Typography.Text>
            <strong>{summaryQuery.isLoading ? "-" : (summary?.activeModelCount ?? 0)}</strong>
            <Typography.Text type="secondary">
              共 {summaryQuery.isLoading ? "-" : (summary?.modelCount ?? 0)} 个
            </Typography.Text>
          </div>
          <div className="ai-setup-defaults">
            <Typography.Title level={5}>当前默认模型</Typography.Title>
            <DefaultModelLine label="Chat" model={summary?.defaults.chat ?? null} />
            <DefaultModelLine label="结构化输出" model={summary?.defaults.structured ?? null} />
            <DefaultModelLine label="Embedding" model={summary?.defaults.embedding ?? null} />
          </div>
        </section>

        <section className="ai-setup-flow" aria-label="标准接入流程">
          <div>
            <Typography.Title level={4}>标准接入流程</Typography.Title>
            <Typography.Text type="secondary">
              向导只展示完成调用所需的核心字段，连接超时、Organization 和 Project 位于高级设置。
            </Typography.Text>
          </div>
          <Steps
            responsive
            items={[
              { title: "选择服务商", description: "填写连接和凭据" },
              { title: "同步模型", description: "批量选择模型" },
              { title: "设置默认", description: "指定业务用途" },
              { title: "开始使用", description: "进入 Chat 或 Agent" },
            ]}
          />
          <Space wrap>
            <AuthButton auth="system.aiSetup.configure">
              <Button type="primary" icon={<PlusOutlined />} onClick={openWizard}>
                开始接入
              </Button>
            </AuthButton>
            <Button
              icon={<ExperimentOutlined />}
              disabled={!summary?.defaults.chat}
              onClick={() => navigation.push("/system/ai/playground")}
            >
              打开 Playground
            </Button>
          </Space>
        </section>
      </div>

      <Modal
        open={open}
        title="接入 AI 服务"
        width={960}
        footer={footer}
        onCancel={closeWizard}
        destroyOnHidden
        mask={{ closable: false }}
      >
        <div className="ai-setup-wizard">
          <Steps
            size="small"
            current={step}
            items={[
              { title: "连接" },
              { title: "模型" },
              { title: "默认用途" },
              { title: "确认" },
              { title: "完成" },
            ]}
          />

          {step === 0 ? (
            <Form
              form={providerForm}
              layout="vertical"
              requiredMark={false}
              className="ai-setup-provider-form"
            >
              <Alert
                showIcon
                type="info"
                title="一条连接对应一个账号、环境或网关"
                description="同一个服务商可以重复接入，例如生产账号、备用账号和公司代理。"
              />
              <div className="ai-setup-form-grid">
                <Form.Item name="providerType" label="服务商" rules={[{ required: true }]}>
                  <Select
                    options={providerOptions}
                    onChange={(value: ProviderType) => {
                      const label = providerOptions.find((item) => item.value === value)?.label;
                      providerForm.setFieldsValue({
                        providerType: value,
                        name: label || value,
                        baseUrl: providerBaseUrls[value],
                      });
                    }}
                  />
                </Form.Item>
                <Form.Item name="name" label="连接名称" rules={[{ required: true }]}>
                  <Input placeholder="例如 OpenAI 生产账号" />
                </Form.Item>
                <Form.Item
                  name="baseUrl"
                  label="Base URL"
                  rules={[{ required: true }, { type: "url" }]}
                >
                  <Input placeholder="选择服务商后自动填写" />
                </Form.Item>
                <Form.Item
                  name="apiKey"
                  label="API Key"
                  rules={providerType === "ollama" ? [] : [{ required: true }]}
                >
                  <Input.Password
                    placeholder={providerType === "ollama" ? "本地模型可留空" : "输入服务商密钥"}
                  />
                </Form.Item>
              </div>
              <Collapse
                ghost
                items={[
                  {
                    key: "advanced",
                    label: "高级连接设置",
                    children: (
                      <div className="ai-setup-form-grid">
                        <Form.Item
                          name="timeoutMinutes"
                          label="请求超时"
                          rules={[{ required: true }]}
                        >
                          <InputNumber
                            min={0.1}
                            max={60}
                            step={0.5}
                            precision={2}
                            addonAfter="分钟"
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                        <Form.Item name="organization" label="Organization">
                          <Input placeholder="仅部分 OpenAI 账号需要" />
                        </Form.Item>
                        <Form.Item name="project" label="Project">
                          <Input placeholder="仅部分 OpenAI 项目需要" />
                        </Form.Item>
                      </div>
                    ),
                  },
                ]}
              />
            </Form>
          ) : null}

          {step === 1 ? (
            <div className="ai-setup-model-step">
              <Alert
                showIcon
                type="info"
                title={models.length ? `已发现 ${models.length} 个模型` : "手工添加模型"}
                description="同步结果只作为候选项，不会自动导入；勾选后才会在完成步骤写入模型管理。"
              />
              <div className="ai-setup-model-toolbar">
                <Input.Search
                  allowClear
                  value={modelKeyword}
                  placeholder="搜索模型 ID 或名称"
                  onChange={(event) => setModelKeyword(event.target.value)}
                />
                <Space.Compact>
                  <Input
                    value={manualModelId}
                    placeholder="手工输入模型 ID"
                    onChange={(event) => setManualModelId(event.target.value)}
                    onPressEnter={addManualModel}
                  />
                  <Select
                    value={manualModelType}
                    options={Object.entries(modelTypeLabels).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                    onChange={setManualModelType}
                  />
                  <Button onClick={addManualModel}>添加</Button>
                </Space.Compact>
              </div>
              {models.length ? (
                <Table<SetupModel>
                  rowKey="modelId"
                  size="small"
                  pagination={false}
                  dataSource={filteredModels}
                  scroll={{ y: 340 }}
                  rowSelection={{
                    selectedRowKeys: selectedModelIds,
                    preserveSelectedRowKeys: true,
                    onChange: (keys) => setSelectedModelIds(keys.map(String)),
                  }}
                  columns={[
                    { title: "模型", dataIndex: "name", width: 190, ellipsis: true },
                    { title: "模型 ID", dataIndex: "modelId", ellipsis: true },
                    {
                      title: "类型",
                      dataIndex: "modelType",
                      width: 110,
                      render: (value) => (
                        <Tag>{modelTypeLabels[value as SetupModel["modelType"]]}</Tag>
                      ),
                    },
                    {
                      title: "上下文",
                      dataIndex: "contextWindow",
                      width: 100,
                      render: (value) => formatTokenLimit(Number(value) || null),
                    },
                    {
                      title: "最大输出",
                      dataIndex: "maxOutputTokens",
                      width: 100,
                      render: (value) => formatTokenLimit(Number(value) || null),
                    },
                    {
                      title: "Agent",
                      dataIndex: "toolCalling",
                      width: 92,
                      render: (value, record) =>
                        record.modelType === "chat" ? (
                          <Checkbox
                            checked={Boolean(value)}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              setModels((current) =>
                                current.map((item) =>
                                  item.modelId === record.modelId
                                    ? { ...item, toolCalling: checked }
                                    : item,
                                ),
                              );
                            }}
                          >
                            工具
                          </Checkbox>
                        ) : (
                          "-"
                        ),
                    },
                    {
                      title: "来源",
                      dataIndex: "source",
                      width: 100,
                      render: (value) => (
                        <Tag color={value === "provider" ? "blue" : undefined}>
                          {value === "provider" ? "服务商同步" : "手工配置"}
                        </Tag>
                      ),
                    },
                  ]}
                />
              ) : (
                <Empty description="暂时没有模型，请在上方手工添加模型 ID" />
              )}
              <Typography.Text type="secondary">
                已选择 {selectedModelIds.length} 个模型；需要用于 Agent 的 Chat
                模型必须勾选“工具”，未知容量可在完成后进入模型管理补充。
              </Typography.Text>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="ai-setup-default-step">
              <Alert
                showIcon
                type="info"
                title="设置默认用途"
                description="业务未指定模型时使用对应默认模型；以后可以在模型管理中随时切换。"
              />
              <div className="ai-setup-form-grid">
                <div>
                  <Typography.Text strong>默认 Chat 模型</Typography.Text>
                  <Select
                    allowClear
                    value={defaultChat}
                    placeholder={chatModels.length ? "选择 Chat 模型" : "没有可用 Chat 模型"}
                    options={chatModels.map((model) => ({
                      label: model.name,
                      value: model.modelId,
                    }))}
                    disabled={!chatModels.length}
                    onChange={setDefaultChat}
                  />
                </div>
                <div>
                  <Typography.Text strong>默认结构化输出模型</Typography.Text>
                  <Select
                    allowClear
                    value={defaultStructured}
                    placeholder={chatModels.length ? "选择 Chat 模型" : "没有可用 Chat 模型"}
                    options={chatModels.map((model) => ({
                      label: model.name,
                      value: model.modelId,
                    }))}
                    disabled={!chatModels.length}
                    onChange={setDefaultStructured}
                  />
                </div>
                <div>
                  <Typography.Text strong>默认 Embedding 模型</Typography.Text>
                  <Select
                    allowClear
                    value={defaultEmbedding}
                    placeholder={
                      embeddingModels.length ? "选择 Embedding 模型" : "没有可用 Embedding 模型"
                    }
                    options={embeddingModels.map((model) => ({
                      label: model.name,
                      value: model.modelId,
                    }))}
                    disabled={!embeddingModels.length}
                    onChange={setDefaultEmbedding}
                  />
                </div>
                <div className="ai-setup-default-provider">
                  <div>
                    <Typography.Text strong>设为默认连接</Typography.Text>
                    <Typography.Text type="secondary">
                      供未显式指定连接的兼容能力使用
                    </Typography.Text>
                  </div>
                  <Switch checked={makeDefaultProvider} onChange={setMakeDefaultProvider} />
                </div>
              </div>
            </div>
          ) : null}

          {step === 3 && providerDraft ? (
            <div className="ai-setup-review-step">
              <Alert
                showIcon
                type="warning"
                title="确认后将一次性写入连接、模型和默认用途"
                description="整个过程使用数据库事务；任意模型写入失败时不会留下半成品配置。"
              />
              <Descriptions bordered size="small" column={2}>
                <Descriptions.Item label="连接名称">{providerDraft.name}</Descriptions.Item>
                <Descriptions.Item label="服务商">
                  {providerOptions.find((item) => item.value === providerDraft.providerType)?.label}
                </Descriptions.Item>
                <Descriptions.Item label="Base URL" span={2}>
                  {providerDraft.baseUrl}
                </Descriptions.Item>
                <Descriptions.Item label="请求超时">
                  {providerDraft.timeoutMinutes} 分钟
                </Descriptions.Item>
                <Descriptions.Item label="导入模型">{selectedModels.length} 个</Descriptions.Item>
                <Descriptions.Item label="默认 Chat">{defaultChat || "不设置"}</Descriptions.Item>
                <Descriptions.Item label="默认结构化">
                  {defaultStructured || "不设置"}
                </Descriptions.Item>
                <Descriptions.Item label="默认 Embedding">
                  {defaultEmbedding || "不设置"}
                </Descriptions.Item>
                <Descriptions.Item label="默认连接">
                  {makeDefaultProvider ? "是" : "否"}
                </Descriptions.Item>
              </Descriptions>
              <div className="ai-setup-review-models">
                {selectedModels.map((model) => (
                  <Tag key={model.modelId} color={model.toolCalling ? "cyan" : undefined}>
                    {model.modelId}
                    {model.toolCalling ? " · Agent" : ""}
                  </Tag>
                ))}
              </div>
            </div>
          ) : null}

          {step === 4 && completed ? (
            <Result
              status="success"
              icon={<CheckCircleOutlined />}
              title="AI 服务接入完成"
              subTitle={`连接 ${completed.providerCode} 已启用，已导入 ${completed.importedModels.length} 个模型。`}
              extra={[
                <Button
                  key="chat"
                  type="primary"
                  onClick={() => navigation.push("/system/ai/chat")}
                >
                  打开 AI Chat
                </Button>,
                <Button key="model" onClick={() => navigation.push("/system/ai/model")}>
                  查看模型
                </Button>,
              ]}
            />
          ) : null}
        </div>
      </Modal>
    </PageScaffold>
  );
}
