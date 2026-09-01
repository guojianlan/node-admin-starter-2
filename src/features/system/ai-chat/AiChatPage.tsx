"use client";

import {
  BulbOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  DeploymentUnitOutlined,
  DownloadOutlined,
  EditOutlined,
  EnvironmentOutlined,
  ExclamationCircleOutlined,
  GlobalOutlined,
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
import {
  buildQueryString,
  request,
  requestEventStream,
  type EventStreamMessage,
} from "@/lib/request";
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
  metadataJson?: string | null;
  durationMs?: number | null;
  createdAt?: string;
  streaming?: boolean;
  error?: string;
  sources?: AiChatSource[];
  timing?: ChatMessageTiming;
};

type ChatMessageTiming = {
  totalMs?: number | null;
  firstResponseMs?: number | null;
  firstTextMs?: number | null;
  reasoningMs?: number | null;
  generationMs?: number | null;
  reasoningObserved?: boolean;
};

type AiChatSource = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source: string;
};

type StreamFinish = {
  messageId?: number;
  finishReason?: string;
  usage?: Record<string, unknown>;
  durationMs?: number;
  waitingApproval?: boolean;
  context?: Record<string, unknown>;
  timing?: ChatMessageTiming;
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
  agents: Array<{
    id: number;
    name: string;
    code: string;
    description?: string | null;
    modelName?: string | null;
    toolCodes: string[];
  }>;
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
  status: "pending" | "executing" | "approved" | "denied" | "expired" | "executed" | "failed";
  reason?: string | null;
  continuationRunId?: number | null;
  continuationRunStatus?: string | null;
  createdAt: string;
};

type BrowserLocationResult =
  | {
      status: "granted";
      latitude: number;
      longitude: number;
      accuracy?: number;
    }
  | {
      status: "denied" | "unavailable" | "error";
      reason: string;
    };

type BrowserLocationNotice = {
  status: "granted" | "denied" | "unavailable" | "timeout" | "error" | "expired";
  title: string;
  description: string;
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
  status:
    | "queued"
    | "running"
    | "waiting_approval"
    | "waiting_continuation"
    | "completed"
    | "stopped"
    | "failed";
  attempt: number;
  leaseUntil?: string | null;
  heartbeatAt?: string | null;
  totalSteps: number;
  inputTokens: number;
  outputTokens: number;
  durationMs?: number | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  steps: AgentRunStep[];
  events?: PersistedRunEvent[];
};

type PersistedRunEvent = {
  id: number;
  runId: number;
  attempt: number;
  sequence: number;
  eventType: string;
  payload: unknown;
  createdAt: string;
};

type LiveRunEvent = {
  id: number;
  eventKey: string;
  kind: "model" | "tool" | "approval" | "finish" | "error";
  title: string;
  description?: string;
  status: "running" | "waiting" | "completed" | "failed";
  createdAt: string;
  durationMs?: number | null;
  input?: unknown;
  output?: unknown;
  usage?: unknown;
  error?: string | null;
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

function ChatApprovalCard({
  approval,
  deciding,
  onDecision,
}: {
  approval: ToolApproval;
  deciding: boolean;
  onDecision: (id: number, approved: boolean) => void;
}) {
  const isReadOnlyMcp = approval.handlerKey === "mcp_gateway";
  const description = isReadOnlyMcp
    ? "读取当前管理员有权查看的系统数据，不会修改页面、菜单、人员或权限。"
    : approval.toolDescription || "执行 Agent 请求的服务端工具";

  return (
    <section className="ai-chat-approval-card" aria-label="工具调用审批" aria-live="polite">
      <div className="ai-chat-approval-card-header">
        <div className="ai-chat-approval-card-title">
          <span className="ai-chat-approval-card-icon" aria-hidden="true">
            <SafetyCertificateOutlined />
          </span>
          <div>
            <Typography.Text strong>需要你的确认</Typography.Text>
            <Typography.Text type="secondary">AI 正在等待工具执行许可</Typography.Text>
          </div>
        </div>
        <Tag color={isReadOnlyMcp ? "blue" : approvalRiskColors[approval.riskLevel]}>
          {isReadOnlyMcp
            ? "只读"
            : approval.riskLevel === "low"
              ? "低风险"
              : approval.riskLevel === "medium"
                ? "中风险"
                : approval.riskLevel === "high"
                  ? "高风险"
                  : "关键操作"}
        </Tag>
      </div>

      <div className="ai-chat-approval-card-body">
        <Typography.Text className="ai-chat-approval-card-tool" strong>
          {approval.toolDisplayName || approval.toolName}
        </Typography.Text>
        <Typography.Paragraph type="secondary">{description}</Typography.Paragraph>
        <Typography.Text type="secondary" className="ai-chat-approval-card-scope">
          本次只请求一项工具权限，完成后才会继续下一项。
        </Typography.Text>
      </div>

      <div className="ai-chat-approval-card-actions">
        <Button loading={deciding} onClick={() => onDecision(approval.id, false)}>
          拒绝
        </Button>
        <Button
          type="primary"
          icon={<CheckCircleOutlined />}
          loading={deciding}
          onClick={() => onDecision(approval.id, true)}
        >
          允许执行
        </Button>
      </div>
    </section>
  );
}

function parseMessageSources(message: ChatMessage) {
  if (message.sources?.length) return message.sources;
  if (!message.metadataJson) return [];
  try {
    const metadata = JSON.parse(message.metadataJson) as { sources?: unknown };
    if (!Array.isArray(metadata.sources)) return [];
    return metadata.sources.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const source = item as Record<string, unknown>;
      const url = String(source.url || "");
      if (!/^https?:\/\//.test(url)) return [];
      return [
        {
          title: String(source.title || url),
          url,
          snippet: String(source.snippet || ""),
          ...(source.publishedAt ? { publishedAt: String(source.publishedAt) } : {}),
          source: String(source.source || "web"),
        },
      ];
    });
  } catch {
    return [];
  }
}

function parseMessageMetadata(message: ChatMessage) {
  if (!message.metadataJson) return null;
  try {
    return asRecord(JSON.parse(message.metadataJson));
  } catch {
    return null;
  }
}

