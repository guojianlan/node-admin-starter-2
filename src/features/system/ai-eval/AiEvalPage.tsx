"use client";

import {
  BugOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  ExperimentOutlined,
  PlusOutlined,
  ReloadOutlined,
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
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useMemo, useState } from "react";
import { StreamingMarkdown } from "@/components/ai/StreamingMarkdown";
import { AuthButton } from "@/components/auth-button/AuthButton";
import { request } from "@/lib/request";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";

type EvalDataset = {
  id: number;
  name: string;
  description?: string | null;
  scopeType: "global" | "department" | "user";
  deptId?: number | null;
  deptName?: string | null;
  ownerName?: string | null;
  status: number;
  sort: number;
  caseCount: number;
  runCount: number;
};

type EvalAssertions = {
  contains?: string[];
  notContains?: string[];
  expectedTools?: string[];
  forbiddenTools?: string[];
  maxLatencyMs?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxEstimatedCost?: number;
};

type EvalCase = {
  id: number;
  datasetId: number;
  name: string;
  description?: string | null;
  agentId: number;
  agentName: string;
  sourceRunId?: number | null;
  inputText: string;
  expectedText?: string | null;
  assertions: EvalAssertions;
  tags: string[];
  judgeEnabled: boolean;
  judgeRubric?: string | null;
  groundednessRequired: boolean;
  status: number;
  sort: number;
};

type EvalRun = {
  id: number;
  datasetId: number;
  datasetName: string;
  status: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  errorCases: number;
  durationMs?: number | null;
  requestId?: string | null;
  startedAt?: string | null;
  createdAt: string;
};

type AssertionOutcome = {
  key: string;
  label: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
};

type EvalResult = {
  id: number;
  evalRunId: number;
  caseId: number;
  caseName: string;
  agentName: string;
  agentRunId?: number | null;
  status: "passed" | "failed" | "error";
  actualOutput?: string | null;
  assertions: AssertionOutcome[];
  metrics: Record<string, unknown>;
  judgeScore?: number | null;
  judgeReason?: string | null;
  groundednessScore?: string | null;
  judgeInvocationId?: number | null;
  errorMessage?: string | null;
  durationMs?: number | null;
};

type EvalResultDetail = EvalResult & {
  inputText: string;
  expectedText?: string | null;
  trace?: {
    id: number;
    status: string;
    agentName: string;
    totalSteps: number;
    inputTokens: number;
    outputTokens: number;
    durationMs?: number | null;
    steps: Array<{
      id: number;
      stepNo: number;
      stepType: string;
      status: string;
      toolName?: string | null;
      durationMs?: number | null;
      errorMessage?: string | null;
    }>;
    invocations: Array<{
      id: number;
      status: string;
      purpose: string;
      estimatedCost?: string | null;
      currency?: string | null;
      attempts: Array<{
        attemptNo: number;
        providerName: string;
        modelName: string;
        status: string;
        latencyMs?: number | null;
      }>;
    }>;
  } | null;
};

type EvalInvocation = NonNullable<EvalResultDetail["trace"]>["invocations"][number];

type EvalOptions = {
  agents: Array<{ id: number; name: string; code: string }>;
  departments: Array<{ id: number; name: string }>;
};

type PageResult<T> = { data: T[]; total: number; page: number; pageSize: number };

const statusColors: Record<string, string> = {
  passed: "success",
  completed: "success",
  failed: "error",
  error: "error",
  running: "processing",
  queued: "default",
  cancelled: "default",
};

