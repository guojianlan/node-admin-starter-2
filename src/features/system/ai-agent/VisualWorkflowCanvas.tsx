"use client";

/* eslint-disable @next/next/no-img-element -- generated assets may use a configured S3 URL. */
/* eslint-disable react-hooks/refs -- mutable graph/history refs are read only inside user event handlers; the inspector render helper forwards those callbacks without invoking them. */

import {
  addEdge,
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  SelectionMode,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Drawer, Input, InputNumber, Popover, Select, Space, Switch, Tag, Typography, Tooltip, Upload } from "antd";
import {
  AimOutlined,
  ApiOutlined,
  ApartmentOutlined,
  ArrowLeftOutlined,
  BookOutlined,
  BranchesOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  DragOutlined,
  FileSearchOutlined,
  ExportOutlined,
  ForkOutlined,
  FunctionOutlined,
  ImportOutlined,
  InfoCircleOutlined,
  MergeCellsOutlined,
  LeftOutlined,
  PartitionOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  RedoOutlined,
  ReloadOutlined,
  RetweetOutlined,
  RightOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SelectOutlined,
  SnippetsOutlined,
  SwapOutlined,
  SyncOutlined,
  ThunderboltOutlined,
  UndoOutlined,
  UploadOutlined,
  WarningOutlined,
  DatabaseOutlined,
  HistoryOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { request } from "@/lib/request";
import { feedback } from "@/ui/feedback/feedback";
import {
  cloneWorkflowGraph,
  copyWorkflowSelection,
  deleteWorkflowSelection,
  isWorkflowConnectionValid,
  normalizeWorkflowEdges,
  pasteWorkflowSelection,
  serializeWorkflowGraph,
  workflowNodeType,
  type WorkflowClipboard,
  type WorkflowGraphSnapshot,
} from "./visual-workflow-canvas-operations";

type GraphNodeData = {
  label: string;
  type: string;
  template?: string;
  contains?: string;
  modelId?: number | string;
  agentId?: number | string;
  toolId?: number | string;
  workflowId?: number | string;
  mapConfig?: string;
  children?: string;
  body?: string;
  predicate?: string;
  loopType?: "dowhile" | "dountil";
  concurrency?: number;
  duration?: number;
  date?: string;
  description?: string;
  schema?: string | Record<string, unknown>;
  modelSelection?: "active" | string;
  prompt?: string;
  systemPrompt?: string;
  purpose?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  outputSchema?: string;
  aggregateMode?: string;
  retries?: number;
  backoffMs?: number;
  fallback?: string;
  title?: string;
  correlationKey?: string;
  knowledgeBaseIds?: string;
  queryTemplate?: string;
  limit?: number;
  stateKey?: string;
  stateAction?: string;
  stateValue?: string;
  terminateStatus?: string;
  message?: string;
  contentTemplate?: string;
  documentId?: number;
  documentIdPath?: string;
};
type GraphNode = Node<GraphNodeData>;
type Definition = { id: number; code: string; name: string; currentVersion?: number | null; status: string };
type JsonSchemaProperty = {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  format?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  [key: string]: unknown;
};
type JsonSchema = {
  type?: string;
  title?: string;
  description?: string;
  required?: string[];
  properties?: Record<string, JsonSchemaProperty>;
  [key: string]: unknown;
};
type Detail = Definition & { version?: number; graph?: { nodes: GraphNode[]; edges: Edge[] } | null; inputSchema?: JsonSchema; outputSchema?: JsonSchema };
type ModelOption = { id: number; name: string; modelId: string; modelType: string; providerName?: string };
type AgentOption = { id: number; name: string; code: string; status: number; modelId?: number | null; modelName?: string | null; modelIdentifier?: string | null; toolIds?: number[]; skillIds?: number[] };
type ToolOption = { id: number; name: string; code: string; description?: string; handlerKey?: string; inputSchemaJson?: string | null; configJson?: string | null; riskLevel?: string; status: number };
type RuntimeSkillOption = { id: number; name: string; code: string };
type AgentOptions = { models: ModelOption[]; tools: ToolOption[]; skills: RuntimeSkillOption[] };
type KnowledgeOption = { id: number; name: string; code: string; status: number };
type WorkflowRunSummary = {
  id: number;
  workflowCode: string;
  status: string;
  durationMs?: number | null;
  createdAt?: string | null;
};
type WorkflowRunStep = {
  id: number;
  stepNo: number;
  stepCode: string;
  status: string;
  input: unknown;
  output: unknown;
  errorMessage?: string | null;
  durationMs?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
};
type WorkflowRunDetail = WorkflowRunSummary & {
  parentRunId?: number | null;
  parentNodeId?: string | null;
  callDepth?: number;
  input: unknown;
  output: unknown;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  steps: WorkflowRunStep[];
  waits?: Array<{
    id: number;
    nodeId: string;
    waitType: "approval" | "event" | "timer" | "child_workflow";
    status: string;
    childRunId?: number | null;
    correlationKey?: string | null;
    input?: unknown;
    resolution?: unknown;
    resumeAt?: string | null;
    timeoutAt?: string | null;
  }>;
};
type VisualWorkflowRunResponse = {
  runId: number;
  value: unknown;
  orchestrator?: string;
  status?: string;
  wait?: { id: number; waitType: string; correlationKey?: string | null; resumeAt?: string | null; timeoutAt?: string | null };
};
type WorkflowPredicate = {
  op?: "always" | "truthy" | "falsy" | "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains";
  value?: { path?: string; literal?: unknown };
  left?: { path?: string; literal?: unknown };
  right?: { path?: string; literal?: unknown };
};
type MastraChildEntry = {
  type: "agent" | "tool" | "workflow";
  id: string;
  label?: string;
  predicate?: WorkflowPredicate;
  isDefault?: boolean;
  agentId?: string;
  toolId?: string;
  workflowId?: string;
};

type NodeCategory = "io" | "data" | "capability" | "control" | "governance" | "time" | "legacy";
type NodeOption = {
  value: GraphNodeData["type"];
  label: string;
  description: string;
  category: NodeCategory;
  icon: ReactNode;
  tone: "green" | "blue" | "orange" | "purple" | "cyan" | "neutral";
  hidden?: boolean;
};

const nodeCategories: Array<{ key: NodeCategory; label: string }> = [
  { key: "io", label: "输入与输出" },
  { key: "data", label: "数据处理" },
  { key: "capability", label: "AI 与能力" },
  { key: "control", label: "流程控制" },
  { key: "governance", label: "治理与人工协作" },
  { key: "time", label: "时间控制" },
];

const nodeOptions: NodeOption[] = [
  { value: "input", label: "流程输入", description: "定义启动参数和测试表单", category: "io", icon: <ImportOutlined />, tone: "green" },
  { value: "output", label: "流程输出", description: "定义最终结果的数据契约", category: "io", icon: <ExportOutlined />, tone: "green" },
  { value: "mapping", label: "字段映射", description: "重组字段并适配下一节点", category: "data", icon: <SwapOutlined />, tone: "orange" },
  { value: "transform", label: "文本转换", description: "使用模板整理文本内容", category: "data", icon: <FunctionOutlined />, tone: "orange" },
  { value: "aggregate", label: "合并结果", description: "合并并行、多上游或批量输出", category: "data", icon: <MergeCellsOutlined />, tone: "orange" },
  { value: "state", label: "流程变量", description: "设置、累加或追加运行状态", category: "data", icon: <DatabaseOutlined />, tone: "orange" },
  { value: "agent", label: "AI Agent", description: "让受控 Agent 理解并处理任务", category: "capability", icon: <RobotOutlined />, tone: "blue" },
  { value: "llm", label: "LLM 调用", description: "直接执行 Prompt 和结构化输出", category: "capability", icon: <ThunderboltOutlined />, tone: "blue" },
  { value: "tool", label: "调用工具", description: "执行搜索、计算、图片等能力", category: "capability", icon: <ApiOutlined />, tone: "blue" },
  { value: "workflow", label: "子流程", description: "复用另一个已发布 Workflow", category: "capability", icon: <ApartmentOutlined />, tone: "blue" },
  { value: "knowledge", label: "知识检索", description: "检索受权限控制的知识库并返回引用", category: "capability", icon: <BookOutlined />, tone: "blue" },
  { value: "memoryRead", label: "读取 Memory", description: "读取用户确认保存的长期记忆", category: "capability", icon: <HistoryOutlined />, tone: "blue" },
  { value: "documentParser", label: "解析文档", description: "提交知识文档解析和索引任务", category: "capability", icon: <FileSearchOutlined />, tone: "blue" },
  { value: "condition", label: "条件分支", description: "按规则选择第一个命中的分支", category: "control", icon: <BranchesOutlined />, tone: "purple" },
  { value: "parallel", label: "并行执行", description: "同时执行多个互不依赖的任务", category: "control", icon: <ForkOutlined />, tone: "purple" },
  { value: "foreach", label: "遍历列表", description: "对数组中的每一项执行同一任务", category: "control", icon: <PartitionOutlined />, tone: "purple" },
  { value: "loop", label: "条件循环", description: "重复执行，直到满足停止条件", category: "control", icon: <RetweetOutlined />, tone: "purple" },
  { value: "retry", label: "重试与兜底", description: "失败重试、退避、超时和备用能力", category: "control", icon: <SyncOutlined />, tone: "purple" },
  { value: "terminate", label: "终止流程", description: "明确成功结束或抛出业务失败", category: "control", icon: <StopOutlined />, tone: "purple" },
  { value: "approval", label: "人工审批", description: "持久暂停并等待批准或拒绝", category: "governance", icon: <SafetyCertificateOutlined />, tone: "cyan" },
  { value: "humanInput", label: "人工输入", description: "暂停并等待用户补充结构化数据", category: "governance", icon: <SnippetsOutlined />, tone: "cyan" },
  { value: "memoryCandidate", label: "Memory 候选", description: "创建待用户确认的长期记忆候选", category: "governance", icon: <HistoryOutlined />, tone: "cyan" },
  { value: "waitEvent", label: "等待事件", description: "等待业务回调或外部事件后恢复", category: "time", icon: <AimOutlined />, tone: "cyan" },
  { value: "sleep", label: "等待时长", description: "暂停指定毫秒后继续执行", category: "time", icon: <ClockCircleOutlined />, tone: "cyan" },
  { value: "sleepUntil", label: "等待至时间", description: "在指定时间点继续执行", category: "time", icon: <CalendarOutlined />, tone: "cyan" },
  { value: "model", label: "旧版模型", description: "仅兼容历史草稿，请改用 Agent", category: "legacy", icon: <CodeOutlined />, tone: "neutral", hidden: true },
];

function nodeOption(type: string | undefined) {
  return nodeOptions.find((option) => option.value === type) ?? {
    value: type || "unknown",
    label: type || "未知节点",
    description: "未识别的 Workflow 节点",
    category: "legacy" as NodeCategory,
    icon: <CodeOutlined />,
    tone: "neutral" as const,
  };
}

const initialNodes: GraphNode[] = [
  { id: "input", type: "input", position: { x: 80, y: 160 }, data: { label: "输入", type: "input" } },
  { id: "output", type: "output", position: { x: 560, y: 160 }, data: { label: "输出", type: "output" } },
];
const initialEdges: Edge[] = [{ id: "input-output", source: "input", target: "output" }];

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatJsonEditorValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return JSON.stringify(value, null, 2);
}

function isValidJsonEditorValue(value: string) {
  if (!value.trim()) return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true'], .ant-select-dropdown, .ant-modal, .ant-drawer"));
}

function asSchema(value: unknown): JsonSchema | null {
  const parsed = parseJsonValue(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonSchema : null;
}

function schemaFieldTitle(key: string, field?: JsonSchemaProperty) {
  return field?.title || key;
}

function schemaSummary(schema: JsonSchema | null, empty = "未配置 Schema") {
  if (!schema) return empty;
  const fields = Object.entries(schema.properties ?? {}).map(([key, field]) => `${schemaFieldTitle(key, field)}${schema.required?.includes(key) ? " *" : ""}`);
  return fields.length ? fields.join(" · ") : schema.type || "已配置 Schema";
}

function getImageSchemaField(schema: JsonSchema | null) {
  return Object.entries(schema?.properties ?? {}).find(([key, field]) => field["x-input"] === "image" || field.format === "binary" || key === "fileId");
}

function runStatusMeta(status?: string) {
  if (status === "completed") return { color: "success", label: "已完成" };
  if (status === "failed") return { color: "error", label: "失败" };
  if (status === "running") return { color: "processing", label: "运行中" };
  if (status === "suspended") return { color: "warning", label: "已暂停" };
  if (status === "cancelled") return { color: "default", label: "已取消" };
  return { color: "default", label: status || "等待运行" };
}

function workflowOutputValue(output: unknown) {
  if (output && typeof output === "object" && "value" in output) return (output as { value: unknown }).value;
  return output;
}

function workflowImageUrl(value: unknown) {
  return value && typeof value === "object" && "url" in value ? String((value as { url: unknown }).url) : null;
}

function formatWorkflowDebugValue(value: unknown) {
  if (value == null) return "-";
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text) return "-";
  return text.length > 12000 ? `${text.slice(0, 12000)}\n…内容过长，已截断展示` : text;
}

function nodeSchema(node?: GraphNode | null) {
  return asSchema(node?.data.schema);
}

