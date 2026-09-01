"use client";

import {
  ApartmentOutlined,
  BugOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  MessageOutlined,
  PlusOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  StopOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
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
  Tooltip,
  Typography,
} from "antd";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { StreamingMarkdown } from "@/components/ai/StreamingMarkdown";
import { AuthButton } from "@/components/auth-button/AuthButton";
import { request, requestEventStream, type EventStreamMessage } from "@/lib/request";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { WorkflowListPanel } from "../ai-workflow/AiWorkflowPage";

type AgentRow = {
  id: number;
  name: string;
  code: string;
  description?: string | null;
  instructions: string;
  modelId?: number | null;
  modelName?: string | null;
  temperatureMilli: number;
  maxOutputTokens?: number | null;
  maxSteps: number;
  toolIds: number[];
  status: number;
  sort: number;
  isSystem: boolean;
};

type ToolRow = {
  id: number;
  name: string;
  code: string;
  description: string;
  handlerKey: string;
  inputSchemaJson?: string | null;
  configJson?: string | null;
  riskLevel: "low" | "medium" | "high" | "critical";
  approvalRequired: boolean;
  status: number;
  sort: number;
  isSystem: boolean;
};

type AgentOptions = {
  models: Array<{ id: number; name: string; modelId: string; providerName: string }>;
  tools: ToolRow[];
  handlers: Array<{ value: string; label: string; description: string; riskLevel: string }>;
};

type RunRow = {
  id: number;
  sessionId: number;
  agentName: string;
  status: string;
  attempt: number;
  leaseUntil?: string | null;
  heartbeatAt?: string | null;
  totalSteps: number;
  inputTokens: number;
  outputTokens: number;
  durationMs?: number | null;
  errorMessage?: string | null;
  startedAt?: string | null;
};

type StepRow = {
  id: number;
  stepNo: number;
  stepType: string;
  status: string;
  toolName?: string | null;
  inputJson?: string | null;
  outputJson?: string | null;
  usageJson?: string | null;
  durationMs?: number | null;
  errorMessage?: string | null;
};

type RunTrace = RunRow & {
  finishedAt?: string | null;
  steps: StepRow[];
  invocations: Array<{
    id: number;
    purpose: string;
    status: string;
    attemptCount: number;
    fallbackUsed: boolean;
    inputTokens: number;
    outputTokens: number;
    durationMs?: number | null;
    attempts: Array<{
      attemptNo: number;
      providerName: string;
      modelName: string;
      status: string;
      latencyMs?: number | null;
      firstTokenMs?: number | null;
      errorMessage?: string | null;
    }>;
  }>;
};

type EvalDatasetOption = { id: number; name: string; caseCount: number };

type DebugStatus = "idle" | "running" | "completed" | "waiting_approval" | "failed" | "stopped";

type DebugTrace = {
  id: number;
  event: string;
  label: string;
  data: unknown;
  createdAt: string;
};

type ToolApproval = {
  id: number;
  runId: number;
  toolName: string;
  toolDisplayName?: string | null;
  toolDescription?: string | null;
  handlerKey?: string | null;
  riskLevel: "low" | "medium" | "high" | "critical";
  inputJson?: string | null;
  outputJson?: string | null;
  planHash?: string | null;
  affectedFilesJson?: string | null;
  validationJson?: string | null;
  expiresAt?: string | null;
  status: "pending" | "approved" | "denied" | "expired" | "executed" | "failed";
  reason?: string | null;
};

type WorkflowDefinition = {
  code: string;
  name: string;
  description: string;
  category: "diagnostic" | "business";
  riskLevel: "low" | "medium" | "high" | "critical";
};

type WorkflowCheck = {
  key: string;
  label: string;
  status: "pass" | "warning" | "fail";
  message: string;
  details?: Record<string, unknown>;
};

type WorkflowOutput = {
  status: "ready" | "warning" | "failed";
  summary: { passed: number; warnings: number; failed: number };
  orchestrator?: "legacy" | "mastra" | null;
  runtime?: {
    provider: { name: string; code: string };
    model: { name: string; modelId: string };
  } | null;
  checks: WorkflowCheck[];
};

type WorkflowRunRow = {
  id: number;
  workflowCode: string;
  orchestratorRunId: string;
  status: string;
  requestId?: string | null;
  resourceId?: string | null;
  input?: unknown;
  output?: WorkflowOutput | null;
  errorMessage?: string | null;
  durationMs?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
};

type WorkflowRunDetail = WorkflowRunRow & {
  steps: Array<{
    id: number;
    stepNo: number;
    stepCode: string;
    status: string;
    input?: unknown;
    output?: unknown;
    errorMessage?: string | null;
    durationMs?: number | null;
  }>;
};

const riskColors = { low: "green", medium: "gold", high: "orange", critical: "red" } as const;

function JsonPreview({ value }: { value?: string | null }) {
  if (!value) return <Typography.Text type="secondary">-</Typography.Text>;
  let output = value;
  try {
    output = JSON.stringify(JSON.parse(value), null, 2);
  } catch {}
  return <pre className="ai-agent-json">{output}</pre>;
}

function DebugDataPreview({ value }: { value: unknown }) {
  if (value == null) return null;
  let output = "";
  try {
    output = JSON.stringify(value, null, 2);
  } catch {
    output = String(value);
  }
  return <pre className="ai-agent-json ai-agent-debug-json">{output}</pre>;
}

function traceLabel(event: string) {
  const labels: Record<string, string> = {
    meta: "运行已创建",
    "tool-call": "调用工具",
    "tool-result": "工具返回",
    approval: "等待人工审批",
    finish: "运行完成",
    error: "运行失败",
  };
  return labels[event] ?? event;
}

function debugStatusTag(status: DebugStatus) {
  const options: Record<DebugStatus, { color: string; label: string }> = {
    idle: { color: "default", label: "未运行" },
    running: { color: "processing", label: "运行中" },
    completed: { color: "success", label: "已完成" },
    waiting_approval: { color: "warning", label: "等待审批" },
    failed: { color: "error", label: "失败" },
    stopped: { color: "default", label: "已停止" },
  };
  return <Tag color={options[status].color}>{options[status].label}</Tag>;
}

