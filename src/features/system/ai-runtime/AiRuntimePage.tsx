"use client";

import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
  RightOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useMemo, useState } from "react";
import { AuthButton } from "@/components/auth-button/AuthButton";
import { request } from "@/lib/request";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";

type Purpose = "chat" | "structured" | "embedding" | "rerank" | "agent" | "ragAnswer" | "evalJudge";

type ModelOption = {
  id: number;
  name: string;
  modelId: string;
  modelType: string;
  capabilitiesJson?: string | null;
  providerName: string;
  providerCode: string;
};

type PurposeCandidate = {
  modelId: number;
  priority: number;
  modelName: string;
  modelIdentifier: string;
  modelType: string;
  capabilitiesJson?: string | null;
  providerId: number;
  providerName: string;
  providerCode: string;
  modelStatus: number;
  providerStatus: number;
};

type PurposeRoute = {
  purpose: Purpose;
  name: string;
  description?: string | null;
  status: number;
  updatedAt?: string | null;
  candidates: PurposeCandidate[];
};

type PurposeData = { purposes: PurposeRoute[]; models: ModelOption[] };

type ProviderHealth = {
  id: number;
  name: string;
  code: string;
  providerType: string;
  status: number;
  businessCalls: number;
  businessSuccesses: number;
  healthChecks: number;
  successRate?: string | number | null;
  p50LatencyMs?: number | null;
  p95LatencyMs?: number | null;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  lastErrorType?: string | null;
};

type Invocation = {
  id: number;
  purpose: Purpose;
  sourceType: string;
  sourceId?: string | null;
  requestId?: string | null;
  username?: string | null;
  sessionId?: number | null;
  runId?: number | null;
  status: string;
  attemptCount: number;
  fallbackUsed: boolean;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  estimatedCost?: string | null;
  currency?: string | null;
  durationMs?: number | null;
  errorType?: string | null;
  errorMessage?: string | null;
  modelName?: string | null;
  modelIdentifier?: string | null;
  providerName?: string | null;
  providerCode?: string | null;
  startedAt: string;
  finishedAt?: string | null;
};

type Attempt = {
  id: number;
  attemptNo: number;
  providerName: string;
  providerCode: string;
  modelName: string;
  modelIdentifier: string;
  status: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  estimatedCost?: string | null;
  currency?: string | null;
  latencyMs?: number | null;
  firstTokenMs?: number | null;
  errorType?: string | null;
  errorMessage?: string | null;
  startedAt: string;
  finishedAt?: string | null;
};

type InvocationDetail = Invocation & { attempts: Attempt[] };
type InvocationPage = { data: Invocation[]; total: number; page: number; pageSize: number };

const purposeLabels: Record<Purpose, string> = {
  chat: "普通对话",
  structured: "结构化生成",
  embedding: "向量化",
  rerank: "重排序",
  agent: "Agent 执行",
  ragAnswer: "RAG 回答",
  evalJudge: "Eval 裁判",
};

const statusColor: Record<string, string> = {
  completed: "success",
  failed: "error",
  aborted: "default",
  running: "processing",
};

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}

function formatCost(value?: string | null, currency?: string | null) {
  if (value == null) return "-";
  return `${currency || "USD"} ${Number(value).toFixed(6)}`;
}

function modelSupportsPurpose(model: ModelOption, purpose: Purpose) {
  if (purpose === "embedding") return model.modelType === "embedding";
  if (purpose === "rerank") return model.modelType === "rerank";
  if (model.modelType !== "chat") return false;
  if (purpose !== "agent") return true;
  try {
    return JSON.parse(model.capabilitiesJson || "{}").toolCalling === true;
  } catch {
    return false;
  }
}