function WorkflowCanvasNode({ data, selected, type }: NodeProps<GraphNode>) {
  const nodeKind = data.type || type;
  const schema = nodeSchema({ data } as GraphNode);
  const meta = nodeOption(nodeKind);
  const typeLabel = meta.label;
  const isInput = nodeKind === "input";
  const isOutput = nodeKind === "output";
  const summary = nodeKind === "input" || nodeKind === "output"
    ? schemaSummary(schema)
    : nodeKind === "mapping"
      ? `映射字段：${Object.keys((parseJsonValue(data.mapConfig) as Record<string, unknown> | null) ?? {}).join("、") || "未配置"}`
      : nodeKind === "tool"
        ? data.toolId ? `Tool：${data.toolId} · ${data.modelSelection === "active" ? "当前启用模型" : "未指定模型"}` : "未选择 Tool"
        : nodeKind === "agent"
          ? data.agentId ? `Agent：${data.agentId}` : "未选择 Agent"
          : nodeKind === "transform"
            ? "模板转换"
            : data.description || meta.description;
  return <div className={`ai-visual-workflow-node node-${nodeKind} tone-${meta.tone}${selected ? " is-selected" : ""}`}>
    {!isInput ? <Handle type="target" position={Position.Left} /> : null}
    <div className="ai-visual-workflow-node-kicker">
      <span className="ai-visual-workflow-node-type"><span className="ai-visual-workflow-node-icon">{meta.icon}</span><span>{typeLabel}</span><code>{nodeKind}</code></span>
      {(nodeKind === "input" || nodeKind === "output") && schema ? <CheckCircleOutlined /> : null}
    </div>
    <div className="ai-visual-workflow-node-title">{data.label || typeLabel}</div>
    <div className="ai-visual-workflow-node-summary">{summary}</div>
    {nodeKind === "tool" && !data.toolId ? <WarningOutlined className="ai-visual-workflow-node-warning" /> : null}
    {!isOutput ? <Handle type="source" position={Position.Right} /> : null}
  </div>;
}

const workflowNodeTypes = Object.fromEntries(
  ["default", ...nodeOptions.map((option) => option.value)].map((type) => [type, WorkflowCanvasNode]),
);

function SchemaPreview({ schema, empty = "未定义输入输出契约", compact = false }: { schema: JsonSchema | null; empty?: string; compact?: boolean }) {
  if (!schema) return <Typography.Text type="secondary">{empty}</Typography.Text>;
  const properties = Object.entries(schema.properties ?? {});
  return <div className={`ai-visual-workflow-schema-preview${compact ? " is-compact" : ""}`}>
    <div className="ai-visual-workflow-schema-title"><InfoCircleOutlined /> {schema.title || "Schema 契约"}</div>
    {schema.description ? <Typography.Text type="secondary">{schema.description}</Typography.Text> : null}
    {properties.length ? properties.map(([key, field]) => <div className="ai-visual-workflow-schema-field" key={key}>
      <span className="ai-visual-workflow-schema-field-name">{schemaFieldTitle(key, field)}{schema.required?.includes(key) ? <em>必填</em> : null}</span>
      <Typography.Text type="secondary"><code>{key}</code> · {field["x-input"] === "image" ? "图片上传" : field.type || "值"}</Typography.Text>
      {field.description ? <Typography.Text type="secondary">{field.description}</Typography.Text> : null}
    </div>) : <Typography.Text type="secondary">{schema.type || "object"}，无字段定义</Typography.Text>}
  </div>;
}

function HumanInputWaitForm({
  waitInput,
  loading,
  onSubmit,
}: {
  waitInput: unknown;
  loading: boolean;
  onSubmit: (value: Record<string, unknown>) => void;
}) {
  const metadata = waitInput && typeof waitInput === "object" && !Array.isArray(waitInput)
    ? waitInput as { title?: string; description?: string; schema?: unknown }
    : {};
  const schema = asSchema(metadata.schema);
  const properties = Object.entries(schema?.properties ?? {});
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(
    properties.map(([key, field]) => [
      key,
      field.type === "array" || field.type === "object"
        ? formatJsonEditorValue(field.default)
        : field.default ?? (field.type === "boolean" ? false : ""),
    ]),
  ));
  const parsed = useMemo(() => {
    const output: Record<string, unknown> = {};
    const invalid = new Set<string>();
    for (const [key, field] of properties) {
      const raw = values[key];
      if (field.type === "array" || field.type === "object") {
        try {
          output[key] = typeof raw === "string" && raw.trim() ? JSON.parse(raw) : field.type === "array" ? [] : {};
        } catch {
          invalid.add(key);
        }
      } else if (field.type === "number" || field.type === "integer") {
        output[key] = raw === "" || raw == null ? null : Number(raw);
      } else {
        output[key] = raw;
      }
      if (schema?.required?.includes(key) && (output[key] == null || output[key] === "")) invalid.add(key);
    }
    return { output, invalid };
  }, [properties, schema?.required, values]);

  if (!schema || schema.type !== "object" || !properties.length) {
    return <div className="ai-visual-workflow-schema-input">
      <Typography.Text type="secondary">该人工输入节点没有可渲染的对象 Schema，请先回到节点配置补充字段。</Typography.Text>
    </div>;
  }

  return <div className="ai-visual-workflow-human-form">
    <div>
      <Typography.Text strong>{metadata.title || schema.title || "补充流程信息"}</Typography.Text>
      {metadata.description || schema.description ? <Typography.Paragraph type="secondary">{metadata.description || schema.description}</Typography.Paragraph> : null}
    </div>
    {properties.map(([key, field]) => {
      const required = schema.required?.includes(key);
      const invalid = parsed.invalid.has(key);
      const heading = <div className="ai-visual-workflow-field-heading">
        <div><Typography.Text strong>{schemaFieldTitle(key, field)}</Typography.Text><Typography.Text type="secondary"> · <code>{key}</code></Typography.Text></div>
        {invalid ? <Tag color="error">请检查</Tag> : required ? <Tag color="warning">必填</Tag> : <Tag>可选</Tag>}
      </div>;
      return <div className="ai-visual-workflow-schema-input" key={key}>
        {heading}
        {field.description ? <Typography.Text type="secondary">{field.description}</Typography.Text> : null}
        {field.enum?.length ? <Select
          value={values[key] === "" ? undefined : values[key]}
          options={field.enum.map((item) => ({ value: String(item), label: String(item) }))}
          onChange={(value) => setValues((current) => ({ ...current, [key]: value }))}
          placeholder={`选择${schemaFieldTitle(key, field)}`}
        /> : field.type === "boolean" ? <Switch
          checked={Boolean(values[key])}
          onChange={(checked) => setValues((current) => ({ ...current, [key]: checked }))}
        /> : field.type === "number" || field.type === "integer" ? <InputNumber
          value={typeof values[key] === "number" ? values[key] as number : null}
          min={field.minimum}
          max={field.maximum}
          precision={field.type === "integer" ? 0 : undefined}
          onChange={(value) => setValues((current) => ({ ...current, [key]: value }))}
          style={{ width: "100%" }}
        /> : field.type === "array" || field.type === "object" ? <Input.TextArea
          value={String(values[key] ?? "")}
          rows={4}
          status={invalid ? "error" : undefined}
          onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
          placeholder={field.type === "array" ? "[]" : "{}"}
        /> : field.format === "textarea" ? <Input.TextArea
          value={String(values[key] ?? "")}
          rows={3}
          onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
        /> : <Input
          value={String(values[key] ?? "")}
          onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
          placeholder={`输入${schemaFieldTitle(key, field)}`}
        />}
      </div>;
    })}
    <Button type="primary" block disabled={parsed.invalid.size > 0} loading={loading} onClick={() => onSubmit(parsed.output)}>提交信息并继续</Button>
  </div>;
}

type VisualWorkflowCanvasProps = {
  initialDefinitionId?: number | null;
  createNew?: boolean;
  onBack?: () => void;
};

