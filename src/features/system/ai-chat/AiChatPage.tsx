"use client";

import {
  CheckCircleOutlined,
  CloseOutlined,
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  DeploymentUnitOutlined,
  DownloadOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  MessageOutlined,
  PlusOutlined,
  RedoOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  SettingOutlined,
  StopOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Divider,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { StreamingMarkdown } from "@/components/ai/StreamingMarkdown";
import { getAuthToken } from "@/lib/auth-token";
import { buildQueryString, request, requestEventStream, type EventStreamMessage } from "@/lib/request";
import type { PageResult } from "@/lib/response";
import { useAuthStore } from "@/stores/auth";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";

type AiRuntimeConfig = {
  provider: {
    id: number;
    code: string;
    name: string;
    providerType: string;
    baseUrl: string;
    hasApiKey: boolean;
  };
  model: {
    id: number;
    name: string;
    modelId: string;
    modelType: string;
    contextWindow?: number | null;
    maxOutputTokens?: number | null;
  };
};

type AiRuntimeStatus =
  | (AiRuntimeConfig & { ready: true; reason: null })
  | { ready: false; reason: string; provider: null; model: null };

type ChatSession = {
  id: number;
  title: string;
  providerCode?: string | null;
  modelName?: string | null;
  modelIdentifier?: string | null;
  modelId?: number | null;
  agentId?: number | null;
  agentName?: string | null;
  systemPrompt?: string | null;
  temperatureMilli: number;
  maxOutputTokens?: number | null;
  contextSummary?: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  messageCount: number;
  lastMessageAt?: string | null;
  updatedAt: string;
};

type ChatMessage = {
  id: number | string;
  sessionId: number;
  role: "system" | "user" | "assistant";
  content: string;
  status?: "pending" | "streaming" | "completed" | "stopped" | "failed" | "superseded";
  errorMessage?: string | null;
  parentMessageId?: number | null;
  finishReason?: string | null;
  usageJson?: string | null;
  durationMs?: number | null;
  createdAt?: string;
  streaming?: boolean;
  error?: string;
};

type StreamFinish = {
  messageId?: number;
  finishReason?: string;
  usage?: Record<string, unknown>;
  durationMs?: number;
  waitingApproval?: boolean;
  context?: Record<string, unknown>;
};

type ChatOptions = {
  models: Array<{
    id: number;
    name: string;
    modelId: string;
    providerName: string;
    contextWindow?: number | null;
    maxOutputTokens?: number | null;
    isDefault?: boolean;
  }>;
  agents: Array<{ id: number; name: string; code: string; description?: string | null; modelName?: string | null }>;
};

type ChatProfile = {
  avatarUrl?: string | null;
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
  createdAt: string;
};

type AgentRunStep = {
  id: number;
  stepNo: number;
  stepType: "model" | "tool" | "approval";
  status: "running" | "waiting_approval" | "completed" | "denied" | "failed";
  toolName?: string | null;
  inputJson?: string | null;
  outputJson?: string | null;
  usageJson?: string | null;
  durationMs?: number | null;
  errorMessage?: string | null;
  startedAt?: string | null;
};

type AgentRunDetail = {
  id: number;
  sessionId: number;
  agentId: number;
  agentName: string;
  agentCode: string;
  modelName?: string | null;
  modelIdentifier?: string | null;
  status: "queued" | "running" | "waiting_approval" | "completed" | "stopped" | "failed";
  totalSteps: number;
  inputTokens: number;
  outputTokens: number;
  durationMs?: number | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  steps: AgentRunStep[];
};

type LiveRunEvent = {
  id: number;
  kind: "model" | "tool" | "approval" | "finish" | "error";
  title: string;
  description?: string;
  status: "running" | "waiting" | "completed" | "failed";
  createdAt: string;
  data?: unknown;
};

const approvalRiskColors = {
  low: "green",
  medium: "gold",
  high: "orange",
  critical: "red",
} as const;

function formatJsonText(value?: string | null) {
  if (!value) return "{}";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function parseJsonText(value?: string | null) {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function friendlyStreamError(value: string) {
  if (/on conflict|constraint|relation .* does not exist|syntax error|sqlstate/i.test(value)) {
    return "Agent 工具调用未完成，请重试；详细错误已保留在服务端运行日志中。";
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatTime(value?: string | null) {
  if (!value) return "暂无消息";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function finishColor(finishReason?: string | null) {
  if (!finishReason) return "default";
  if (finishReason === "stop") return "success";
  if (finishReason === "length") return "warning";
  if (finishReason === "error") return "error";
  return "blue";
}

function messageMeta(message: ChatMessage) {
  const parts: string[] = [];
  if (message.durationMs) parts.push(`${message.durationMs} ms`);
  return parts.join(" / ");
}

const toolResultPrefix = "[已审批工具执行结果]";

function parseToolResultMessage(content: string) {
  if (!content.startsWith(toolResultPrefix)) return null;
  const [heading = "", ...bodyLines] = content.split("\n");
  const toolName = heading.slice(toolResultPrefix.length).trim() || "Agent 工具";
  const rawBody = bodyLines.join("\n").trim();
  return {
    toolName,
    body: rawBody ? formatJsonText(rawBody) : "暂无结果数据",
  };
}

function runStatusColor(status?: AgentRunDetail["status"]) {
  if (status === "completed") return "success";
  if (status === "failed") return "error";
  if (status === "waiting_approval") return "warning";
  if (status === "stopped") return "default";
  return "processing";
}

function stepTitle(step: AgentRunStep) {
  if (step.stepType === "approval") return "审批请求";
  if (step.stepType === "tool") return step.toolName ? `工具 · ${step.toolName}` : "工具调用";
  return "模型处理";
}

function stepDescription(step: AgentRunStep) {
  if (step.errorMessage) return step.errorMessage;
  if (step.stepType === "approval") return "等待管理员确认后继续执行";
  if (step.stepType === "tool") return step.status === "completed" ? "工具执行完成" : "正在执行工具";
  return step.status === "completed" ? "模型步骤已完成" : "模型正在生成回复";
}

function RunInspector({
  run,
  activeRunId,
  liveEvents,
  approvals,
  fallbackAgentName,
  fallbackModelName,
  isStreaming,
  deciding,
  onClose,
  onDecision,
}: {
  run?: AgentRunDetail | null;
  activeRunId?: number | null;
  liveEvents: LiveRunEvent[];
  approvals: ToolApproval[];
  fallbackAgentName?: string | null;
  fallbackModelName?: string | null;
  isStreaming: boolean;
  deciding: boolean;
  onClose: () => void;
  onDecision: (id: number, approved: boolean) => void;
}) {
  const persistedEvents: LiveRunEvent[] = (run?.steps ?? []).map((step) => ({
    id: step.id,
    kind: step.stepType === "approval" ? "approval" : step.stepType,
    title: stepTitle(step),
    description: stepDescription(step),
    status:
      step.status === "completed"
        ? "completed"
        : step.status === "failed" || step.status === "denied"
          ? "failed"
          : step.status === "waiting_approval"
            ? "waiting"
            : "running",
    createdAt: step.startedAt ? formatTime(step.startedAt) : "",
    data: parseJsonText(step.inputJson),
  }));
  const runHasFinished = run?.status === "completed" || run?.status === "failed" || run?.status === "stopped";
  const events = !isStreaming && runHasFinished && persistedEvents.length > 0
    ? persistedEvents
    : liveEvents.length > 0
      ? liveEvents
      : persistedEvents;
  const pendingApprovals = approvals.filter((item) => item.status === "pending");
  const status = isStreaming ? "running" : run?.status;

  return (
    <aside className="ai-chat-inspector" aria-label="Agent 运行检查器">
      <div className="ai-chat-inspector-header">
        <Space size={8}>
          <DeploymentUnitOutlined />
          <Typography.Text strong>运行检查器</Typography.Text>
        </Space>
        <Space size={6}>
          {run?.id || activeRunId ? <Typography.Text code>Run #{run?.id || activeRunId}</Typography.Text> : null}
          {status ? <Tag color={runStatusColor(status)}>{status}</Tag> : null}
          <Tooltip title="关闭检查器">
            <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} />
          </Tooltip>
        </Space>
      </div>

      <div className="ai-chat-inspector-scroll">
        <dl className="ai-chat-run-facts">
          <div><dt>Agent</dt><dd>{run?.agentName || fallbackAgentName || "未绑定"}</dd></div>
          <div><dt>模型</dt><dd>{run?.modelIdentifier || run?.modelName || fallbackModelName || "系统默认"}</dd></div>
          <div><dt>开始时间</dt><dd>{run?.startedAt ? formatTime(run.startedAt) : isStreaming ? "刚刚" : "-"}</dd></div>
          <div><dt>执行步骤</dt><dd>{run?.totalSteps ?? events.length}</dd></div>
        </dl>

        <div className="ai-chat-inspector-section-title">步骤时间线</div>
        {events.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="发送消息后显示 Agent 运行步骤" />
        ) : (
          <div className="ai-chat-run-timeline">
            {events.map((event) => (
              <div key={`${event.kind}-${event.id}`} className={`ai-chat-run-step ai-chat-run-step-${event.status}`}>
                <div className="ai-chat-run-step-icon">
                  {event.status === "running" ? <LoadingOutlined spin /> : null}
                  {event.status === "waiting" ? <SafetyCertificateOutlined /> : null}
                  {event.status === "completed" ? <CheckCircleOutlined /> : null}
                  {event.status === "failed" ? <ExclamationCircleOutlined /> : null}
                </div>
                <div className="ai-chat-run-step-content">
                  <div className="ai-chat-run-step-heading">
                    <Typography.Text strong>{event.title}</Typography.Text>
                    <Typography.Text type="secondary">{event.createdAt}</Typography.Text>
                  </div>
                  {event.description ? <Typography.Text type="secondary">{event.description}</Typography.Text> : null}
                  {event.data != null ? (
                    <details className="ai-chat-run-step-details">
                      <summary>查看数据</summary>
                      <pre>{JSON.stringify(event.data, null, 2)}</pre>
                    </details>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        {pendingApprovals.map((approval) => (
          <section key={approval.id} className="ai-chat-inspector-approval">
            <div className="ai-chat-inspector-approval-title">
              <Typography.Text strong>等待审批</Typography.Text>
              <Tag color={approvalRiskColors[approval.riskLevel]}>{approval.riskLevel}</Tag>
            </div>
            <dl>
              <div><dt>工具</dt><dd>{approval.toolDisplayName || approval.toolName}</dd></div>
              <div><dt>影响</dt><dd>{approval.toolDescription || "执行 Agent 请求的服务端工具"}</dd></div>
              <div><dt>范围</dt><dd>当前管理员可访问数据</dd></div>
              {approval.planHash ? <div><dt>计划</dt><dd><Typography.Text code copyable>{approval.planHash}</Typography.Text></dd></div> : null}
              {approval.expiresAt ? <div><dt>有效期</dt><dd>{formatTime(approval.expiresAt)}</dd></div> : null}
            </dl>
            <Typography.Text type="secondary">参数</Typography.Text>
            <pre className="ai-chat-approval-input">{formatJsonText(approval.inputJson)}</pre>
            {approval.affectedFilesJson ? (
              <details className="ai-chat-approval-raw">
                <summary><CodeOutlined /> 受影响文件</summary>
                <pre>{formatJsonText(approval.affectedFilesJson)}</pre>
              </details>
            ) : null}
            {approval.validationJson ? (
              <details className="ai-chat-approval-raw">
                <summary><SafetyCertificateOutlined /> 隔离验证结果</summary>
                <pre>{formatJsonText(approval.validationJson)}</pre>
              </details>
            ) : null}
            <Space orientation="vertical" size={8} style={{ width: "100%" }}>
              <Button type="primary" block loading={deciding} onClick={() => onDecision(approval.id, true)}>
                批准并继续
              </Button>
              <Button block loading={deciding} onClick={() => onDecision(approval.id, false)}>
                拒绝
              </Button>
            </Space>
            <details className="ai-chat-approval-raw">
              <summary><CodeOutlined /> 原始参数 JSON</summary>
              <pre>{formatJsonText(approval.inputJson)}</pre>
            </details>
          </section>
        ))}
      </div>

      <div className="ai-chat-inspector-footer">
        <span>总耗时 {run?.durationMs ? `${run.durationMs} ms` : "-"}</span>
        <span>输入 {run?.inputTokens ?? 0}</span>
        <span>输出 {run?.outputTokens ?? 0}</span>
      </div>
    </aside>
  );
}

export function AiChatPage() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.user);
  const [settingsForm] = Form.useForm();
  const [activeSessionId, setActiveSessionId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const sessionId = Number(new URLSearchParams(window.location.search).get("sessionId") || 0);
    return sessionId > 0 ? sessionId : null;
  });
  const [keyword, setKeyword] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [maxOutputTokens, setMaxOutputTokens] = useState(16384);
  const [timeoutMs, setTimeoutMs] = useState(60000);
  const [streamFinish, setStreamFinish] = useState<StreamFinish | null>(null);
  const [streamError, setStreamError] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [liveRunEvents, setLiveRunEvents] = useState<LiveRunEvent[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const liveRunEventIdRef = useRef(0);

  const sessionsQuery = useQuery({
    queryKey: ["system-ai-chat-sessions", keyword],
    queryFn: () =>
      request<PageResult<ChatSession>>(
        `/api/system/ai/chat/sessions${buildQueryString({
          page: 1,
          pageSize: 50,
          keyword,
        })}`,
      ),
  });

  const runtimeQuery = useQuery({
    queryKey: ["system-ai-chat-runtime"],
    queryFn: () => request<AiRuntimeStatus>("/api/system/ai/chat/runtime-config", { silent: true }),
    retry: false,
  });

  const optionsQuery = useQuery({
    queryKey: ["system-ai-chat-options"],
    queryFn: () => request<ChatOptions>("/api/system/ai/chat/options"),
  });

  const profileQuery = useQuery({
    queryKey: ["profile"],
    enabled: Boolean(currentUser),
    queryFn: () => request<ChatProfile>("/api/system/profile", { silent: true }),
    staleTime: 5 * 60_000,
  });

  const messagesQuery = useQuery({
    queryKey: ["system-ai-chat-messages", activeSessionId],
    enabled: Boolean(activeSessionId) && !isStreaming,
    queryFn: () =>
      request<ChatMessage[]>(`/api/system/ai/chat/sessions/${activeSessionId}/messages`),
  });

  const approvalsQuery = useQuery({
    queryKey: ["system-ai-chat-approvals", activeSessionId],
    enabled: Boolean(activeSessionId),
    queryFn: () => request<ToolApproval[]>(`/api/system/ai/chat/sessions/${activeSessionId}/approvals`),
  });

  const latestRunQuery = useQuery({
    queryKey: ["system-ai-chat-latest-run", activeSessionId],
    enabled: Boolean(activeSessionId),
    queryFn: () => request<AgentRunDetail | null>(`/api/system/ai/chat/sessions/${activeSessionId}/run/latest`),
  });

  const displayedMessages = useMemo(
    () => (messages.length > 0 || isStreaming ? messages : (messagesQuery.data ?? [])),
    [isStreaming, messages, messagesQuery.data],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [displayedMessages, isStreaming]);

  const activeSession = useMemo(
    () => sessionsQuery.data?.data.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessionsQuery.data?.data],
  );
  const activeModel = useMemo(
    () => optionsQuery.data?.models.find((model) => model.id === activeSession?.modelId) ?? null,
    [activeSession?.modelId, optionsQuery.data?.models],
  );
  const activeAgent = useMemo(
    () => optionsQuery.data?.agents.find((agent) => agent.id === activeSession?.agentId) ?? null,
    [activeSession?.agentId, optionsQuery.data?.agents],
  );

  const createSessionMutation = useMutation({
    mutationFn: (title?: string) =>
      request<{ id: number }>("/api/system/ai/chat/sessions", {
        method: "POST",
        body: { title },
      }),
    onSuccess: async (result) => {
      setActiveSessionId(result.id);
      setMessages([]);
      setActiveRunId(null);
      setLiveRunEvents([]);
      await queryClient.invalidateQueries({ queryKey: ["system-ai-chat-sessions"] });
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) =>
      request(`/api/system/ai/chat/sessions/${id}`, {
        method: "PUT",
        body: { title },
      }),
    onSuccess: async () => {
      feedback.success("会话已重命名");
      setRenameOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["system-ai-chat-sessions"] });
    },
  });

  const settingsMutation = useMutation({
    mutationFn: ({ id, values }: { id: number; values: Record<string, unknown> }) =>
      request(`/api/system/ai/chat/sessions/${id}`, { method: "PUT", body: values }),
    onSuccess: async (_, variables) => {
      feedback.success("会话设置已保存");
      if (typeof variables.values.maxOutputTokens === "number") {
        setMaxOutputTokens(variables.values.maxOutputTokens);
      }
      setSettingsOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["system-ai-chat-sessions"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      request(`/api/system/ai/chat/sessions/${id}`, {
        method: "DELETE",
      }),
    onSuccess: async (_, id) => {
      feedback.success("会话已删除");
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setMessages([]);
        setActiveRunId(null);
        setLiveRunEvents([]);
      }
      await queryClient.invalidateQueries({ queryKey: ["system-ai-chat-sessions"] });
    },
  });

  const ensureSession = async () => {
    if (activeSessionId) return activeSessionId;
    const result = await createSessionMutation.mutateAsync("新的聊天");
    return result.id;
  };

  const appendLiveRunEvent = (event: Omit<LiveRunEvent, "id" | "createdAt">) => {
    liveRunEventIdRef.current += 1;
    setLiveRunEvents((current) => [
      ...current,
      {
        ...event,
        id: liveRunEventIdRef.current,
        createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }),
      },
    ]);
  };

  const handleStreamEvent = (message: EventStreamMessage) => {
    const data = asRecord(message.data);
    if (message.event === "meta" && data) {
      if (typeof data.runId === "number") {
        setActiveRunId(data.runId);
        setInspectorOpen(true);
      }
      appendLiveRunEvent({
        kind: "model",
        title: "模型处理",
        description: "正在分析用户问题并选择执行路径",
        status: "running",
        data: {
          model: asRecord(data.model)?.modelId,
          endpoint: data.endpoint,
        },
      });
      return;
    }
    if (message.event === "tool-call" && data) {
      appendLiveRunEvent({
        kind: "tool",
        title: `工具调用 · ${String(data.toolName || "unknown")}`,
        description: "模型请求执行服务端工具",
        status: "running",
        data: data.input,
      });
      return;
    }
    if (message.event === "tool-result" && data) {
      appendLiveRunEvent({
        kind: "tool",
        title: `工具结果 · ${String(data.toolName || "unknown")}`,
        description: "服务端工具执行完成",
        status: "completed",
        data: data.output,
      });
      return;
    }
    if (message.event === "finish" && data) {
      setStreamFinish({
        messageId: typeof data.messageId === "number" ? data.messageId : undefined,
        finishReason: typeof data.finishReason === "string" ? data.finishReason : undefined,
        usage: asRecord(data.usage) ?? undefined,
        durationMs: typeof data.durationMs === "number" ? data.durationMs : undefined,
        waitingApproval: data.waitingApproval === true,
        context: asRecord(data.context) ?? undefined,
      });
      setMessages((previous) =>
        previous.map((item) =>
          item.id === "streaming-assistant"
            ? {
                ...item,
                id: typeof data.messageId === "number" ? data.messageId : item.id,
                finishReason: typeof data.finishReason === "string" ? data.finishReason : item.finishReason,
                durationMs: typeof data.durationMs === "number" ? data.durationMs : item.durationMs,
                usageJson: data.usage ? JSON.stringify(data.usage) : item.usageJson,
                status: "completed",
                streaming: false,
              }
            : item,
        ),
      );
      appendLiveRunEvent({
        kind: "finish",
        title: data.waitingApproval === true ? "等待审批" : "最终回复",
        description: data.waitingApproval === true ? "需要管理员确认工具调用" : "本次 Agent 运行已完成",
        status: data.waitingApproval === true ? "waiting" : "completed",
        data: data.usage,
      });
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-approvals"] }),
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-latest-run"] }),
      ]);
      return;
    }
    if (message.event === "approval") {
      appendLiveRunEvent({
        kind: "approval",
        title: "审批请求",
        description: `等待确认工具 ${String(data?.toolName || "unknown")}`,
        status: "waiting",
        data: data?.input,
      });
      setInspectorOpen(true);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-approvals"] }),
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-latest-run"] }),
      ]);
      return;
    }
    if (message.event === "error" && data) {
      const error = friendlyStreamError(String(data.message || "AI Chat 流式调用失败"));
      setStreamError(error);
      appendLiveRunEvent({
        kind: "error",
        title: "运行失败",
        description: error,
        status: "failed",
      });
      setMessages((previous) =>
        previous.map((item) =>
          item.id === "streaming-assistant"
            ? { ...item, streaming: false, status: "failed", error, errorMessage: error }
            : item,
        ),
      );
    }
  };

  const executeStream = async (input: {
    sessionId: number;
    path: string;
    body: Record<string, unknown>;
    nextMessages: ChatMessage[];
  }) => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsStreaming(true);
    setStreamError("");
    setStreamFinish(null);
    setMessages(input.nextMessages);
    setActiveRunId(null);
    setLiveRunEvents([]);
    liveRunEventIdRef.current = 0;

    try {
      await requestEventStream(input.path, {
        method: "POST",
        body: input.body,
        signal: controller.signal,
        silent: true,
        onEvent: handleStreamEvent,
        onChunk: (chunk) => {
          setMessages((previous) =>
            previous.map((message) =>
              message.id === "streaming-assistant"
                ? { ...message, content: message.content + chunk }
                : message,
            ),
          );
        },
      });
    } catch (error) {
      if (controller.signal.aborted) {
        feedback.info("已停止生成");
      } else {
        const message = friendlyStreamError(error instanceof Error ? error.message : "AI Chat 发送失败");
        setStreamError(message);
        feedback.error(message);
      }
      setMessages((previous) =>
        previous.map((item) =>
          item.id === "streaming-assistant"
            ? { ...item, streaming: false, status: controller.signal.aborted ? "stopped" : "failed" }
            : item,
        ),
      );
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setIsStreaming(false);
      const durableMessages = await request<ChatMessage[]>(
        `/api/system/ai/chat/sessions/${input.sessionId}/messages`,
        { silent: true },
      ).catch(() => null);
      if (durableMessages) {
        queryClient.setQueryData(["system-ai-chat-messages", input.sessionId], durableMessages);
        setMessages([]);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-sessions"] }),
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-approvals", input.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-latest-run", input.sessionId] }),
      ]);
    }
  };

  const sendMessage = async () => {
    const content = input.trim();
    if (!content) {
      feedback.warning("请输入聊天内容");
      return;
    }
    const sessionId = await ensureSession();
    setInput("");
    const baseMessages = activeSessionId === sessionId ? displayedMessages : [];
    await executeStream({
      sessionId,
      path: `/api/system/ai/chat/sessions/${sessionId}/messages/stream`,
      body: { content, maxOutputTokens, timeoutMs },
      nextMessages: [
        ...baseMessages,
        { id: `local-user-${Date.now()}`, sessionId, role: "user", content, status: "completed" },
        { id: "streaming-assistant", sessionId, role: "assistant", content: "", status: "streaming", streaming: true },
      ],
    });
  };

  const regenerateMessage = async (messageId: number) => {
    if (!activeSessionId) return;
    const index = displayedMessages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    await executeStream({
      sessionId: activeSessionId,
      path: `/api/system/ai/chat/sessions/${activeSessionId}/messages/${messageId}/regenerate`,
      body: { maxOutputTokens, timeoutMs },
      nextMessages: [
        ...displayedMessages.slice(0, index),
        { id: "streaming-assistant", sessionId: activeSessionId, role: "assistant", content: "", status: "streaming", streaming: true },
      ],
    });
  };

  const resumeAgent = async (sessionId: number, baseMessages: ChatMessage[]) => {
    await executeStream({
      sessionId,
      path: `/api/system/ai/chat/sessions/${sessionId}/messages/stream`,
      body: { resume: true, maxOutputTokens, timeoutMs },
      nextMessages: [
        ...baseMessages,
        { id: "streaming-assistant", sessionId, role: "assistant", content: "", status: "streaming", streaming: true },
      ],
    });
  };

  const approvalMutation = useMutation({
    mutationFn: ({ id, approved }: { id: number; approved: boolean }) =>
      request<{ status: string; sessionId: number }>(`/api/system/ai/approval/${id}/decision`, {
        method: "POST",
        body: { approved },
      }),
    onSuccess: async (result) => {
      feedback.success(result.status === "executed" ? "工具已批准并执行" : "工具调用已拒绝");
      await queryClient.invalidateQueries({ queryKey: ["system-ai-chat-approvals"] });
      const durableMessages = await request<ChatMessage[]>(
        `/api/system/ai/chat/sessions/${result.sessionId}/messages`,
        { silent: true },
      );
      queryClient.setQueryData(["system-ai-chat-messages", result.sessionId], durableMessages);
      setMessages(durableMessages);
      await resumeAgent(result.sessionId, durableMessages);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-approvals"] }),
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-sessions"] }),
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-latest-run"] }),
      ]);
    },
  });

  const exportSession = async (format: "markdown" | "json") => {
    if (!activeSessionId) return;
    const response = await fetch(`/api/system/ai/chat/sessions/${activeSessionId}/export?format=${format}`, {
      headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : undefined,
    });
    if (!response.ok) {
      feedback.error("导出会话失败");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ai-chat-${activeSessionId}.${format === "json" ? "json" : "md"}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const runtime = runtimeQuery.data?.ready ? runtimeQuery.data : null;
  const displayModelId = activeModel?.modelId || activeSession?.modelIdentifier || runtime?.model.modelId;
  const displayModelName = activeModel?.name || activeAgent?.modelName || activeSession?.modelName || runtime?.model.name;
  const displayProviderName = activeModel?.providerName || activeSession?.providerCode || runtime?.provider.name;

  return (
    <PageScaffold
      title="AI Chat"
      description="使用会话模型或 Agent 进行连续对话，保存消息、运行状态和审批记录"
      className="ai-chat-page"
    >
      <div className={inspectorOpen ? "ai-chat-layout ai-chat-layout-inspector" : "ai-chat-layout"}>
        <Card
          className="admin-card ai-chat-sidebar"
          variant="borderless"
          title="聊天会话"
          extra={
            <Tooltip title="新建聊天">
              <Button
                size="small"
                type="primary"
                icon={<PlusOutlined />}
                loading={createSessionMutation.isPending}
                onClick={() => void createSessionMutation.mutateAsync("新的聊天")}
              />
            </Tooltip>
          }
          styles={{ body: { padding: 12 } }}
        >
          <div className="ai-chat-sidebar-body">
            <Input.Search
              allowClear
              placeholder="搜索会话"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            {sessionsQuery.isLoading ? (
              <Spin />
            ) : !(sessionsQuery.data?.data.length) ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无会话" />
            ) : (
              <div className="ai-chat-session-list" role="list">
                {(sessionsQuery.data?.data ?? []).map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    className={
                      activeSessionId === session.id
                        ? "ai-chat-session ai-chat-session-active"
                        : "ai-chat-session"
                    }
                    onClick={() => {
                      setActiveSessionId(session.id);
                      setMessages([]);
                      setStreamError("");
                      setStreamFinish(null);
                      setActiveRunId(null);
                      setLiveRunEvents([]);
                      setMaxOutputTokens(session.maxOutputTokens ?? 16384);
                    }}
                  >
                    <MessageOutlined className="ai-chat-session-icon" />
                    <span className="ai-chat-session-meta">
                      <span className="ai-chat-session-title">
                        <Typography.Text ellipsis strong={activeSessionId === session.id}>
                          {session.title}
                        </Typography.Text>
                      </span>
                      <Typography.Text type="secondary" ellipsis>
                        {session.modelIdentifier || session.modelName || "未调用模型"}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        {session.messageCount} 条消息 / {formatTime(session.lastMessageAt || session.updatedAt)}
                      </Typography.Text>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card
          className="admin-card ai-chat-main"
          variant="borderless"
          title={
            <Space size={8} wrap>
              <Typography.Text strong>{activeSession?.title ?? "新的聊天"}</Typography.Text>
              {displayModelId ? <Tag color="blue">{displayModelId}</Tag> : null}
              {activeSession?.agentName ? <Tag icon={<RobotOutlined />} color="cyan">{activeSession.agentName}</Tag> : null}
              {isStreaming ? <Tag color="processing">生成中</Tag> : null}
            </Space>
          }
          extra={
            <Space>
              {!inspectorOpen ? (
                <Tooltip title="打开运行检查器">
                  <Button
                    size="small"
                    icon={<DeploymentUnitOutlined />}
                    onClick={() => setInspectorOpen(true)}
                  />
                </Tooltip>
              ) : null}
              <Tooltip title="重命名">
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  disabled={!activeSession}
                  onClick={() => {
                    if (!activeSession) return;
                    setRenameTitle(activeSession.title);
                    setRenameOpen(true);
                  }}
                />
              </Tooltip>
              <Tooltip title="会话设置">
                <Button
                  size="small"
                  icon={<SettingOutlined />}
                  disabled={!activeSession}
                  onClick={() => {
                    if (!activeSession) return;
                    settingsForm.setFieldsValue({
                      modelId: activeSession.modelId ?? undefined,
                      agentId: activeSession.agentId ?? undefined,
                      systemPrompt: activeSession.systemPrompt ?? "",
                      temperature: activeSession.temperatureMilli / 1000,
                      maxOutputTokens: activeSession.maxOutputTokens ?? 16384,
                    });
                    setSettingsOpen(true);
                  }}
                />
              </Tooltip>
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    { key: "markdown", label: "导出 Markdown" },
                    { key: "json", label: "导出 JSON" },
                  ],
                  onClick: ({ key }) => void exportSession(key === "json" ? "json" : "markdown"),
                }}
              >
                <Tooltip title="导出会话">
                  <Button size="small" icon={<DownloadOutlined />} disabled={!activeSession} />
                </Tooltip>
              </Dropdown>
              <Tooltip title="删除会话">
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={!activeSession}
                  loading={deleteMutation.isPending}
                  onClick={() => {
                    if (!activeSession) return;
                    Modal.confirm({
                      title: "删除 AI Chat 会话",
                      content: `确认删除「${activeSession.title}」吗？该会话的消息历史会一并删除。`,
                      okText: "删除",
                      okButtonProps: { danger: true },
                      cancelText: "取消",
                      onOk: async () => {
                        await deleteMutation.mutateAsync(activeSession.id);
                      },
                    });
                  }}
                />
              </Tooltip>
            </Space>
          }
        >
          {(runtimeQuery.error || (!runtimeQuery.isLoading && !runtime)) && !activeModel && !activeSession?.modelIdentifier ? (
            <Alert
              showIcon
              type="warning"
              title="默认 Chat 模型未就绪"
              description={runtimeQuery.data?.reason}
            />
          ) : (
            <div className="ai-chat-runtime-strip">
              <Space size={8} wrap>
                <RobotOutlined />
                <Typography.Text strong>{activeSession?.agentName || "直接对话"}</Typography.Text>
                <Typography.Text type="secondary">{displayProviderName || "AI Provider"}</Typography.Text>
                <Tag color="blue">{displayModelId || displayModelName || "默认模型"}</Tag>
              </Space>
              <Typography.Text type="secondary">
                累计 {(activeSession?.totalInputTokens ?? 0).toLocaleString()} 输入 / {(activeSession?.totalOutputTokens ?? 0).toLocaleString()} 输出
              </Typography.Text>
            </div>
          )}

          <div className="ai-chat-message-scroll">
            {messagesQuery.isLoading && activeSessionId ? (
              <Spin />
            ) : displayedMessages.length === 0 ? (
              <Empty description="开始一个新的 AI 对话" />
            ) : (
              <Space orientation="vertical" size={14} style={{ width: "100%" }}>
                {displayedMessages.map((message) => {
                  const isUser = message.role === "user";
                  const isSystem = message.role === "system";
                  const toolResult = isSystem ? parseToolResultMessage(message.content) : null;
                  const lastAssistantId = [...displayedMessages].reverse().find((item) => item.role === "assistant")?.id;
                  const assistantStatus = message.streaming || message.status === "streaming"
                    ? "streaming"
                    : message.status && message.status !== "completed"
                      ? message.status
                      : null;
                  const userDisplayName = currentUser?.nickname || currentUser?.username || "当前用户";
                  const userAvatarFallback = userDisplayName.trim().slice(0, 1).toUpperCase();
                  return (
                    <div
                      key={message.id}
                      className={`ai-chat-message-row ${
                        isUser
                          ? "ai-chat-message-row-user"
                          : isSystem
                            ? "ai-chat-message-row-system"
                            : "ai-chat-message-row-assistant"
                      }`}
                    >
                      {!isUser && !isSystem ? (
                        <Avatar
                          className="ai-chat-message-avatar ai-chat-message-avatar-assistant"
                          size={34}
                          icon={<RobotOutlined />}
                        />
                      ) : null}

                      {toolResult ? (
                        <details className="ai-chat-tool-result">
                          <summary>
                            <span className="ai-chat-tool-result-icon"><CodeOutlined /></span>
                            <span className="ai-chat-tool-result-copy">
                              <strong>工具执行完成</strong>
                              <span>{toolResult.toolName}，结果已写入对话上下文</span>
                            </span>
                            <Typography.Text type="secondary">查看数据</Typography.Text>
                          </summary>
                          <pre>{toolResult.body}</pre>
                        </details>
                      ) : (
                        <div className="ai-chat-message-column">
                          <div className="ai-chat-message-meta">
                            <Typography.Text strong>
                              {isUser ? userDisplayName : isSystem ? "系统消息" : activeSession?.agentName || "AI 助手"}
                            </Typography.Text>
                            {!isUser && !isSystem ? (
                              <Typography.Text type="secondary">
                                {displayModelId || displayModelName || "默认模型"}
                              </Typography.Text>
                            ) : null}
                            {message.createdAt ? (
                              <Typography.Text type="secondary">{formatTime(message.createdAt)}</Typography.Text>
                            ) : null}
                          </div>

                          <div
                            className={`ai-chat-message ${
                              isUser
                                ? "ai-chat-message-user"
                                : isSystem
                                  ? "ai-chat-message-system"
                                  : "ai-chat-message-assistant"
                            }`}
                          >
                            {isUser || isSystem ? (
                              <Typography.Text className="ai-chat-message-text">
                                {message.content}
                              </Typography.Text>
                            ) : message.status === "failed" && !message.content ? (
                              <div className="ai-chat-message-error">
                                <ExclamationCircleOutlined />
                                <div>
                                  <Typography.Text strong>本次生成未完成</Typography.Text>
                                  <Typography.Text type="secondary">
                                    {friendlyStreamError(message.error || message.errorMessage || "请稍后重试")}
                                  </Typography.Text>
                                </div>
                              </div>
                            ) : (
                              <StreamingMarkdown
                                content={message.content}
                                minHeight={message.content ? 0 : assistantStatus === "streaming" ? 24 : 72}
                                maxHeight={null}
                                placeholder={assistantStatus === "streaming" ? "" : "回答未生成"}
                              />
                            )}
                          </div>

                          {!isUser && !isSystem ? (
                            <Space className="ai-chat-message-actions" size={6} wrap>
                              {assistantStatus && assistantStatus !== "streaming" ? (
                                <Tag color={assistantStatus === "failed" ? "error" : assistantStatus === "stopped" ? "warning" : "processing"}>
                                  {assistantStatus}
                                </Tag>
                              ) : null}
                              {message.finishReason && message.finishReason !== "stop" && message.finishReason !== "error" ? (
                                <Tag color={finishColor(message.finishReason)}>
                                  {message.finishReason}
                                </Tag>
                              ) : null}
                              {messageMeta(message) ? (
                                <Typography.Text type="secondary">{messageMeta(message)}</Typography.Text>
                              ) : null}
                              {(message.error || message.errorMessage) && message.content ? (
                                <Typography.Text type="danger">{message.error || message.errorMessage}</Typography.Text>
                              ) : null}
                              {message.content ? (
                                <Tooltip title="复制回答">
                                  <Button
                                    type="text"
                                    size="small"
                                    icon={<CopyOutlined />}
                                    onClick={() => void navigator.clipboard.writeText(message.content).then(() => feedback.success("已复制"))}
                                  />
                                </Tooltip>
                              ) : null}
                              {message.id === lastAssistantId && typeof message.id === "number" && !isStreaming ? (
                                <Tooltip title="重新生成">
                                  <Button type="text" size="small" icon={<RedoOutlined />} onClick={() => void regenerateMessage(message.id as number)} />
                                </Tooltip>
                              ) : null}
                            </Space>
                          ) : null}
                        </div>
                      )}

                      {isUser ? (
                        <Avatar
                          className="ai-chat-message-avatar ai-chat-message-avatar-user"
                          size={34}
                          src={profileQuery.data?.avatarUrl || undefined}
                          icon={userAvatarFallback ? undefined : <UserOutlined />}
                        >
                          {profileQuery.data?.avatarUrl ? null : userAvatarFallback}
                        </Avatar>
                      ) : null}
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </Space>
            )}
          </div>

          <div className="ai-chat-composer">
            <div className="ai-chat-composer-notices">
              {streamError ? <Alert showIcon type="error" title={streamError} /> : null}
              {streamFinish?.finishReason === "length" ? (
                <Alert showIcon type="warning" title="模型输出达到最大 tokens 限制，内容可能被截断。" />
              ) : null}
            </div>
            <Input.TextArea
              className="ai-chat-composer-input"
              value={input}
              rows={4}
              placeholder="输入消息，Shift + Enter 换行，Enter 发送"
              onChange={(event) => setInput(event.target.value)}
              onPressEnter={(event) => {
                if (event.shiftKey) return;
                event.preventDefault();
                if (!isStreaming) void sendMessage();
              }}
            />
            <Space className="ai-chat-composer-toolbar" wrap style={{ justifyContent: "space-between", width: "100%" }}>
              <Space wrap>
                <Typography.Text type="secondary">输出 tokens</Typography.Text>
                <InputNumber
                  min={16}
                  max={32768}
                  step={512}
                  value={maxOutputTokens}
                  onChange={(value) => setMaxOutputTokens(Number(value ?? 16384))}
                />
                <Typography.Text type="secondary">超时 ms</Typography.Text>
                <InputNumber
                  min={5000}
                  max={300000}
                  step={5000}
                  value={timeoutMs}
                  onChange={(value) => setTimeoutMs(Number(value ?? 60000))}
                />
              </Space>
              {isStreaming ? (
                <Button
                  danger
                  icon={<StopOutlined />}
                  onClick={() => controllerRef.current?.abort()}
                >
                  停止
                </Button>
              ) : (
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  loading={createSessionMutation.isPending}
                  onClick={() => void sendMessage()}
                >
                  发送
                </Button>
              )}
            </Space>
          </div>
        </Card>

        {inspectorOpen ? (
          <RunInspector
            run={latestRunQuery.data}
            activeRunId={activeRunId}
            liveEvents={liveRunEvents}
            approvals={approvalsQuery.data ?? []}
            fallbackAgentName={activeSession?.agentName}
            fallbackModelName={displayModelId || displayModelName}
            isStreaming={isStreaming}
            deciding={approvalMutation.isPending}
            onClose={() => setInspectorOpen(false)}
            onDecision={(id, approved) => approvalMutation.mutate({ id, approved })}
          />
        ) : null}
      </div>

      <Modal
        title="重命名会话"
        open={renameOpen}
        okText="保存"
        cancelText="取消"
        confirmLoading={renameMutation.isPending}
        onCancel={() => setRenameOpen(false)}
        onOk={() => {
          if (!activeSession || !renameTitle.trim()) {
            feedback.warning("请输入会话标题");
            return;
          }
          void renameMutation.mutateAsync({ id: activeSession.id, title: renameTitle.trim() });
        }}
      >
        <Input value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} />
      </Modal>

      <Modal
        title="会话运行设置"
        open={settingsOpen}
        width={680}
        okText="保存"
        cancelText="取消"
        confirmLoading={settingsMutation.isPending}
        onCancel={() => setSettingsOpen(false)}
        onOk={() => {
          if (!activeSession) return;
          void settingsForm.validateFields().then((values) =>
            settingsMutation.mutateAsync({ id: activeSession.id, values }),
          );
        }}
      >
        <Form form={settingsForm} layout="vertical">
          <Form.Item name="agentId" label="Agent">
            <Select
              allowClear
              placeholder="不使用 Agent，直接与模型对话"
              options={(optionsQuery.data?.agents ?? []).map((agent) => ({
                value: agent.id,
                label: `${agent.name} (${agent.code})`,
              }))}
            />
          </Form.Item>
          <Form.Item name="modelId" label="会话模型">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="使用 Agent 模型或系统默认 Chat 模型"
              options={(optionsQuery.data?.models ?? []).map((model) => ({
                value: model.id,
                label: `${model.providerName} / ${model.name} (${model.modelId})`,
              }))}
            />
          </Form.Item>
          <Space size={16} align="start" style={{ width: "100%" }}>
            <Form.Item name="temperature" label="Temperature">
              <InputNumber min={0} max={2} step={0.1} />
            </Form.Item>
            <Form.Item name="maxOutputTokens" label="最大输出 Tokens">
              <InputNumber min={16} max={32768} step={512} />
            </Form.Item>
          </Space>
          <Divider />
          <Form.Item name="systemPrompt" label="会话 System Prompt">
            <Input.TextArea rows={7} placeholder="只对当前会话生效；选择 Agent 时会追加在 Agent Instructions 后面" />
          </Form.Item>
        </Form>
      </Modal>
    </PageScaffold>
  );
}
