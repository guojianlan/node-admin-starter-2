"use client";

import {
  ApiOutlined,
  CloseCircleOutlined,
  PlayCircleOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Input,
  InputNumber,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { useRef, useState } from "react";
import { StreamingMarkdown } from "@/components/ai/StreamingMarkdown";
import { request, requestEventStream, type EventStreamMessage } from "@/lib/request";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";

type AiRuntimeUsage = "chat" | "structured";

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
    capabilities: Record<string, unknown>;
    contextWindow?: number | null;
    maxOutputTokens?: number | null;
  };
};

type AiRuntimeStatus =
  | (AiRuntimeConfig & { ready: true; reason: null })
  | { ready: false; reason: string; provider: null; model: null };

type AiGenerationResult = AiRuntimeConfig & {
  text: string;
  finishReason: string;
  rawFinishReason?: string;
  usage: Record<string, unknown>;
  request: {
    usage: AiRuntimeUsage;
    inputLength: number;
    maxOutputTokens: number;
    timeoutMs: number;
  };
  durationMs: number;
  warnings?: string[];
};

type StreamFinish = {
  finishReason?: string;
  rawFinishReason?: string;
  usage?: Record<string, unknown>;
  durationMs?: number;
};

const usageOptions = [
  { label: "Chat", value: "chat" },
  { label: "结构化", value: "structured" },
];