export function VisualWorkflowCanvas({
  initialDefinitionId = null,
  createNew = false,
  onBack,
}: VisualWorkflowCanvasProps) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(initialDefinitionId);
  const [isNewDraft, setIsNewDraft] = useState(createNew);
  const [nodes, setNodes, onNodesChange] = useNodesState<GraphNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [name, setName] = useState("业务 AI 工作流");
  const [code, setCode] = useState("business-workflow");
  const [input, setInput] = useState("");
  const [assetFileId, setAssetFileId] = useState<number | null>(null);
  const [assetUrl, setAssetUrl] = useState<string | null>(null);
  const assetInstruction = "变成夸张搞怪的漫画风格，保留主体和主要构图";
  const [schemaInputValues, setSchemaInputValues] = useState<Record<string, string>>({});
  const [structuredSchemaInputValues, setStructuredSchemaInputValues] = useState<Record<string, string>>({});
  const [runResponse, setRunResponse] = useState<VisualWorkflowRunResponse | null>(null);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [draftVersion, setDraftVersion] = useState<number | null>(null);
  const [isDirty, setIsDirty] = useState(createNew);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [runPanelOpen, setRunPanelOpen] = useState(false);
  const [eventPayload, setEventPayload] = useState("{}");
  const [nodeSearch, setNodeSearch] = useState("");
  const [canvasTool, setCanvasTool] = useState<"pan" | "select">("pan");
  const [historyAvailability, setHistoryAvailability] = useState({ canUndo: false, canRedo: false });
  const [clipboardCount, setClipboardCount] = useState(0);
  const nodeSequenceRef = useRef(0);
  const edgeSequenceRef = useRef(0);
  const canvasRef = useRef<HTMLElement | null>(null);
  const reactFlowRef = useRef<ReactFlowInstance<GraphNode, Edge> | null>(null);
  const graphRef = useRef<WorkflowGraphSnapshot<GraphNode>>(cloneWorkflowGraph(initialNodes, initialEdges));
  const undoStackRef = useRef<Array<WorkflowGraphSnapshot<GraphNode>>>([]);
  const redoStackRef = useRef<Array<WorkflowGraphSnapshot<GraphNode>>>([]);
  const clipboardRef = useRef<WorkflowClipboard<GraphNode> | null>(null);
  const dragHistoryCapturedRef = useRef(false);
  const syncHistoryAvailability = useCallback(() => {
    setHistoryAvailability({
      canUndo: undoStackRef.current.length > 0,
      canRedo: redoStackRef.current.length > 0,
    });
  }, []);
  const clearHistory = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    syncHistoryAvailability();
  }, [syncHistoryAvailability]);
  const pushHistory = useCallback((snapshot?: WorkflowGraphSnapshot<GraphNode>) => {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-59),
      cloneWorkflowGraph(
        snapshot?.nodes ?? graphRef.current.nodes,
        snapshot?.edges ?? graphRef.current.edges,
      ),
    ];
    redoStackRef.current = [];
    syncHistoryAvailability();
  }, [syncHistoryAvailability]);
  const definitions = useQuery({
    queryKey: ["system-ai-visual-workflows"],
    queryFn: () => request<Definition[]>("/api/system/ai/workflow/visual/definitions"),
  });
  const detail = useQuery({
    queryKey: ["system-ai-visual-workflow", selectedId],
    enabled: selectedId != null,
    queryFn: () => request<Detail>(`/api/system/ai/workflow/visual/definitions/${selectedId}`),
  });
  const models = useQuery({
    queryKey: ["system-ai-workflow-models"],
    queryFn: () => request<{ data: ModelOption[] }>("/api/system/ai/model?page=1&pageSize=200").then((page) => page.data),
  });
  const agentOptions = useQuery({
    queryKey: ["system-ai-workflow-agents"],
    queryFn: () => request<AgentOption[]>("/api/system/ai/agent"),
  });
  const runtimeOptions = useQuery({
    queryKey: ["system-ai-workflow-tools"],
    queryFn: () => request<AgentOptions>("/api/system/ai/agent/options"),
  });
  const knowledgeOptions = useQuery({
    queryKey: ["system-ai-workflow-knowledge-options"],
    queryFn: () => request<KnowledgeOption[]>("/api/system/ai/knowledge?page=1&pageSize=100"),
  });
  const recentRuns = useQuery({
    queryKey: ["system-ai-visual-workflow-runs", code],
    enabled: runPanelOpen && Boolean(code) && !isNewDraft,
    queryFn: () => request<WorkflowRunSummary[]>(`/api/system/ai/workflow/runs?workflowCode=${encodeURIComponent(code)}`),
  });
  const visibleRunId = activeRunId ?? recentRuns.data?.[0]?.id ?? null;
  const runDetail = useQuery({
    queryKey: ["system-ai-visual-workflow-run", visibleRunId],
    enabled: runPanelOpen && Boolean(visibleRunId),
    queryFn: () => request<WorkflowRunDetail>(`/api/system/ai/workflow/runs/${visibleRunId}`),
    refetchInterval: (query) => ["running", "suspended"].includes(String(query.state.data?.status)) ? 2000 : false,
  });
  useEffect(() => {
    graphRef.current = { nodes, edges };
  }, [edges, nodes]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const syncResponsivePanels = (matches: boolean) => {
      setPaletteCollapsed(matches);
      setInspectorCollapsed(matches);
    };
    const handleChange = (event: MediaQueryListEvent) => syncResponsivePanels(event.matches);

    syncResponsivePanels(media.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);
  /* eslint-disable react-hooks/set-state-in-effect -- hydrate the editor from persisted server state. */
  useEffect(() => {
    const first = definitions.data?.[0];
    if (!isNewDraft && initialDefinitionId == null && selectedId == null && first) setSelectedId(first.id);
  }, [definitions.data, initialDefinitionId, isNewDraft, selectedId]);
  useEffect(() => {
    if (initialDefinitionId != null) {
      setSelectedId(initialDefinitionId);
      setIsNewDraft(false);
    }
  }, [initialDefinitionId]);
  useEffect(() => {
    setActiveRunId(null);
    setRunResponse(null);
  }, [selectedId]);
  useEffect(() => {
    const value = detail.data;
    if (!value) return;
    setName(value.name);
    setCode(value.code);
    setDraftVersion(value.version ?? null);
    const hydratedNodes = value.graph?.nodes?.length ? value.graph.nodes.map((node) => {
      const type = node.data.type || node.type || "default";
      return { ...node, type, data: { ...node.data, type } };
    }) : initialNodes;
    const hydratedEdges = normalizeWorkflowEdges(value.graph?.edges ?? initialEdges);
    const hydratedGraph = cloneWorkflowGraph(hydratedNodes, hydratedEdges);
    graphRef.current = hydratedGraph;
    setNodes(hydratedGraph.nodes);
    setEdges(hydratedGraph.edges);
    const properties = value.inputSchema?.properties ?? {};
    setSchemaInputValues((current) => Object.fromEntries(Object.entries(properties)
      .filter(([, field]) => field.type === "string")
      .map(([key, field]) => [key, current[key] ?? (typeof field.default === "string" ? field.default : key === "instruction" ? assetInstruction : "")])));
    setStructuredSchemaInputValues((current) => Object.fromEntries(Object.entries(properties)
      .filter(([, field]) => field.type === "array" || field.type === "object")
      .map(([key, field]) => [key, current[key] ?? formatJsonEditorValue(field.default)])));
    if (value.inputSchema?.type && value.inputSchema.type !== "object") {
      setInput(formatJsonEditorValue(value.inputSchema.default));
    }
    setIsDirty(false);
    clearHistory();
  }, [assetInstruction, clearHistory, detail.data, setEdges, setNodes]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const selectedNode = useMemo(() => nodes.find((node) => node.selected), [nodes]);
  const selectedNodeCount = nodes.filter((node) => node.selected).length;
  const selectedEdgeCount = edges.filter((edge) => edge.selected).length;
  const hasDeletableSelection = nodes.some((node) => node.selected && !["input", "output"].includes(node.data.type)) || selectedEdgeCount > 0;
  const hasCopyableSelection = nodes.some((node) => node.selected && !["input", "output"].includes(node.data.type));
  const renderedEdges = useMemo<Edge[]>(
    () => edges.map((edge) => ({ ...edge, markerEnd: { type: MarkerType.ArrowClosed } })),
    [edges],
  );
  const selectedMeta = nodeOption(selectedNode?.data.type);
  const visibleNodeOptions = useMemo(() => {
    const keyword = nodeSearch.trim().toLowerCase();
    return nodeOptions.filter((option) => !option.hidden && (!keyword || `${option.label} ${option.value} ${option.description}`.toLowerCase().includes(keyword)));
  }, [nodeSearch]);
  const workflowInputSchema = useMemo<JsonSchema | null>(() => {
    return detail.data?.inputSchema ?? nodeSchema(nodes.find((node) => node.data.type === "input"));
  }, [detail.data?.inputSchema, nodes]);
  const workflowOutputSchema = useMemo<JsonSchema | null>(() => {
    return detail.data?.outputSchema ?? nodeSchema(nodes.find((node) => node.data.type === "output"));
  }, [detail.data?.outputSchema, nodes]);
  const imageInputField = useMemo(() => getImageSchemaField(workflowInputSchema), [workflowInputSchema]);
  const rootStructuredInput = Boolean(workflowInputSchema?.type && workflowInputSchema.type !== "object");
  const structuredSchemaFields = useMemo(() => Object.entries(workflowInputSchema?.properties ?? {})
    .filter(([, field]) => field.type === "array" || field.type === "object"), [workflowInputSchema]);
  const imageWorkflow = Boolean(imageInputField) || nodes.some((node) => node.data.type === "tool" && ["image-transform", "image_transform"].includes(String(node.data.toolId)));
  const executionPreviewPath = useMemo(() => {
    if (!nodes.length) return [];
    const incoming = new Set(edges.map((edge) => edge.target));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const start = nodes.find((node) => !incoming.has(node.id)) ?? nodes[0];
    const path: GraphNode[] = [];
    const visited = new Set<string>();
    let current: GraphNode | undefined = start;
    while (current && !visited.has(current.id)) {
      path.push(current);
      visited.add(current.id);
      const nextId = edges
        .filter((edge) => edge.source === current?.id)
        .sort((left, right) => Number(left.sourceHandle ?? 0) - Number(right.sourceHandle ?? 0))[0]?.target;
      current = nextId ? byId.get(nextId) : undefined;
    }
    return path.length > 1 ? path : [...nodes].sort((left, right) => left.position.x - right.position.x);
  }, [edges, nodes]);
  const workflowToolCount = nodes.filter((node) => node.data.type === "tool").length;
  const persistedResultValue = workflowOutputValue(runDetail.data?.output);
  const resultValue = runResponse?.value ?? persistedResultValue;
  const resultImageUrl = workflowImageUrl(resultValue);
  const hasResult = runResponse !== null || runDetail.data?.output != null;
  const requiredSchemaValueMissing = useMemo(() => Object.entries(workflowInputSchema?.properties ?? {}).some(([key, field]) => {
    if (!workflowInputSchema?.required?.includes(key) || key === imageInputField?.[0]) return false;
    if (field.type === "string") return !(schemaInputValues[key] ?? field.default ?? "").toString().trim();
    if (field.type === "array" || field.type === "object") return !(structuredSchemaInputValues[key] ?? formatJsonEditorValue(field.default)).trim();
    return field.default == null;
  }), [imageInputField, schemaInputValues, structuredSchemaInputValues, workflowInputSchema]);
  const schemaJsonInvalid = useMemo(() => {
    if (rootStructuredInput) return !isValidJsonEditorValue(input);
    return structuredSchemaFields.some(([key, field]) => {
      const value = structuredSchemaInputValues[key] ?? formatJsonEditorValue(field.default);
      return Boolean(value.trim()) && !isValidJsonEditorValue(value);
    });
  }, [input, rootStructuredInput, structuredSchemaFields, structuredSchemaInputValues]);
  const runDisabled = detail.data?.status !== "published" || (imageInputField
    ? !assetFileId || requiredSchemaValueMissing || schemaJsonInvalid
    : workflowInputSchema
      ? rootStructuredInput
        ? !input.trim() || schemaJsonInvalid
        : requiredSchemaValueMissing || schemaJsonInvalid
      : !input.trim());
  const nextNodeId = useCallback((prefix: string) => {
    const used = new Set(graphRef.current.nodes.map((node) => node.id));
    let id = "";
    do id = `${prefix}-${++nodeSequenceRef.current}`;
    while (used.has(id));
    return id;
  }, []);
  const nextEdgeId = useCallback((edge: Pick<Edge, "source" | "target">) => {
    const used = new Set(graphRef.current.edges.map((item) => item.id));
    let id = "";
    do id = `${edge.source}-${edge.target}-${++edgeSequenceRef.current}`;
    while (used.has(id));
    return id;
  }, []);
  const save = useMutation({
    mutationFn: () =>
      request<{ definitionId: number; version: number }>("/api/system/ai/workflow/visual/versions", {
        method: "POST",
        body: JSON.stringify({ code, name, graph: serializeWorkflowGraph(nodes, edges) }),
      }),
    onSuccess: (value) => {
      setSelectedId(value.definitionId);
      setIsNewDraft(false);
      setDraftVersion(value.version);
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ["system-ai-visual-workflows"] });
      queryClient.invalidateQueries({ queryKey: ["system-ai-visual-workflow", value.definitionId] });
      feedback.success("工作流草稿已保存");
    },
  });
  const publish = useMutation({
    mutationFn: () => {
      if (!selectedId || !draftVersion) throw new Error("请先保存草稿");
      return request(`/api/system/ai/workflow/visual/definitions/${selectedId}/versions/${draftVersion}/publish`, { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-ai-visual-workflows"] });
      queryClient.invalidateQueries({ queryKey: ["system-ai-visual-workflow", selectedId] });
      feedback.success("工作流已发布");
    },
  });
  const run = useMutation({
    onMutate: () => {
      setActiveRunId(null);
      setRunResponse(null);
    },
    mutationFn: () => {
      if (!selectedId) throw new Error("请先保存并发布工作流");
      const schemaProperties = workflowInputSchema?.properties;
      const value = rootStructuredInput
        ? input
        : schemaProperties
        ? JSON.stringify(Object.fromEntries(Object.entries(schemaProperties).map(([key, field]) => {
          if (imageInputField?.[0] === key) return [key, assetFileId];
          if (field.type === "string") return [key, schemaInputValues[key] ?? (typeof field.default === "string" ? field.default : "")];
          if (field.type === "array" || field.type === "object") {
            const raw = structuredSchemaInputValues[key] ?? formatJsonEditorValue(field.default);
            return [key, raw.trim() ? JSON.parse(raw) : null];
          }
          return [key, field.default ?? null];
        })))
        : imageWorkflow
          ? JSON.stringify({ fileId: assetFileId, instruction: assetInstruction })
          : input;
      return request<VisualWorkflowRunResponse>(`/api/system/ai/workflow/visual/definitions/${selectedId}/runs`, { method: "POST", body: JSON.stringify({ value }) });
    },
    onSuccess: async (value) => {
      setRunResponse(value);
      setActiveRunId(value.runId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system-ai-visual-workflow-runs", code] }),
        queryClient.invalidateQueries({ queryKey: ["system-ai-visual-workflow-run", value.runId] }),
      ]);
      if (value.status === "suspended") feedback.warning(`Workflow Run #${value.runId} 正在等待外部操作`);
      else feedback.success(`Workflow Run #${value.runId} 执行完成`);
    },
    onError: async () => {
      await queryClient.invalidateQueries({ queryKey: ["system-ai-visual-workflow-runs", code] });
    },
  });
  const pendingWait = runDetail.data?.waits?.find((wait) => wait.status === "pending");
  const humanInputWait = pendingWait?.waitType === "event" && pendingWait.correlationKey?.startsWith("human-input:");
  const resolveWait = useMutation({
    mutationFn: async ({ action, data }: { action: "approve" | "reject" | "event"; data?: unknown }) => {
      if (!visibleRunId || !pendingWait) throw new Error("当前没有待处理的 Workflow Wait");
      if (action === "event") {
        return request<VisualWorkflowRunResponse>(`/api/system/ai/workflow/runs/${visibleRunId}/events`, {
          method: "POST",
          body: JSON.stringify({
            waitId: pendingWait.id,
            correlationKey: pendingWait.correlationKey,
            data: data ?? (eventPayload.trim() ? JSON.parse(eventPayload) : {}),
          }),
        });
      }
      return request<VisualWorkflowRunResponse>(`/api/system/ai/workflow/runs/${visibleRunId}/waits/${pendingWait.id}/decision`, {
        method: "POST",
        body: JSON.stringify({ approved: action === "approve" }),
      });
    },
    onSuccess: async (value) => {
      setRunResponse(value);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system-ai-visual-workflow-run", visibleRunId] }),
        queryClient.invalidateQueries({ queryKey: ["system-ai-visual-workflow-runs", code] }),
      ]);
      feedback.success(value.status === "suspended" ? "操作已提交，Workflow 仍在等待" : "Workflow 已恢复执行");
    },
  });
  const assetUpload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<{ id: number; url: string }>("/api/system/ai/workflow/assets", { method: "POST", body: form });
    },
    onSuccess: (value) => {
      setAssetFileId(value.id);
      setAssetUrl(value.url);
      feedback.success("图片已上传，可以运行 Workflow");
    },
  });
  const canvasCenterPosition = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const nodeCount = graphRef.current.nodes.length;
    if (!rect || !reactFlowRef.current) return { x: 280 + nodeCount * 28, y: 80 + (nodeCount % 4) * 100 };
    return reactFlowRef.current.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  }, []);
  const addNode = useCallback((type: string, position = canvasCenterPosition()) => {
    pushHistory();
    const id = nextNodeId(type);
    const label = nodeOptions.find((item) => item.value === type)?.label ?? type;
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), {
      id,
      type,
      position,
      data: {
        label,
        type,
        template: "{{value}}",
        mapConfig: JSON.stringify({ value: { template: "${inputData}" } }, null, 2),
        children: "[]",
        body: "",
        predicate: JSON.stringify({ op: "truthy", value: { path: "inputData" } }, null, 2),
        loopType: "dountil",
        concurrency: 3,
        duration: 1000,
        modelSelection: type === "llm" ? "purpose" : undefined,
        purpose: type === "llm" ? "agent" : undefined,
        prompt: type === "llm" ? "请处理以下输入：\n${inputData}" : undefined,
        outputSchema: type === "llm" ? "" : undefined,
        aggregateMode: type === "aggregate" ? "array" : undefined,
        retries: type === "retry" ? 2 : undefined,
        backoffMs: type === "retry" ? 500 : undefined,
        timeoutMs: type === "retry" ? 30000 : type === "approval" ? 604800000 : ["waitEvent", "humanInput"].includes(type) ? 86400000 : undefined,
        title: type === "approval" ? "请确认是否继续执行" : type === "humanInput" ? "请补充流程所需信息" : undefined,
        correlationKey: type === "waitEvent" ? "business-event:${inputData.id}" : undefined,
        schema: type === "humanInput" ? JSON.stringify({ type: "object", required: ["comment"], properties: { comment: { type: "string", title: "补充说明" } } }, null, 2) : type === "input" ? JSON.stringify({ type: "string", title: "输入内容", description: "Workflow 的初始输入" }, null, 2) : type === "output" ? JSON.stringify({ description: "Workflow 最终输出" }, null, 2) : undefined,
        knowledgeBaseIds: type === "knowledge" ? "[]" : undefined,
        queryTemplate: ["knowledge", "memoryRead"].includes(type) ? "${inputData}" : undefined,
        limit: ["knowledge", "memoryRead"].includes(type) ? 8 : undefined,
        stateKey: type === "state" ? "result" : undefined,
        stateAction: type === "state" ? "set" : undefined,
        terminateStatus: type === "terminate" ? "success" : undefined,
        message: type === "terminate" ? "Workflow 已完成" : undefined,
        contentTemplate: type === "memoryCandidate" ? "${inputData}" : undefined,
        documentIdPath: type === "documentParser" ? "inputData.documentId" : undefined,
      },
      selected: true,
    }]);
    setIsDirty(true);
  }, [canvasCenterPosition, nextNodeId, pushHistory, setNodes]);
  const resetDraft = () => {
    setSelectedId(null);
    setIsNewDraft(true);
    setDraftVersion(null);
    setName("业务 AI 工作流");
    setCode("business-workflow");
    const initial = cloneWorkflowGraph(initialNodes, initialEdges);
    graphRef.current = initial;
    setNodes(initial.nodes);
    setEdges(initial.edges);
    setRunResponse(null);
    setActiveRunId(null);
    setIsDirty(true);
    clearHistory();
  };
  const selectedType = selectedNode?.data.type;
  const deleteSelectedElements = useCallback(() => {
    const next = deleteWorkflowSelection(graphRef.current.nodes, graphRef.current.edges);
    if (!next.changed) return;
    pushHistory();
    setNodes(next.nodes);
    setEdges(next.edges);
    setIsDirty(true);
  }, [pushHistory, setEdges, setNodes]);
  const updateSelectedNode = (patch: Partial<GraphNode["data"]>) => {
    if (!selectedNode) return;
    pushHistory();
    setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, ...patch } } : node));
    setIsDirty(true);
  };
  const selectedJson = (key: "mapConfig" | "children" | "body" | "predicate" | "schema" | "outputSchema" | "knowledgeBaseIds" | "fallback") => {
    const value = selectedNode?.data[key];
    if (typeof value === "string") return value;
    return value == null ? "" : JSON.stringify(value, null, 2);
  };
  const selectedChildren = useMemo<MastraChildEntry[]>(() => {
    if (!selectedNode) return [];
    try {
      const value = selectedNode.data.children;
      const parsed = typeof value === "string" ? JSON.parse(value || "[]") : value;
      return Array.isArray(parsed) ? parsed as MastraChildEntry[] : [];
    } catch {
      return [];
    }
  }, [selectedNode]);
  const selectedBody = useMemo<MastraChildEntry | null>(() => {
    if (!selectedNode) return null;
    try {
      const value = selectedNode.data.body;
      const parsed = typeof value === "string" ? JSON.parse(value || "null") : value;
      return parsed && typeof parsed === "object" ? parsed as MastraChildEntry : null;
    } catch {
      return null;
    }
  }, [selectedNode]);
  const selectedFallback = useMemo<MastraChildEntry | null>(() => {
    if (!selectedNode) return null;
    try {
      const value = selectedNode.data.fallback;
      const parsed = typeof value === "string" ? JSON.parse(value || "null") : value;
      return parsed && typeof parsed === "object" ? parsed as MastraChildEntry : null;
    } catch {
      return null;
    }
  }, [selectedNode]);
  const selectedKnowledgeIds = useMemo<number[]>(() => {
    if (!selectedNode) return [];
    const parsed = parseJsonValue(selectedNode.data.knowledgeBaseIds);
    return Array.isArray(parsed) ? parsed.map(Number).filter(Boolean) : [];
  }, [selectedNode]);
  const updateChildren = (children: MastraChildEntry[]) => updateSelectedNode({ children: JSON.stringify(children) });
  const updateBody = (body: MastraChildEntry | null) => updateSelectedNode({ body: body ? JSON.stringify(body) : "" });
  const updateFallback = (fallback: MastraChildEntry | null) => updateSelectedNode({ fallback: fallback ? JSON.stringify(fallback) : "" });
  const referenceOptions = (type: MastraChildEntry["type"]) => {
    if (type === "agent") return (agentOptions.data ?? []).filter((item) => item.status === 1).map((item) => ({ value: String(item.id), label: `${item.name} · ${item.code}` }));
    if (type === "tool") return (runtimeOptions.data?.tools ?? []).filter((item) => item.status === 1).map((item) => ({ value: String(item.id), label: `${item.name} · ${item.code}` }));
    return (definitions.data ?? []).filter((item) => item.status === "published" && item.id !== selectedId).map((item) => ({ value: String(item.id), label: `${item.name} · ${item.code}` }));
  };
  const referenceKey = (type: MastraChildEntry["type"]) => type === "agent" ? "agentId" : type === "tool" ? "toolId" : "workflowId";
  const renderChildEditor = (child: MastraChildEntry, onChange: (next: MastraChildEntry) => void, onDelete?: () => void, branch = false) => {
    const key = referenceKey(child.type);
    const childAgent = child.type === "agent" ? (agentOptions.data ?? []).find((agent) => String(agent.id) === String(child.agentId)) : undefined;
    const childTool = child.type === "tool" ? (runtimeOptions.data?.tools ?? []).find((tool) => String(tool.id) === String(child.toolId) || tool.code === String(child.toolId)) : undefined;
    const predicate = child.predicate ?? { op: "eq", left: { path: "inputData.route" }, right: { literal: "" } };
    const predicatePath = predicate.op === "truthy" || predicate.op === "falsy" ? predicate.value?.path : predicate.left?.path;
    const predicateLiteral = predicate.right?.literal;
    const updatePredicate = (next: Partial<WorkflowPredicate>) => onChange({ ...child, predicate: { ...predicate, ...next } });
    return <div className="ai-visual-workflow-child-editor" key={child.id}>
      {branch ? <>
        <div className="ai-visual-workflow-child-heading">
          <Input size="small" value={child.label ?? ""} placeholder={child.isDefault ? "默认分支" : "分支名称"} onChange={(event) => onChange({ ...child, label: event.target.value })} />
          <span><Typography.Text type="secondary">默认</Typography.Text><Switch size="small" checked={Boolean(child.isDefault)} onChange={(checked) => onChange({ ...child, isDefault: checked, predicate: checked ? undefined : predicate })} /></span>
          {onDelete ? <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={onDelete} aria-label="删除分支" /> : null}
        </div>
        {!child.isDefault ? <div className="ai-visual-workflow-branch-rule">
          <Select
            size="small"
            value={predicate.op ?? "eq"}
            options={[
              { value: "eq", label: "等于" },
              { value: "ne", label: "不等于" },
              { value: "contains", label: "包含" },
              { value: "gt", label: "大于" },
              { value: "gte", label: "大于等于" },
              { value: "lt", label: "小于" },
              { value: "lte", label: "小于等于" },
              { value: "truthy", label: "有值" },
              { value: "falsy", label: "为空" },
            ]}
            onChange={(op) => updatePredicate(op === "truthy" || op === "falsy" ? { op, value: { path: predicatePath || "inputData" }, left: undefined, right: undefined } : { op, left: { path: predicatePath || "inputData.route" }, right: { literal: predicateLiteral ?? "" }, value: undefined })}
          />
          <Input size="small" value={predicatePath ?? ""} placeholder="inputData.route" onChange={(event) => updatePredicate(predicate.op === "truthy" || predicate.op === "falsy" ? { value: { path: event.target.value } } : { left: { path: event.target.value } })} />
          {predicate.op !== "truthy" && predicate.op !== "falsy" ? <Input size="small" value={String(predicateLiteral ?? "")} placeholder="比较值" onChange={(event) => updatePredicate({ right: { literal: event.target.value } })} /> : null}
        </div> : <Typography.Text type="secondary">前面的规则都未命中时执行</Typography.Text>}
      </> : <div className="ai-visual-workflow-child-heading"><Typography.Text strong>{child.label || "执行节点"}</Typography.Text>{onDelete ? <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={onDelete} aria-label="删除子节点" /> : null}</div>}
      <div className="ai-visual-workflow-child-reference">
        <Select size="small" value={child.type} options={[{ value: "agent", label: "Agent" }, { value: "tool", label: "Tool" }, { value: "workflow", label: "子流程" }]} onChange={(type) => onChange({ ...child, type, [referenceKey(type)]: child[key] })} />
        <Select size="small" showSearch value={child[key]} loading={child.type === "agent" ? agentOptions.isLoading : child.type === "tool" ? runtimeOptions.isLoading : definitions.isLoading} options={referenceOptions(child.type)} placeholder="选择受控能力" onChange={(value) => onChange({ ...child, [key]: String(value) })} />
      </div>
      {childAgent ? <div className="ai-visual-workflow-child-resolution"><RobotOutlined /><span>{childAgent.modelName ? `模型：${childAgent.modelName}${childAgent.modelIdentifier ? ` · ${childAgent.modelIdentifier}` : ""}` : "模型：agent 用途级默认策略"}</span>{childAgent.skillIds?.length ? <Tag>{childAgent.skillIds.length} Skills</Tag> : null}</div> : null}
      {childTool ? <div className="ai-visual-workflow-child-resolution"><ApiOutlined /><span>{childTool.handlerKey === "mcp_gateway" ? "MCP Tool · 通过 Gateway 受控调用" : `Tool Registry · ${childTool.handlerKey || childTool.code}`}</span></div> : null}
    </div>;
  };
  const selectedTool = useMemo(
    () => selectedNode?.data.type === "tool" ? (runtimeOptions.data?.tools ?? []).find((tool) => String(tool.id) === String(selectedNode.data.toolId) || tool.code === String(selectedNode.data.toolId)) : undefined,
    [runtimeOptions.data?.tools, selectedNode],
  );
  const selectedAgent = useMemo(
    () => selectedNode?.data.type === "agent" ? (agentOptions.data ?? []).find((agent) => String(agent.id) === String(selectedNode.data.agentId)) : undefined,
    [agentOptions.data, selectedNode],
  );
  const selectedAgentSkills = useMemo(
    () => (runtimeOptions.data?.skills ?? []).filter((skill) => selectedAgent?.skillIds?.includes(skill.id)),
    [runtimeOptions.data?.skills, selectedAgent?.skillIds],
  );
  const selectedAgentTools = useMemo(
    () => (runtimeOptions.data?.tools ?? []).filter((tool) => selectedAgent?.toolIds?.includes(tool.id)),
    [runtimeOptions.data?.tools, selectedAgent?.toolIds],
  );
  const toolSelectOptions = useMemo(() => {
    const enabled = (runtimeOptions.data?.tools ?? []).filter((tool) => tool.status === 1);
    const asOption = (tool: ToolOption) => ({ value: String(tool.id), label: `${tool.name} · ${tool.code}` });
    const nativeTools = enabled.filter((tool) => tool.handlerKey !== "mcp_gateway").map(asOption);
    const mcpTools = enabled.filter((tool) => tool.handlerKey === "mcp_gateway").map(asOption);
    return [
      ...(nativeTools.length ? [{ label: "内置与业务 Tool", options: nativeTools }] : []),
      ...(mcpTools.length ? [{ label: "MCP Tool", options: mcpTools }] : []),
    ];
  }, [runtimeOptions.data?.tools]);
  const selectedToolConfig = useMemo(
    () => parseJsonValue(selectedTool?.configJson) as Record<string, unknown> | null,
    [selectedTool?.configJson],
  );
  const applyGraphSnapshot = useCallback((snapshot: WorkflowGraphSnapshot<GraphNode>) => {
    const next = cloneWorkflowGraph(snapshot.nodes, snapshot.edges);
    graphRef.current = next;
    setNodes(next.nodes);
    setEdges(next.edges);
    setIsDirty(true);
  }, [setEdges, setNodes]);
  const undoCanvas = useCallback(() => {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current = [
      ...redoStackRef.current.slice(-59),
      cloneWorkflowGraph(graphRef.current.nodes, graphRef.current.edges),
    ];
    applyGraphSnapshot(previous);
    syncHistoryAvailability();
  }, [applyGraphSnapshot, syncHistoryAvailability]);
  const redoCanvas = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current = [
      ...undoStackRef.current.slice(-59),
      cloneWorkflowGraph(graphRef.current.nodes, graphRef.current.edges),
    ];
    applyGraphSnapshot(next);
    syncHistoryAvailability();
  }, [applyGraphSnapshot, syncHistoryAvailability]);
  const copySelection = useCallback(() => {
    const clipboard = copyWorkflowSelection(graphRef.current.nodes, graphRef.current.edges);
    if (!clipboard.nodes.length) return false;
    clipboardRef.current = clipboard;
    setClipboardCount(clipboard.nodes.length);
    feedback.success(`已复制 ${clipboard.nodes.length} 个节点`);
    return true;
  }, []);
  const pasteSelection = useCallback(() => {
    const clipboard = clipboardRef.current;
    if (!clipboard?.nodes.length) return false;
    pushHistory();
    const pasted = pasteWorkflowSelection(
      clipboard,
      (node) => nextNodeId(workflowNodeType(node)),
      nextEdgeId,
    );
    const next = {
      nodes: [
        ...graphRef.current.nodes.map((node) => ({ ...node, selected: false })),
        ...pasted.nodes,
      ],
      edges: [
        ...graphRef.current.edges.map((edge) => ({ ...edge, selected: false })),
        ...pasted.edges,
      ],
    };
    applyGraphSnapshot(next);
    clipboardRef.current = cloneWorkflowGraph(
      pasted.nodes.map((node) => ({ ...node, selected: false })),
      pasted.edges,
    );
    return true;
  }, [applyGraphSnapshot, nextEdgeId, nextNodeId, pushHistory]);
  const duplicateSelection = useCallback(() => {
    const selected = copyWorkflowSelection(graphRef.current.nodes, graphRef.current.edges);
    if (!selected.nodes.length) return false;
    const previousClipboard = clipboardRef.current;
    clipboardRef.current = selected;
    const duplicated = pasteSelection();
    clipboardRef.current = previousClipboard;
    return duplicated;
  }, [pasteSelection]);
  const fitCanvasView = useCallback(() => {
    void reactFlowRef.current?.fitView({ padding: 0.18, duration: 240, maxZoom: 1.2 });
  }, []);
  const handlePaletteDragStart = useCallback((event: DragEvent<HTMLButtonElement>, type: string) => {
    event.dataTransfer.setData("application/x-admin-workflow-node", type);
    event.dataTransfer.effectAllowed = "copy";
  }, []);
  const handleCanvasDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);
  const handleCanvasDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const type = event.dataTransfer.getData("application/x-admin-workflow-node");
    if (!nodeOptions.some((option) => option.value === type && !option.hidden) || !reactFlowRef.current) return;
    addNode(type, reactFlowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }, [addNode]);
  const handleNodesChange = (changes: Parameters<typeof onNodesChange>[0]) => {
    const mutatesGraph = changes.some((change) => ["position", "remove", "add", "replace"].includes(change.type));
    const needsHistory = changes.some((change) => change.type === "remove")
      || (changes.some((change) => change.type === "position") && !dragHistoryCapturedRef.current);
    if (needsHistory) pushHistory();
    onNodesChange(changes);
    if (mutatesGraph) setIsDirty(true);
  };
  const handleEdgesChange = (changes: Parameters<typeof onEdgesChange>[0]) => {
    const mutatesGraph = changes.some((change) => ["remove", "add", "replace"].includes(change.type));
    if (mutatesGraph) pushHistory();
    onEdgesChange(changes);
    if (mutatesGraph) setIsDirty(true);
  };
  const handleConnect = (connection: Connection) => {
    if (!isWorkflowConnectionValid(connection, graphRef.current.edges)) return;
    pushHistory();
    setEdges((current) => addEdge({ ...connection, animated: true }, current));
    setIsDirty(true);
  };
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      const primary = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (primary && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redoCanvas();
        else undoCanvas();
        return;
      }
      if (primary && key === "y") {
        event.preventDefault();
        redoCanvas();
        return;
      }
      if (primary && key === "c") {
        if (copySelection()) event.preventDefault();
        return;
      }
      if (primary && key === "v") {
        if (pasteSelection()) event.preventDefault();
        return;
      }
      if (primary && key === "d") {
        if (duplicateSelection()) event.preventDefault();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (graphRef.current.nodes.some((node) => node.selected) || graphRef.current.edges.some((edge) => edge.selected)) {
          event.preventDefault();
          deleteSelectedElements();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [copySelection, deleteSelectedElements, duplicateSelection, pasteSelection, redoCanvas, undoCanvas]);
  return (
    <div className="ai-visual-workflow-editor">
      <header className="ai-visual-workflow-topbar">
        <div className="ai-visual-workflow-heading">
          {onBack ? <Tooltip title="返回 Workflow 列表"><Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack} aria-label="返回 Workflow 列表" /></Tooltip> : null}
          <div className="ai-visual-workflow-title-fields">
            <Input
              className="ai-visual-workflow-name"
              value={name}
              onChange={(event) => { setName(event.target.value); setIsDirty(true); }}
              placeholder="Workflow 名称"
              aria-label="Workflow 名称"
            />
            <Input
              className="ai-visual-workflow-code"
              value={code}
              onChange={(event) => { setCode(event.target.value); setIsDirty(true); }}
              placeholder="workflow-code"
              aria-label="Workflow 编码"
            />
          </div>
          <div className="ai-visual-workflow-meta">
            <Tag color="blue">Mastra Builder</Tag>
            <Tag color={detail.data?.status === "published" ? "success" : "warning"}>{detail.data?.status === "published" ? "已发布" : "草稿"}</Tag>
            {draftVersion ? <Typography.Text type="secondary">v{draftVersion}</Typography.Text> : null}
            {isDirty ? <Typography.Text type="warning">有未保存修改</Typography.Text> : null}
          </div>
        </div>
        <Space wrap>
          <Button icon={<PlusOutlined />} onClick={resetDraft}>新建</Button>
          <Button type="primary" loading={save.isPending} onClick={() => save.mutate()}>保存草稿</Button>
          <Button disabled={!selectedId || !draftVersion || isDirty} loading={publish.isPending} onClick={() => publish.mutate()}>发布版本</Button>
          <Tooltip title="重新读取当前草稿"><Button icon={<ReloadOutlined />} onClick={() => detail.refetch()} disabled={!selectedId} aria-label="刷新 Workflow 草稿" /></Tooltip>
          <Button onClick={() => setRunPanelOpen(true)} disabled={!selectedId || detail.data?.status !== "published"}>测试运行</Button>
        </Space>
      </header>
      <div className={`ai-visual-workflow-layout${paletteCollapsed ? " palette-collapsed" : ""}${inspectorCollapsed ? " inspector-collapsed" : ""}`}>
        <aside className={paletteCollapsed ? "ai-visual-workflow-palette is-collapsed" : "ai-visual-workflow-palette"}>
          <div className="ai-visual-workflow-panel-heading">
            {!paletteCollapsed ? <div><Typography.Text strong>节点库</Typography.Text><Typography.Text type="secondary">{visibleNodeOptions.length} 种能力</Typography.Text></div> : null}
            <Tooltip title={paletteCollapsed ? "展开节点面板" : "收起节点面板"}>
              <Button type="text" size="small" icon={paletteCollapsed ? <RightOutlined /> : <LeftOutlined />} onClick={() => setPaletteCollapsed((value) => !value)} aria-label={paletteCollapsed ? "展开节点面板" : "收起节点面板"} />
            </Tooltip>
          </div>
          {!paletteCollapsed ? <div className="ai-visual-workflow-palette-items">
            <Input.Search allowClear value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} placeholder="搜索节点或 key" />
            {nodeCategories.map((category) => {
              const options = visibleNodeOptions.filter((option) => option.category === category.key);
              if (!options.length) return null;
              return <section className="ai-visual-workflow-palette-group" key={category.key}>
                <Typography.Text type="secondary" className="ai-visual-workflow-palette-group-title">{category.label}</Typography.Text>
                <div className="ai-visual-workflow-palette-group-items">
                  {options.map((option) => <button
                    className={`ai-visual-workflow-palette-item tone-${option.tone}`}
                    draggable
                    key={option.value}
                    type="button"
                    onClick={() => addNode(option.value)}
                    onDragStart={(event) => handlePaletteDragStart(event, option.value)}
                  >
                    <span className="ai-visual-workflow-palette-item-icon">{option.icon}</span>
                    <span className="ai-visual-workflow-palette-item-copy"><strong>{option.label}</strong><small>{option.description}</small></span>
                    <code>{option.value}</code>
                    <PlusOutlined className="ai-visual-workflow-palette-item-add" />
                  </button>)}
                </div>
              </section>;
            })}
          </div> : null}
        </aside>
        <main ref={canvasRef} className={`ai-visual-workflow-canvas tool-${canvasTool}`} onDragOver={handleCanvasDragOver} onDrop={handleCanvasDrop}>
          <div className="ai-visual-workflow-canvas-toolbar">
            <Space.Compact>
              <Tooltip title="移动画布；按住空格可临时平移">
                <Button type={canvasTool === "pan" ? "primary" : "default"} icon={<DragOutlined />} onClick={() => setCanvasTool("pan")} aria-label="移动画布" />
              </Tooltip>
              <Tooltip title="框选节点；按住 Ctrl 或 Command 追加选择">
                <Button type={canvasTool === "select" ? "primary" : "default"} icon={<SelectOutlined />} onClick={() => setCanvasTool("select")} aria-label="框选节点" />
              </Tooltip>
            </Space.Compact>
            <Space.Compact>
              <Tooltip title="撤销（Ctrl/Command + Z）"><Button icon={<UndoOutlined />} disabled={!historyAvailability.canUndo} onClick={undoCanvas} aria-label="撤销画布操作" /></Tooltip>
              <Tooltip title="重做（Ctrl/Command + Shift + Z）"><Button icon={<RedoOutlined />} disabled={!historyAvailability.canRedo} onClick={redoCanvas} aria-label="重做画布操作" /></Tooltip>
            </Space.Compact>
            <Space.Compact>
              <Tooltip title="复制所选节点（Ctrl/Command + C）"><Button icon={<CopyOutlined />} disabled={!hasCopyableSelection} onClick={copySelection} aria-label="复制所选节点" /></Tooltip>
              <Tooltip title="粘贴节点（Ctrl/Command + V）"><Button icon={<SnippetsOutlined />} disabled={!clipboardCount} onClick={pasteSelection} aria-label="粘贴节点" /></Tooltip>
              <Tooltip title="复制一份所选节点（Ctrl/Command + D）"><Button icon={<PlusOutlined />} disabled={!hasCopyableSelection} onClick={duplicateSelection} aria-label="复制一份所选节点" /></Tooltip>
              <Tooltip title="删除所选节点或连线"><Button danger icon={<DeleteOutlined />} disabled={!hasDeletableSelection} onClick={deleteSelectedElements} aria-label="删除所选画布元素" /></Tooltip>
            </Space.Compact>
            <Tooltip title="定位全部节点"><Button icon={<AimOutlined />} onClick={fitCanvasView} aria-label="定位全部节点" /></Tooltip>
            <Popover
              placement="bottomRight"
              trigger="click"
              title="画布快捷键"
              content={<dl className="ai-visual-workflow-shortcuts">
                <div><dt>平移</dt><dd>拖动空白区域 / 空格</dd></div>
                <div><dt>框选</dt><dd>切换框选工具后拖动空白区域</dd></div>
                <div><dt>多选</dt><dd>Ctrl / Command + 点击</dd></div>
                <div><dt>复制 / 粘贴</dt><dd>Ctrl / Command + C / V</dd></div>
                <div><dt>复制一份</dt><dd>Ctrl / Command + D</dd></div>
                <div><dt>撤销 / 重做</dt><dd>Ctrl / Command + Z / Shift + Z</dd></div>
                <div><dt>删除</dt><dd>Delete / Backspace</dd></div>
              </dl>}
            >
              <Button icon={<QuestionCircleOutlined />} aria-label="查看画布快捷键" />
            </Popover>
          </div>
          <div className="ai-visual-workflow-canvas-hint">
            <Typography.Text type="secondary">从左侧拖入节点并连接执行路径；右侧配置受控 Agent、Tool 或控制流。</Typography.Text>
          </div>
          <ReactFlow
            nodes={nodes}
            edges={renderedEdges}
            nodeTypes={workflowNodeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onInit={(instance) => { reactFlowRef.current = instance; }}
            onNodeDragStart={() => {
              pushHistory();
              dragHistoryCapturedRef.current = true;
            }}
            onNodeDragStop={() => { dragHistoryCapturedRef.current = false; }}
            isValidConnection={(connection) => isWorkflowConnectionValid(connection, edges)}
            panOnDrag={canvasTool === "pan" ? true : [1, 2]}
            selectionOnDrag={canvasTool === "select"}
            selectionMode={SelectionMode.Partial}
            panActivationKeyCode="Space"
            multiSelectionKeyCode={["Meta", "Control"]}
            deleteKeyCode={null}
            snapToGrid
            snapGrid={[24, 24]}
            minZoom={0.05}
            maxZoom={2.5}
            fitView
            fitViewOptions={{ padding: 0.18, maxZoom: 1.2 }}
          >
            <Background gap={24} size={1} />
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>
        </main>
        <aside className={inspectorCollapsed ? "ai-visual-workflow-inspector is-collapsed" : "ai-visual-workflow-inspector"}>
          <div className="ai-visual-workflow-panel-heading">
            {!inspectorCollapsed ? <div><Typography.Text strong>节点配置</Typography.Text><Typography.Text type="secondary">输入、行为与输出</Typography.Text></div> : null}
            <Tooltip title={inspectorCollapsed ? "展开节点配置" : "收起节点配置"}>
              <Button type="text" size="small" icon={inspectorCollapsed ? <LeftOutlined /> : <RightOutlined />} onClick={() => setInspectorCollapsed((value) => !value)} aria-label={inspectorCollapsed ? "展开节点配置" : "收起节点配置"} />
            </Tooltip>
          </div>
          {!inspectorCollapsed ? <>
          {selectedNode ? (
            <Space orientation="vertical" size={14} style={{ width: "100%" }}>
              <div className={`ai-visual-workflow-inspector-hero tone-${selectedMeta.tone}`}>
                <span className="ai-visual-workflow-inspector-icon">{selectedMeta.icon}</span>
                <div>
                  <div><Typography.Text strong>{selectedMeta.label}</Typography.Text><code>{selectedNode.data.type}</code></div>
                  <Typography.Text type="secondary">{selectedMeta.description}</Typography.Text>
                </div>
              </div>
              <label className="ai-visual-workflow-inspector-field">
                <span><Typography.Text strong>节点名称</Typography.Text><Typography.Text type="secondary">显示在画布和运行日志中</Typography.Text></span>
                <Input value={selectedNode.data.label} onChange={(event) => updateSelectedNode({ label: event.target.value })} placeholder={selectedMeta.label} />
              </label>
              {selectedNode.data.type === "input" ? <>
                <Typography.Text strong>输入契约</Typography.Text>
                <SchemaPreview schema={nodeSchema(selectedNode)} empty="请配置输入 Schema，测试运行会按它显示上传或输入控件" />
                <Input.TextArea value={selectedJson("schema")} onChange={(event) => updateSelectedNode({ schema: event.target.value })} placeholder={'{"type":"object","properties":{"text":{"type":"string"}}}'} rows={8} />
                <Typography.Text type="secondary">使用 `x-input: &quot;image&quot;` 声明图片字段，测试运行会自动显示上传按钮。</Typography.Text>
              </> : null}
              {selectedNode.data.type === "output" ? <>
                <Typography.Text strong>输出契约</Typography.Text>
                <SchemaPreview schema={nodeSchema(selectedNode)} empty="请配置输出 Schema，运行结果会按它展示" />
                <Input.TextArea value={selectedJson("schema")} onChange={(event) => updateSelectedNode({ schema: event.target.value })} placeholder={'{"type":"object","properties":{"result":{"type":"string"}}}'} rows={8} />
              </> : null}
              {["agent", "tool", "workflow"].includes(selectedNode.data.type) ? <Typography.Text type="secondary">引用来自 Admin Base 受控 Registry，发布时会检查是否存在、启用和允许执行。</Typography.Text> : null}
              {selectedNode.data.type === "agent" ? <label className="ai-visual-workflow-inspector-field">
                <span><Typography.Text strong>执行 Agent</Typography.Text><Typography.Text type="secondary">选择一个包含模型、Skill 和 Tool 权限的执行主体</Typography.Text></span>
                <Select
                  showSearch
                  value={selectedNode.data.agentId}
                  loading={agentOptions.isLoading}
                  placeholder="选择 Agent"
                  options={(agentOptions.data ?? []).filter((agent) => agent.status === 1).map((agent) => ({ value: String(agent.id), label: `${agent.name} · ${agent.code}` }))}
                  onChange={(value) => updateSelectedNode({ agentId: Number(value) })}
                />
              </label> : null}
              {selectedNode.data.type === "agent" && selectedAgent ? <section className="ai-visual-workflow-runtime-resolution">
                <div className="ai-visual-workflow-runtime-resolution-heading">
                  <div><Typography.Text strong>实际运行配置</Typography.Text><Typography.Text type="secondary">运行时根据 Agent 配置解析，不由画布猜测</Typography.Text></div>
                  <Tag color="blue">Agent</Tag>
                </div>
                <dl>
                  <div><dt>模型</dt><dd>{selectedAgent.modelName ? <><Typography.Text>{selectedAgent.modelName}</Typography.Text>{selectedAgent.modelIdentifier ? <code>{selectedAgent.modelIdentifier}</code> : null}</> : <Typography.Text type="warning">未固定，使用 agent 用途级默认模型</Typography.Text>}</dd></div>
                  <div><dt>Skills</dt><dd>{selectedAgentSkills.length ? selectedAgentSkills.slice(0, 4).map((skill) => <Tag key={skill.id}>{skill.name}</Tag>) : <Typography.Text type="secondary">未绑定 Runtime Skill</Typography.Text>}{selectedAgentSkills.length > 4 ? <Tag>+{selectedAgentSkills.length - 4}</Tag> : null}</dd></div>
                  <div><dt>Tools</dt><dd>{selectedAgentTools.length ? <><Typography.Text>{selectedAgentTools.length} 个受控 Tool</Typography.Text>{selectedAgentTools.some((tool) => tool.handlerKey === "mcp_gateway") ? <Tag color="purple">含 MCP</Tag> : null}</> : <Typography.Text type="secondary">未绑定 Tool</Typography.Text>}</dd></div>
                </dl>
                <Typography.Text type="secondary">Skill 是 Agent 的指令与能力包，不作为独立执行节点；Skill 中允许的 Tool 会在 Agent 运行时参与治理。</Typography.Text>
              </section> : null}
              {selectedNode.data.type === "tool" ? <label className="ai-visual-workflow-inspector-field">
                <span><Typography.Text strong>执行工具</Typography.Text><Typography.Text type="secondary">MCP Tool 已按来源单独分组</Typography.Text></span>
                <Select
                  showSearch
                  value={selectedNode.data.toolId}
                  loading={runtimeOptions.isLoading}
                  placeholder="选择受控 Tool"
                  options={toolSelectOptions}
                  onChange={(value) => updateSelectedNode({ toolId: Number(value) })}
                />
              </label> : null}
              {selectedNode.data.type === "tool" ? <>
                {selectedTool ? <>
                  <Typography.Text strong>{selectedTool.name} 的输入</Typography.Text>
                  <Typography.Text type="secondary">{selectedTool.description || "这个 Tool 会在服务端执行，并由 Workflow Run 记录步骤。"}</Typography.Text>
                  {selectedTool.handlerKey === "mcp_gateway" ? <div className="ai-visual-workflow-tool-origin"><Tag color="purple">MCP Tool</Tag><Typography.Text type="secondary">通过 MCP Gateway 调用{selectedToolConfig?.remoteName ? ` · ${String(selectedToolConfig.remoteName)}` : ""}</Typography.Text></div> : <div className="ai-visual-workflow-tool-origin"><Tag>受控 Tool</Tag><Typography.Text type="secondary">服务端 Registry：{selectedTool.handlerKey || selectedTool.code}</Typography.Text></div>}
                  {selectedTool.code === "image-transform" ? <Typography.Text type="secondary">模型来源：当前启用的 Image Model。你只需要在 AI 模型管理中启用一个图片模型，运行时会自动选择它。</Typography.Text> : null}
                  <SchemaPreview schema={asSchema(selectedTool.inputSchemaJson)} empty="该 Tool 没有声明输入 Schema" />
                </> : <Typography.Text type="warning">还没有选择 Tool，保存或发布前必须完成配置。</Typography.Text>}
              </> : null}
              {selectedNode.data.type === "workflow" ? <label className="ai-visual-workflow-inspector-field">
                <span><Typography.Text strong>已发布子流程</Typography.Text><Typography.Text type="secondary">不能引用自身或草稿版本</Typography.Text></span>
                <Select showSearch value={selectedNode.data.workflowId} loading={definitions.isLoading} placeholder="选择已发布子 Workflow" options={(definitions.data ?? []).filter((definition) => definition.status === "published" && definition.id !== selectedId).map((definition) => ({ value: String(definition.id), label: `${definition.name} · ${definition.code}` }))} onChange={(value) => updateSelectedNode({ workflowId: Number(value) })} />
              </label> : null}
              {selectedNode.data.type === "transform" ? <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>文本模板</Typography.Text><Typography.Text type="secondary">使用 {"{{value}}"} 引用上一步输出</Typography.Text></span><Input.TextArea value={selectedNode.data.template} onChange={(event) => updateSelectedNode({ template: event.target.value })} placeholder="结果：{{value}}" rows={4} /></label> : null}
              {selectedNode.data.type === "mapping" ? <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>字段映射</Typography.Text><Typography.Text type="secondary">把输入整理成下一节点需要的对象</Typography.Text></span><Input.TextArea value={selectedJson("mapConfig")} onChange={(event) => updateSelectedNode({ mapConfig: event.target.value })} placeholder={'{"prompt":{"template":"${inputData}"}}'} rows={7} /></label> : null}
              {selectedNode.data.type === "llm" ? <section className="ai-visual-workflow-inspector-section">
                <div className="ai-visual-workflow-inspector-section-heading"><div><Typography.Text strong>模型调用策略</Typography.Text><Typography.Text type="secondary">默认使用用途级模型路由和候选回退</Typography.Text></div><Tag color="blue">AI SDK 7</Tag></div>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>模型来源</Typography.Text></span><Select value={selectedNode.data.modelSelection ?? "purpose"} options={[{ value: "purpose", label: "用途级模型策略（推荐）" }, { value: "fixed", label: "固定模型" }]} onChange={(value) => updateSelectedNode({ modelSelection: value })} /></label>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>用途</Typography.Text><Typography.Text type="secondary">决定主模型和候选模型的有序回退</Typography.Text></span><Select value={selectedNode.data.purpose ?? "agent"} options={[{ value: "agent", label: "Agent / 通用任务" }, { value: "chat", label: "Chat" }, { value: "rag", label: "RAG" }, { value: "eval", label: "Eval" }]} onChange={(value) => updateSelectedNode({ purpose: value })} /></label>
                {selectedNode.data.modelSelection === "fixed" ? <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>固定模型</Typography.Text></span><Select showSearch loading={models.isLoading} value={selectedNode.data.modelId} placeholder="选择已启用 Chat 模型" options={(models.data ?? []).filter((model) => model.modelType === "chat").map((model) => ({ value: model.id, label: `${model.name} · ${model.modelId}` }))} onChange={(value) => updateSelectedNode({ modelId: value })} /></label> : null}
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>System Prompt</Typography.Text><Typography.Text type="secondary">可选；不要写入密钥或不可审计权限</Typography.Text></span><Input.TextArea value={selectedNode.data.systemPrompt} onChange={(event) => updateSelectedNode({ systemPrompt: event.target.value })} rows={3} placeholder="你是一个受控的业务分析助手。" /></label>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>Prompt 模板</Typography.Text><Typography.Text type="secondary">支持 ${"${inputData}"}、${"${initData.xxx}"}、${"${state.xxx}"}</Typography.Text></span><Input.TextArea value={selectedNode.data.prompt} onChange={(event) => updateSelectedNode({ prompt: event.target.value })} rows={5} placeholder="请处理以下输入：${inputData}" /></label>
                <details className="ai-visual-workflow-inspector-advanced"><summary>输出和运行限制</summary><Space orientation="vertical" size={10} style={{ width: "100%" }}>
                  <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>Temperature</Typography.Text></span><InputNumber min={0} max={2} step={0.1} value={selectedNode.data.temperature} placeholder="使用运行时默认值" onChange={(value) => updateSelectedNode({ temperature: value ?? undefined })} style={{ width: "100%" }} /></label>
                  <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>最大输出 Tokens</Typography.Text><Typography.Text type="secondary">不会超过模型配置上限</Typography.Text></span><InputNumber min={16} max={131072} value={selectedNode.data.maxOutputTokens} placeholder="使用模型上限" onChange={(value) => updateSelectedNode({ maxOutputTokens: value ?? undefined })} style={{ width: "100%" }} /></label>
                  <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>结构化输出 Schema</Typography.Text><Typography.Text type="secondary">留空返回文本；配置后要求模型返回 JSON</Typography.Text></span><Input.TextArea value={selectedJson("outputSchema")} onChange={(event) => updateSelectedNode({ outputSchema: event.target.value })} rows={6} placeholder={'{"type":"object","required":["result"],"properties":{"result":{"type":"string"}}}'} /></label>
                </Space></details>
              </section> : null}
              {selectedNode.data.type === "aggregate" ? <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>合并方式</Typography.Text><Typography.Text type="secondary">多条入边会作为数组输入</Typography.Text></span><Select value={selectedNode.data.aggregateMode ?? "array"} options={[{ value: "array", label: "保留为数组" }, { value: "object", label: "合并对象字段" }, { value: "flatten", label: "展平数组" }, { value: "unique", label: "去重" }, { value: "first", label: "取第一项" }, { value: "last", label: "取最后一项" }]} onChange={(value) => updateSelectedNode({ aggregateMode: value })} /></label> : null}
              {selectedNode.data.type === "retry" ? <section className="ai-visual-workflow-inspector-section">
                <div className="ai-visual-workflow-inspector-section-heading"><div><Typography.Text strong>主任务</Typography.Text><Typography.Text type="secondary">仅允许受控 Agent、Tool 或子 Workflow</Typography.Text></div></div>
                {selectedBody ? renderChildEditor(selectedBody, updateBody) : <Button icon={<PlusOutlined />} onClick={() => updateBody({ type: "agent", id: nextNodeId("retry-body"), label: "主任务", agentId: String(agentOptions.data?.[0]?.id ?? "") })}>选择主任务</Button>}
                <Space size={8} style={{ width: "100%" }}><InputNumber min={0} max={5} suffix="次" value={selectedNode.data.retries ?? 2} onChange={(value) => updateSelectedNode({ retries: value ?? 2 })} style={{ width: "50%" }} /><InputNumber min={0} max={60000} suffix="ms" value={selectedNode.data.backoffMs ?? 500} onChange={(value) => updateSelectedNode({ backoffMs: value ?? 500 })} style={{ width: "50%" }} /></Space>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>单次超时</Typography.Text></span><InputNumber min={100} max={600000} suffix="ms" value={selectedNode.data.timeoutMs ?? 30000} onChange={(value) => updateSelectedNode({ timeoutMs: value ?? 30000 })} style={{ width: "100%" }} /></label>
                <div className="ai-visual-workflow-inspector-section-heading"><div><Typography.Text strong>兜底任务</Typography.Text><Typography.Text type="secondary">全部重试失败后执行，可不配置</Typography.Text></div></div>
                {selectedFallback ? renderChildEditor(selectedFallback, updateFallback, () => updateFallback(null)) : <Button onClick={() => updateFallback({ type: "agent", id: nextNodeId("retry-fallback"), label: "兜底任务", agentId: String(agentOptions.data?.[0]?.id ?? "") })}>添加兜底任务</Button>}
              </section> : null}
              {selectedNode.data.type === "approval" ? <section className="ai-visual-workflow-inspector-section">
                <Typography.Text type="secondary">运行到这里会持久暂停，审批结果会以 `approved/status/resolution/value` 传给下一节点。</Typography.Text>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>审批标题</Typography.Text></span><Input value={selectedNode.data.title} onChange={(event) => updateSelectedNode({ title: event.target.value })} placeholder="请确认是否继续执行" /></label>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>审批说明</Typography.Text></span><Input.TextArea value={selectedNode.data.description} onChange={(event) => updateSelectedNode({ description: event.target.value })} rows={3} /></label>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>审批有效期</Typography.Text></span><InputNumber min={60000} max={2592000000} suffix="ms" value={selectedNode.data.timeoutMs ?? 604800000} onChange={(value) => updateSelectedNode({ timeoutMs: value ?? 604800000 })} style={{ width: "100%" }} /></label>
              </section> : null}
              {selectedNode.data.type === "humanInput" ? <section className="ai-visual-workflow-inspector-section">
                <Typography.Text type="secondary">运行时会根据 Schema 收集结构化数据并持久恢复，适合补件、修改意见和人工分类。</Typography.Text>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>输入标题</Typography.Text></span><Input value={selectedNode.data.title} onChange={(event) => updateSelectedNode({ title: event.target.value })} /></label>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>输入说明</Typography.Text></span><Input.TextArea value={selectedNode.data.description} onChange={(event) => updateSelectedNode({ description: event.target.value })} rows={3} /></label>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>表单 Schema</Typography.Text></span><Input.TextArea value={selectedJson("schema")} onChange={(event) => updateSelectedNode({ schema: event.target.value })} rows={7} /></label>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>等待超时</Typography.Text></span><InputNumber min={60000} max={2592000000} suffix="ms" value={selectedNode.data.timeoutMs ?? 86400000} onChange={(value) => updateSelectedNode({ timeoutMs: value ?? 86400000 })} style={{ width: "100%" }} /></label>
              </section> : null}
              {selectedNode.data.type === "waitEvent" ? <section className="ai-visual-workflow-inspector-section">
                <Typography.Text type="secondary">关联键用于把支付回调、客户回复或业务事件准确交给当前 Wait。</Typography.Text>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>事件关联键</Typography.Text><Typography.Text type="secondary">支持输入模板</Typography.Text></span><Input value={selectedNode.data.correlationKey} onChange={(event) => updateSelectedNode({ correlationKey: event.target.value })} placeholder="order:${inputData.orderId}" /></label>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>等待超时</Typography.Text></span><InputNumber min={60000} max={2592000000} suffix="ms" value={selectedNode.data.timeoutMs ?? 86400000} onChange={(value) => updateSelectedNode({ timeoutMs: value ?? 86400000 })} style={{ width: "100%" }} /></label>
              </section> : null}
              {selectedNode.data.type === "knowledge" ? <section className="ai-visual-workflow-inspector-section">
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>知识库范围</Typography.Text><Typography.Text type="secondary">留空时检索当前用户可见的全部知识库</Typography.Text></span><Select mode="multiple" allowClear loading={knowledgeOptions.isLoading} value={selectedKnowledgeIds} options={(knowledgeOptions.data ?? []).filter((item) => item.status === 1).map((item) => ({ value: item.id, label: `${item.name} · ${item.code}` }))} onChange={(value) => updateSelectedNode({ knowledgeBaseIds: JSON.stringify(value) })} /></label>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>检索问题模板</Typography.Text></span><Input.TextArea value={selectedNode.data.queryTemplate} onChange={(event) => updateSelectedNode({ queryTemplate: event.target.value })} rows={3} placeholder="${inputData.question}" /></label>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>返回引用数</Typography.Text></span><InputNumber min={1} max={20} value={selectedNode.data.limit ?? 8} onChange={(value) => updateSelectedNode({ limit: value ?? 8 })} style={{ width: "100%" }} /></label>
              </section> : null}
              {selectedNode.data.type === "state" ? <section className="ai-visual-workflow-inspector-section">
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>变量名</Typography.Text><Typography.Text type="secondary">后续使用 ${"${state.key}"} 读取</Typography.Text></span><Input value={selectedNode.data.stateKey} onChange={(event) => updateSelectedNode({ stateKey: event.target.value })} /></label>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>操作</Typography.Text></span><Select value={selectedNode.data.stateAction ?? "set"} options={[{ value: "set", label: "设置" }, { value: "increment", label: "数值累加" }, { value: "append", label: "追加到数组" }, { value: "merge", label: "合并对象" }]} onChange={(value) => updateSelectedNode({ stateAction: value })} /></label>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>值模板</Typography.Text><Typography.Text type="secondary">留空使用上一步输出</Typography.Text></span><Input value={selectedNode.data.stateValue} onChange={(event) => updateSelectedNode({ stateValue: event.target.value })} placeholder="${inputData.value}" /></label>
              </section> : null}
              {selectedNode.data.type === "terminate" ? <section className="ai-visual-workflow-inspector-section">
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>结束状态</Typography.Text></span><Select value={selectedNode.data.terminateStatus ?? "success"} options={[{ value: "success", label: "成功结束" }, { value: "failure", label: "业务失败" }]} onChange={(value) => updateSelectedNode({ terminateStatus: value })} /></label>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>结果说明</Typography.Text></span><Input value={selectedNode.data.message} onChange={(event) => updateSelectedNode({ message: event.target.value })} /></label>
              </section> : null}
              {selectedNode.data.type === "memoryRead" ? <section className="ai-visual-workflow-inspector-section">
                <Typography.Text type="secondary">只读取用户已确认保存的 Memory，不会读取待确认候选。</Typography.Text>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>召回问题</Typography.Text></span><Input value={selectedNode.data.queryTemplate} onChange={(event) => updateSelectedNode({ queryTemplate: event.target.value })} placeholder="${inputData}" /></label>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>最多返回</Typography.Text></span><InputNumber min={1} max={20} value={selectedNode.data.limit ?? 5} onChange={(value) => updateSelectedNode({ limit: value ?? 5 })} style={{ width: "100%" }} /></label>
              </section> : null}
              {selectedNode.data.type === "memoryCandidate" ? <section className="ai-visual-workflow-inspector-section">
                <Typography.Text type="secondary">这里只创建候选，不会静默写入长期 Memory；用户仍需在治理页确认。</Typography.Text>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>候选内容模板</Typography.Text></span><Input.TextArea value={selectedNode.data.contentTemplate} onChange={(event) => updateSelectedNode({ contentTemplate: event.target.value })} rows={4} placeholder="${inputData.preference}" /></label>
              </section> : null}
              {selectedNode.data.type === "documentParser" ? <section className="ai-visual-workflow-inspector-section">
                <Typography.Text type="secondary">提交 Knowledge Parser Job 后立即返回 jobId；长任务由常驻 Worker 处理。</Typography.Text>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>Document ID 取值路径</Typography.Text></span><Input value={selectedNode.data.documentIdPath} onChange={(event) => updateSelectedNode({ documentIdPath: event.target.value })} placeholder="inputData.documentId" /></label>
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>固定 Document ID</Typography.Text><Typography.Text type="secondary">仅适合固定来源流程</Typography.Text></span><InputNumber min={1} value={selectedNode.data.documentId} onChange={(value) => updateSelectedNode({ documentId: value ?? undefined })} style={{ width: "100%" }} /></label>
              </section> : null}
              {["parallel", "condition"].includes(selectedNode.data.type) ? <section className="ai-visual-workflow-inspector-section">
                <div className="ai-visual-workflow-inspector-section-heading"><div><Typography.Text strong>{selectedNode.data.type === "parallel" ? "并行任务" : "分支规则"}</Typography.Text><Typography.Text type="secondary">{selectedNode.data.type === "parallel" ? "所有任务同时执行，完成后合并结果" : "从上到下判断，执行第一个命中的分支"}</Typography.Text></div><Tag>{selectedChildren.length}</Tag></div>
                {selectedChildren.map((child, index) => renderChildEditor(child, (next) => updateChildren(selectedChildren.map((item, childIndex) => childIndex === index ? next : item)), () => updateChildren(selectedChildren.filter((_, childIndex) => childIndex !== index)), selectedNode.data.type === "condition"))}
                <Button icon={<PlusOutlined />} onClick={() => updateChildren([...selectedChildren, {
                  type: "agent",
                  id: nextNodeId("branch"),
                  label: selectedNode.data.type === "condition" ? `分支 ${selectedChildren.length + 1}` : `并行任务 ${selectedChildren.length + 1}`,
                  predicate: selectedNode.data.type === "condition" ? { op: "eq", left: { path: "inputData.route" }, right: { literal: "" } } : undefined,
                  agentId: String(agentOptions.data?.[0]?.id ?? ""),
                }])}>添加{selectedNode.data.type === "parallel" ? "并行任务" : "条件分支"}</Button>
              </section> : null}
              {selectedNode.data.type === "foreach" ? <section className="ai-visual-workflow-inspector-section">
                <div className="ai-visual-workflow-inspector-section-heading"><div><Typography.Text strong>遍历任务</Typography.Text><Typography.Text type="secondary">输入必须是数组，每一项都会传给下面的能力</Typography.Text></div></div>
                {selectedBody ? renderChildEditor(selectedBody, updateBody) : <Button icon={<PlusOutlined />} onClick={() => updateBody({ type: "agent", id: nextNodeId("foreach-body"), label: "逐项处理", agentId: String(agentOptions.data?.[0]?.id ?? "") })}>选择逐项执行能力</Button>}
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>最大并发</Typography.Text><Typography.Text type="secondary">1-20；外部 API 建议从 3 开始</Typography.Text></span><InputNumber min={1} max={20} value={selectedNode.data.concurrency ?? 3} onChange={(value) => updateSelectedNode({ concurrency: value ?? 3 })} style={{ width: "100%" }} /></label>
              </section> : null}
              {selectedNode.data.type === "loop" ? <section className="ai-visual-workflow-inspector-section">
                <div className="ai-visual-workflow-inspector-section-heading"><div><Typography.Text strong>循环任务</Typography.Text><Typography.Text type="secondary">最多执行 20 次，防止无限循环</Typography.Text></div></div>
                {selectedBody ? renderChildEditor(selectedBody, updateBody) : <Button icon={<PlusOutlined />} onClick={() => updateBody({ type: "agent", id: nextNodeId("loop-body"), label: "循环处理", agentId: String(agentOptions.data?.[0]?.id ?? "") })}>选择循环执行能力</Button>}
                <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>循环方式</Typography.Text></span><Select value={selectedNode.data.loopType ?? "dountil"} options={[{ value: "dountil", label: "执行直到条件满足" }, { value: "dowhile", label: "条件满足时继续" }]} onChange={(value) => updateSelectedNode({ loopType: value })} /></label>
                <details className="ai-visual-workflow-inspector-advanced"><summary>高级停止条件</summary><Input.TextArea value={selectedJson("predicate")} onChange={(event) => updateSelectedNode({ predicate: event.target.value })} placeholder={'{"op":"truthy","value":{"path":"inputData.result"}}'} rows={5} /></details>
              </section> : null}
              {selectedNode.data.type === "sleep" ? <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>等待时长</Typography.Text><Typography.Text type="secondary">最长 24 小时</Typography.Text></span><InputNumber min={0} max={86400000} suffix="ms" value={selectedNode.data.duration ?? 1000} onChange={(value) => updateSelectedNode({ duration: value ?? 1000 })} style={{ width: "100%" }} /></label> : null}
              {selectedNode.data.type === "sleepUntil" ? <label className="ai-visual-workflow-inspector-field"><span><Typography.Text strong>继续执行时间</Typography.Text><Typography.Text type="secondary">ISO 8601，例如 2026-08-26T18:00:00+08:00</Typography.Text></span><Input value={selectedNode.data.date} onChange={(event) => updateSelectedNode({ date: event.target.value })} placeholder="2026-08-26T18:00:00+08:00" /></label> : null}
              {selectedNode.data.type === "model" ? <Select
                showSearch
                loading={models.isLoading}
                value={selectedNode.data.modelId}
                placeholder="选择执行模型"
                options={(models.data ?? []).filter((model) => model.modelType === "chat").map((model) => ({ value: model.id, label: `${model.name} · ${model.modelId}` }))}
                onChange={(value) => updateSelectedNode({ modelId: value })}
              /> : null}
              <Button danger icon={<DeleteOutlined />} disabled={selectedType === "input" || selectedType === "output"} onClick={deleteSelectedElements}>删除节点</Button>
            </Space>
          ) : <Typography.Text type="secondary">点击画布节点配置参数</Typography.Text>}
          </> : null}
        </aside>
      </div>
      <footer className="ai-visual-workflow-statusbar">
        <Space size="middle">
          <Typography.Text type="secondary">{nodes.length} 个节点 · {edges.length} 条连接</Typography.Text>
          {selectedNodeCount || selectedEdgeCount ? <Typography.Text type="secondary">已选择 {selectedNodeCount} 个节点 · {selectedEdgeCount} 条连接</Typography.Text> : null}
          <Typography.Text type="secondary">发布前会校验 Builder JSON、Registry 引用和权限边界</Typography.Text>
        </Space>
        <Button type="link" onClick={() => setRunPanelOpen(true)} disabled={!selectedId || detail.data?.status !== "published"}>打开测试运行</Button>
      </footer>
      <Drawer
        title={<Space size={8}><Typography.Text strong>测试运行</Typography.Text><Tag color="blue">已发布 v{draftVersion ?? "-"}</Tag></Space>}
        placement="right"
        size={520}
        open={runPanelOpen}
        onClose={() => setRunPanelOpen(false)}
        className="ai-visual-workflow-run-drawer"
      >
        <div className="ai-visual-workflow-run-panel">
          <div className="ai-visual-workflow-run-intro">
            <Typography.Text type="secondary">运行当前已发布版本。输入会按 Schema 校验，并写入 Run / Step 记录。</Typography.Text>
            <Tag color="blue">Schema 驱动输入</Tag>
          </div>
          {workflowInputSchema ? <>
            <SchemaPreview schema={workflowInputSchema} compact />
            <div className="ai-visual-workflow-execution-preview">
              <div className="ai-visual-workflow-execution-heading"><Typography.Text strong>执行预览</Typography.Text><Typography.Text type="secondary">{executionPreviewPath.length} 个节点 · {workflowToolCount} 个 Tool</Typography.Text></div>
              <div className="ai-visual-workflow-execution-path">
                {executionPreviewPath.map((node, index) => <span className="ai-visual-workflow-execution-step" key={node.id}>
                  {index > 0 ? <span className="ai-visual-workflow-execution-arrow">→</span> : null}
                  <Tag color={node.data.type === "input" ? "blue" : node.data.type === "output" ? "success" : node.data.type === "tool" || node.data.type === "agent" ? "geekblue" : undefined}>{node.data.label || nodeOptions.find((option) => option.value === node.data.type)?.label || node.data.type}</Tag>
                </span>)}
              </div>
              <Typography.Text type="secondary">{imageWorkflow ? "图片 Tool 使用当前启用的 Image Model，生成结果不会覆盖原图。" : "运行时将按画布连接和节点配置执行。"}</Typography.Text>
            </div>
            {imageInputField ? <div className="ai-visual-workflow-upload-field">
              <div className="ai-visual-workflow-field-heading">
                <div><Typography.Text strong>{schemaFieldTitle(imageInputField[0], imageInputField[1])}</Typography.Text><Typography.Text type="secondary"> · 图片</Typography.Text></div>
                {assetFileId ? <Tag color="success">已上传 #{assetFileId}</Tag> : <Tag color="warning">必填</Tag>}
              </div>
              <div className="ai-visual-workflow-upload-row">
                {assetUrl ? <img className="ai-visual-workflow-input-preview" src={assetUrl} alt="Workflow 输入图片" /> : <div className="ai-visual-workflow-upload-placeholder"><UploadOutlined /><span>未选择图片</span></div>}
                <Upload
                  accept="image/*"
                  showUploadList={false}
                  beforeUpload={(file) => {
                    assetUpload.mutate(file);
                    return false;
                  }}
                >
                  <Button icon={<UploadOutlined />} loading={assetUpload.isPending}>{assetUrl ? "重新上传" : "上传图片"}</Button>
                </Upload>
              </div>
            </div> : null}
            {Object.entries(workflowInputSchema.properties ?? {}).filter(([key, field]) => key !== imageInputField?.[0] && field.type === "string").map(([key, field]) => (
              <div className="ai-visual-workflow-schema-input" key={key}>
                <div className="ai-visual-workflow-field-heading">
                  <Typography.Text strong>{schemaFieldTitle(key, field)}</Typography.Text>
                  {workflowInputSchema.required?.includes(key) ? <Tag color="warning">必填</Tag> : <Tag>可选</Tag>}
                </div>
                {key === "instruction" ? <Input.TextArea
                  value={schemaInputValues[key] ?? ""}
                  onChange={(event) => setSchemaInputValues((current) => ({ ...current, [key]: event.target.value }))}
                  placeholder={typeof field.default === "string" ? field.default : `输入 ${schemaFieldTitle(key, field)}`}
                  rows={3}
                /> : <Input
                  value={schemaInputValues[key] ?? ""}
                  onChange={(event) => setSchemaInputValues((current) => ({ ...current, [key]: event.target.value }))}
                  placeholder={typeof field.default === "string" ? field.default : `输入 ${schemaFieldTitle(key, field)}`}
                />}
              </div>
            ))}
            {structuredSchemaFields.map(([key, field]) => {
              const value = structuredSchemaInputValues[key] ?? formatJsonEditorValue(field.default);
              const invalid = Boolean(value.trim()) && !isValidJsonEditorValue(value);
              return <div className="ai-visual-workflow-schema-input" key={key}>
                <div className="ai-visual-workflow-field-heading">
                  <div><Typography.Text strong>{schemaFieldTitle(key, field)}</Typography.Text><Typography.Text type="secondary"> · {field.type === "array" ? "数组 JSON" : "对象 JSON"}</Typography.Text></div>
                  {invalid ? <Tag color="error">JSON 格式错误</Tag> : workflowInputSchema.required?.includes(key) ? <Tag color="warning">必填</Tag> : <Tag>可选</Tag>}
                </div>
                <Input.TextArea
                  value={value}
                  onChange={(event) => setStructuredSchemaInputValues((current) => ({ ...current, [key]: event.target.value }))}
                  placeholder={field.type === "array" ? '[{"value":"示例"}]' : '{"key":"value"}'}
                  rows={5}
                  status={invalid ? "error" : undefined}
                />
              </div>;
            })}
            {rootStructuredInput ? <div className="ai-visual-workflow-schema-input">
              <div className="ai-visual-workflow-field-heading">
                <div><Typography.Text strong>流程输入</Typography.Text><Typography.Text type="secondary"> · {workflowInputSchema.type === "array" ? "数组 JSON" : "JSON"}</Typography.Text></div>
                {schemaJsonInvalid ? <Tag color="error">JSON 格式错误</Tag> : <Tag color="success">格式正确</Tag>}
              </div>
              <Input.TextArea value={input} onChange={(event) => setInput(event.target.value)} rows={8} status={schemaJsonInvalid ? "error" : undefined} />
            </div> : null}
          </> : <Input.TextArea value={input} onChange={(event) => setInput(event.target.value)} placeholder="输入一段测试内容" rows={4} />}
          <div className="ai-visual-workflow-run-action-bar">
            <Typography.Text type="secondary">{run.isPending ? "Workflow 正在执行，请稍候…" : "准备好输入后运行已发布版本"}</Typography.Text>
            <Button type="primary" size="large" block loading={run.isPending} disabled={runDisabled} onClick={() => run.mutate()}>运行已发布版本</Button>
          </div>
          {run.isPending ? <div className="ai-visual-workflow-run-progress" role="status">
            <ReloadOutlined spin />
            <div>
              <Typography.Text strong>正在执行 Workflow</Typography.Text>
              <Typography.Text type="secondary">服务端正在依次执行节点，完成后会在这里显示 Run、步骤日志和输出结果。</Typography.Text>
            </div>
          </div> : null}
          {pendingWait && !run.isPending ? <section className="ai-visual-workflow-wait-card">
            <div className="ai-visual-workflow-result-heading">
              <div><Typography.Text strong>{pendingWait.waitType === "approval" ? "等待人工审批" : humanInputWait ? "等待人工补充信息" : pendingWait.waitType === "event" ? "等待业务事件" : pendingWait.waitType === "child_workflow" ? "等待子流程完成" : "等待到期恢复"}</Typography.Text><Typography.Text type="secondary">节点 {pendingWait.nodeId} · Wait #{pendingWait.id}</Typography.Text></div>
              <Tag color="warning">Workflow 已持久暂停</Tag>
            </div>
            {pendingWait.waitType === "approval" ? <>
              <Typography.Text type="secondary">审批结果会写入 Run/Step 后继续执行；拒绝不会丢失运行上下文，下一节点可以根据 `approved=false` 分支处理。</Typography.Text>
              <Space style={{ width: "100%", justifyContent: "flex-end" }}><Button danger loading={resolveWait.isPending} onClick={() => resolveWait.mutate({ action: "reject" })}>拒绝</Button><Button type="primary" icon={<CheckCircleOutlined />} loading={resolveWait.isPending} onClick={() => resolveWait.mutate({ action: "approve" })}>批准并继续</Button></Space>
            </> : null}
            {pendingWait.waitType === "event" && humanInputWait ? <HumanInputWaitForm
              key={pendingWait.id}
              waitInput={pendingWait.input}
              loading={resolveWait.isPending}
              onSubmit={(data) => resolveWait.mutate({ action: "event", data })}
            /> : null}
            {pendingWait.waitType === "event" && !humanInputWait ? <>
              <div className="ai-visual-workflow-wait-key"><Typography.Text type="secondary">关联键</Typography.Text><code>{pendingWait.correlationKey || "未配置"}</code></div>
              <Input.TextArea value={eventPayload} onChange={(event) => setEventPayload(event.target.value)} rows={5} placeholder={'{"status":"paid","orderId":1001}'} />
              <Button type="primary" block disabled={!pendingWait.correlationKey || !isValidJsonEditorValue(eventPayload)} loading={resolveWait.isPending} onClick={() => resolveWait.mutate({ action: "event" })}>提交事件并继续</Button>
            </> : null}
            {pendingWait.waitType === "child_workflow" ? <>
              <Typography.Text type="secondary">父流程会在子流程完成后由常驻 Worker 自动恢复，不需要重新运行。</Typography.Text>
              <div className="ai-visual-workflow-wait-key"><Typography.Text type="secondary">子流程运行</Typography.Text><code>Run #{pendingWait.childRunId ?? "-"}</code></div>
              {pendingWait.childRunId ? <Button block icon={<ApartmentOutlined />} onClick={() => setActiveRunId(pendingWait.childRunId ?? null)}>查看并处理子流程</Button> : null}
            </> : null}
            {pendingWait.waitType === "timer" ? <Typography.Text type="secondary">{pendingWait.resumeAt ? `常驻 Worker 将在 ${new Date(pendingWait.resumeAt).toLocaleString("zh-CN", { hour12: false })} 后恢复。` : "等待 Worker 恢复。"}</Typography.Text> : null}
            {pendingWait.timeoutAt ? <Typography.Text type="secondary">超时：{new Date(pendingWait.timeoutAt).toLocaleString("zh-CN", { hour12: false })}</Typography.Text> : null}
          </section> : null}
          {hasResult && !run.isPending ? <div className="ai-visual-workflow-run-result">
            <div className="ai-visual-workflow-result-heading">
              <Typography.Text strong>输出结果</Typography.Text>
              {visibleRunId ? <Tag color="success">Run #{visibleRunId}</Tag> : null}
            </div>
            <SchemaPreview schema={workflowOutputSchema} compact />
            {resultImageUrl ? <img src={resultImageUrl} alt="Workflow 生成结果" /> : null}
            {resultImageUrl && resultValue && typeof resultValue === "object" ? <div className="ai-visual-workflow-result-meta">
              {"fileId" in resultValue ? <Tag>文件 #{String(resultValue.fileId)}</Tag> : null}
              {"sourceFileId" in resultValue ? <Tag>来源 #{String(resultValue.sourceFileId)}</Tag> : null}
              <Button type="link" size="small" href={resultImageUrl} target="_blank">打开生成文件</Button>
            </div> : null}
            {typeof resultValue === "string" ? <Typography.Paragraph className="ai-visual-workflow-result-text">{resultValue}</Typography.Paragraph> : <details className="ai-visual-workflow-run-debug">
              <summary>查看原始输出</summary>
              <pre>{formatWorkflowDebugValue(resultValue)}</pre>
            </details>}
          </div> : null}
          {visibleRunId && !run.isPending ? <div className="ai-visual-workflow-run-observability">
            <div className="ai-visual-workflow-result-heading">
              <div>
                <Typography.Text strong>运行记录</Typography.Text>
                <Typography.Text type="secondary">Run #{visibleRunId}</Typography.Text>
              </div>
              <Space size={6}>
                {runDetail.data?.parentRunId ? <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => setActiveRunId(runDetail.data?.parentRunId ?? null)}>返回父 Run</Button> : null}
                <Button size="small" icon={<ReloadOutlined />} loading={runDetail.isFetching} onClick={() => runDetail.refetch()}>刷新</Button>
              </Space>
            </div>
            {runDetail.isLoading ? <Typography.Text type="secondary">正在加载运行记录…</Typography.Text> : null}
            {runDetail.data ? <>
              <div className="ai-visual-workflow-run-summary">
                <Tag color={runStatusMeta(runDetail.data.status).color}>{runStatusMeta(runDetail.data.status).label}</Tag>
                <Typography.Text type="secondary">{runDetail.data.steps.length} 个步骤</Typography.Text>
                <Typography.Text type="secondary">{runDetail.data.durationMs == null ? "耗时未记录" : `${runDetail.data.durationMs} ms`}</Typography.Text>
                {runDetail.data.startedAt ? <Typography.Text type="secondary">{new Date(runDetail.data.startedAt).toLocaleString("zh-CN", { hour12: false })}</Typography.Text> : null}
              </div>
              {runDetail.data.errorMessage ? <div className="ai-visual-workflow-run-error"><WarningOutlined /><span>{runDetail.data.errorMessage}</span></div> : null}
              <div className="ai-visual-workflow-run-steps">
                {runDetail.data.steps.length ? runDetail.data.steps.map((step) => {
                  const workflowNode = nodes.find((node) => node.id === step.stepCode);
                  const status = runStatusMeta(step.status);
                  return <div className={`ai-visual-workflow-run-step is-${step.status}`} key={step.id}>
                    <span className="ai-visual-workflow-run-step-marker" />
                    <div className="ai-visual-workflow-run-step-content">
                      <div className="ai-visual-workflow-run-step-heading">
                        <div><Typography.Text strong>{workflowNode?.data.label || step.stepCode}</Typography.Text><code>{step.stepCode}</code></div>
                        <Space size={4}><Tag color={status.color}>{status.label}</Tag><Typography.Text type="secondary">{step.durationMs == null ? "-" : `${step.durationMs} ms`}</Typography.Text></Space>
                      </div>
                      {step.errorMessage ? <Typography.Text type="danger">{step.errorMessage}</Typography.Text> : null}
                      <details className="ai-visual-workflow-run-debug">
                        <summary>输入与输出</summary>
                        <div className="ai-visual-workflow-run-debug-grid">
                          <div><Typography.Text type="secondary">输入</Typography.Text><pre>{formatWorkflowDebugValue(step.input)}</pre></div>
                          <div><Typography.Text type="secondary">输出</Typography.Text><pre>{formatWorkflowDebugValue(step.output)}</pre></div>
                        </div>
                      </details>
                    </div>
                  </div>;
                }) : <Typography.Text type="secondary">本次运行没有产生步骤记录。</Typography.Text>}
              </div>
            </> : null}
          </div> : null}
        </div>
      </Drawer>
    </div>
  );
}