function splitLines(value?: string) {
  return value
    ? value
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function joinLines(values?: string[]) {
  return (values ?? []).join("\n");
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}

export function AiEvalPage() {
  const queryClient = useQueryClient();
  const [datasetForm] = Form.useForm();
  const [caseForm] = Form.useForm();
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(null);
  const [editingDataset, setEditingDataset] = useState<EvalDataset | null>(null);
  const [datasetModalOpen, setDatasetModalOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<EvalCase | null>(null);
  const [caseModalOpen, setCaseModalOpen] = useState(false);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [selectedResultId, setSelectedResultId] = useState<number | null>(null);
  const [runPage, setRunPage] = useState(1);
  const [runPageSize, setRunPageSize] = useState(20);

  const datasetsQuery = useQuery({
    queryKey: ["system-ai-eval-datasets"],
    queryFn: () => request<EvalDataset[]>("/api/system/ai/eval/datasets"),
  });
  const activeDatasetId = (datasetsQuery.data ?? []).some((row) => row.id === selectedDatasetId)
    ? selectedDatasetId
    : (datasetsQuery.data?.[0]?.id ?? null);
  const optionsQuery = useQuery({
    queryKey: ["system-ai-eval-options"],
    queryFn: () => request<EvalOptions>("/api/system/ai/eval/options"),
  });
  const casesQuery = useQuery({
    queryKey: ["system-ai-eval-cases", activeDatasetId],
    enabled: Boolean(activeDatasetId),
    queryFn: () => request<EvalCase[]>(`/api/system/ai/eval/datasets/${activeDatasetId}/cases`),
  });
  const runsQuery = useQuery({
    queryKey: ["system-ai-eval-runs", activeDatasetId, runPage, runPageSize],
    enabled: Boolean(activeDatasetId),
    queryFn: () =>
      request<PageResult<EvalRun>>(
        `/api/system/ai/eval/runs?datasetId=${activeDatasetId}&page=${runPage}&pageSize=${runPageSize}`,
      ),
  });
  const resultsQuery = useQuery({
    queryKey: ["system-ai-eval-results", activeRunId],
    enabled: Boolean(activeRunId),
    queryFn: () => request<EvalResult[]>(`/api/system/ai/eval/runs/${activeRunId}/results`),
  });
  const resultDetailQuery = useQuery({
    queryKey: ["system-ai-eval-result", selectedResultId],
    enabled: Boolean(selectedResultId),
    queryFn: () => request<EvalResultDetail>(`/api/system/ai/eval/results/${selectedResultId}`),
  });

  const activeDataset = useMemo(
    () => (datasetsQuery.data ?? []).find((row) => row.id === activeDatasetId) ?? null,
    [activeDatasetId, datasetsQuery.data],
  );

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["system-ai-eval-datasets"] }),
      queryClient.invalidateQueries({ queryKey: ["system-ai-eval-cases"] }),
      queryClient.invalidateQueries({ queryKey: ["system-ai-eval-runs"] }),
      queryClient.invalidateQueries({ queryKey: ["system-ai-eval-results"] }),
    ]);
  };

  const saveDataset = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      request(
        editingDataset
          ? `/api/system/ai/eval/datasets/${editingDataset.id}`
          : "/api/system/ai/eval/datasets",
        { method: editingDataset ? "PUT" : "POST", body: values },
      ),
    onSuccess: async () => {
      feedback.success(editingDataset ? "Eval 数据集已更新" : "Eval 数据集已创建");
      setDatasetModalOpen(false);
      await refreshAll();
    },
  });
  const deleteDataset = useMutation({
    mutationFn: (id: number) => request(`/api/system/ai/eval/datasets/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      feedback.success("Eval 数据集已删除");
      await refreshAll();
    },
  });
  const saveCase = useMutation({
    mutationFn: (values: Record<string, unknown>) => {
      if (!activeDatasetId) throw new Error("请先选择数据集");
      const assertions = {
        contains: splitLines(String(values.contains ?? "")),
        notContains: splitLines(String(values.notContains ?? "")),
        expectedTools: splitLines(String(values.expectedTools ?? "")),
        forbiddenTools: splitLines(String(values.forbiddenTools ?? "")),
        maxLatencyMs: values.maxLatencyMs,
        maxInputTokens: values.maxInputTokens,
        maxOutputTokens: values.maxOutputTokens,
        maxEstimatedCost: values.maxEstimatedCost,
      };
      const body = {
        ...values,
        assertions,
        tags: splitLines(String(values.tagsText ?? "")),
        contains: undefined,
        notContains: undefined,
        expectedTools: undefined,
        forbiddenTools: undefined,
        tagsText: undefined,
      };
      return request(
        editingCase
          ? `/api/system/ai/eval/cases/${editingCase.id}`
          : `/api/system/ai/eval/datasets/${activeDatasetId}/cases`,
        { method: editingCase ? "PUT" : "POST", body },
      );
    },
    onSuccess: async () => {
      feedback.success(editingCase ? "Eval Case 已更新" : "Eval Case 已创建");
      setCaseModalOpen(false);
      await refreshAll();
    },
  });
  const deleteCase = useMutation({
    mutationFn: (id: number) => request(`/api/system/ai/eval/cases/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      feedback.success("Eval Case 已删除");
      await refreshAll();
    },
  });
  const executeDataset = useMutation({
    mutationFn: (id: number) =>
      request<EvalRun>(`/api/system/ai/eval/datasets/${id}/runs`, { method: "POST" }),
    onSuccess: async (run) => {
      feedback.success(
        `Eval 完成：${run.passedCases} 通过，${run.failedCases} 失败，${run.errorCases} 错误`,
      );
      setActiveRunId(run.id);
      await refreshAll();
    },
  });

  function openDataset(row?: EvalDataset) {
    setEditingDataset(row ?? null);
    datasetForm.setFieldsValue(row ?? { scopeType: "user", status: 1, sort: 0, deptId: null });
    setDatasetModalOpen(true);
  }

  function openCase(row?: EvalCase) {
    setEditingCase(row ?? null);
    caseForm.setFieldsValue(
      row
        ? {
            ...row,
            contains: joinLines(row.assertions.contains),
            notContains: joinLines(row.assertions.notContains),
            expectedTools: joinLines(row.assertions.expectedTools),
            forbiddenTools: joinLines(row.assertions.forbiddenTools),
            maxLatencyMs: row.assertions.maxLatencyMs,
            maxInputTokens: row.assertions.maxInputTokens,
            maxOutputTokens: row.assertions.maxOutputTokens,
            maxEstimatedCost: row.assertions.maxEstimatedCost,
            tagsText: joinLines(row.tags),
          }
        : {
            status: 1,
            sort: 0,
            assertions: {},
            judgeEnabled: false,
            groundednessRequired: false,
          },
    );
    setCaseModalOpen(true);
  }

  const caseColumns = [
    {
      title: "Case",
      dataIndex: "name",
      width: 240,
      render: (value: string, row: EvalCase) => (
        <Space orientation="vertical" size={2}>
          <Typography.Text strong>{value}</Typography.Text>
          <Space size={4} wrap>
            <Tag>{row.agentName}</Tag>
            {row.sourceRunId ? <Tag color="blue">Run #{row.sourceRunId}</Tag> : null}
            {row.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Space>
        </Space>
      ),
    },
    { title: "固定输入", dataIndex: "inputText", ellipsis: true },
    {
      title: "断言",
      width: 190,
      render: (_: unknown, row: EvalCase) => {
        const count = Object.values(row.assertions).reduce<number>(
          (total, value) => total + (Array.isArray(value) ? value.length : value == null ? 0 : 1),
          row.expectedText ? 1 : 0,
        );
        return (
          <Space size={4} wrap>
            <Tag color={count ? "cyan" : "default"}>{count} 条</Tag>
            {row.judgeEnabled ? <Tag color="purple">Judge</Tag> : null}
            {row.groundednessRequired ? <Tag color="geekblue">Grounded</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (value: number) => (
        <Tag color={value === 1 ? "success" : "default"}>{value === 1 ? "启用" : "停用"}</Tag>
      ),
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right" as const,
      width: 130,
      render: (_: unknown, row: EvalCase) => (
        <Space size={4}>
          <AuthButton auth="system.aiEval.update">
            <Button type="text" icon={<EditOutlined />} onClick={() => openCase(row)} />
          </AuthButton>
          <Popconfirm title="删除该 Eval Case？" onConfirm={() => deleteCase.mutate(row.id)}>
            <AuthButton auth="system.aiEval.delete">
              <Button danger type="text" icon={<DeleteOutlined />} />
            </AuthButton>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const runColumns = [
    { title: "Run", dataIndex: "id", width: 88, render: (value: number) => `#${value}` },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (value: string) => <Tag color={statusColors[value]}>{value}</Tag>,
    },
    { title: "总数", dataIndex: "totalCases", width: 76 },
    {
      title: "通过",
      dataIndex: "passedCases",
      width: 76,
      render: (value: number) => <Typography.Text type="success">{value}</Typography.Text>,
    },
    {
      title: "失败",
      dataIndex: "failedCases",
      width: 76,
      render: (value: number) => <Typography.Text type="danger">{value}</Typography.Text>,
    },
    { title: "错误", dataIndex: "errorCases", width: 76 },
    {
      title: "耗时",
      dataIndex: "durationMs",
      width: 100,
      render: (value?: number) => (value == null ? "-" : `${value} ms`),
    },
    {
      title: "Judge",
      dataIndex: "judgeScore",
      width: 100,
      render: (value?: number | null) => (value == null ? "-" : `${value}/100`),
    },
    {
      title: "Grounded",
      dataIndex: "groundednessScore",
      width: 110,
      render: (value?: string | null) =>
        value == null ? "-" : `${(Number(value) * 100).toFixed(0)}%`,
    },
    { title: "开始时间", dataIndex: "startedAt", width: 180, render: formatDate },
    {
      title: "操作",
      width: 96,
      fixed: "right" as const,
      render: (_: unknown, row: EvalRun) => (
        <Button type="link" onClick={() => setActiveRunId(row.id)}>
          查看结果
        </Button>
      ),
    },
  ];

  const resultColumns = [
    { title: "Case", dataIndex: "caseName" },
    { title: "Agent", dataIndex: "agentName", width: 140 },
    {
      title: "结果",
      dataIndex: "status",
      width: 100,
      render: (value: string) => <Tag color={statusColors[value]}>{value}</Tag>,
    },
    {
      title: "断言",
      width: 120,
      render: (_: unknown, row: EvalResult) =>
        `${row.assertions.filter((item) => item.passed).length}/${row.assertions.length}`,
    },
    {
      title: "耗时",
      dataIndex: "durationMs",
      width: 100,
      render: (value?: number) => (value == null ? "-" : `${value} ms`),
    },
    {
      title: "Trace",
      dataIndex: "agentRunId",
      width: 100,
      render: (value?: number) => (value ? `#${value}` : "-"),
    },
    {
      title: "操作",
      width: 90,
      render: (_: unknown, row: EvalResult) => (
        <Button type="link" onClick={() => setSelectedResultId(row.id)}>
          详情
        </Button>
      ),
    },
  ];

  return (
    <PageScaffold
      title="AI Eval"
      description="把真实 Agent Run 固化为可重复用例，并用确定性断言持续验证输出、工具、延迟、Token 和成本。"
      className="ai-eval-page"
      actions={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void refreshAll()}>
            刷新
          </Button>
          <AuthButton auth="system.aiEval.create">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openDataset()}>
              新建数据集
            </Button>
          </AuthButton>
        </Space>
      }
    >
      <div className="ai-eval-workspace">
        <aside className="ai-eval-datasets">
          <div className="ai-eval-panel-header">
            <Typography.Text strong>数据集</Typography.Text>
            <Tag>{datasetsQuery.data?.length ?? 0}</Tag>
          </div>
          <div className="ai-eval-dataset-list">
            {datasetsQuery.isLoading ? (
              <Spin />
            ) : (datasetsQuery.data ?? []).length ? (
              (datasetsQuery.data ?? []).map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={row.id === activeDatasetId ? "is-active" : ""}
                  onClick={() => {
                    setSelectedDatasetId(row.id);
                    setActiveRunId(null);
                    setRunPage(1);
                  }}
                >
                  <span>
                    <strong>{row.name}</strong>
                    <small>
                      {row.caseCount} Cases · {row.runCount} Runs
                    </small>
                  </span>
                  <Tag color={row.status === 1 ? "success" : "default"}>
                    {row.status === 1 ? "启用" : "停用"}
                  </Tag>
                </button>
              ))
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据集" />
            )}
          </div>
          {activeDataset ? (
            <div className="ai-eval-dataset-actions">
              <AuthButton auth="system.aiEval.update">
                <Button icon={<EditOutlined />} onClick={() => openDataset(activeDataset)}>
                  编辑
                </Button>
              </AuthButton>
              <Popconfirm
                title="删除当前数据集？"
                onConfirm={() => deleteDataset.mutate(activeDataset.id)}
              >
                <AuthButton auth="system.aiEval.delete">
                  <Button danger icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </AuthButton>
              </Popconfirm>
            </div>
          ) : null}
        </aside>

        <main className="ai-eval-main">
          {activeDataset ? (
            <>
              <div className="ai-eval-toolbar">
                <div>
                  <Space size={8} wrap>
                    <Typography.Title level={4}>{activeDataset.name}</Typography.Title>
                    <Tag>{activeDataset.scopeType}</Tag>
                  </Space>
                  {activeDataset.description ? (
                    <Typography.Text type="secondary">{activeDataset.description}</Typography.Text>
                  ) : null}
                </div>
                <Space>
                  <AuthButton auth="system.aiEval.create">
                    <Button icon={<PlusOutlined />} onClick={() => openCase()}>
                      新建 Case
                    </Button>
                  </AuthButton>
                  <AuthButton auth="system.aiEval.execute">
                    <Button
                      type="primary"
                      icon={<ExperimentOutlined />}
                      loading={executeDataset.isPending}
                      disabled={!casesQuery.data?.some((row) => row.status === 1)}
                      onClick={() => executeDataset.mutate(activeDataset.id)}
                    >
                      运行数据集
                    </Button>
                  </AuthButton>
                </Space>
              </div>
              <Tabs
                className="ai-eval-tabs"
                items={[
                  {
                    key: "cases",
                    label: `Cases (${casesQuery.data?.length ?? 0})`,
                    children: (
                      <Table
                        rowKey="id"
                        size="small"
                        loading={casesQuery.isLoading}
                        dataSource={casesQuery.data ?? []}
                        columns={caseColumns}
                        pagination={false}
                        scroll={{ x: 980, y: "calc(100vh - 390px)" }}
                      />
                    ),
                  },
                  {
                    key: "runs",
                    label: `Runs (${runsQuery.data?.total ?? 0})`,
                    children: (
                      <Table
                        rowKey="id"
                        size="small"
                        loading={runsQuery.isLoading}
                        dataSource={runsQuery.data?.data ?? []}
                        columns={runColumns}
                        scroll={{ x: 900, y: "calc(100vh - 440px)" }}
                        pagination={{
                          current: runPage,
                          pageSize: runPageSize,
                          total: runsQuery.data?.total ?? 0,
                          showSizeChanger: true,
                          onChange: (page, pageSize) => {
                            setRunPage(page);
                            setRunPageSize(pageSize);
                          },
                        }}
                      />
                    ),
                  },
                ]}
              />
            </>
          ) : (
            <Empty description="创建或选择一个 Eval 数据集" />
          )}
        </main>
      </div>

      <Modal
        title={editingDataset ? "编辑 Eval 数据集" : "新建 Eval 数据集"}
        open={datasetModalOpen}
        width={680}
        confirmLoading={saveDataset.isPending}
        onCancel={() => setDatasetModalOpen(false)}
        onOk={() =>
          void datasetForm.validateFields().then((values) => saveDataset.mutateAsync(values))
        }
      >
        <Form form={datasetForm} layout="vertical" className="admin-entity-form-grid">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="scopeType" label="可见范围" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "user", label: "个人" },
                { value: "department", label: "部门" },
                { value: "global", label: "全局" },
              ]}
            />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(previous, current) => previous.scopeType !== current.scopeType}
          >
            {({ getFieldValue }) =>
              getFieldValue("scopeType") === "department" ? (
                <Form.Item name="deptId" label="归属部门" rules={[{ required: true }]}>
                  <Select
                    options={(optionsQuery.data?.departments ?? []).map((row) => ({
                      value: row.id,
                      label: row.name,
                    }))}
                  />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Form.Item
            name="status"
            label="启用"
            valuePropName="checked"
            getValueFromEvent={(checked) => (checked ? 1 : 0)}
            getValueProps={(value) => ({ checked: value === 1 })}
          >
            <Switch />
          </Form.Item>
          <Form.Item name="sort" label="排序">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="description" label="说明" className="admin-form-full">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingCase ? "编辑 Eval Case" : "新建 Eval Case"}
        open={caseModalOpen}
        width={860}
        confirmLoading={saveCase.isPending}
        onCancel={() => setCaseModalOpen(false)}
        onOk={() => void caseForm.validateFields().then((values) => saveCase.mutateAsync(values))}
      >
        <Form form={caseForm} layout="vertical" className="admin-entity-form-grid">
          <Form.Item name="name" label="Case 名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="agentId" label="Agent" rules={[{ required: true }]}>
            <Select
              options={(optionsQuery.data?.agents ?? []).map((row) => ({
                value: row.id,
                label: `${row.name} · ${row.code}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="status"
            label="启用"
            valuePropName="checked"
            getValueFromEvent={(checked) => (checked ? 1 : 0)}
            getValueProps={(value) => ({ checked: value === 1 })}
          >
            <Switch />
          </Form.Item>
          <Form.Item name="sort" label="排序">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="inputText"
            label="固定输入"
            className="admin-form-full"
            rules={[{ required: true }]}
          >
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="expectedText" label="期望包含文本" className="admin-form-full">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="contains" label="必须包含（每行一项）">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="notContains" label="禁止包含（每行一项）">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="expectedTools" label="期望工具（每行一项）">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="forbiddenTools" label="禁止工具（每行一项）">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="maxLatencyMs" label="最大耗时 ms">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="maxEstimatedCost" label="最大估算费用">
            <InputNumber min={0} precision={6} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="maxInputTokens" label="最大输入 Token">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="maxOutputTokens" label="最大输出 Token">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="judgeEnabled" label="启用 LLM Judge" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="groundednessRequired" label="要求知识库证据" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="judgeRubric" label="Judge 评分标准" className="admin-form-full">
            <Input.TextArea rows={3} placeholder="留空使用正确、相关、完整且不虚构的默认标准" />
          </Form.Item>
          <Form.Item name="tagsText" label="标签（每行一项）">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={`Eval Run #${activeRunId ?? ""} 结果`}
        open={Boolean(activeRunId)}
        size="min(1040px, 94vw)"
        onClose={() => setActiveRunId(null)}
      >
        <Table
          rowKey="id"
          size="small"
          loading={resultsQuery.isLoading}
          dataSource={resultsQuery.data ?? []}
          columns={resultColumns}
          pagination={false}
          scroll={{ x: 800 }}
        />
      </Drawer>

      <Drawer
        title={`Eval Result #${selectedResultId ?? ""}`}
        open={Boolean(selectedResultId)}
        size="min(1120px, 96vw)"
        onClose={() => setSelectedResultId(null)}
      >
        {resultDetailQuery.isLoading ? (
          <Spin />
        ) : resultDetailQuery.data ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions
              size="small"
              bordered
              column={2}
              items={[
                {
                  key: "status",
                  label: "结果",
                  children: (
                    <Tag color={statusColors[resultDetailQuery.data.status]}>
                      {resultDetailQuery.data.status}
                    </Tag>
                  ),
                },
                {
                  key: "trace",
                  label: "Agent Run",
                  children: resultDetailQuery.data.agentRunId
                    ? `#${resultDetailQuery.data.agentRunId}`
                    : "-",
                },
                {
                  key: "duration",
                  label: "耗时",
                  children: `${resultDetailQuery.data.durationMs ?? 0} ms`,
                },
                { key: "case", label: "Case", children: resultDetailQuery.data.caseName },
                {
                  key: "judge",
                  label: "LLM Judge",
                  children:
                    resultDetailQuery.data.judgeScore == null
                      ? "未启用"
                      : `${resultDetailQuery.data.judgeScore}/100 · Invocation #${resultDetailQuery.data.judgeInvocationId ?? "-"}`,
                },
                {
                  key: "groundedness",
                  label: "Groundedness",
                  children:
                    resultDetailQuery.data.groundednessScore == null
                      ? "未评测"
                      : `${(Number(resultDetailQuery.data.groundednessScore) * 100).toFixed(0)}%`,
                },
              ]}
            />
            {resultDetailQuery.data.judgeReason ? (
              <Alert
                type={(resultDetailQuery.data.judgeScore ?? 0) >= 70 ? "success" : "warning"}
                showIcon
                title="LLM Judge 说明"
                description={resultDetailQuery.data.judgeReason}
              />
            ) : null}
            {resultDetailQuery.data.errorMessage ? (
              <Alert
                type="error"
                showIcon
                title="执行错误"
                description={resultDetailQuery.data.errorMessage}
              />
            ) : null}
            <div>
              <Typography.Title level={5}>固定输入</Typography.Title>
              <Typography.Paragraph copyable>
                {resultDetailQuery.data.inputText}
              </Typography.Paragraph>
            </div>
            <div>
              <Typography.Title level={5}>实际输出</Typography.Title>
              <StreamingMarkdown
                content={resultDetailQuery.data.actualOutput ?? ""}
                minHeight={120}
                maxHeight={420}
                placeholder="没有输出"
              />
            </div>
            <div>
              <Typography.Title level={5}>确定性断言</Typography.Title>
              <Space orientation="vertical" size={6} style={{ width: "100%" }}>
                {resultDetailQuery.data.assertions.length ? (
                  resultDetailQuery.data.assertions.map((assertion) => (
                    <Alert
                      key={assertion.key}
                      type={assertion.passed ? "success" : "error"}
                      showIcon
                      icon={assertion.passed ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                      title={assertion.label}
                      description={
                        <Typography.Text code>
                          {JSON.stringify({
                            expected: assertion.expected,
                            actual: assertion.actual,
                          })}
                        </Typography.Text>
                      }
                    />
                  ))
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该 Case 没有断言" />
                )}
              </Space>
            </div>
            {resultDetailQuery.data.trace ? (
              <div>
                <Typography.Title level={5}>
                  <BugOutlined /> Agent Run / Step / Invocation Trace
                </Typography.Title>
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={resultDetailQuery.data.trace.steps}
                  columns={[
                    { title: "Step", dataIndex: "stepNo", width: 70 },
                    { title: "类型", dataIndex: "stepType", width: 100 },
                    { title: "工具", dataIndex: "toolName" },
                    {
                      title: "状态",
                      dataIndex: "status",
                      width: 120,
                      render: (value: string) => <Tag color={statusColors[value]}>{value}</Tag>,
                    },
                    {
                      title: "耗时",
                      dataIndex: "durationMs",
                      width: 100,
                      render: (value?: number) => (value == null ? "-" : `${value} ms`),
                    },
                  ]}
                />
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={resultDetailQuery.data.trace.invocations}
                  columns={[
                    {
                      title: "Invocation",
                      dataIndex: "id",
                      width: 110,
                      render: (value: number) => `#${value}`,
                    },
                    { title: "用途", dataIndex: "purpose", width: 100 },
                    {
                      title: "状态",
                      dataIndex: "status",
                      width: 110,
                      render: (value: string) => <Tag color={statusColors[value]}>{value}</Tag>,
                    },
                    {
                      title: "模型尝试",
                      render: (_: unknown, row: EvalInvocation) =>
                        row.attempts
                          .map(
                            (attempt) =>
                              `${attempt.providerName} / ${attempt.modelName} · ${attempt.status}`,
                          )
                          .join("；") || "-",
                    },
                    {
                      title: "费用",
                      width: 120,
                      render: (_: unknown, row: EvalInvocation) =>
                        row.estimatedCost ? `${row.currency || "USD"} ${row.estimatedCost}` : "-",
                    },
                  ]}
                />
              </div>
            ) : null}
          </Space>
        ) : (
          <Empty />
        )}
      </Drawer>
    </PageScaffold>
  );
}