export function AiRuntimePage() {
  const queryClient = useQueryClient();
  const [editingRoute, setEditingRoute] = useState<PurposeRoute | null>(null);
  const [orderedModelIds, setOrderedModelIds] = useState<number[]>([]);
  const [selectedInvocationId, setSelectedInvocationId] = useState<number | null>(null);
  const [windowHours, setWindowHours] = useState(24);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState<Record<string, string | number | undefined>>({});
  const [filterForm] = Form.useForm();

  const purposesQuery = useQuery({
    queryKey: ["system-ai-runtime-purposes"],
    queryFn: () => request<PurposeData>("/api/system/ai/runtime/purposes"),
  });
  const healthQuery = useQuery({
    queryKey: ["system-ai-runtime-health", windowHours],
    queryFn: () =>
      request<ProviderHealth[]>(
        `/api/system/ai/runtime/provider-health?windowHours=${windowHours}`,
      ),
  });
  const invocationQuery = useQuery({
    queryKey: ["system-ai-runtime-invocations", page, pageSize, filters],
    queryFn: () => {
      const search = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      for (const [key, value] of Object.entries(filters)) {
        if (value != null && value !== "") search.set(key, String(value));
      }
      return request<InvocationPage>(`/api/system/ai/runtime/invocations?${search}`);
    },
  });
  const detailQuery = useQuery({
    queryKey: ["system-ai-runtime-invocation", selectedInvocationId],
    queryFn: () =>
      request<InvocationDetail>(`/api/system/ai/runtime/invocations/${selectedInvocationId}`),
    enabled: Boolean(selectedInvocationId),
  });

  const saveRoute = useMutation({
    mutationFn: ({ purpose, modelIds }: { purpose: Purpose; modelIds: number[] }) =>
      request(`/api/system/ai/runtime/purposes/${purpose}`, {
        method: "PUT",
        body: JSON.stringify({ modelIds }),
      }),
    onSuccess: async () => {
      feedback.success("用途模型路由已更新");
      setEditingRoute(null);
      await queryClient.invalidateQueries({ queryKey: ["system-ai-runtime-purposes"] });
    },
  });

  const modelMap = useMemo(
    () => new Map((purposesQuery.data?.models ?? []).map((model) => [model.id, model])),
    [purposesQuery.data?.models],
  );

  const moveModel = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= orderedModelIds.length) return;
    setOrderedModelIds((current) => {
      const next = [...current];
      const currentValue = next[index];
      const targetValue = next[target];
      if (currentValue == null || targetValue == null) return current;
      next[index] = targetValue;
      next[target] = currentValue;
      return next;
    });
  };

  const openRoute = (route: PurposeRoute) => {
    setEditingRoute(route);
    setOrderedModelIds(route.candidates.map((candidate) => candidate.modelId));
  };

  const compatibleModels = (purposesQuery.data?.models ?? []).filter(
    (model) => editingRoute && modelSupportsPurpose(model, editingRoute.purpose),
  );

  const refreshAll = () =>
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["system-ai-runtime-purposes"] }),
      queryClient.invalidateQueries({ queryKey: ["system-ai-runtime-health"] }),
      queryClient.invalidateQueries({ queryKey: ["system-ai-runtime-invocations"] }),
    ]);

  return (
    <PageScaffold
      title="AI 运行与追踪"
      description="统一管理用途级模型路由、Provider 真实健康和调用费用账本"
      actions={
        <Button icon={<ReloadOutlined />} onClick={refreshAll}>
          刷新
        </Button>
      }
    >
      <Tabs
        className="admin-fill-tabs"
        items={[
          {
            key: "routing",
            label: "用途路由",
            children: (
              <div className="admin-fill-workspace">
                <Alert
                  showIcon
                  type="info"
                  title="按业务用途选择模型"
                  description="第一项是主模型；仅当请求尚未输出内容且调用失败时，才按顺序尝试后续候选，避免混合两段回答。显式选择的会话模型会排在用途候选之前。"
                  style={{ marginBottom: 12 }}
                />
                <Table
                  className="admin-table-surface admin-fill-table"
                  rowKey="purpose"
                  loading={purposesQuery.isLoading}
                  dataSource={purposesQuery.data?.purposes ?? []}
                  pagination={false}
                  scroll={{ x: 980, y: "100%" }}
                  columns={[
                    {
                      title: "业务用途",
                      dataIndex: "name",
                      width: 180,
                      render: (_, row) => (
                        <Space orientation="vertical" size={0}>
                          <Typography.Text strong>{row.name}</Typography.Text>
                          <Typography.Text type="secondary" code>
                            {row.purpose}
                          </Typography.Text>
                        </Space>
                      ),
                    },
                    { title: "说明", dataIndex: "description", width: 260 },
                    {
                      title: "主模型与回退顺序",
                      render: (_, row) =>
                        row.candidates.length ? (
                          <Space wrap size={4}>
                            {row.candidates.map((candidate, index) => (
                              <Space key={candidate.modelId} size={4}>
                                {index > 0 ? <RightOutlined className="admin-muted-icon" /> : null}
                                <Tag color={index === 0 ? "blue" : "default"}>
                                  {index === 0 ? "主模型" : `候选 ${index}`} ·{" "}
                                  {candidate.providerName} / {candidate.modelName}
                                </Tag>
                              </Space>
                            ))}
                          </Space>
                        ) : (
                          <Tag color="warning">未配置</Tag>
                        ),
                    },
                    {
                      title: "操作",
                      width: 90,
                      fixed: "right",
                      render: (_, row) => (
                        <AuthButton auth="system.aiRuntime.update">
                          <Button
                            type="text"
                            icon={<EditOutlined />}
                            onClick={() => openRoute(row)}
                          />
                        </AuthButton>
                      ),
                    },
                  ]}
                />
              </div>
            ),
          },
          {
            key: "health",
            label: "Provider 健康",
            children: (
              <div className="admin-fill-workspace">
                <div className="admin-toolbar">
                  <Typography.Text type="secondary">
                    仅用真实业务调用计算成功率和延迟；连接测试单独计数。
                  </Typography.Text>
                  <Select
                    value={windowHours}
                    onChange={setWindowHours}
                    options={[
                      { label: "最近 24 小时", value: 24 },
                      { label: "最近 7 天", value: 168 },
                      { label: "最近 30 天", value: 720 },
                    ]}
                    style={{ width: 150 }}
                  />
                </div>
                <Table
                  className="admin-table-surface admin-fill-table"
                  rowKey="id"
                  loading={healthQuery.isLoading}
                  dataSource={healthQuery.data ?? []}
                  pagination={false}
                  scroll={{ x: 1080, y: "100%" }}
                  columns={[
                    {
                      title: "Provider",
                      render: (_, row) => (
                        <Space orientation="vertical" size={0}>
                          <Typography.Text strong>{row.name}</Typography.Text>
                          <Typography.Text type="secondary" code>
                            {row.code}
                          </Typography.Text>
                        </Space>
                      ),
                    },
                    {
                      title: "业务成功率",
                      width: 150,
                      render: (_, row) =>
                        row.businessCalls ? (
                          <Statistic
                            value={Number(row.successRate || 0)}
                            precision={2}
                            suffix="%"
                            valueStyle={{ fontSize: 16 }}
                          />
                        ) : (
                          <Typography.Text type="secondary">暂无调用</Typography.Text>
                        ),
                    },
                    {
                      title: "成功 / 总数",
                      width: 120,
                      render: (_, row) => `${row.businessSuccesses} / ${row.businessCalls}`,
                    },
                    {
                      title: "P50",
                      dataIndex: "p50LatencyMs",
                      width: 100,
                      render: (value) => (value == null ? "-" : `${value} ms`),
                    },
                    {
                      title: "P95",
                      dataIndex: "p95LatencyMs",
                      width: 100,
                      render: (value) => (value == null ? "-" : `${value} ms`),
                    },
                    { title: "连接测试", dataIndex: "healthChecks", width: 100 },
                    {
                      title: "最近成功",
                      dataIndex: "lastSuccessAt",
                      width: 180,
                      render: formatDate,
                    },
                    {
                      title: "最近错误",
                      width: 150,
                      render: (_, row) =>
                        row.lastErrorType ? <Tag color="error">{row.lastErrorType}</Tag> : "-",
                    },
                  ]}
                />
              </div>
            ),
          },
          {
            key: "traces",
            label: "调用 Trace",
            children: (
              <div className="admin-fill-workspace">
                <Form
                  form={filterForm}
                  layout="inline"
                  className="admin-inline-filter"
                  onFinish={(values) => {
                    setPage(1);
                    setFilters(values);
                  }}
                  style={{ marginBottom: 12 }}
                >
                  <Form.Item name="purpose">
                    <Select
                      allowClear
                      placeholder="用途"
                      style={{ width: 150 }}
                      options={Object.entries(purposeLabels).map(([value, label]) => ({
                        value,
                        label,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item name="status">
                    <Select
                      allowClear
                      placeholder="状态"
                      style={{ width: 130 }}
                      options={["running", "completed", "failed", "aborted"].map((value) => ({
                        value,
                        label: value,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item name="sourceType">
                    <Input allowClear placeholder="来源类型" style={{ width: 150 }} />
                  </Form.Item>
                  <Form.Item name="requestId">
                    <Input allowClear placeholder="Request ID" style={{ width: 220 }} />
                  </Form.Item>
                  <Button type="primary" htmlType="submit">
                    筛选
                  </Button>
                  <Button
                    onClick={() => {
                      filterForm.resetFields();
                      setFilters({});
                      setPage(1);
                    }}
                  >
                    重置
                  </Button>
                </Form>
                <Table
                  className="admin-table-surface admin-fill-table"
                  rowKey="id"
                  loading={invocationQuery.isLoading}
                  dataSource={invocationQuery.data?.data ?? []}
                  pagination={{
                    current: page,
                    pageSize,
                    total: invocationQuery.data?.total ?? 0,
                    showSizeChanger: true,
                    showTotal: (total) => `共 ${total} 条`,
                    onChange: (nextPage, nextSize) => {
                      setPage(nextPage);
                      setPageSize(nextSize);
                    },
                  }}
                  onRow={(row) => ({
                    onClick: () => setSelectedInvocationId(row.id),
                    style: { cursor: "pointer" },
                  })}
                  scroll={{ x: 1280, y: "100%" }}
                  columns={[
                    {
                      title: "Trace",
                      dataIndex: "id",
                      width: 90,
                      fixed: "left",
                      render: (value) => `#${value}`,
                    },
                    {
                      title: "用途",
                      dataIndex: "purpose",
                      width: 130,
                      render: (value: Purpose) => <Tag>{purposeLabels[value]}</Tag>,
                    },
                    { title: "来源", dataIndex: "sourceType", width: 130 },
                    {
                      title: "Provider / 模型",
                      width: 230,
                      render: (_, row) =>
                        row.modelName ? `${row.providerName} / ${row.modelName}` : "-",
                    },
                    {
                      title: "状态",
                      dataIndex: "status",
                      width: 100,
                      render: (value) => <Tag color={statusColor[value]}>{value}</Tag>,
                    },
                    {
                      title: "尝试",
                      dataIndex: "attemptCount",
                      width: 80,
                      render: (value, row) =>
                        row.fallbackUsed ? <Tag color="warning">{value} 次</Tag> : value,
                    },
                    {
                      title: "Tokens",
                      width: 210,
                      render: (_, row) => (
                        <Space orientation="vertical" size={0}>
                          <Typography.Text>
                            {row.inputTokens} 输入 / {row.outputTokens} 输出
                          </Typography.Text>
                          {row.cachedInputTokens || row.cacheWriteTokens ? (
                            <Typography.Text type="secondary">
                              缓存读 {row.cachedInputTokens} / 写 {row.cacheWriteTokens}
                            </Typography.Text>
                          ) : null}
                        </Space>
                      ),
                    },
                    {
                      title: "费用",
                      width: 130,
                      render: (_, row) => formatCost(row.estimatedCost, row.currency),
                    },
                    {
                      title: "耗时",
                      dataIndex: "durationMs",
                      width: 100,
                      render: (value) => (value == null ? "-" : `${value} ms`),
                    },
                    {
                      title: "用户",
                      dataIndex: "username",
                      width: 110,
                      render: (value) => value || "系统",
                    },
                    { title: "开始时间", dataIndex: "startedAt", width: 180, render: formatDate },
                  ]}
                />
              </div>
            ),
          },
        ]}
      />

      <Drawer
        title={editingRoute ? `${editingRoute.name} · 模型优先级` : "用途模型路由"}
        size="large"
        open={Boolean(editingRoute)}
        onClose={() => setEditingRoute(null)}
        extra={
          <Button
            type="primary"
            loading={saveRoute.isPending}
            disabled={!orderedModelIds.length}
            onClick={() =>
              editingRoute &&
              saveRoute.mutate({ purpose: editingRoute.purpose, modelIds: orderedModelIds })
            }
          >
            保存
          </Button>
        }
      >
        {editingRoute ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Alert
              type="info"
              showIcon
              title="优先级从上到下执行"
              description="第 1 项为主模型，其余模型只在前一个请求尚未输出内容且失败时依次接管。Agent 模型必须声明 Tool Calling 能力。"
            />
            <Select<number>
              showSearch
              placeholder="添加候选模型"
              value={undefined}
              style={{ width: "100%" }}
              optionFilterProp="label"
              options={compatibleModels
                .filter((model) => !orderedModelIds.includes(model.id))
                .map((model) => ({
                  value: model.id,
                  label: `${model.providerName} / ${model.name} (${model.modelId})`,
                }))}
              onChange={(value) => setOrderedModelIds((current) => [...current, value])}
            />
            <List
              bordered
              dataSource={orderedModelIds}
              locale={{
                emptyText: (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请至少添加一个模型" />
                ),
              }}
              renderItem={(modelId, index) => {
                const model = modelMap.get(modelId);
                return (
                  <List.Item
                    actions={[
                      <Button
                        key="up"
                        type="text"
                        icon={<ArrowUpOutlined />}
                        disabled={index === 0}
                        onClick={() => moveModel(index, -1)}
                      />,
                      <Button
                        key="down"
                        type="text"
                        icon={<ArrowDownOutlined />}
                        disabled={index === orderedModelIds.length - 1}
                        onClick={() => moveModel(index, 1)}
                      />,
                      <Button
                        key="delete"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() =>
                          setOrderedModelIds((current) => current.filter((id) => id !== modelId))
                        }
                      />,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={
                        <Tag color={index === 0 ? "blue" : "default"}>
                          {index === 0 ? "主" : index + 1}
                        </Tag>
                      }
                      title={model ? `${model.providerName} / ${model.name}` : `Model #${modelId}`}
                      description={model?.modelId}
                    />
                  </List.Item>
                );
              }}
            />
          </Space>
        ) : null}
      </Drawer>

      <Drawer
        title={selectedInvocationId ? `Trace #${selectedInvocationId}` : "调用 Trace"}
        size="large"
        open={Boolean(selectedInvocationId)}
        onClose={() => setSelectedInvocationId(null)}
        loading={detailQuery.isLoading}
      >
        {detailQuery.data ? (
          <Space orientation="vertical" size={18} style={{ width: "100%" }}>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="用途">
                {purposeLabels[detailQuery.data.purpose]}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={statusColor[detailQuery.data.status]}>{detailQuery.data.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="来源">
                {detailQuery.data.sourceType}
                {detailQuery.data.sourceId ? ` #${detailQuery.data.sourceId}` : ""}
              </Descriptions.Item>
              <Descriptions.Item label="用户">
                {detailQuery.data.username || "系统"}
              </Descriptions.Item>
              <Descriptions.Item label="Request ID" span={2}>
                {detailQuery.data.requestId ? (
                  <Typography.Text copyable>{detailQuery.data.requestId}</Typography.Text>
                ) : (
                  "-"
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Run / Session">
                {detailQuery.data.runId ? `Run #${detailQuery.data.runId}` : "-"} /{" "}
                {detailQuery.data.sessionId ? `Session #${detailQuery.data.sessionId}` : "-"}
              </Descriptions.Item>
              <Descriptions.Item label="总耗时">
                {detailQuery.data.durationMs == null ? "-" : `${detailQuery.data.durationMs} ms`}
              </Descriptions.Item>
              <Descriptions.Item label="Token">
                {detailQuery.data.inputTokens} 输入 / {detailQuery.data.outputTokens} 输出
                {detailQuery.data.cachedInputTokens || detailQuery.data.cacheWriteTokens
                  ? ` · 缓存读 ${detailQuery.data.cachedInputTokens} / 写 ${detailQuery.data.cacheWriteTokens}`
                  : ""}
              </Descriptions.Item>
              <Descriptions.Item label="估算费用">
                {formatCost(detailQuery.data.estimatedCost, detailQuery.data.currency)}
              </Descriptions.Item>
            </Descriptions>
            {detailQuery.data.errorMessage ? (
              <Alert
                type="error"
                showIcon
                title={detailQuery.data.errorType || "调用失败"}
                description={detailQuery.data.errorMessage}
              />
            ) : null}
            <Typography.Title level={5}>模型尝试</Typography.Title>
            <List
              dataSource={detailQuery.data.attempts}
              renderItem={(attempt) => (
                <List.Item>
                  <List.Item.Meta
                    avatar={
                      attempt.status === "completed" ? (
                        <CheckCircleOutlined style={{ color: "var(--ant-color-success)" }} />
                      ) : attempt.status === "failed" ? (
                        <WarningOutlined style={{ color: "var(--ant-color-error)" }} />
                      ) : (
                        <ClockCircleOutlined />
                      )
                    }
                    title={
                      <Space>
                        <Tag>{attempt.attemptNo}</Tag>
                        <Typography.Text strong>
                          {attempt.providerName} / {attempt.modelName}
                        </Typography.Text>
                        <Tag color={statusColor[attempt.status]}>{attempt.status}</Tag>
                      </Space>
                    }
                    description={
                      <Space orientation="vertical" size={2}>
                        <Typography.Text type="secondary">
                          {attempt.modelIdentifier} · {attempt.latencyMs ?? "-"} ms · 首次响应{" "}
                          {attempt.firstTokenMs ?? "-"} ms · 输入 {attempt.inputTokens} / 输出{" "}
                          {attempt.outputTokens}
                          {attempt.cachedInputTokens || attempt.cacheWriteTokens
                            ? ` · 缓存读 ${attempt.cachedInputTokens} / 写 ${attempt.cacheWriteTokens}`
                            : ""}{" "}
                          · {formatCost(attempt.estimatedCost, attempt.currency)}
                        </Typography.Text>
                        {attempt.errorMessage ? (
                          <Typography.Text type="danger">
                            {attempt.errorType}: {attempt.errorMessage}
                          </Typography.Text>
                        ) : null}
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          </Space>
        ) : null}
      </Drawer>
    </PageScaffold>
  );
}