export function AiAgentPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [agentForm] = Form.useForm();
  const [toolForm] = Form.useForm();
  const [evalCaseForm] = Form.useForm();
  const [agentModal, setAgentModal] = useState(false);
  const [toolModal, setToolModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentRow | null>(null);
  const [editingTool, setEditingTool] = useState<ToolRow | null>(null);
  const [activeRun, setActiveRun] = useState<RunRow | null>(null);
  const [evalCaseModalOpen, setEvalCaseModalOpen] = useState(false);
  const [debugAgent, setDebugAgent] = useState<AgentRow | null>(null);
  const [debugPrompt, setDebugPrompt] = useState("");
  const [debugSessionId, setDebugSessionId] = useState<number | null>(null);
  const [debugRunId, setDebugRunId] = useState<number | null>(null);
  const [debugOutput, setDebugOutput] = useState("");
  const [debugError, setDebugError] = useState("");
  const [debugStatus, setDebugStatus] = useState<DebugStatus>("idle");
  const [debugTrace, setDebugTrace] = useState<DebugTrace[]>([]);
  const [workflowAgentId, setWorkflowAgentId] = useState<number | null>(null);
  const [activeWorkflowRunId, setActiveWorkflowRunId] = useState<number | null>(null);
  const debugControllerRef = useRef<AbortController | null>(null);
  const debugTraceIdRef = useRef(0);

  const agentsQuery = useQuery({
    queryKey: ["system-ai-agents"],
    queryFn: () => request<AgentRow[]>("/api/system/ai/agent"),
  });
  const optionsQuery = useQuery({
    queryKey: ["system-ai-agent-options"],
    queryFn: () => request<AgentOptions>("/api/system/ai/agent/options"),
  });
  const runsQuery = useQuery({
    queryKey: ["system-ai-agent-runs"],
    queryFn: () => request<RunRow[]>("/api/system/ai/agent/runs"),
  });
  const runTraceQuery = useQuery({
    queryKey: ["system-ai-agent-run-trace", activeRun?.id],
    enabled: Boolean(activeRun),
    queryFn: () => request<RunTrace>(`/api/system/ai/agent/runs/${activeRun?.id}/trace`),
  });
  const evalDatasetsQuery = useQuery({
    queryKey: ["system-ai-eval-datasets"],
    enabled: evalCaseModalOpen,
    queryFn: () => request<EvalDatasetOption[]>("/api/system/ai/eval/datasets"),
  });
  const debugApprovalsQuery = useQuery({
    queryKey: ["system-ai-agent-debug-approvals", debugSessionId],
    enabled: Boolean(debugSessionId),
    queryFn: () =>
      request<ToolApproval[]>(`/api/system/ai/chat/sessions/${debugSessionId}/approvals`),
  });
  const workflowDefinitionsQuery = useQuery({
    queryKey: ["system-ai-workflow-definitions"],
    queryFn: () => request<WorkflowDefinition[]>("/api/system/ai/workflow/definitions"),
  });
  const workflowRunsQuery = useQuery({
    queryKey: ["system-ai-workflow-runs"],
    queryFn: () => request<WorkflowRunRow[]>("/api/system/ai/workflow/runs"),
  });
  const workflowRunDetailQuery = useQuery({
    queryKey: ["system-ai-workflow-run", activeWorkflowRunId],
    enabled: Boolean(activeWorkflowRunId),
    queryFn: () =>
      request<WorkflowRunDetail>(`/api/system/ai/workflow/runs/${activeWorkflowRunId}`),
  });

  const saveAgent = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      request(editingAgent ? `/api/system/ai/agent/${editingAgent.id}` : "/api/system/ai/agent", {
        method: editingAgent ? "PUT" : "POST",
        body: values,
      }),
    onSuccess: async () => {
      feedback.success(editingAgent ? "Agent 已更新" : "Agent 已创建");
      setAgentModal(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system-ai-agents"] }),
        queryClient.invalidateQueries({ queryKey: ["system-ai-agent-options"] }),
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-options"] }),
      ]);
    },
  });
  const saveTool = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      request(editingTool ? `/api/system/ai/tool/${editingTool.id}` : "/api/system/ai/tool", {
        method: editingTool ? "PUT" : "POST",
        body: values,
      }),
    onSuccess: async () => {
      feedback.success(editingTool ? "工具已更新" : "工具已创建");
      setToolModal(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system-ai-agent-options"] }),
        queryClient.invalidateQueries({ queryKey: ["system-ai-agents"] }),
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-options"] }),
      ]);
    },
  });
  const saveRunAsEvalCase = useMutation({
    mutationFn: (values: { datasetId: number; name?: string }) => {
      if (!activeRun) throw new Error("请先选择 Agent Run");
      return request(`/api/system/ai/eval/cases/from-run/${activeRun.id}`, {
        method: "POST",
        body: values,
      });
    },
    onSuccess: async () => {
      feedback.success("Run 已保存为 Eval Case");
      setEvalCaseModalOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["system-ai-eval-datasets"] });
    },
  });
  const runWorkflow = useMutation({
    mutationFn: (agentId: number) =>
      request<WorkflowRunDetail>("/api/system/ai/workflow/ai-runtime-preflight/runs", {
        method: "POST",
        body: { agentId },
      }),
    onSuccess: async (run) => {
      feedback.success("AI 运行环境预检完成");
      setActiveWorkflowRunId(run.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system-ai-workflow-runs"] }),
        queryClient.invalidateQueries({ queryKey: ["system-ai-workflow-run", run.id] }),
      ]);
    },
  });

  function addDebugTrace(message: EventStreamMessage) {
    if (message.event === "delta") return;
    debugTraceIdRef.current += 1;
    setDebugTrace((previous) => [
      ...previous,
      {
        id: debugTraceIdRef.current,
        event: message.event,
        label: traceLabel(message.event),
        data: message.data,
        createdAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      },
    ]);
  }

  async function ensureDebugSession(agent: AgentRow) {
    if (debugSessionId) return debugSessionId;
    const result = await request<{ id: number }>("/api/system/ai/chat/sessions", {
      method: "POST",
      body: {
        title: `调试 · ${agent.name}`,
        agentId: agent.id,
        maxOutputTokens: agent.maxOutputTokens ?? 16384,
      },
    });
    setDebugSessionId(result.id);
    return result.id;
  }

  async function executeDebugStream(input: {
    agent: AgentRow;
    sessionId: number;
    content?: string;
    resume?: boolean;
    preserveOutput?: boolean;
  }) {
    const controller = new AbortController();
    debugControllerRef.current = controller;
    setDebugStatus("running");
    setDebugError("");
    if (!input.preserveOutput) {
      setDebugOutput("");
      setDebugTrace([]);
      setDebugRunId(null);
      debugTraceIdRef.current = 0;
    } else {
      setDebugOutput((previous) => (previous ? `${previous}\n\n---\n\n` : ""));
    }

    try {
      await requestEventStream(`/api/system/ai/chat/sessions/${input.sessionId}/messages/stream`, {
        method: "POST",
        body: {
          content: input.content,
          resume: input.resume,
          maxOutputTokens: input.agent.maxOutputTokens ?? 16384,
          timeoutMs: 120000,
        },
        signal: controller.signal,
        silent: true,
        onChunk: (chunk) => setDebugOutput((previous) => previous + chunk),
        onEvent: (message) => {
          addDebugTrace(message);
          const data =
            message.data && typeof message.data === "object"
              ? (message.data as Record<string, unknown>)
              : null;
          if (message.event === "meta" && typeof data?.runId === "number") {
            setDebugRunId(data.runId);
          }
          if (message.event === "approval") {
            setDebugStatus("waiting_approval");
            void queryClient.invalidateQueries({
              queryKey: ["system-ai-agent-debug-approvals", input.sessionId],
            });
          }
          if (message.event === "finish") {
            setDebugStatus(data?.waitingApproval === true ? "waiting_approval" : "completed");
          }
          if (message.event === "error") {
            const messageText = String(data?.message || "Agent 调试失败");
            setDebugError(messageText);
            setDebugStatus("failed");
          }
        },
      });
    } catch (error) {
      if (controller.signal.aborted) {
        setDebugStatus("stopped");
      } else {
        const message = error instanceof Error ? error.message : "Agent 调试失败";
        setDebugError(message);
        setDebugStatus("failed");
      }
    } finally {
      if (debugControllerRef.current === controller) debugControllerRef.current = null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system-ai-agent-runs"] }),
        queryClient.invalidateQueries({
          queryKey: ["system-ai-agent-debug-approvals", input.sessionId],
        }),
      ]);
    }
  }

  function openDebug(agent: AgentRow) {
    setDebugAgent(agent);
    setDebugPrompt("");
    setDebugSessionId(null);
    setDebugRunId(null);
    setDebugOutput("");
    setDebugError("");
    setDebugStatus("idle");
    setDebugTrace([]);
    debugTraceIdRef.current = 0;
  }

  async function runDebug() {
    if (!debugAgent) return;
    const content = debugPrompt.trim();
    if (!content) {
      feedback.warning("请输入调试消息");
      return;
    }
    const sessionId = await ensureDebugSession(debugAgent);
    await executeDebugStream({ agent: debugAgent, sessionId, content });
  }

  async function openAgentInChat(agent: AgentRow, sessionId?: number | null) {
    let targetSessionId = sessionId ?? null;
    if (!targetSessionId) {
      const result = await request<{ id: number }>("/api/system/ai/chat/sessions", {
        method: "POST",
        body: {
          title: agent.name,
          agentId: agent.id,
          maxOutputTokens: agent.maxOutputTokens ?? 16384,
        },
      });
      targetSessionId = result.id;
    }
    router.push(`/system/ai/chat?sessionId=${targetSessionId}`);
  }

  const decideDebugApproval = useMutation({
    mutationFn: ({ id, approved }: { id: number; approved: boolean }) =>
      request<{ status: string; sessionId: number }>(`/api/system/ai/approval/${id}/decision`, {
        method: "POST",
        body: { approved },
      }),
    onSuccess: async (result, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ["system-ai-agent-debug-approvals", result.sessionId],
      });
      if (variables.approved && result.status === "executed" && debugAgent) {
        await executeDebugStream({
          agent: debugAgent,
          sessionId: result.sessionId,
          resume: true,
          preserveOutput: true,
        });
      } else {
        setDebugStatus("stopped");
      }
    },
  });

  function openAgent(row?: AgentRow) {
    setEditingAgent(row ?? null);
    agentForm.setFieldsValue(
      row
        ? { ...row, temperature: row.temperatureMilli / 1000 }
        : {
            temperature: 0.7,
            maxOutputTokens: 16384,
            maxSteps: 6,
            status: 1,
            sort: 0,
            toolIds: [],
          },
    );
    setAgentModal(true);
  }

  function openTool(row?: ToolRow) {
    setEditingTool(row ?? null);
    toolForm.setFieldsValue(
      row ?? {
        handlerKey: "current_time",
        riskLevel: "low",
        approvalRequired: false,
        status: 1,
        sort: 0,
      },
    );
    setToolModal(true);
  }

  async function remove(type: "agent" | "tool", id: number) {
    await request(`/api/system/ai/${type}/${id}`, { method: "DELETE" });
    feedback.success("已删除");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["system-ai-agents"] }),
      queryClient.invalidateQueries({ queryKey: ["system-ai-agent-options"] }),
      queryClient.invalidateQueries({ queryKey: ["system-ai-chat-options"] }),
    ]);
  }

  const agents = agentsQuery.data ?? [];
  const tools = optionsQuery.data?.tools ?? [];
  const selectedWorkflowAgentId =
    workflowAgentId ??
    agents.find((agent) => agent.code === "general-assistant")?.id ??
    agents[0]?.id ??
    null;
  const preflightDefinition = (workflowDefinitionsQuery.data ?? []).find(
    (definition) => definition.code === "ai-runtime-preflight",
  );
  const pendingDebugApprovals = (debugApprovalsQuery.data ?? []).filter(
    (item) => item.status === "pending",
  );

  return (
    <PageScaffold
      title="AI Agent"
      description="把模型、指令和受控工具组合成可复用执行单元，并追踪 Run、Step 和 Approval"
      className="ai-agent-page"
      actions={
        <Button
          icon={<ReloadOutlined />}
          onClick={() =>
            void Promise.all([
              queryClient.invalidateQueries({ queryKey: ["system-ai-agents"] }),
              queryClient.invalidateQueries({ queryKey: ["system-ai-agent-options"] }),
              queryClient.invalidateQueries({ queryKey: ["system-ai-agent-runs"] }),
            ])
          }
        >
          刷新
        </Button>
      }
    >
      <Card className="admin-card ai-agent-workbench admin-fill-workspace" variant="borderless">
        <Tabs
          className="admin-fill-tabs ai-agent-tabs"
          items={[
            {
              key: "agents",
              label: "Agents",
              children: (
                <div className="ai-agent-tab-panel">
                  <div className="admin-toolbar">
                    <div className="admin-toolbar-left">
                      <Typography.Text type="secondary">{agents.length} 个 Agent</Typography.Text>
                    </div>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => openAgent()}>
                      新建 Agent
                    </Button>
                  </div>
                  <Table
                    className="admin-table-surface admin-fill-table"
                    rowKey="id"
                    loading={agentsQuery.isLoading}
                    dataSource={agents}
                    pagination={false}
                    columns={[
                      {
                        title: "Agent",
                        dataIndex: "name",
                        render: (_, row) => (
                          <Space orientation="vertical" size={1}>
                            <Space>
                              <Typography.Text strong>{row.name}</Typography.Text>
                              {row.isSystem ? <Tag>内置</Tag> : null}
                            </Space>
                            <Typography.Text type="secondary" code>
                              {row.code}
                            </Typography.Text>
                            {row.description ? (
                              <Typography.Text type="secondary">{row.description}</Typography.Text>
                            ) : null}
                          </Space>
                        ),
                      },
                      {
                        title: "模型",
                        dataIndex: "modelName",
                        render: (value) => value || "系统默认",
                      },
                      {
                        title: "工具",
                        dataIndex: "toolIds",
                        render: (ids: number[]) => <Tag icon={<ToolOutlined />}>{ids.length}</Tag>,
                      },
                      { title: "最大步骤", dataIndex: "maxSteps", width: 100 },
                      {
                        title: "状态",
                        dataIndex: "status",
                        width: 90,
                        render: (value) => (
                          <Tag color={value === 1 ? "green" : "default"}>
                            {value === 1 ? "启用" : "停用"}
                          </Tag>
                        ),
                      },
                      {
                        title: "操作",
                        width: 260,
                        fixed: "right",
                        render: (_, row) => (
                          <Space size={4}>
                            <Button
                              size="small"
                              type="primary"
                              ghost
                              icon={<BugOutlined />}
                              disabled={row.status !== 1}
                              onClick={() => openDebug(row)}
                            >
                              调试
                            </Button>
                            <Button
                              size="small"
                              icon={<MessageOutlined />}
                              disabled={row.status !== 1}
                              onClick={() => void openAgentInChat(row)}
                            >
                              使用
                            </Button>
                            <Tooltip title="编辑 Agent">
                              <Button
                                type="text"
                                icon={<EditOutlined />}
                                onClick={() => openAgent(row)}
                              />
                            </Tooltip>
                            <Popconfirm
                              title="确认删除该 Agent？"
                              onConfirm={() => void remove("agent", row.id)}
                              disabled={row.isSystem}
                            >
                              <Tooltip
                                title={row.isSystem ? "内置 Agent 不允许删除" : "删除 Agent"}
                              >
                                <Button
                                  type="text"
                                  danger
                                  icon={<DeleteOutlined />}
                                  disabled={row.isSystem}
                                />
                              </Tooltip>
                            </Popconfirm>
                          </Space>
                        ),
                      },
                    ]}
                    scroll={{ x: 980, y: "100%" }}
                  />
                </div>
              ),
            },
            {
              key: "tools",
              label: "Tools",
              children: (
                <div className="ai-agent-tab-panel">
                  <div className="admin-toolbar">
                    <Typography.Text type="secondary">
                      工具执行器由服务端白名单注册，配置不能注入任意代码
                    </Typography.Text>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => openTool()}>
                      新建工具
                    </Button>
                  </div>
                  <Table
                    className="admin-table-surface admin-fill-table"
                    rowKey="id"
                    loading={optionsQuery.isLoading}
                    dataSource={tools}
                    pagination={false}
                    columns={[
                      {
                        title: "工具",
                        dataIndex: "name",
                        render: (_, row) => (
                          <Space orientation="vertical" size={1}>
                            <Typography.Text strong>{row.name}</Typography.Text>
                            <Typography.Text code type="secondary">
                              {row.code}
                            </Typography.Text>
                          </Space>
                        ),
                      },
                      {
                        title: "处理器",
                        dataIndex: "handlerKey",
                        render: (value) => <Typography.Text code>{value}</Typography.Text>,
                      },
                      {
                        title: "风险",
                        dataIndex: "riskLevel",
                        width: 90,
                        render: (value: ToolRow["riskLevel"]) => (
                          <Tag color={riskColors[value]}>{value}</Tag>
                        ),
                      },
                      {
                        title: "审批",
                        dataIndex: "approvalRequired",
                        width: 90,
                        render: (value) =>
                          value ? (
                            <Tag icon={<SafetyCertificateOutlined />} color="orange">
                              需要
                            </Tag>
                          ) : (
                            <Tag>自动</Tag>
                          ),
                      },
                      {
                        title: "状态",
                        dataIndex: "status",
                        width: 90,
                        render: (value) => (
                          <Tag color={value === 1 ? "green" : "default"}>
                            {value === 1 ? "启用" : "停用"}
                          </Tag>
                        ),
                      },
                      {
                        title: "操作",
                        width: 140,
                        fixed: "right",
                        render: (_, row) => (
                          <Space>
                            <Button
                              type="text"
                              icon={<EditOutlined />}
                              onClick={() => openTool(row)}
                            />
                            <Popconfirm
                              title="确认删除该工具？"
                              onConfirm={() => void remove("tool", row.id)}
                              disabled={row.isSystem}
                            >
                              <Button
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                disabled={row.isSystem}
                              />
                            </Popconfirm>
                          </Space>
                        ),
                      },
                    ]}
                    scroll={{ x: 760, y: "100%" }}
                  />
                </div>
              ),
            },
            {
              key: "runs",
              label: "Runs",
              children: (
                <div className="ai-agent-tab-panel">
                  <Table
                    className="admin-table-surface admin-fill-table"
                    rowKey="id"
                    loading={runsQuery.isLoading}
                    dataSource={runsQuery.data ?? []}
                    pagination={{
                      pageSize: 20,
                      showSizeChanger: true,
                      showTotal: (total) => `共 ${total} 条`,
                    }}
                    scroll={{ x: 920, y: "100%" }}
                    onRow={(row) => ({
                      onClick: () => setActiveRun(row),
                      style: { cursor: "pointer" },
                    })}
                    columns={[
                      { title: "Run", dataIndex: "id", width: 90, render: (value) => `#${value}` },
                      { title: "Agent", dataIndex: "agentName" },
                      {
                        title: "状态",
                        dataIndex: "status",
                        render: (value) => (
                          <Tag
                            color={
                              value === "completed"
                                ? "green"
                                : value === "failed"
                                  ? "red"
                                  : value === "waiting_approval"
                                    ? "orange"
                                    : "blue"
                            }
                          >
                            {value}
                          </Tag>
                        ),
                      },
                      { title: "步骤", dataIndex: "totalSteps", width: 90 },
                      {
                        title: "Tokens",
                        render: (_, row) => `${row.inputTokens} / ${row.outputTokens}`,
                      },
                      {
                        title: "耗时",
                        dataIndex: "durationMs",
                        render: (value) => (value ? `${value} ms` : "-"),
                      },
                      {
                        title: "开始时间",
                        dataIndex: "startedAt",
                        render: (value) => (value ? new Date(value).toLocaleString() : "-"),
                      },
                    ]}
                  />
                </div>
              ),
            },
            {
              key: "workflows",
              label: "Workflows",
              children: (
                <div className="ai-agent-tab-panel ai-agent-workflow-panel">
                  <WorkflowListPanel embedded />
                  <Alert
                    showIcon
                    type="info"
                    title={preflightDefinition?.name || "AI 运行环境预检"}
                    description={
                      preflightDefinition?.description ||
                      "检查 Agent、Provider、Model、Tool 和治理上下文，不调用外部模型，也不修改配置。"
                    }
                  />
                  <div className="admin-toolbar">
                    <Space wrap>
                      <Tag icon={<ApartmentOutlined />} color="blue">
                        Mastra Workflow
                      </Tag>
                      <Select
                        value={selectedWorkflowAgentId ?? undefined}
                        placeholder="选择需要预检的 Agent"
                        style={{ minWidth: 320 }}
                        onChange={(value) => setWorkflowAgentId(value)}
                        options={agents.map((agent) => ({
                          value: agent.id,
                          label: `${agent.name} · ${agent.code}`,
                        }))}
                      />
                    </Space>
                    <AuthButton auth="system.aiAgent.executeWorkflow">
                      <Button
                        type="primary"
                        icon={<PlayCircleOutlined />}
                        loading={runWorkflow.isPending}
                        disabled={!selectedWorkflowAgentId}
                        onClick={() =>
                          selectedWorkflowAgentId && runWorkflow.mutate(selectedWorkflowAgentId)
                        }
                      >
                        运行预检
                      </Button>
                    </AuthButton>
                  </div>
                  <Table
                    className="admin-table-surface admin-fill-table"
                    rowKey="id"
                    loading={workflowRunsQuery.isLoading}
                    dataSource={workflowRunsQuery.data ?? []}
                    pagination={{ pageSize: 20 }}
                    scroll={{ x: 1080, y: "100%" }}
                    onRow={(row) => ({
                      onClick: () => setActiveWorkflowRunId(row.id),
                      style: { cursor: "pointer" },
                    })}
                    columns={[
                      {
                        title: "Run",
                        dataIndex: "id",
                        width: 90,
                        render: (value) => `#${value}`,
                      },
                      {
                        title: "工作流",
                        dataIndex: "workflowCode",
                        render: (value) => (
                          <Space orientation="vertical" size={0}>
                            <Typography.Text strong>
                              {value === "ai-runtime-preflight" ? "AI 运行环境预检" : value}
                            </Typography.Text>
                            <Typography.Text type="secondary" code>
                              {value}
                            </Typography.Text>
                          </Space>
                        ),
                      },
                      {
                        title: "执行状态",
                        dataIndex: "status",
                        width: 110,
                        render: (value) => (
                          <Tag
                            color={
                              value === "completed" ? "green" : value === "failed" ? "red" : "blue"
                            }
                          >
                            {value}
                          </Tag>
                        ),
                      },
                      {
                        title: "预检结论",
                        dataIndex: "output",
                        width: 120,
                        render: (value: WorkflowOutput | null) => {
                          if (!value) return "-";
                          const color =
                            value.status === "ready"
                              ? "green"
                              : value.status === "warning"
                                ? "gold"
                                : "red";
                          return <Tag color={color}>{value.status}</Tag>;
                        },
                      },
                      {
                        title: "Agent ID",
                        dataIndex: "resourceId",
                        width: 100,
                      },
                      {
                        title: "Request ID",
                        dataIndex: "requestId",
                        ellipsis: true,
                        render: (value) =>
                          value ? <Typography.Text copyable>{value}</Typography.Text> : "-",
                      },
                      {
                        title: "耗时",
                        dataIndex: "durationMs",
                        width: 110,
                        render: (value) => (value == null ? "-" : `${value} ms`),
                      },
                      {
                        title: "开始时间",
                        dataIndex: "startedAt",
                        width: 190,
                        render: (value) => (value ? new Date(value).toLocaleString() : "-"),
                      },
                    ]}
                  />
                </div>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={editingAgent ? "编辑 Agent" : "新建 Agent"}
        open={agentModal}
        width={760}
        okText="保存"
        cancelText="取消"
        confirmLoading={saveAgent.isPending}
        onCancel={() => setAgentModal(false)}
        onOk={() => void agentForm.validateFields().then((values) => saveAgent.mutateAsync(values))}
      >
        <Form form={agentForm} layout="vertical" className="admin-entity-form-grid">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="code" label="编码" rules={[{ required: true }]}>
            <Input disabled={Boolean(editingAgent?.isSystem)} />
          </Form.Item>
          <Form.Item name="modelId" label="模型">
            <Select
              allowClear
              placeholder="使用系统默认模型"
              options={(optionsQuery.data?.models ?? []).map((item) => ({
                value: item.id,
                label: `${item.providerName} / ${item.name} (${item.modelId})`,
              }))}
            />
          </Form.Item>
          <Form.Item name="toolIds" label="工具">
            <Select
              mode="multiple"
              allowClear
              options={tools.map((item) => ({
                value: item.id,
                label: `${item.name} · ${item.riskLevel}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="temperature" label="Temperature">
            <InputNumber min={0} max={2} step={0.1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="maxOutputTokens" label="最大输出 Tokens">
            <InputNumber min={16} max={131072} step={512} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="maxSteps" label="最大执行步骤">
            <InputNumber min={1} max={20} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="sort" label="排序">
            <InputNumber style={{ width: "100%" }} />
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
          <Form.Item name="description" label="描述" className="admin-form-full">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item
            name="instructions"
            label="Instructions / System Prompt"
            className="admin-form-full"
            rules={[{ required: true }]}
          >
            <Input.TextArea rows={8} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingTool ? "编辑工具" : "新建工具"}
        open={toolModal}
        width={720}
        okText="保存"
        cancelText="取消"
        confirmLoading={saveTool.isPending}
        onCancel={() => setToolModal(false)}
        onOk={() => void toolForm.validateFields().then((values) => saveTool.mutateAsync(values))}
      >
        <Form form={toolForm} layout="vertical" className="admin-entity-form-grid">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="code" label="编码" rules={[{ required: true }]}>
            <Input disabled={Boolean(editingTool?.isSystem)} />
          </Form.Item>
          <Form.Item name="handlerKey" label="服务端处理器" rules={[{ required: true }]}>
            <Select
              disabled={Boolean(editingTool?.isSystem)}
              options={(optionsQuery.data?.handlers ?? []).map((item) => ({
                value: item.value,
                label: `${item.label} · ${item.value}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="riskLevel" label="风险等级">
            <Select options={Object.keys(riskColors).map((value) => ({ value, label: value }))} />
          </Form.Item>
          <Form.Item name="approvalRequired" label="需要人工审批" valuePropName="checked">
            <Switch />
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
            <InputNumber style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="description"
            label="给模型的工具描述"
            className="admin-form-full"
            rules={[{ required: true }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="inputSchemaJson" label="输入结构说明 JSON" className="admin-form-full">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="configJson" label="工具配置 JSON" className="admin-form-full">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={
          <Space size={8} wrap>
            <BugOutlined />
            <Typography.Text strong>
              {debugAgent ? `调试 · ${debugAgent.name}` : "Agent 调试"}
            </Typography.Text>
            {debugStatusTag(debugStatus)}
          </Space>
        }
        size="min(1120px, 94vw)"
        open={Boolean(debugAgent)}
        destroyOnHidden
        onClose={() => {
          debugControllerRef.current?.abort();
          setDebugAgent(null);
        }}
        extra={
          <Space>
            <Button
              icon={<ReloadOutlined />}
              disabled={!debugSessionId || debugStatus === "running"}
              onClick={() => {
                setDebugSessionId(null);
                setDebugRunId(null);
                setDebugOutput("");
                setDebugTrace([]);
                setDebugStatus("idle");
              }}
            >
              新上下文
            </Button>
            <Button
              type="primary"
              icon={<MessageOutlined />}
              disabled={!debugAgent}
              onClick={() => debugAgent && void openAgentInChat(debugAgent, debugSessionId)}
            >
              在 AI Chat 使用
            </Button>
          </Space>
        }
      >
        {debugAgent ? (
          <div className="ai-agent-debug-layout">
            <section className="ai-agent-debug-main">
              <Card size="small" className="admin-card" variant="borderless">
                <Space size={[6, 6]} wrap>
                  <Tag color="cyan">{debugAgent.code}</Tag>
                  <Tag>{debugAgent.modelName || "系统默认模型"}</Tag>
                  <Tag icon={<ToolOutlined />}>{debugAgent.toolIds.length} 个工具</Tag>
                  <Tag>最多 {debugAgent.maxSteps} 步</Tag>
                  {debugSessionId ? <Tag>Session #{debugSessionId}</Tag> : null}
                  {debugRunId ? <Tag color="blue">Run #{debugRunId}</Tag> : null}
                </Space>
                {debugAgent.description ? (
                  <Typography.Paragraph type="secondary" className="ai-agent-debug-description">
                    {debugAgent.description}
                  </Typography.Paragraph>
                ) : null}
              </Card>

              <Card
                size="small"
                className="admin-card"
                variant="borderless"
                title="模型回复"
                extra={debugStatus === "running" ? <Spin size="small" /> : null}
              >
                <StreamingMarkdown
                  content={debugOutput}
                  minHeight={260}
                  maxHeight={520}
                  placeholder={
                    debugStatus === "running" ? "Agent 正在运行..." : "输入消息后开始调试"
                  }
                />
                {debugError ? (
                  <Alert showIcon type="error" title="调试失败" description={debugError} />
                ) : null}
              </Card>

              {pendingDebugApprovals.map((approval) => (
                <Alert
                  key={approval.id}
                  showIcon
                  type="warning"
                  title={
                    <Space size={6} wrap>
                      <Typography.Text strong>
                        工具审批 · {approval.toolDisplayName || approval.toolName}
                      </Typography.Text>
                      <Tag color={riskColors[approval.riskLevel]}>{approval.riskLevel}</Tag>
                      <Tag>Run #{approval.runId}</Tag>
                    </Space>
                  }
                  description={
                    <Space orientation="vertical" size={10} style={{ width: "100%" }}>
                      {approval.toolDescription ? (
                        <Typography.Text type="secondary">
                          {approval.toolDescription}
                        </Typography.Text>
                      ) : null}
                      <Typography.Text type="secondary">即将执行的参数</Typography.Text>
                      <JsonPreview value={approval.inputJson} />
                      {approval.planHash ? (
                        <Typography.Text copyable code>
                          planHash: {approval.planHash}
                        </Typography.Text>
                      ) : null}
                      {approval.affectedFilesJson ? (
                        <>
                          <Typography.Text type="secondary">受影响文件</Typography.Text>
                          <JsonPreview value={approval.affectedFilesJson} />
                        </>
                      ) : null}
                      {approval.validationJson ? (
                        <>
                          <Typography.Text type="secondary">隔离验证结果</Typography.Text>
                          <JsonPreview value={approval.validationJson} />
                        </>
                      ) : null}
                      {approval.expiresAt ? (
                        <Typography.Text type="secondary">
                          审批有效期至 {new Date(approval.expiresAt).toLocaleString()}
                        </Typography.Text>
                      ) : null}
                      <Space>
                        <Button
                          type="primary"
                          icon={<SafetyCertificateOutlined />}
                          loading={decideDebugApproval.isPending}
                          onClick={() =>
                            decideDebugApproval.mutate({ id: approval.id, approved: true })
                          }
                        >
                          批准并继续
                        </Button>
                        <Button
                          danger
                          loading={decideDebugApproval.isPending}
                          onClick={() =>
                            decideDebugApproval.mutate({ id: approval.id, approved: false })
                          }
                        >
                          拒绝
                        </Button>
                      </Space>
                    </Space>
                  }
                />
              ))}

              <div className="ai-agent-debug-composer">
                <Input.TextArea
                  value={debugPrompt}
                  rows={4}
                  maxLength={12000}
                  showCount
                  disabled={debugStatus === "running"}
                  placeholder="输入要交给 Agent 处理的任务"
                  onChange={(event) => setDebugPrompt(event.target.value)}
                  onPressEnter={(event) => {
                    if (event.shiftKey) return;
                    event.preventDefault();
                    void runDebug();
                  }}
                />
                {debugStatus === "running" ? (
                  <Button
                    danger
                    icon={<StopOutlined />}
                    onClick={() => debugControllerRef.current?.abort()}
                  >
                    停止
                  </Button>
                ) : (
                  <Button type="primary" icon={<SendOutlined />} onClick={() => void runDebug()}>
                    运行
                  </Button>
                )}
              </div>
            </section>

            <aside className="ai-agent-debug-trace">
              <div className="ai-agent-debug-trace-heading">
                <Typography.Text strong>运行轨迹</Typography.Text>
                <Typography.Text type="secondary">{debugTrace.length} 个事件</Typography.Text>
              </div>
              {debugTrace.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="运行后显示模型、工具和审批事件"
                />
              ) : (
                <div className="ai-agent-debug-trace-list" role="list">
                  {debugTrace.map((item, index) => (
                    <div
                      className="ai-agent-debug-trace-item"
                      key={`${item.createdAt}-${index}`}
                      role="listitem"
                    >
                      <Space orientation="vertical" size={5} style={{ width: "100%" }}>
                        <Space style={{ justifyContent: "space-between", width: "100%" }}>
                          <Tag
                            color={
                              item.event === "error"
                                ? "red"
                                : item.event === "approval"
                                  ? "orange"
                                  : item.event === "finish"
                                    ? "green"
                                    : "blue"
                            }
                          >
                            {item.label}
                          </Tag>
                          <Typography.Text type="secondary">{item.createdAt}</Typography.Text>
                        </Space>
                        <DebugDataPreview value={item.data} />
                      </Space>
                    </div>
                  ))}
                </div>
              )}
            </aside>
          </div>
        ) : null}
      </Drawer>

      <Drawer
        title={activeRun ? `Run #${activeRun.id} · ${activeRun.agentName}` : "Run 详情"}
        size="large"
        open={Boolean(activeRun)}
        onClose={() => setActiveRun(null)}
        loading={runTraceQuery.isLoading}
        extra={
          activeRun ? (
            <AuthButton auth="system.aiEval.saveCase">
              <Button
                icon={<SaveOutlined />}
                onClick={() => {
                  evalCaseForm.setFieldsValue({
                    datasetId: undefined,
                    name: `Run #${activeRun.id} · ${activeRun.agentName}`,
                  });
                  setEvalCaseModalOpen(true);
                }}
              >
                保存为 Eval Case
              </Button>
            </AuthButton>
          ) : null
        }
      >
        {runTraceQuery.data ? (
          <Space orientation="vertical" size={18} style={{ width: "100%" }}>
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="状态">
                <Tag>{runTraceQuery.data.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="总耗时">
                {runTraceQuery.data.durationMs == null
                  ? "-"
                  : `${runTraceQuery.data.durationMs} ms`}
              </Descriptions.Item>
              <Descriptions.Item label="步骤">{runTraceQuery.data.totalSteps}</Descriptions.Item>
              <Descriptions.Item label="Attempt">{runTraceQuery.data.attempt}</Descriptions.Item>
              <Descriptions.Item label="租约心跳">
                {runTraceQuery.data.heartbeatAt
                  ? new Date(runTraceQuery.data.heartbeatAt).toLocaleString()
                  : "-"}
              </Descriptions.Item>
              <Descriptions.Item label="Token">
                {runTraceQuery.data.inputTokens} 输入 / {runTraceQuery.data.outputTokens} 输出
              </Descriptions.Item>
              <Descriptions.Item label="开始">
                {runTraceQuery.data.startedAt
                  ? new Date(runTraceQuery.data.startedAt).toLocaleString()
                  : "-"}
              </Descriptions.Item>
              <Descriptions.Item label="结束">
                {runTraceQuery.data.finishedAt
                  ? new Date(runTraceQuery.data.finishedAt).toLocaleString()
                  : "-"}
              </Descriptions.Item>
            </Descriptions>

            <Typography.Title level={5}>模型调用</Typography.Title>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={runTraceQuery.data.invocations}
              expandable={{
                expandedRowRender: (invocation) => (
                  <Table
                    rowKey="attemptNo"
                    size="small"
                    pagination={false}
                    dataSource={invocation.attempts}
                    columns={[
                      { title: "尝试", dataIndex: "attemptNo", width: 70 },
                      { title: "Provider", dataIndex: "providerName" },
                      { title: "模型", dataIndex: "modelName" },
                      {
                        title: "状态",
                        dataIndex: "status",
                        render: (value) => <Tag>{value}</Tag>,
                      },
                      {
                        title: "首响",
                        dataIndex: "firstTokenMs",
                        render: (value) => (value == null ? "-" : `${value} ms`),
                      },
                      {
                        title: "耗时",
                        dataIndex: "latencyMs",
                        render: (value) => (value == null ? "-" : `${value} ms`),
                      },
                      {
                        title: "错误",
                        dataIndex: "errorMessage",
                        ellipsis: true,
                        render: (value) => value || "-",
                      },
                    ]}
                  />
                ),
                rowExpandable: (invocation) => invocation.attempts.length > 0,
              }}
              columns={[
                { title: "Trace", dataIndex: "id", width: 90, render: (value) => `#${value}` },
                { title: "用途", dataIndex: "purpose" },
                { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> },
                {
                  title: "尝试",
                  dataIndex: "attemptCount",
                  render: (value, row) =>
                    row.fallbackUsed ? <Tag color="warning">{value} 次</Tag> : value,
                },
                { title: "Token", render: (_, row) => `${row.inputTokens} / ${row.outputTokens}` },
                {
                  title: "耗时",
                  dataIndex: "durationMs",
                  render: (value) => (value == null ? "-" : `${value} ms`),
                },
              ]}
            />

            <Typography.Title level={5}>执行步骤</Typography.Title>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={runTraceQuery.data.steps}
              expandable={{
                expandedRowRender: (step) => (
                  <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                    <Typography.Text type="secondary">输入</Typography.Text>
                    <JsonPreview value={step.inputJson} />
                    <Typography.Text type="secondary">输出</Typography.Text>
                    <JsonPreview value={step.outputJson || step.usageJson} />
                    {step.errorMessage ? (
                      <Typography.Text type="danger">{step.errorMessage}</Typography.Text>
                    ) : null}
                  </Space>
                ),
              }}
              columns={[
                { title: "步骤", dataIndex: "stepNo", width: 70 },
                { title: "类型", dataIndex: "stepType", width: 100 },
                {
                  title: "工具",
                  dataIndex: "toolName",
                  render: (value) =>
                    value ? <Typography.Text code>{value}</Typography.Text> : "-",
                },
                { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> },
                {
                  title: "耗时",
                  dataIndex: "durationMs",
                  render: (value) => (value == null ? "-" : `${value} ms`),
                },
              ]}
            />
          </Space>
        ) : null}
      </Drawer>

      <Modal
        title="保存为 Eval Case"
        open={evalCaseModalOpen}
        width={560}
        confirmLoading={saveRunAsEvalCase.isPending}
        onCancel={() => setEvalCaseModalOpen(false)}
        onOk={() =>
          void evalCaseForm.validateFields().then((values) => saveRunAsEvalCase.mutateAsync(values))
        }
      >
        <Form form={evalCaseForm} layout="vertical">
          <Form.Item name="datasetId" label="Eval 数据集" rules={[{ required: true }]}>
            <Select
              loading={evalDatasetsQuery.isLoading}
              placeholder="选择要保存到的数据集"
              options={(evalDatasetsQuery.data ?? []).map((dataset) => ({
                value: dataset.id,
                label: `${dataset.name} · ${dataset.caseCount} Cases`,
              }))}
              notFoundContent={
                evalDatasetsQuery.isLoading ? <Spin size="small" /> : "请先在 AI Eval 创建数据集"
              }
            />
          </Form.Item>
          <Form.Item name="name" label="Case 名称">
            <Input maxLength={160} />
          </Form.Item>
          <Alert
            showIcon
            type="info"
            title="将固定当前 Run 的输入、Agent、输出和已成功调用的工具"
          />
        </Form>
      </Modal>

      <Drawer
        title={
          activeWorkflowRunId
            ? `Workflow Run #${activeWorkflowRunId} · AI 运行环境预检`
            : "Workflow Run"
        }
        size="min(1040px, 94vw)"
        open={Boolean(activeWorkflowRunId)}
        loading={workflowRunDetailQuery.isLoading}
        onClose={() => setActiveWorkflowRunId(null)}
      >
        {workflowRunDetailQuery.data ? (
          <Space orientation="vertical" size={18} style={{ width: "100%" }}>
            <Space size={[6, 6]} wrap>
              <Tag icon={<ApartmentOutlined />} color="blue">
                {workflowRunDetailQuery.data.workflowCode}
              </Tag>
              <Tag color={workflowRunDetailQuery.data.status === "completed" ? "green" : "red"}>
                {workflowRunDetailQuery.data.status}
              </Tag>
              {workflowRunDetailQuery.data.output ? (
                <Tag
                  color={
                    workflowRunDetailQuery.data.output.status === "ready"
                      ? "green"
                      : workflowRunDetailQuery.data.output.status === "warning"
                        ? "gold"
                        : "red"
                  }
                >
                  {workflowRunDetailQuery.data.output.status}
                </Tag>
              ) : null}
              {workflowRunDetailQuery.data.output?.orchestrator ? (
                <Tag>orchestrator: {workflowRunDetailQuery.data.output.orchestrator}</Tag>
              ) : null}
              {workflowRunDetailQuery.data.durationMs != null ? (
                <Tag>{workflowRunDetailQuery.data.durationMs} ms</Tag>
              ) : null}
            </Space>

            {workflowRunDetailQuery.data.requestId ? (
              <Typography.Text copyable code>
                requestId: {workflowRunDetailQuery.data.requestId}
              </Typography.Text>
            ) : null}

            {workflowRunDetailQuery.data.output?.runtime ? (
              <Alert
                showIcon
                type="success"
                icon={<CheckCircleOutlined />}
                title={`${workflowRunDetailQuery.data.output.runtime.provider.name} / ${workflowRunDetailQuery.data.output.runtime.model.name}`}
                description={`Provider: ${workflowRunDetailQuery.data.output.runtime.provider.code} · Model ID: ${workflowRunDetailQuery.data.output.runtime.model.modelId}`}
              />
            ) : null}

            <div>
              <Typography.Title level={5}>预检结果</Typography.Title>
              <Table
                rowKey="key"
                size="small"
                pagination={false}
                dataSource={workflowRunDetailQuery.data.output?.checks ?? []}
                columns={[
                  { title: "检查项", dataIndex: "label", width: 180 },
                  {
                    title: "结论",
                    dataIndex: "status",
                    width: 100,
                    render: (value: WorkflowCheck["status"]) => (
                      <Tag
                        color={value === "pass" ? "green" : value === "warning" ? "gold" : "red"}
                      >
                        {value}
                      </Tag>
                    ),
                  },
                  { title: "说明", dataIndex: "message" },
                ]}
              />
            </div>

            <div>
              <Typography.Title level={5}>执行步骤</Typography.Title>
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={workflowRunDetailQuery.data.steps}
                expandable={{
                  expandedRowRender: (step) => (
                    <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                      <Typography.Text type="secondary">输入</Typography.Text>
                      <DebugDataPreview value={step.input} />
                      <Typography.Text type="secondary">输出</Typography.Text>
                      <DebugDataPreview value={step.output} />
                    </Space>
                  ),
                }}
                columns={[
                  { title: "#", dataIndex: "stepNo", width: 64 },
                  { title: "步骤", dataIndex: "stepCode" },
                  {
                    title: "状态",
                    dataIndex: "status",
                    width: 100,
                    render: (value) => (
                      <Tag color={value === "completed" ? "green" : "red"}>{value}</Tag>
                    ),
                  },
                  {
                    title: "耗时",
                    dataIndex: "durationMs",
                    width: 110,
                    render: (value) => (value == null ? "-" : `${value} ms`),
                  },
                ]}
              />
            </div>

            {workflowRunDetailQuery.data.errorMessage ? (
              <Alert
                showIcon
                type="error"
                title="工作流执行失败"
                description={workflowRunDetailQuery.data.errorMessage}
              />
            ) : null}
          </Space>
        ) : null}
      </Drawer>
    </PageScaffold>
  );
}
