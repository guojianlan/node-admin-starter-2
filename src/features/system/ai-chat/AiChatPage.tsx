"use client";

import {
  DeleteOutlined,
  EditOutlined,
  MessageOutlined,
  PlusOutlined,
  SendOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  List,
  Modal,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { StreamingMarkdown } from "@/components/ai/StreamingMarkdown";
import { buildQueryString, request, requestEventStream, type EventStreamMessage } from "@/lib/request";
import type { PageResult } from "@/lib/response";
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

type ChatSession = {
  id: number;
  title: string;
  providerCode?: string | null;
  modelName?: string | null;
  modelIdentifier?: string | null;
  messageCount: number;
  lastMessageAt?: string | null;
  updatedAt: string;
};

type ChatMessage = {
  id: number | string;
  sessionId: number;
  role: "system" | "user" | "assistant";
  content: string;
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
};

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
  if (message.finishReason) parts.push(`finish: ${message.finishReason}`);
  if (message.durationMs) parts.push(`${message.durationMs} ms`);
  return parts.join(" / ");
}

export function AiChatPage() {
  const queryClient = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
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
  const controllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

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
    queryFn: () => request<AiRuntimeConfig>("/api/system/ai/chat/runtime-config", { silent: true }),
    retry: false,
  });

  const messagesQuery = useQuery({
    queryKey: ["system-ai-chat-messages", activeSessionId],
    enabled: Boolean(activeSessionId) && !isStreaming,
    queryFn: () =>
      request<ChatMessage[]>(`/api/system/ai/chat/sessions/${activeSessionId}/messages`),
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

  const createSessionMutation = useMutation({
    mutationFn: (title?: string) =>
      request<{ id: number }>("/api/system/ai/chat/sessions", {
        method: "POST",
        body: { title },
      }),
    onSuccess: async (result) => {
      setActiveSessionId(result.id);
      setMessages([]);
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
      }
      await queryClient.invalidateQueries({ queryKey: ["system-ai-chat-sessions"] });
    },
  });

  const ensureSession = async () => {
    if (activeSessionId) return activeSessionId;
    const result = await createSessionMutation.mutateAsync("新的聊天");
    return result.id;
  };

  const handleStreamEvent = (message: EventStreamMessage) => {
    const data = asRecord(message.data);
    if (message.event === "finish" && data) {
      setStreamFinish({
        messageId: typeof data.messageId === "number" ? data.messageId : undefined,
        finishReason: typeof data.finishReason === "string" ? data.finishReason : undefined,
        usage: asRecord(data.usage) ?? undefined,
        durationMs: typeof data.durationMs === "number" ? data.durationMs : undefined,
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
                streaming: false,
              }
            : item,
        ),
      );
      return;
    }
    if (message.event === "error" && data) {
      const error = String(data.message || "AI Chat 流式调用失败");
      setStreamError(error);
      setMessages((previous) =>
        previous.map((item) =>
          item.id === "streaming-assistant" ? { ...item, streaming: false, error } : item,
        ),
      );
    }
  };

  const sendMessage = async () => {
    const content = input.trim();
    if (!content) {
      feedback.warning("请输入聊天内容");
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsStreaming(true);
    setStreamError("");
    setStreamFinish(null);
    setInput("");

    try {
      const sessionId = await ensureSession();
      const userMessage: ChatMessage = {
        id: `local-user-${Date.now()}`,
        sessionId,
        role: "user",
        content,
      };
      const assistantMessage: ChatMessage = {
        id: "streaming-assistant",
        sessionId,
        role: "assistant",
        content: "",
        streaming: true,
      };
      const baseMessages = activeSessionId === sessionId ? displayedMessages : [];
      setMessages([...baseMessages, userMessage, assistantMessage]);

      await requestEventStream(`/api/system/ai/chat/sessions/${sessionId}/messages/stream`, {
        method: "POST",
        body: { content, maxOutputTokens, timeoutMs },
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
      await queryClient.invalidateQueries({ queryKey: ["system-ai-chat-sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["system-ai-chat-messages", sessionId] });
    } catch (error) {
      if (controller.signal.aborted) {
        feedback.info("已停止生成");
      } else {
        const message = error instanceof Error ? error.message : "AI Chat 发送失败";
        setStreamError(message);
        feedback.error(message);
      }
      setMessages((previous) =>
        previous.map((item) =>
          item.id === "streaming-assistant" ? { ...item, streaming: false } : item,
        ),
      );
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setIsStreaming(false);
    }
  };

  const runtime = runtimeQuery.data;

  return (
    <PageScaffold
      title="AI Chat"
      description="使用当前默认 Chat 模型进行连续对话，保存会话和消息历史"
    >
      <div className="ai-chat-layout">
        <Card
          className="admin-card"
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
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Input.Search
              allowClear
              placeholder="搜索会话"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            {sessionsQuery.isLoading ? (
              <Spin />
            ) : (
              <List
                rowKey="id"
                dataSource={sessionsQuery.data?.data ?? []}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无会话" /> }}
                renderItem={(session) => (
                  <List.Item
                    style={{
                      cursor: "pointer",
                      borderRadius: 6,
                      padding: "10px 8px",
                      background: activeSessionId === session.id ? "#f0f6ff" : "transparent",
                    }}
                    onClick={() => {
                      setActiveSessionId(session.id);
                      setMessages([]);
                      setStreamError("");
                      setStreamFinish(null);
                    }}
                  >
                    <List.Item.Meta
                      avatar={<MessageOutlined style={{ color: "#1677ff" }} />}
                      title={
                        <Typography.Text ellipsis strong={activeSessionId === session.id}>
                          {session.title}
                        </Typography.Text>
                      }
                      description={
                        <Space direction="vertical" size={2} style={{ width: "100%" }}>
                          <Typography.Text type="secondary" ellipsis>
                            {session.modelIdentifier || session.modelName || "未调用模型"}
                          </Typography.Text>
                          <Typography.Text type="secondary">
                            {session.messageCount} 条消息 / {formatTime(session.lastMessageAt || session.updatedAt)}
                          </Typography.Text>
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </Space>
        </Card>

        <Card
          className="admin-card"
          variant="borderless"
          title={
            <Space size={8} wrap>
              <Typography.Text strong>{activeSession?.title ?? "新的聊天"}</Typography.Text>
              {runtime ? <Tag color="blue">{runtime.model.modelId}</Tag> : null}
              {isStreaming ? <Tag color="processing">生成中</Tag> : null}
            </Space>
          }
          extra={
            <Space>
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
          styles={{
            body: {
              display: "grid",
              gridTemplateRows: "auto minmax(360px, calc(100vh - 430px)) auto",
              gap: 12,
              minHeight: 560,
            },
          }}
        >
          {runtimeQuery.error ? (
            <Alert
              showIcon
              type="warning"
              message="默认 Chat 模型未就绪"
              description={
                runtimeQuery.error instanceof Error
                  ? runtimeQuery.error.message
                  : "请先配置并启用默认 AI Provider 和 Chat 模型。"
              }
            />
          ) : (
            <Alert
              showIcon
              type="info"
              message={
                runtime
                  ? `${runtime.provider.name} / ${runtime.model.name}`
                  : "正在读取默认 Chat Runtime"
              }
              description={
                runtime
                  ? `${runtime.provider.providerType} / ${runtime.provider.baseUrl}`
                  : "AI Chat 会使用系统默认 Chat 模型。"
              }
            />
          )}

          <div style={{ overflow: "auto", padding: "4px 2px" }}>
            {messagesQuery.isLoading && activeSessionId ? (
              <Spin />
            ) : displayedMessages.length === 0 ? (
              <Empty description="开始一个新的 AI 对话" />
            ) : (
              <Space direction="vertical" size={14} style={{ width: "100%" }}>
                {displayedMessages.map((message) => {
                  const isUser = message.role === "user";
                  return (
                    <div
                      key={message.id}
                      style={{
                        display: "grid",
                        justifyItems: isUser ? "end" : "start",
                        gap: 4,
                      }}
                    >
                      <div
                        style={{
                          maxWidth: "min(780px, 88%)",
                          border: isUser ? "1px solid #1677ff" : "1px solid #e5e7eb",
                          borderRadius: 8,
                          background: isUser ? "#1677ff" : "#ffffff",
                          color: isUser ? "#ffffff" : "#111827",
                          padding: isUser ? "10px 12px" : 0,
                        }}
                      >
                        {isUser ? (
                          <Typography.Text style={{ color: "#ffffff", whiteSpace: "pre-wrap" }}>
                            {message.content}
                          </Typography.Text>
                        ) : (
                          <StreamingMarkdown
                            content={message.content}
                            minHeight={message.content ? 48 : 96}
                            maxHeight={520}
                            placeholder={message.streaming ? "模型正在生成..." : "暂无内容"}
                          />
                        )}
                      </div>
                      {!isUser ? (
                        <Space size={6} wrap>
                          {message.streaming ? <Tag color="processing">streaming</Tag> : null}
                          {message.finishReason ? (
                            <Tag color={finishColor(message.finishReason)}>
                              {message.finishReason}
                            </Tag>
                          ) : null}
                          {messageMeta(message) ? (
                            <Typography.Text type="secondary">{messageMeta(message)}</Typography.Text>
                          ) : null}
                          {message.error ? (
                            <Typography.Text type="danger">{message.error}</Typography.Text>
                          ) : null}
                        </Space>
                      ) : null}
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </Space>
            )}
          </div>

          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            {streamError ? <Alert showIcon type="error" message={streamError} /> : null}
            {streamFinish?.finishReason === "length" ? (
              <Alert showIcon type="warning" message="模型输出达到最大 tokens 限制，内容可能被截断。" />
            ) : null}
            <Input.TextArea
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
            <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
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
          </Space>
        </Card>
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
    </PageScaffold>
  );
}