function optionalMetric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function parseMessageTiming(message: ChatMessage): ChatMessageTiming | null {
  const raw = message.timing ?? asRecord(parseMessageMetadata(message)?.timing);
  const timing = raw ? asRecord(raw) : null;
  const totalMs = optionalMetric(timing?.totalMs) ?? optionalMetric(message.durationMs);
  const parsed: ChatMessageTiming = {
    totalMs,
    firstResponseMs: optionalMetric(timing?.firstResponseMs),
    firstTextMs: optionalMetric(timing?.firstTextMs),
    reasoningMs: optionalMetric(timing?.reasoningMs),
    generationMs: optionalMetric(timing?.generationMs),
    reasoningObserved: timing?.reasoningObserved === true,
  };
  return Object.values(parsed).some((value) => value != null && value !== false) ? parsed : null;
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

function getBrowserLocation(): Promise<BrowserLocationResult> {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return Promise.resolve({ status: "unavailable", reason: "当前环境不支持浏览器定位" });
  }
  if (!window.isSecureContext) {
    return Promise.resolve({
      status: "unavailable",
      reason: "浏览器只允许在 HTTPS 或 localhost 中使用定位",
    });
  }
  if (!navigator.geolocation) {
    return Promise.resolve({ status: "unavailable", reason: "当前浏览器不支持定位" });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const round = (value: number) => Math.round(value * 100) / 100;
        resolve({
          status: "granted",
          latitude: round(position.coords.latitude),
          longitude: round(position.coords.longitude),
          accuracy: Math.round(position.coords.accuracy),
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          resolve({ status: "denied", reason: "浏览器位置权限未授权" });
          return;
        }
        if (error.code === error.POSITION_UNAVAILABLE) {
          resolve({ status: "unavailable", reason: "浏览器暂时无法获取当前位置" });
          return;
        }
        if (error.code === error.TIMEOUT) {
          resolve({ status: "error", reason: "获取位置超时，请手动输入城市" });
          return;
        }
        resolve({ status: "error", reason: "浏览器定位失败，请手动输入城市" });
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

function parseBrowserLocationNotice(content: string): BrowserLocationNotice | null {
  if (!content.startsWith("[浏览器位置结果]")) return null;
  if (content.includes("用户已允许本次使用大致位置")) {
    return {
      status: "granted",
      title: "已使用本次大致位置",
      description: "位置已粗化后交给 Agent，正在继续处理当前问题。",
    };
  }
  if (content.includes("位置授权已过期") || content.includes("本次位置授权已过期")) {
    return {
      status: "expired",
      title: "位置授权已过期",
      description: "本次请求没有读取位置，可以重新提问或直接输入城市。",
    };
  }
  const reason = content.match(/用户未提供位置：(.+?)。请继续/)?.[1] || "没有获得位置";
  if (reason.includes("超时")) {
    return {
      status: "timeout",
      title: "没有在规定时间内获得位置",
      description: "已停止等待定位，Agent 会改为询问城市。",
    };
  }
  if (reason.includes("权限") || reason.includes("未授权")) {
    return {
      status: "denied",
      title: "位置权限未授权",
      description: "没有读取设备位置，Agent 会改为询问城市。",
    };
  }
  if (reason.includes("不支持") || reason.includes("无法获取") || reason.includes("HTTPS")) {
    return {
      status: "unavailable",
      title: "当前位置不可用",
      description: "当前浏览器或系统没有返回位置，Agent 会改为询问城市。",
    };
  }
  return {
    status: "error",
    title: "浏览器定位未完成",
    description: "没有读取设备位置，Agent 会改为询问城市。",
  };
}

function BrowserLocationHelpIcons() {
  return (
    <span className="ai-chat-location-help" aria-label="定位条件说明">
      <Tooltip title="只有点击“允许一次”后才会请求浏览器位置；页面加载和 Agent 都不能直接读取。">
        <span className="ai-chat-location-help-icon" tabIndex={0} aria-label="授权触发条件">
          <SafetyCertificateOutlined />
        </span>
      </Tooltip>
      <Tooltip title="浏览器定位需要 HTTPS 或 localhost，并且浏览器和操作系统的定位服务可用。">
        <span className="ai-chat-location-help-icon" tabIndex={0} aria-label="定位环境要求">
          <EnvironmentOutlined />
        </span>
      </Tooltip>
      <Tooltip title="最多等待 10 秒，并允许使用 60 秒内的缓存位置；超时后会改为让你输入城市。">
        <span className="ai-chat-location-help-icon" tabIndex={0} aria-label="定位等待时间">
          <ClockCircleOutlined />
        </span>
      </Tooltip>
    </span>
  );
}

function BrowserLocationStatus({ notice }: { notice: BrowserLocationNotice }) {
  const icon =
    notice.status === "granted" ? (
      <CheckCircleOutlined />
    ) : notice.status === "timeout" || notice.status === "expired" ? (
      <ClockCircleOutlined />
    ) : notice.status === "denied" ? (
      <SafetyCertificateOutlined />
    ) : notice.status === "unavailable" ? (
      <EnvironmentOutlined />
    ) : (
      <ExclamationCircleOutlined />
    );
  return (
    <div className="ai-chat-location-status" data-status={notice.status}>
      <span className="ai-chat-location-status-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="ai-chat-location-status-copy">
        <Typography.Text strong>{notice.title}</Typography.Text>
        <Typography.Text type="secondary">{notice.description}</Typography.Text>
      </span>
      <BrowserLocationHelpIcons />
    </div>
  );
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

function formatDuration(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "-";
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} 秒`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes}分 ${String(seconds).padStart(2, "0")}秒`;
}

function MessageTiming({ timing }: { timing: ChatMessageTiming | null }) {
  if (!timing) return null;
  const details = [
    timing.firstResponseMs != null
      ? { label: "首次响应", value: formatDuration(timing.firstResponseMs), tone: "info" }
      : null,
    timing.firstTextMs != null
      ? { label: "首字", value: formatDuration(timing.firstTextMs) }
      : null,
    timing.generationMs != null
      ? { label: "回答生成", value: formatDuration(timing.generationMs) }
      : null,
    timing.totalMs != null ? { label: "总耗时", value: formatDuration(timing.totalMs) } : null,
  ].filter((item): item is { label: string; value: string; tone?: "info" } => Boolean(item));

  return (
    <div className="ai-chat-timing" aria-label="回答时序">
      {timing.reasoningObserved && timing.reasoningMs != null ? (
        <Tooltip title="Provider 返回了可观测的 reasoning 流事件">
          <span className="ai-chat-timing-primary">
            <BulbOutlined /> 已思考 {formatDuration(timing.reasoningMs)}
          </span>
        </Tooltip>
      ) : null}
      {details.length ? (
        <span className="ai-chat-timing-details">
          <ClockCircleOutlined />
          {details.map((item) => (
            <span key={item.label} className="ai-chat-timing-item" data-tone={item.tone}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

function AssistantThinkingState({ agent }: { agent: boolean }) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = performance.now();
    const updateElapsed = () => setElapsedMs(Math.max(performance.now() - startedAt, 0));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className="ai-chat-thinking"
      role="status"
      aria-live="polite"
      aria-label={agent ? "AI 正在处理任务" : "AI 正在思考"}
    >
      <LoadingOutlined spin className="ai-chat-thinking-icon" />
      <span className="ai-chat-thinking-label">{agent ? "正在处理任务" : "正在思考"}</span>
      <span className="ai-chat-thinking-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="ai-chat-thinking-elapsed">{formatDuration(elapsedMs)}</span>
    </div>
  );
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

function runStatusLabel(status?: AgentRunDetail["status"] | "running") {
  const labels: Record<string, string> = {
    queued: "排队中",
    running: "运行中",
    waiting_approval: "等待审批",
    waiting_continuation: "等待继续",
    completed: "已完成",
    stopped: "已停止",
    failed: "失败",
  };
  return status ? labels[status] || status : "";
}

function stepTitle(step: AgentRunStep) {
  if (step.stepType === "approval") return "审批请求";
  if (step.stepType === "tool") return step.toolName ? `工具 · ${step.toolName}` : "工具调用";
  return "模型处理";
}

function stepDescription(step: AgentRunStep) {
  if (step.errorMessage) return step.errorMessage;
  if (step.stepType === "approval") return "等待管理员确认后继续执行";
  if (step.stepType === "tool")
    return step.status === "completed" ? "工具执行完成" : "正在执行工具";
  return step.status === "completed" ? "模型步骤已完成" : "模型正在生成回复";
}

function formatRunData(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function RunStepDetails({ event }: { event: LiveRunEvent }) {
  const sections: Array<{ key: string; title: string; value: unknown }> = [];
  if (event.input !== undefined) sections.push({ key: "input", title: "输入", value: event.input });
  if (event.output !== undefined)
    sections.push({ key: "output", title: "输出", value: event.output });
  if (event.usage !== undefined)
    sections.push({ key: "usage", title: "Usage", value: event.usage });
  if (event.error) sections.push({ key: "error", title: "错误", value: event.error });
  if (!sections.length) return null;

  return (
    <details className="ai-chat-run-step-details">
      <summary>查看完整数据</summary>
      <div className="ai-chat-run-step-data-grid">
        {sections.map((section) => (
          <section key={section.key} className="ai-chat-run-step-data">
            <Typography.Text type="secondary">{section.title}</Typography.Text>
            <pre>{formatRunData(section.value)}</pre>
          </section>
        ))}
      </div>
    </details>
  );
}

function RunInspector({
  run,
  activeRunId,
  liveEvents,
  approvals,
  fallbackAgentName,
  fallbackModelName,
  isStreaming,
  onClose,
}: {
  run?: AgentRunDetail | null;
  activeRunId?: number | null;
  liveEvents: LiveRunEvent[];
  approvals: ToolApproval[];
  fallbackAgentName?: string | null;
  fallbackModelName?: string | null;
  isStreaming: boolean;
  onClose: () => void;
}) {
  const persistedEvents: LiveRunEvent[] = (run?.steps ?? []).map((step) => ({
    id: step.id,
    eventKey: `persisted:${step.id}`,
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
    durationMs: step.durationMs,
    input: parseJsonText(step.inputJson),
    output: parseJsonText(step.outputJson),
    usage: parseJsonText(step.usageJson),
    error: step.errorMessage,
  }));
  const runHasFinished =
    run?.status === "completed" || run?.status === "failed" || run?.status === "stopped";
  const events =
    !isStreaming && runHasFinished && persistedEvents.length > 0
      ? persistedEvents
      : liveEvents.length > 0
        ? liveEvents
        : persistedEvents;
  const pendingApprovals = approvals.filter(
    (item) => item.status === "pending" && item.handlerKey !== "browser_location",
  );
  const resumableApprovals = approvals.filter(
    (item) =>
      item.status === "executed" &&
      (!item.continuationRunId ||
        item.continuationRunStatus === "failed" ||
        item.continuationRunStatus === "stopped"),
  );
  const status = isStreaming ? "running" : run?.status;

  return (
    <aside className="ai-chat-inspector" aria-label="Agent 运行检查器">
      <div className="ai-chat-inspector-header">
        <Space size={8}>
          <DeploymentUnitOutlined />
          <Typography.Text strong>运行检查器</Typography.Text>
        </Space>
        <Space size={6}>
          {run?.id || activeRunId ? (
            <Typography.Text code>Run #{run?.id || activeRunId}</Typography.Text>
          ) : null}
          {status ? <Tag color={runStatusColor(status)}>{runStatusLabel(status)}</Tag> : null}
          <Tooltip title="关闭检查器">
            <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} />
          </Tooltip>
        </Space>
      </div>

      <div className="ai-chat-inspector-scroll">
        <dl className="ai-chat-run-facts">
          <div>
            <dt>Agent</dt>
            <dd>{run?.agentName || fallbackAgentName || "未绑定"}</dd>
          </div>
          <div>
            <dt>模型</dt>
            <dd>{run?.modelIdentifier || run?.modelName || fallbackModelName || "系统默认"}</dd>
          </div>
          <div>
            <dt>开始时间</dt>
            <dd>{run?.startedAt ? formatTime(run.startedAt) : isStreaming ? "刚刚" : "-"}</dd>
          </div>
          <div>
            <dt>执行步骤</dt>
            <dd>{run?.totalSteps ?? events.length}</dd>
          </div>
          <div>
            <dt>Attempt</dt>
            <dd>{run?.attempt ?? "-"}</dd>
          </div>
        </dl>

        <div className="ai-chat-inspector-section-title">步骤时间线</div>
        {events.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="发送消息后显示 Agent 运行步骤" />
        ) : (
          <div className="ai-chat-run-timeline">
            {events.map((event) => (
              <div
                key={`${event.kind}-${event.id}`}
                className={`ai-chat-run-step ai-chat-run-step-${event.status}`}
              >
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
                  {event.description ? (
                    <Typography.Text type="secondary">{event.description}</Typography.Text>
                  ) : null}
                  {event.durationMs != null ? (
                    <span className="ai-chat-run-step-duration">
                      耗时 {formatDuration(event.durationMs)}
                    </span>
                  ) : null}
                  <RunStepDetails event={event} />
                </div>
              </div>
            ))}
          </div>
        )}

        {pendingApprovals.length || resumableApprovals.length ? (
          <section className="ai-chat-inspector-approval-summary">
            <div className="ai-chat-inspector-approval-title">
              <Typography.Text strong>
                {pendingApprovals.length
                  ? `当前有 ${pendingApprovals.length} 个审批待处理`
                  : "工具已执行"}
              </Typography.Text>
              <Tag color={pendingApprovals.length ? "warning" : "processing"}>聊天窗口处理</Tag>
            </div>
            <Typography.Text type="secondary">
              {pendingApprovals.length
                ? "审批卡片已显示在聊天窗口底部，请在那里确认后继续。"
                : "如需继续 Agent，请回到聊天窗口底部操作。"}
            </Typography.Text>
          </section>
        ) : null}
      </div>

      <div className="ai-chat-inspector-footer">
        <span>总耗时 {formatDuration(run?.durationMs)}</span>
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
  const [streamFinish, setStreamFinish] = useState<StreamFinish | null>(null);
  const [streamError, setStreamError] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [liveRunEvents, setLiveRunEvents] = useState<LiveRunEvent[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const liveRunEventIdRef = useRef(0);
  const activeRunIdRef = useRef<number | null>(null);
  const lastServerEventIdRef = useRef(0);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryRunIdRef = useRef<number | null>(null);

  const setCurrentRunId = (runId: number | null) => {
    activeRunIdRef.current = runId;
    setActiveRunId(runId);
  };

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
    queryFn: () =>
      request<ToolApproval[]>(`/api/system/ai/chat/sessions/${activeSessionId}/approvals`),
  });

  const latestRunQuery = useQuery({
    queryKey: ["system-ai-chat-latest-run", activeSessionId],
    enabled: Boolean(activeSessionId),
    queryFn: () =>
      request<AgentRunDetail | null>(`/api/system/ai/chat/sessions/${activeSessionId}/run/latest`),
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
  const defaultAgent = useMemo(
    () => optionsQuery.data?.agents.find((agent) => agent.code === "general-assistant") ?? null,
    [optionsQuery.data?.agents],
  );

  const createSessionMutation = useMutation({
    mutationFn: async (title?: string) => {
      const options = optionsQuery.data ?? (await optionsQuery.refetch()).data;
      const agentId = options?.agents.find((agent) => agent.code === "general-assistant")?.id;
      return request<{ id: number }>("/api/system/ai/chat/sessions", {
        method: "POST",
        body: { title, agentId: agentId ?? null },
      });
    },
    onSuccess: async (result) => {
      setActiveSessionId(result.id);
      setMessages([]);
      setInspectorOpen(false);
      setCurrentRunId(null);
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
    onSuccess: async () => {
      feedback.success("会话设置已保存");
      setSettingsOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["system-ai-chat-sessions"] });
    },
  });

  const modeMutation = useMutation({
    mutationFn: ({ id, agentId }: { id: number; agentId: number | null }) =>
      request(`/api/system/ai/chat/sessions/${id}`, {
        method: "PUT",
        body: { agentId },
      }),
    onSuccess: async (_, variables) => {
      feedback.success(variables.agentId ? "已切换到 Agent 模式" : "已切换到直接对话");
      setInspectorOpen(false);
      setCurrentRunId(null);
      setLiveRunEvents([]);
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
        setInspectorOpen(false);
        setCurrentRunId(null);
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

  const upsertLiveRunEvent = (event: Omit<LiveRunEvent, "id" | "createdAt">) => {
    setLiveRunEvents((current) => {
      const existingIndex = current.findIndex((item) => item.eventKey === event.eventKey);
      if (existingIndex >= 0) {
        return current.map((item, index) =>
          index === existingIndex
            ? {
                ...item,
                ...event,
                input: event.input ?? item.input,
                output: event.output ?? item.output,
                usage: event.usage ?? item.usage,
                error: event.error ?? item.error,
              }
            : item,
        );
      }
      liveRunEventIdRef.current += 1;
      return [
        ...current,
        {
          ...event,
          id: liveRunEventIdRef.current,
          createdAt: new Date().toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          }),
        },
      ];
    });
  };

  const handleStreamEvent = (message: EventStreamMessage) => {
    if (message.id != null) {
      if (message.id <= lastServerEventIdRef.current) return;
      lastServerEventIdRef.current = message.id;
    }
    const data = asRecord(message.data);
    if (message.event === "meta" && data) {
      if (typeof data.runId === "number") {
        setCurrentRunId(data.runId);
        upsertLiveRunEvent({
          eventKey: "model:active",
          kind: "model",
          title: "模型处理",
          description: "正在分析用户问题并选择执行路径",
          status: "running",
          input: {
            model: asRecord(data.model)?.modelId,
            endpoint: data.endpoint,
          },
        });
      }
      return;
    }
    if (message.event === "delta" && data && typeof data.text === "string") {
      setMessages((previous) =>
        previous.map((item) =>
          item.id === "streaming-assistant"
            ? { ...item, content: item.content + data.text }
            : item,
        ),
      );
      return;
    }
    if (message.event === "tool-call" && data) {
      upsertLiveRunEvent({
        eventKey: `tool:${String(data.toolCallId || "unknown")}`,
        kind: "tool",
        title: `工具调用 · ${String(data.toolName || "unknown")}`,
        description: "模型请求执行服务端工具",
        status: "running",
        input: data.input,
      });
      return;
    }
    if (message.event === "tool-result" && data) {
      upsertLiveRunEvent({
        eventKey: `tool:${String(data.toolCallId || "unknown")}`,
        kind: "tool",
        title: `工具 · ${String(data.toolName || "unknown")}`,
        description: "服务端工具执行完成",
        status: "completed",
        output: data.output,
      });
      return;
    }
    if (message.event === "sources" && data) {
      const rows = Array.isArray(data.sources) ? data.sources : [];
      const sources = rows.flatMap((item) => {
        const row = asRecord(item);
        if (!row || typeof row.url !== "string" || !/^https?:\/\//.test(row.url)) return [];
        return [
          {
            title: String(row.title || row.url),
            url: row.url,
            snippet: String(row.snippet || ""),
            ...(row.publishedAt ? { publishedAt: String(row.publishedAt) } : {}),
            source: String(row.source || "web"),
          },
        ];
      });
      setMessages((previous) =>
        previous.map((item) => {
          if (item.id !== "streaming-assistant") return item;
          const merged = [...(item.sources ?? []), ...sources];
          return {
            ...item,
            sources: merged.filter(
              (source, index) =>
                merged.findIndex((candidate) => candidate.url === source.url) === index,
            ),
          };
        }),
      );
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
        timing: asRecord(data.timing) as ChatMessageTiming | undefined,
      });
      setMessages((previous) =>
        previous.map((item) =>
          item.id === "streaming-assistant"
            ? {
                ...item,
                id: typeof data.messageId === "number" ? data.messageId : item.id,
                finishReason:
                  typeof data.finishReason === "string" ? data.finishReason : item.finishReason,
                durationMs: typeof data.durationMs === "number" ? data.durationMs : item.durationMs,
                usageJson: data.usage ? JSON.stringify(data.usage) : item.usageJson,
                timing: (asRecord(data.timing) as ChatMessageTiming | null) ?? item.timing,
                status: "completed",
                streaming: false,
              }
            : item,
        ),
      );
      if (activeSession?.agentId || activeRunId) {
        upsertLiveRunEvent({
          eventKey: "model:active",
          kind: "model",
          title: "模型处理",
          description:
            data.waitingApproval === true ? "模型步骤完成，等待工具审批" : "模型步骤已完成",
          status: "completed",
          durationMs: typeof data.durationMs === "number" ? data.durationMs : null,
          usage: data.usage,
        });
      }
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-approvals"] }),
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-latest-run"] }),
      ]);
      return;
    }
    if (message.event === "approval") {
      const isBrowserLocation =
        data?.handlerKey === "browser_location" || data?.toolName === "browser-location";
      upsertLiveRunEvent({
        eventKey: `approval:${String(data?.id || "pending")}`,
        kind: "approval",
        title: isBrowserLocation ? "位置授权" : "审批请求",
        description: isBrowserLocation
          ? "等待用户授权浏览器大致位置"
          : `等待确认工具 ${String(data?.toolName || "unknown")}`,
        status: "waiting",
        input: data?.input,
      });
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-approvals"] }),
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-latest-run"] }),
      ]);
      return;
    }
    if (message.event === "error" && data) {
      const error = friendlyStreamError(String(data.message || "AI Chat 流式调用失败"));
      setStreamError(error);
      if (activeSession?.agentId || activeRunId) {
        upsertLiveRunEvent({
          eventKey: "model:active",
          kind: "error",
          title: "运行失败",
          description: error,
          status: "failed",
          durationMs: typeof data.durationMs === "number" ? data.durationMs : null,
          error,
        });
        setInspectorOpen(true);
      }
      setMessages((previous) =>
        previous.map((item) =>
          item.id === "streaming-assistant"
            ? { ...item, streaming: false, status: "failed", error, errorMessage: error }
            : item,
        ),
      );
    }
  };

  const recoverRunState = async (sessionId: number, expectedRunId: number) => {
    const run = await request<AgentRunDetail | null>(
      `/api/system/ai/chat/sessions/${sessionId}/run/latest`,
      { silent: true },
    );
    if (!run || run.id !== expectedRunId) return false;

    const isNewRun = activeRunIdRef.current !== run.id;
    setCurrentRunId(run.id);
    if (isNewRun) {
      setLiveRunEvents([]);
      liveRunEventIdRef.current = 0;
    }

    const replay = await request<{ events: PersistedRunEvent[]; lastEventId: number }>(
      `/api/system/ai/chat/sessions/${sessionId}/runs/${run.id}/events${buildQueryString({
        afterEventId: lastServerEventIdRef.current,
      })}`,
      { silent: true },
    );
    const durableMessages = await request<ChatMessage[]>(
      `/api/system/ai/chat/sessions/${sessionId}/messages`,
      { silent: true },
    );
    const stillRunning = run.status === "running";

    if (isNewRun) {
      if (stillRunning) {
        setMessages([
          ...durableMessages.filter((item) => item.status !== "streaming"),
          {
            id: "streaming-assistant",
            sessionId,
            role: "assistant",
            content: "",
            status: "streaming",
            streaming: true,
          },
        ]);
      } else {
        setMessages(durableMessages);
      }
    }

    for (const event of replay.events) {
      handleStreamEvent({
        event: event.eventType,
        data: event.payload,
        id: event.id,
      });
    }
    lastServerEventIdRef.current = Math.max(
      lastServerEventIdRef.current,
      replay.lastEventId || 0,
    );

    if (!stillRunning) {
      setMessages(durableMessages);
      setIsStreaming(false);
      recoveryRunIdRef.current = null;
      return false;
    }

    setInspectorOpen(true);
    setIsStreaming(true);
    return true;
  };

  const beginRunRecovery = (sessionId: number, runId: number) => {
    if (recoveryRunIdRef.current === runId && recoveryTimerRef.current) return;
    recoveryRunIdRef.current = runId;
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      try {
        const stillRunning = await recoverRunState(sessionId, runId);
        if (stillRunning && attempts < 120) {
          recoveryTimerRef.current = setTimeout(() => void poll(), 1500);
          return;
        }
      } catch {
        if (attempts < 120) {
          recoveryTimerRef.current = setTimeout(() => void poll(), 2500);
          return;
        }
      }
      recoveryTimerRef.current = null;
      recoveryRunIdRef.current = null;
      setIsStreaming(false);
    };
    void poll();
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
    setCurrentRunId(null);
    setLiveRunEvents([]);
    liveRunEventIdRef.current = 0;
    lastServerEventIdRef.current = 0;
    recoveryRunIdRef.current = null;
    if (recoveryTimerRef.current) {
      clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }

    let recoveredAfterDisconnect = false;
    try {
      await requestEventStream(input.path, {
        method: "POST",
        body: input.body,
        signal: controller.signal,
        silent: true,
        onEvent: handleStreamEvent,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        feedback.info("已停止生成");
      } else {
        const runId = activeRunIdRef.current;
        if (runId) {
          recoveredAfterDisconnect = true;
          setStreamError("连接已断开，正在从已保存的运行事件恢复");
          beginRunRecovery(input.sessionId, runId);
        } else {
          const message = friendlyStreamError(
            error instanceof Error ? error.message : "AI Chat 发送失败",
          );
          setStreamError(message);
          feedback.error(message);
        }
      }
      if (!recoveredAfterDisconnect) {
        setMessages((previous) =>
          previous.map((item) =>
            item.id === "streaming-assistant"
              ? {
                  ...item,
                  streaming: false,
                  status: controller.signal.aborted ? "stopped" : "failed",
                }
              : item,
          ),
        );
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (!recoveredAfterDisconnect) setIsStreaming(false);
      const durableMessages = await request<ChatMessage[]>(
        `/api/system/ai/chat/sessions/${input.sessionId}/messages`,
        { silent: true },
      ).catch(() => null);
      if (durableMessages) {
        queryClient.setQueryData(["system-ai-chat-messages", input.sessionId], durableMessages);
        if (!recoveredAfterDisconnect) setMessages([]);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-sessions"] }),
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-approvals", input.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-latest-run", input.sessionId] }),
      ]);
    }
  };

  useEffect(() => {
    const latestRun = latestRunQuery.data;
    if (
      !activeSessionId ||
      isStreaming ||
      !latestRun ||
      latestRun.status !== "running" ||
      activeRunIdRef.current === latestRun.id
    ) {
      return;
    }
    beginRunRecovery(activeSessionId, latestRun.id);
    // Recovery helpers intentionally close over the current Chat state and are recreated per render.
    // The run identity and status are the only values that should trigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, isStreaming, latestRunQuery.data]);

  useEffect(
    () => () => {
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
    },
    [],
  );

  const sendMessage = async () => {
    if (approvalsQuery.data?.some((approval) => approval.status === "pending")) {
      feedback.info("请先处理当前工具审批，再发送新的消息");
      return;
    }
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
      body: { content },
      nextMessages: [
        ...baseMessages,
        { id: "local-user", sessionId, role: "user", content, status: "completed" },
        {
          id: "streaming-assistant",
          sessionId,
          role: "assistant",
          content: "",
          status: "streaming",
          streaming: true,
        },
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
      body: {},
      nextMessages: [
        ...displayedMessages.slice(0, index),
        {
          id: "streaming-assistant",
          sessionId: activeSessionId,
          role: "assistant",
          content: "",
          status: "streaming",
          streaming: true,
        },
      ],
    });
  };

  const resumeAgent = async (
    sessionId: number,
    approvalId: number,
    baseMessages: ChatMessage[],
  ) => {
    await executeStream({
      sessionId,
      path: `/api/system/ai/chat/sessions/${sessionId}/messages/stream`,
      body: { resumeApprovalId: approvalId },
      nextMessages: [
        ...baseMessages,
        {
          id: "streaming-assistant",
          sessionId,
          role: "assistant",
          content: "",
          status: "streaming",
          streaming: true,
        },
      ],
    });
  };

  const approvalMutation = useMutation({
    mutationFn: ({ id, approved }: { id: number; approved: boolean }) =>
      request<{ status: string; sessionId: number }>(`/api/system/ai/approval/${id}/decision`, {
        method: "POST",
        body: { approved },
      }),
    onSuccess: async (result, variables) => {
      feedback.success(result.status === "executed" ? "工具已批准并执行" : "工具调用已拒绝");
      await queryClient.invalidateQueries({ queryKey: ["system-ai-chat-approvals"] });
      const durableMessages = await request<ChatMessage[]>(
        `/api/system/ai/chat/sessions/${result.sessionId}/messages`,
        { silent: true },
      );
      queryClient.setQueryData(["system-ai-chat-messages", result.sessionId], durableMessages);
      setMessages(durableMessages);
      if (result.status === "executed") {
        await resumeAgent(result.sessionId, variables.id, durableMessages);
      }
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-approvals"] }),
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-sessions"] }),
        queryClient.invalidateQueries({ queryKey: ["system-ai-chat-latest-run"] }),
      ]);
    },
  });

  const clientLocationMutation = useMutation({
    mutationFn: async ({
      id,
      sessionId,
      action,
    }: {
      id: number;
      sessionId: number;
      action: "allow" | "deny";
    }) => {
      const result: BrowserLocationResult =
        action === "allow"
          ? await getBrowserLocation()
          : { status: "denied", reason: "用户选择手动输入城市" };
      return request<{
        status: "executed";
        sessionId: number;
        output: BrowserLocationResult;
      }>(`/api/system/ai/chat/sessions/${sessionId}/client-actions/${id}/result`, {
        method: "POST",
        body: result,
      });
    },
    onSuccess: async (result, variables) => {
      feedback.success(
        result.output.status === "granted" ? "已提供本次大致位置" : "将改为询问城市",
      );
      await queryClient.invalidateQueries({ queryKey: ["system-ai-chat-approvals"] });
      const durableMessages = await request<ChatMessage[]>(
        `/api/system/ai/chat/sessions/${result.sessionId}/messages`,
        { silent: true },
      );
      queryClient.setQueryData(["system-ai-chat-messages", result.sessionId], durableMessages);
      setMessages(durableMessages);
      await resumeAgent(result.sessionId, variables.id, durableMessages);
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
    const response = await fetch(
      `/api/system/ai/chat/sessions/${activeSessionId}/export?format=${format}`,
      {
        headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : undefined,
      },
    );
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
  const displayModelId =
    activeModel?.modelId || activeSession?.modelIdentifier || runtime?.model.modelId;
  const displayModelName =
    activeModel?.name || activeAgent?.modelName || activeSession?.modelName || runtime?.model.name;
  const displayProviderName =
    activeModel?.providerName || activeSession?.providerCode || runtime?.provider.name;
  const webSearchAvailable = Boolean(activeAgent?.toolCodes.includes("web-search"));
  const activePendingApproval = [...(approvalsQuery.data ?? [])]
    .filter((approval) => approval.status === "pending")
    .sort((left, right) => left.id - right.id)[0];
  const pendingLocationApproval =
    activePendingApproval?.handlerKey === "browser_location" ? activePendingApproval : null;
  const pendingToolApproval =
    activePendingApproval && activePendingApproval.handlerKey !== "browser_location"
      ? activePendingApproval
      : null;
  const hasPendingApproval = Boolean(pendingLocationApproval || pendingToolApproval);
  const pendingLocationReason = pendingLocationApproval
    ? String(
        asRecord(parseJsonText(pendingLocationApproval.inputJson))?.reason ||
          "当前问题需要大致位置才能继续",
      )
    : "";
  const modeValue = activeSession
    ? (activeSession.agentId ?? "direct")
    : (defaultAgent?.id ?? "direct");
  const canInspectRun = Boolean(
    activeSession?.agentId ||
    activeRunId ||
    latestRunQuery.data ||
    liveRunEvents.length ||
    approvalsQuery.data?.length,
  );
  const showInspector = inspectorOpen && canInspectRun;

  return (
    <PageScaffold
      title="AI Chat"
      description="面向使用者的连续对话入口，可选择普通模型或 Agent，并保存消息、用量与运行状态"
      className="ai-chat-page"
    >
      <div className={showInspector ? "ai-chat-layout ai-chat-layout-inspector" : "ai-chat-layout"}>
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
            ) : !sessionsQuery.data?.data.length ? (
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
                      setInspectorOpen(false);
                      setStreamError("");
                      setStreamFinish(null);
                      setCurrentRunId(null);
                      setLiveRunEvents([]);
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
                        {session.messageCount} 条消息 /{" "}
                        {formatTime(session.lastMessageAt || session.updatedAt)}
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
              {activeSession?.agentName ? (
                <Tag icon={<RobotOutlined />} color="cyan">
                  {activeSession.agentName}
                </Tag>
              ) : null}
              {isStreaming ? <Tag color="processing">生成中</Tag> : null}
            </Space>
          }
          extra={
            <Space>
              {canInspectRun && !showInspector ? (
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
          {(runtimeQuery.error || (!runtimeQuery.isLoading && !runtime)) &&
          !activeModel &&
          !activeSession?.modelIdentifier ? (
            <Alert
              showIcon
              type="warning"
              title="默认 Chat 模型未就绪"
              description={runtimeQuery.data?.reason}
            />
          ) : (
            <div className="ai-chat-runtime-strip">
              <div className="ai-chat-mode-control">
                <Typography.Text type="secondary" className="ai-chat-mode-label">
                  对话模式
                </Typography.Text>
                <Select
                  aria-label="对话模式"
                  className="ai-chat-mode-select"
                  value={modeValue}
                  loading={optionsQuery.isLoading || modeMutation.isPending}
                  disabled={!activeSession || isStreaming || modeMutation.isPending}
                  popupMatchSelectWidth={false}
                  onChange={(value) => {
                    if (!activeSession) return;
                    modeMutation.mutate({
                      id: activeSession.id,
                      agentId: value === "direct" ? null : Number(value),
                    });
                  }}
                  options={[
                    { value: "direct", label: "直接对话 · 仅模型" },
                    ...(optionsQuery.data?.agents ?? []).map((agent) => ({
                      value: agent.id,
                      label: agent.name,
                    })),
                  ]}
                />
                {activeSession?.agentId ? (
                  webSearchAvailable ? (
                    <Tag icon={<GlobalOutlined />} color="success">
                      联网搜索可用
                    </Tag>
                  ) : (
                    <Tooltip title="当前 Agent 没有关联可用的联网搜索工具，或搜索服务尚未启用">
                      <Tag color="warning">联网搜索不可用</Tag>
                    </Tooltip>
                  )
                ) : (
                  <Tooltip title="直接对话只调用当前模型，不会使用联网搜索或其他 Agent 工具">
                    <Tag color="default">仅模型 · 不联网</Tag>
                  </Tooltip>
                )}
              </div>
              <div className="ai-chat-runtime-meta">
                <Space size={6} wrap>
                  <Typography.Text type="secondary">
                    {displayProviderName || "AI Provider"}
                  </Typography.Text>
                  <Tag color="blue">{displayModelId || displayModelName || "默认模型"}</Tag>
                </Space>
                <Typography.Text type="secondary">
                  累计 {(activeSession?.totalInputTokens ?? 0).toLocaleString()} 输入 /{" "}
                  {(activeSession?.totalOutputTokens ?? 0).toLocaleString()} 输出
                </Typography.Text>
              </div>
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
                  const locationNotice = isSystem
                    ? parseBrowserLocationNotice(message.content)
                    : null;
                  const lastAssistantId = [...displayedMessages]
                    .reverse()
                    .find((item) => item.role === "assistant")?.id;
                  const assistantStatus =
                    message.streaming || message.status === "streaming"
                      ? "streaming"
                      : message.status && message.status !== "completed"
                        ? message.status
                        : null;
                  const messageSources = parseMessageSources(message);
                  const messageTiming = parseMessageTiming(message);
                  const userDisplayName =
                    currentUser?.nickname || currentUser?.username || "当前用户";
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

                      {locationNotice ? (
                        <BrowserLocationStatus notice={locationNotice} />
                      ) : toolResult ? (
                        <details className="ai-chat-tool-result">
                          <summary>
                            <span className="ai-chat-tool-result-icon">
                              <CodeOutlined />
                            </span>
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
                              {isUser
                                ? userDisplayName
                                : isSystem
                                  ? "系统消息"
                                  : activeSession?.agentName || "AI 助手"}
                            </Typography.Text>
                            {!isUser && !isSystem ? (
                              <Typography.Text type="secondary">
                                {displayModelId || displayModelName || "默认模型"}
                              </Typography.Text>
                            ) : null}
                            {message.createdAt ? (
                              <Typography.Text type="secondary">
                                {formatTime(message.createdAt)}
                              </Typography.Text>
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
                                    {friendlyStreamError(
                                      message.error || message.errorMessage || "请稍后重试",
                                    )}
                                  </Typography.Text>
                                </div>
                              </div>
                            ) : assistantStatus === "streaming" && !message.content.trim() ? (
                              <AssistantThinkingState agent={Boolean(activeSession?.agentId)} />
                            ) : (
                              <StreamingMarkdown
                                content={message.content}
                                minHeight={message.content.trim() ? 0 : 72}
                                maxHeight={null}
                                placeholder="回答未生成"
                              />
                            )}
                          </div>

                          {!isUser && !isSystem && messageSources.length ? (
                            <div className="ai-chat-sources" aria-label="联网搜索来源">
                              <div className="ai-chat-sources-heading">
                                <GlobalOutlined />
                                <Typography.Text strong>联网来源</Typography.Text>
                                <Typography.Text type="secondary">
                                  {messageSources.length} 条
                                </Typography.Text>
                              </div>
                              <div className="ai-chat-source-list">
                                {messageSources.map((source, index) => (
                                  <a
                                    key={`${source.url}-${index}`}
                                    className="ai-chat-source-item"
                                    href={source.url}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                  >
                                    <span className="ai-chat-source-index">{index + 1}</span>
                                    <span className="ai-chat-source-copy">
                                      <strong>{source.title}</strong>
                                      <span>{source.snippet || source.url}</span>
                                      <small>
                                        {source.source}
                                        {source.publishedAt ? ` · ${source.publishedAt}` : ""}
                                      </small>
                                    </span>
                                  </a>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {!isUser && !isSystem && assistantStatus !== "streaming" ? (
                            <div className="ai-chat-response-footer">
                              <div className="ai-chat-response-meta">
                                {assistantStatus ? (
                                  <Tag
                                    color={
                                      assistantStatus === "failed"
                                        ? "error"
                                        : assistantStatus === "stopped"
                                          ? "warning"
                                          : "processing"
                                    }
                                  >
                                    {assistantStatus}
                                  </Tag>
                                ) : null}
                                {message.finishReason &&
                                message.finishReason !== "stop" &&
                                message.finishReason !== "error" ? (
                                  <Tag color={finishColor(message.finishReason)}>
                                    {message.finishReason}
                                  </Tag>
                                ) : null}
                                <MessageTiming timing={messageTiming} />
                                {(message.error || message.errorMessage) && message.content ? (
                                  <Typography.Text type="danger">
                                    {message.error || message.errorMessage}
                                  </Typography.Text>
                                ) : null}
                              </div>
                              <Space className="ai-chat-message-actions" size={2}>
                                {message.content ? (
                                  <Tooltip title="复制回答">
                                    <Button
                                      type="text"
                                      size="small"
                                      icon={<CopyOutlined />}
                                      onClick={() =>
                                        void navigator.clipboard
                                          .writeText(message.content)
                                          .then(() => feedback.success("已复制"))
                                      }
                                    />
                                  </Tooltip>
                                ) : null}
                                {message.id === lastAssistantId &&
                                typeof message.id === "number" &&
                                !isStreaming ? (
                                  <Tooltip title="重新生成">
                                    <Button
                                      type="text"
                                      size="small"
                                      icon={<RedoOutlined />}
                                      onClick={() => void regenerateMessage(message.id as number)}
                                    />
                                  </Tooltip>
                                ) : null}
                              </Space>
                            </div>
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
              {pendingToolApproval ? (
                <ChatApprovalCard
                  key={pendingToolApproval.id}
                  approval={pendingToolApproval}
                  deciding={approvalMutation.isPending}
                  onDecision={(id, approved) => approvalMutation.mutate({ id, approved })}
                />
              ) : null}
              {pendingLocationApproval && activeSessionId ? (
                <section
                  className="ai-chat-client-permission"
                  aria-label="浏览器位置授权"
                  aria-live="polite"
                >
                  <span className="ai-chat-client-permission-icon" aria-hidden="true">
                    <EnvironmentOutlined />
                  </span>
                  <div className="ai-chat-client-permission-copy">
                    <span className="ai-chat-client-permission-title">
                      <Typography.Text strong>使用大致位置</Typography.Text>
                      <BrowserLocationHelpIcons />
                    </span>
                    <Typography.Text>{pendingLocationReason}</Typography.Text>
                    <Typography.Text type="secondary">
                      仅用于本次任务；发送前会将经纬度粗化，服务端不会保存精确坐标。
                    </Typography.Text>
                  </div>
                  <div className="ai-chat-client-permission-actions">
                    <Button
                      type="primary"
                      icon={<EnvironmentOutlined />}
                      loading={clientLocationMutation.isPending}
                      onClick={() =>
                        clientLocationMutation.mutate({
                          id: pendingLocationApproval.id,
                          sessionId: activeSessionId,
                          action: "allow",
                        })
                      }
                    >
                      允许一次
                    </Button>
                    <Button
                      disabled={clientLocationMutation.isPending}
                      onClick={() =>
                        clientLocationMutation.mutate({
                          id: pendingLocationApproval.id,
                          sessionId: activeSessionId,
                          action: "deny",
                        })
                      }
                    >
                      不允许，手动输入城市
                    </Button>
                  </div>
                </section>
              ) : null}
              {streamError ? <Alert showIcon type="error" title={streamError} /> : null}
              {streamFinish?.finishReason === "length" ? (
                <Alert
                  showIcon
                  type="warning"
                  title="模型输出达到上限，内容可能未完整结束；可以继续提问让模型接着回答。"
                />
              ) : null}
            </div>
            <div className="ai-chat-composer-shell">
              <Input.TextArea
                className="ai-chat-composer-input"
                value={input}
                variant="borderless"
                disabled={isStreaming || hasPendingApproval}
                autoSize={{ minRows: 2, maxRows: 8 }}
                placeholder="输入消息，Shift + Enter 换行，Enter 发送"
                onChange={(event) => setInput(event.target.value)}
                onPressEnter={(event) => {
                  if (event.shiftKey) return;
                  event.preventDefault();
                  if (!isStreaming) void sendMessage();
                }}
              />
              <div className="ai-chat-composer-actions">
                {isStreaming ? (
                  <Tooltip title="停止生成">
                    <Button
                      danger
                      shape="circle"
                      aria-label="停止生成"
                      icon={<StopOutlined />}
                      onClick={() => controllerRef.current?.abort()}
                    />
                  </Tooltip>
                ) : (
                  <Tooltip title="发送消息">
                    <Button
                      type="primary"
                      shape="circle"
                      aria-label="发送消息"
                      icon={<SendOutlined />}
                      loading={createSessionMutation.isPending}
                      disabled={!input.trim() || hasPendingApproval}
                      onClick={() => void sendMessage()}
                    />
                  </Tooltip>
                )}
              </div>
            </div>
          </div>
        </Card>

        {showInspector ? (
          <RunInspector
            run={latestRunQuery.data}
            activeRunId={activeRunId}
            liveEvents={liveRunEvents}
            approvals={approvalsQuery.data ?? []}
            fallbackAgentName={activeSession?.agentName}
            fallbackModelName={displayModelId || displayModelName}
            isStreaming={isStreaming}
            onClose={() => setInspectorOpen(false)}
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
          void settingsForm
            .validateFields()
            .then((values) => settingsMutation.mutateAsync({ id: activeSession.id, values }));
        }}
      >
        <Form form={settingsForm} layout="vertical">
          <Form.Item
            name="agentId"
            label="Agent"
            extra="选择 Agent 后可使用其关联的联网搜索和其他工具；清空后为仅调用模型的直接对话"
          >
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
          <Form.Item name="temperature" label="Temperature">
            <InputNumber min={0} max={2} step={0.1} />
          </Form.Item>
          <Divider />
          <Form.Item name="systemPrompt" label="会话 System Prompt">
            <Input.TextArea
              rows={7}
              placeholder="只对当前会话生效；选择 Agent 时会追加在 Agent Instructions 后面"
            />
          </Form.Item>
        </Form>
      </Modal>
    </PageScaffold>
  );
}