const outputTokenPresets = [
  { label: "2K", value: 2048 },
  { label: "8K", value: 8192 },
  { label: "16K", value: 16384 },
  { label: "32K", value: 32768 },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberFormat(value?: number | null) {
  return typeof value === "number" ? value.toLocaleString() : "-";
}

function usageText(usage?: Record<string, unknown>) {
  if (!usage || Object.keys(usage).length === 0) return "暂无 usage 数据";
  return JSON.stringify(usage, null, 2);
}

function finishColor(finishReason?: string) {
  if (!finishReason) return "default";
  if (finishReason === "stop") return "success";
  if (finishReason === "length") return "warning";
  if (finishReason === "error") return "error";
  return "blue";
}

export function AiPlaygroundPage() {
  const [usage, setUsage] = useState<AiRuntimeUsage>("chat");
  const [input, setInput] = useState(
    "请用三句话说明 Admin Base 的 AI Runtime 应该怎么接入业务模块。",
  );
  const [maxOutputTokens, setMaxOutputTokens] = useState(16384);
  const [timeoutMs, setTimeoutMs] = useState(60000);
  const [output, setOutput] = useState("");
  const [streamMeta, setStreamMeta] = useState<AiRuntimeConfig | null>(null);
  const [finish, setFinish] = useState<StreamFinish | null>(null);
  const [streamError, setStreamError] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const runtimeQuery = useQuery({
    queryKey: ["system-ai-playground-runtime", usage],
    queryFn: () =>
      request<AiRuntimeStatus>(`/api/system/ai/playground/runtime-config/${usage}`, {
        silent: true,
      }),
    retry: false,
  });

  const resetResult = () => {
    setOutput("");
    setFinish(null);
    setStreamError("");
    setStreamMeta(runtimeQuery.data?.ready ? runtimeQuery.data : null);
  };

  const buildPayload = () => ({
    usage,
    input: input.trim(),
    maxOutputTokens,
    timeoutMs,
  });

  const runMutation = useMutation({
    mutationFn: () =>
      request<AiGenerationResult>("/api/system/ai/playground/chat", {
        method: "POST",
        body: buildPayload(),
      }),
    onMutate: resetResult,
    onSuccess: (result) => {
      setStreamMeta({ provider: result.provider, model: result.model });
      setOutput(result.text);
      setFinish({
        finishReason: result.finishReason,
        rawFinishReason: result.rawFinishReason,
        usage: result.usage,
        durationMs: result.durationMs,
      });
      feedback.success("AI 调用完成");
    },
  });

  const handleEvent = (message: EventStreamMessage) => {
    const data = asRecord(message.data);
    if (message.event === "meta" && data) {
      const provider = asRecord(data.provider);
      const model = asRecord(data.model);
      if (provider && model) {
        setStreamMeta({
          provider: provider as AiRuntimeConfig["provider"],
          model: model as AiRuntimeConfig["model"],
        });
      }
      return;
    }
    if (message.event === "finish" && data) {
      setFinish({
        finishReason: typeof data.finishReason === "string" ? data.finishReason : undefined,
        rawFinishReason:
          typeof data.rawFinishReason === "string" ? data.rawFinishReason : undefined,
        usage: asRecord(data.usage) ?? undefined,
        durationMs: typeof data.durationMs === "number" ? data.durationMs : undefined,
      });
      return;
    }
    if (message.event === "error" && data) {
      setStreamError(String(data.message || "AI 流式调用失败"));
    }
  };

  const runStream = async () => {
    if (!input.trim()) {
      feedback.warning("请输入调用内容");
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    resetResult();
    setIsStreaming(true);
    try {
      await requestEventStream("/api/system/ai/playground/chat/stream", {
        method: "POST",
        body: buildPayload(),
        signal: controller.signal,
        silent: true,
        onEvent: handleEvent,
        onChunk: (chunk) => {
          setOutput((previous) => previous + chunk);
        },
      });
      feedback.success("流式调用完成");
    } catch (error) {
      if (controller.signal.aborted) {
        feedback.info("已停止流式调用");
      } else {
        const message = error instanceof Error ? error.message : "AI 流式调用失败";
        setStreamError(message);
        feedback.error(message);
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setIsStreaming(false);
    }
  };

  const activeConfig = streamMeta ?? (runtimeQuery.data?.ready ? runtimeQuery.data : null);
  const busy = runMutation.isPending || isStreaming;

  return (
    <PageScaffold
      title="AI Playground"
      description="使用当前默认 Provider 和模型验证 AI Runtime，供业务模块与 Agent 接入前调试"
      className="ai-playground-page"
    >
      <div className="ai-playground-workbench admin-fill-workspace">
        <Card
          className="admin-card ai-playground-parameter-card"
          variant="borderless"
          title="调用参数"
        >
          <Space orientation="vertical" size={14} style={{ width: "100%" }}>
            <Space orientation="vertical" size={6} style={{ width: "100%" }}>
              <Typography.Text type="secondary">业务用途</Typography.Text>
              <Select
                value={usage}
                options={usageOptions}
                onChange={(value) => {
                  setUsage(value);
                  resetResult();
                }}
                style={{ width: "100%" }}
              />
            </Space>
            <Space orientation="vertical" size={6} style={{ width: "100%" }}>
              <Typography.Text type="secondary">Prompt</Typography.Text>
              <Input.TextArea
                value={input}
                rows={10}
                onChange={(event) => setInput(event.target.value)}
                placeholder="输入业务测试 prompt"
                showCount
                maxLength={12000}
              />
            </Space>
            <Space orientation="vertical" size={6} style={{ width: "100%" }}>
              <Typography.Text type="secondary">最大输出 tokens</Typography.Text>
              <Segmented
                block
                value={maxOutputTokens}
                options={outputTokenPresets}
                onChange={(value) => setMaxOutputTokens(Number(value))}
              />
              <InputNumber
                min={16}
                max={32768}
                step={512}
                value={maxOutputTokens}
                onChange={(value) => setMaxOutputTokens(Number(value ?? 16384))}
                style={{ width: "100%" }}
              />
            </Space>
            <Space orientation="vertical" size={6} style={{ width: "100%" }}>
              <Typography.Text type="secondary">超时 ms</Typography.Text>
              <InputNumber
                min={5000}
                max={300000}
                step={5000}
                value={timeoutMs}
                onChange={(value) => setTimeoutMs(Number(value ?? 60000))}
                style={{ width: "100%" }}
              />
            </Space>
            <Space wrap>
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={isStreaming}
                disabled={runMutation.isPending}
                onClick={() => void runStream()}
              >
                流式运行
              </Button>
              <Button
                icon={<PlayCircleOutlined />}
                loading={runMutation.isPending}
                disabled={isStreaming}
                onClick={() => {
                  if (!input.trim()) {
                    feedback.warning("请输入调用内容");
                    return;
                  }
                  void runMutation.mutateAsync();
                }}
              >
                同步运行
              </Button>
              {isStreaming ? (
                <Button
                  danger
                  icon={<CloseCircleOutlined />}
                  onClick={() => controllerRef.current?.abort()}
                >
                  停止
                </Button>
              ) : null}
            </Space>
          </Space>
        </Card>

        <div className="ai-playground-result-column">
          <Card
            className="admin-card ai-playground-runtime-card"
            variant="borderless"
            title="当前运行时"
          >
            {runtimeQuery.isLoading ? (
              <Spin />
            ) : runtimeQuery.error || !activeConfig ? (
              <Alert
                showIcon
                type="warning"
                title="默认 AI Runtime 未就绪"
                description={
                  runtimeQuery.error instanceof Error
                    ? runtimeQuery.error.message
                    : runtimeQuery.data?.reason || "请先启用 AI Provider 并设置默认模型。"
                }
              />
            ) : activeConfig ? (
              <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
                <Descriptions.Item label="Provider">
                  <Space size={6} wrap>
                    <ApiOutlined />
                    <Typography.Text strong>{activeConfig.provider.name}</Typography.Text>
                    <Tag>{activeConfig.provider.providerType}</Tag>
                    {activeConfig.provider.hasApiKey ? (
                      <Tag color="success">已配置密钥</Tag>
                    ) : (
                      <Tag color="warning">无密钥</Tag>
                    )}
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label="Provider Code">
                  {activeConfig.provider.code}
                </Descriptions.Item>
                <Descriptions.Item label="Base URL">
                  <Typography.Text copyable>{activeConfig.provider.baseUrl}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="模型">
                  <Typography.Text strong>{activeConfig.model.name}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="Model ID">
                  <Typography.Text copyable>{activeConfig.model.modelId}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="上下文">
                  {numberFormat(activeConfig.model.contextWindow)}
                </Descriptions.Item>
                <Descriptions.Item label="模型输出上限">
                  {numberFormat(activeConfig.model.maxOutputTokens)}
                </Descriptions.Item>
                <Descriptions.Item label="本次输出上限">
                  {numberFormat(maxOutputTokens)}
                </Descriptions.Item>
                <Descriptions.Item label="超时">{numberFormat(timeoutMs)} ms</Descriptions.Item>
              </Descriptions>
            ) : null}
          </Card>

          <Card
            className="admin-card ai-playground-output-card"
            variant="borderless"
            title="模型输出"
            extra={
              <Space size={8} wrap>
                {busy ? <Tag color="processing">运行中</Tag> : null}
                {finish?.finishReason ? (
                  <Tag color={finishColor(finish.finishReason)}>finish: {finish.finishReason}</Tag>
                ) : null}
                {finish?.durationMs ? <Tag>{finish.durationMs} ms</Tag> : null}
              </Space>
            }
          >
            <div className="ai-playground-output-stack">
              {streamError ? <Alert showIcon type="error" title={streamError} /> : null}
              <div className="ai-playground-stream-slot">
                <StreamingMarkdown
                  className="ai-playground-stream"
                  content={output}
                  minHeight={0}
                  maxHeight={null}
                  placeholder="运行后在这里查看 AI 输出。"
                />
              </div>
              {finish ? (
                <Alert
                  showIcon
                  type={finish.finishReason === "length" ? "warning" : "success"}
                  title={
                    finish.finishReason === "length"
                      ? "模型因为最大输出 tokens 截断"
                      : "模型调用完成"
                  }
                  description={
                    <Typography.Paragraph code style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
                      {usageText(finish.usage)}
                    </Typography.Paragraph>
                  }
                />
              ) : null}
            </div>
          </Card>
        </div>
      </div>
    </PageScaffold>
  );
}
