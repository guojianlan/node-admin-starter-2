import { HTTPException } from "hono/http-exception";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import {
  preflightWorkflowDefinition,
  type WorkflowBuilderDefinition,
  type WorkflowBuilderExecutableInnerEntry,
  type WorkflowBuilderGraphEntry,
} from "@mastra/core/workflows/builder";
import { z } from "zod";
import { sqlite } from "@/server/db";
import { generateAiText } from "./ai-runtime-service";
import { searchKnowledge } from "./ai-knowledge-service";
import {
  createWorkflowMemoryCandidate,
  listAiMemories,
} from "./ai-governance-service";
import { enqueueAiJob } from "./ai-job-service";
import {
  executeAgentTool,
  getAiAgent,
  listAiTools,
} from "./ai-agent-service";
import { isAiToolApprovalRequired } from "./ai-agent-runtime-policy";
import {
  createAiWorkflowRun,
  completeSuspendedAiWorkflowStep,
  createAiWorkflowWait,
  failSuspendedAiWorkflowStep,
  finishAiWorkflowRun,
  finishAiWorkflowStep,
  getAiWorkflowRuntimeRun,
  listAiWorkflowWaits,
  resolveChildWorkflowWaits,
  resolveDueAiWorkflowTimer,
  runPersistedAiWorkflowStep,
  saveAiWorkflowContinuation,
  startAiWorkflowStep,
} from "./ai-workflow-service";

export type VisualWorkflowNode = {
  id: string;
  type:
    | "input"
    | "transform"
    | "model"
    | "agent"
    | "tool"
    | "mapping"
    | "parallel"
    | "condition"
    | "foreach"
    | "loop"
    | "sleep"
    | "sleepUntil"
    | "workflow"
    | "llm"
    | "aggregate"
    | "retry"
    | "approval"
    | "waitEvent"
    | "knowledge"
    | "state"
    | "terminate"
    | "memoryRead"
    | "memoryCandidate"
    | "humanInput"
    | "documentParser"
    | "output";
  position: { x: number; y: number };
  data?: Record<string, unknown>;
};

export type VisualWorkflowGraph = {
  nodes: VisualWorkflowNode[];
  edges: Array<{ id?: string; source: string; target: string; label?: string }>;
};

export type VisualWorkflowExecutionResult = {
  runId: number;
  value: unknown;
  status: "running" | "suspended" | "completed" | "failed" | "cancelled" | string;
  orchestrator?: "mastra" | "admin-base";
  wait?: unknown;
};

const nodeTypes = new Set<VisualWorkflowNode["type"]>([
  "input",
  "transform",
  "model",
  "agent",
  "tool",
  "mapping",
  "parallel",
  "condition",
  "foreach",
  "loop",
  "sleep",
  "sleepUntil",
  "workflow",
  "llm",
  "aggregate",
  "retry",
  "approval",
  "waitEvent",
  "knowledge",
  "state",
  "terminate",
  "memoryRead",
  "memoryCandidate",
  "humanInput",
  "documentParser",
  "output",
]);

const builderInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
} as const;

const builderOutputSchema = {
  description: "The output of the last Admin Base workflow step.",
} as const;

type BuilderEntry = WorkflowBuilderGraphEntry;

export type VisualWorkflowReferenceCatalog = {
  agents: Set<string>;
  tools: Set<string>;
  workflows: Set<string>;
  models?: Set<string>;
  knowledgeBases?: Set<string>;
};

const adminBaseRuntimeNodeTypes = new Set<VisualWorkflowNode["type"]>([
  "llm",
  "aggregate",
  "retry",
  "approval",
  "waitEvent",
  "knowledge",
  "state",
  "terminate",
  "memoryRead",
  "memoryCandidate",
  "humanInput",
  "documentParser",
]);

function nodeDataString(node: VisualWorkflowNode, key: string) {
  const value = node.data?.[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function nodeDataNumber(node: VisualWorkflowNode, key: string, fallback: number) {
  const value = Number(node.data?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function parseNodeJson(node: VisualWorkflowNode, key: string) {
  const raw = node.data?.[key];
  if (typeof raw === "object" && raw !== null) return raw;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HTTPException(400, { message: `节点 ${node.id} 的 ${key} 不是有效 JSON` });
  }
}

function workflowNodeSchema(node: VisualWorkflowNode | undefined, fallback: Record<string, unknown>) {
  if (!node) return fallback;
  if (node.data?.schema == null || node.data.schema === "") return fallback;
  const schema = parseNodeJson(node, "schema");
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new HTTPException(400, { message: `节点 ${node.id} 的 Schema 必须是 JSON 对象` });
  }
  return schema as Record<string, unknown>;
}

function getWorkflowSchemas(graph: VisualWorkflowGraph) {
  return {
    input: workflowNodeSchema(
      graph.nodes.find((node) => node.type === "input"),
      builderInputSchema,
    ),
    output: workflowNodeSchema(
      graph.nodes.find((node) => node.type === "output"),
      builderOutputSchema,
    ),
  };
}

function asBuilderEntry(value: unknown, context: string): BuilderEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HTTPException(400, { message: `${context} 必须是一个 Mastra Workflow 节点对象` });
  }
  return value as BuilderEntry;
}

function asBuilderExecutableEntry(value: unknown, context: string): WorkflowBuilderExecutableInnerEntry {
  const entry = asBuilderEntry(value, context);
  if (entry.type !== "agent" && entry.type !== "tool" && entry.type !== "workflow") {
    throw new HTTPException(400, { message: `${context} 只能是 Agent、Tool 或子 Workflow` });
  }
  return entry;
}

function compileBuilderEntry(node: VisualWorkflowNode): BuilderEntry {
  const description = nodeDataString(node, "description") ?? `Admin Base ${node.type} 节点`;
  switch (node.type) {
    case "agent": {
      const agentId = nodeDataString(node, "agentId");
      if (!agentId) throw new HTTPException(400, { message: `Agent 节点 ${node.id} 必须选择 Agent` });
      return { type: "agent", id: node.id, agentId, description };
    }
    case "tool": {
      const toolId = nodeDataString(node, "toolId");
      if (!toolId) throw new HTTPException(400, { message: `Tool 节点 ${node.id} 必须选择 Tool` });
      return { type: "tool", id: node.id, toolId, description };
    }
    case "workflow": {
      const workflowId = nodeDataString(node, "workflowId");
      if (!workflowId) throw new HTTPException(400, { message: `Workflow 节点 ${node.id} 必须选择子 Workflow` });
      return { type: "workflow", id: node.id, workflowId, description };
    }
    case "mapping": {
      const mapConfig = parseNodeJson(node, "mapConfig");
      if (!mapConfig || typeof mapConfig !== "object" || Array.isArray(mapConfig)) {
        throw new HTTPException(400, { message: `Mapping 节点 ${node.id} 必须配置 mapConfig JSON 对象` });
      }
      return { type: "mapping", id: node.id, mapConfig: JSON.stringify(mapConfig) };
    }
    case "transform": {
      const template = nodeDataString(node, "template") ?? "${inputData}";
      return {
        type: "mapping",
        id: `${node.id}__mapping`,
        mapConfig: JSON.stringify({ value: { template: template.replaceAll("{{value}}", "${inputData}") } }),
      };
    }
    case "parallel": {
      const children = parseNodeJson(node, "children");
      if (!Array.isArray(children) || children.length < 2) {
        throw new HTTPException(400, { message: `Parallel 节点 ${node.id} 至少需要两个子节点` });
      }
      return {
        type: "parallel",
        steps: children.map((child, index) => asBuilderExecutableEntry(child, `Parallel 节点 ${node.id} 的第 ${index + 1} 个子节点`)),
      };
    }
    case "condition": {
      const children = parseNodeJson(node, "children");
      if (!Array.isArray(children) || children.length < 1) {
        throw new HTTPException(400, { message: `Branch 节点 ${node.id} 至少需要一个分支子节点` });
      }
      const fallbackPredicate = parseNodeJson(node, "predicate") ?? {
        op: "truthy",
        value: { path: "inputData" },
      };
      return {
        type: "conditional",
        steps: children.map((child, index) => asBuilderExecutableEntry(child, `Branch 节点 ${node.id} 的第 ${index + 1} 个分支`)),
        predicates: children.map((child) => {
          const item = child && typeof child === "object" ? child as { predicate?: unknown; isDefault?: boolean } : {};
          return item.isDefault ? { op: "truthy", value: { literal: true } } : item.predicate ?? fallbackPredicate;
        }) as never,
      };
    }
    case "foreach": {
      const body = parseNodeJson(node, "body");
      return {
        type: "foreach",
        step: asBuilderExecutableEntry(body, `Foreach 节点 ${node.id} 的循环体`),
        opts: { concurrency: Math.min(Math.max(Math.round(nodeDataNumber(node, "concurrency", 3)), 1), 20) },
      };
    }
    case "loop": {
      const body = parseNodeJson(node, "body");
      const predicate = parseNodeJson(node, "predicate") ?? {
        op: "truthy",
        value: { path: "inputData" },
      };
      return {
        type: "loop",
        step: asBuilderExecutableEntry(body, `Loop 节点 ${node.id} 的循环体`),
        loopType: nodeDataString(node, "loopType") === "dowhile" ? "dowhile" : "dountil",
        predicate: predicate as never,
      };
    }
    case "sleep":
      return { type: "sleep", id: node.id, duration: Math.min(Math.max(Math.round(nodeDataNumber(node, "duration", 1000)), 0), 86_400_000) };
    case "sleepUntil": {
      const date = nodeDataString(node, "date");
      if (!date || Number.isNaN(Date.parse(date))) throw new HTTPException(400, { message: `Sleep Until 节点 ${node.id} 必须配置有效时间` });
      return { type: "sleepUntil", id: node.id, date };
    }
    case "llm": {
      const prompt = nodeDataString(node, "prompt");
      if (!prompt) throw new HTTPException(400, { message: `LLM 节点 ${node.id} 必须配置 Prompt` });
      if (nodeDataString(node, "modelSelection") === "fixed" && !nodeDataString(node, "modelId")) {
        throw new HTTPException(400, { message: `LLM 节点 ${node.id} 选择固定模型时必须指定模型` });
      }
      break;
    }
    case "retry": {
      asBuilderExecutableEntry(parseNodeJson(node, "body"), `Retry 节点 ${node.id} 的主任务`);
      const fallback = parseNodeJson(node, "fallback");
      if (fallback) asBuilderExecutableEntry(fallback, `Retry 节点 ${node.id} 的兜底任务`);
      break;
    }
    case "approval":
      if (!nodeDataString(node, "title")) throw new HTTPException(400, { message: `审批节点 ${node.id} 必须配置审批标题` });
      break;
    case "waitEvent":
      if (!nodeDataString(node, "correlationKey")) throw new HTTPException(400, { message: `事件等待节点 ${node.id} 必须配置关联键` });
      break;
    case "knowledge": {
      const ids = parseNodeJson(node, "knowledgeBaseIds");
      if (ids != null && !Array.isArray(ids)) throw new HTTPException(400, { message: `知识检索节点 ${node.id} 的知识库必须是 ID 数组` });
      break;
    }
    case "state":
      if (!nodeDataString(node, "stateKey")) throw new HTTPException(400, { message: `状态节点 ${node.id} 必须配置变量名` });
      break;
    case "memoryCandidate":
      if (!nodeDataString(node, "contentTemplate")) throw new HTTPException(400, { message: `Memory 候选节点 ${node.id} 必须配置候选内容` });
      break;
    case "humanInput":
      if (!nodeDataString(node, "title")) throw new HTTPException(400, { message: `人工输入节点 ${node.id} 必须配置标题` });
      break;
    case "documentParser":
      if (!nodeDataString(node, "documentIdPath") && !nodeDataString(node, "documentId")) {
        throw new HTTPException(400, { message: `文档解析节点 ${node.id} 必须配置文档 ID 或取值路径` });
      }
      break;
    case "aggregate":
    case "terminate":
    case "memoryRead":
      break;
    case "model":
      throw new HTTPException(400, { message: `模型节点 ${node.id} 是旧版节点，请改用 Agent 节点；Mastra Workflow 不直接引用 Model` });
    default:
      throw new HTTPException(400, { message: `节点 ${node.id} 不能作为 Mastra Workflow 步骤` });
  }
  return {
    type: "mapping",
    id: node.id,
    mapConfig: JSON.stringify({
      value: { template: "${inputData}" },
      __adminBaseRuntimeNode: { value: node.type },
    }),
  };
}

function assertVisualNodeReferences(node: VisualWorkflowNode, catalog: VisualWorkflowReferenceCatalog) {
  if (node.type === "retry") {
    const body = asBuilderExecutableEntry(parseNodeJson(node, "body"), `Retry 节点 ${node.id} 的主任务`);
    assertBuilderReferences(body, catalog, `node.${node.id}.body`);
    const fallback = parseNodeJson(node, "fallback");
    if (fallback) assertBuilderReferences(asBuilderExecutableEntry(fallback, `Retry 节点 ${node.id} 的兜底任务`), catalog, `node.${node.id}.fallback`);
  }
  if (node.type === "llm" && nodeDataString(node, "modelSelection") === "fixed") {
    const modelId = nodeDataString(node, "modelId");
    if (modelId && catalog.models && !catalog.models.has(modelId)) {
      throw new HTTPException(400, { message: `LLM 节点 ${node.id} 引用了不存在或已停用的模型：${modelId}` });
    }
  }
  if (node.type === "knowledge") {
    const ids = parseNodeJson(node, "knowledgeBaseIds");
    if (Array.isArray(ids) && catalog.knowledgeBases) {
      const missing = ids.map(String).filter((id) => !catalog.knowledgeBases?.has(id));
      if (missing.length) throw new HTTPException(400, { message: `知识检索节点 ${node.id} 引用了不可用知识库：${missing.join(", ")}` });
    }
  }
}

function assertBuilderReferences(
  entry: BuilderEntry,
  catalog: VisualWorkflowReferenceCatalog,
  path: string,
) {
  if (entry.type === "agent" && !catalog.agents.has(entry.agentId)) {
    throw new HTTPException(400, { message: `${path} 引用了不存在或已停用的 Agent：${entry.agentId}` });
  }
  if (entry.type === "tool" && !catalog.tools.has(entry.toolId)) {
    throw new HTTPException(400, { message: `${path} 引用了不存在或已停用的 Tool：${entry.toolId}` });
  }
  if (entry.type === "workflow" && !catalog.workflows.has(entry.workflowId)) {
    throw new HTTPException(400, { message: `${path} 引用了不存在的子 Workflow：${entry.workflowId}` });
  }
  if (entry.type === "parallel" || entry.type === "conditional") {
    entry.steps.forEach((child, index) => assertBuilderReferences(child, catalog, `${path}.steps[${index}]`));
  }
  if (entry.type === "foreach" || entry.type === "loop") {
    assertBuilderReferences(entry.step, catalog, `${path}.step`);
  }
}

/**
 * Convert the canvas contract to Mastra's JSON-safe authoring contract. The
 * canvas remains an Admin Base view model (nodes/edges); Mastra receives only
 * registered Agent/Tool/Workflow references and declarative control-flow data.
 */
export function compileVisualWorkflowToMastraBuilder(
  graph: VisualWorkflowGraph,
  id: string,
  description: string,
  catalog?: VisualWorkflowReferenceCatalog,
): WorkflowBuilderDefinition {
  const ordered = topologicalVisualWorkflowOrder(graph);
  if (!ordered) throw new HTTPException(400, { message: "Mastra Workflow 图必须是无循环且可排序的依赖图" });
  const entries = ordered
    .filter((node) => node.type !== "input" && node.type !== "output")
    .map(compileBuilderEntry);
  const schemas = getWorkflowSchemas(graph);
  const definition = {
    id,
    description: description.trim() || "Admin Base 可视化 Workflow",
    inputSchema: schemas.input as typeof builderInputSchema,
    outputSchema: schemas.output as typeof builderOutputSchema,
    graph: entries,
  } satisfies WorkflowBuilderDefinition;
  const result = preflightWorkflowDefinition(definition);
  if (!result.ok) {
    throw new HTTPException(400, {
      message: `Mastra Workflow 预检失败：${result.issues.map((issue) => issue.message).join("；")}`,
    });
  }
  if (catalog) {
    entries.forEach((entry, index) => assertBuilderReferences(entry, catalog, `graph[${index}]`));
    ordered.forEach((node) => assertVisualNodeReferences(node, catalog));
  }
  return definition;
}

function linearVisualWorkflowOrder(graph: VisualWorkflowGraph) {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  graph.edges.forEach((edge) => {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  });
  if (graph.nodes.some((node) => (incoming.get(node.id)?.length ?? 0) > 1 || (outgoing.get(node.id)?.length ?? 0) > 1)) return null;
  const start = graph.nodes.find((node) => node.type === "input");
  if (!start) return null;
  const ordered: VisualWorkflowNode[] = [];
  const seen = new Set<string>();
  let current: VisualWorkflowNode | undefined = start;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    ordered.push(current);
    const nextId: string | undefined = outgoing.get(current.id)?.[0];
    current = nextId ? graph.nodes.find((node) => node.id === nextId) : undefined;
  }
  return ordered.length === graph.nodes.length ? ordered : null;
}

function topologicalVisualWorkflowOrder(graph: VisualWorkflowGraph) {
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const comparePosition = (left: VisualWorkflowNode, right: VisualWorkflowNode) =>
    left.position.y - right.position.y || left.position.x - right.position.x || left.id.localeCompare(right.id);
  const queue = graph.nodes.filter((node) => indegree.get(node.id) === 0).sort(comparePosition);
  const ordered: VisualWorkflowNode[] = [];

  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    ordered.push(current);
    for (const target of outgoing.get(current.id) ?? []) {
      const nextIndegree = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, nextIndegree);
      if (nextIndegree === 0) {
        const node = graph.nodes.find((candidate) => candidate.id === target);
        if (node) {
          queue.push(node);
          queue.sort(comparePosition);
        }
      }
    }
  }

  return ordered.length === graph.nodes.length ? ordered : null;
}

async function executeMastraLinearVisualWorkflow(input: {
  graph: VisualWorkflowGraph;
  value: string;
  definitionId: number;
  runId: number;
}) {
  const ordered = linearVisualWorkflowOrder(input.graph);
  if (!ordered) return null;
  const internalNodes = ordered.filter((node) => node.type !== "input" && node.type !== "output");
  // Control-flow nodes must use the governed graph executor below. The older
  // linear adapter only understands scalar transform/model steps.
  if (internalNodes.some((node) => !["transform", "model"].includes(node.type))) return null;
  if (!internalNodes.length) return input.value;
  const steps = internalNodes.map((node, index) =>
    createStep({
      id: `node-${node.id}`,
      inputSchema: z.string(),
      outputSchema: z.string(),
      execute: async ({ inputData }) =>
        runPersistedAiWorkflowStep({
          runId: input.runId,
          stepNo: index + 1,
          stepCode: node.id,
          stepInput: { node, value: inputData, orchestrator: "mastra" },
          execute: async () => {
            if (node.type === "transform") return String(node.data?.template ?? "{{value}}").replaceAll("{{value}}", inputData);
            if (node.type === "model") {
              const result = await generateAiText({ purpose: "agent", input: inputData, modelId: Number(node.data?.modelId) || null });
              return result.text;
            }
            return inputData;
          },
        }),
    }),
  );
  let workflow = createWorkflow({
    id: `admin-base-visual-${input.definitionId}-${input.runId}`,
    description: "Admin Base persisted visual workflow",
    inputSchema: z.string(),
    outputSchema: z.string(),
  });
  for (const step of steps) workflow = (workflow.then(step as never) as unknown) as typeof workflow;
  const mastraWorkflow = workflow.commit();
  const run = await mastraWorkflow.createRun({ runId: `admin-base-visual-run-${input.runId}` });
  const result = await run.start({ inputData: input.value });
  if (result.status !== "success") throw new Error(`Mastra Workflow 执行失败：${result.status}`);
  return String(result.result ?? "");
}

function stringifyWorkflowValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return JSON.stringify(value);
}

function parseWorkflowInput(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function resolveWorkflowPath(path: string, context: { inputData: unknown; initData: unknown; stepResults: Map<string, unknown>; state?: Record<string, unknown> }) {
  const [root, stepId, ...rest] = path.split(".");
  if (root === "state") {
    let current: unknown = context.state;
    for (const key of [stepId, ...rest].filter(Boolean)) {
      if (!current || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[key as string];
    }
    return current;
  }
  if (root === "inputData" || root === "initData") {
    let current = root === "inputData" ? context.inputData : context.initData;
    for (const key of [stepId, ...rest].filter(Boolean)) {
      if (!current || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[key as string];
    }
    return current;
  }
  if (root !== "stepResults" || !stepId) return undefined;
  let current = context.stepResults.get(stepId);
  for (const key of rest) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function renderWorkflowTemplate(template: string, context: { inputData: unknown; initData: unknown; stepResults: Map<string, unknown>; state?: Record<string, unknown> }) {
  return template.replace(/\$\{([^}]+)\}|\{\{value\}\}/g, (_match, path?: string) => {
    const value = path ? resolveWorkflowPath(path, context) : context.inputData;
    return stringifyWorkflowValue(value);
  });
}

function evaluateWorkflowPredicate(predicate: unknown, value: unknown) {
  if (!predicate || typeof predicate !== "object") return Boolean(value);
  const item = predicate as { op?: string; value?: { path?: string; literal?: unknown }; left?: { path?: string; literal?: unknown }; right?: { path?: string; literal?: unknown } };
  const operand = (input: { path?: string; literal?: unknown } | undefined) => {
    if (!input) return undefined;
    if (input.path) {
      const parts = input.path.split(".");
      if (parts[0] !== "inputData") return undefined;
      let current = value;
      for (const key of parts.slice(1)) {
        if (current == null || typeof current !== "object") return undefined;
        current = (current as Record<string, unknown>)[key];
      }
      return current;
    }
    return input.literal;
  };
  if (item.op === "always") return true;
  if (item.op === "truthy") return Boolean(operand(item.value));
  if (item.op === "falsy") return !operand(item.value);
  const left = operand(item.left);
  const right = operand(item.right);
  if (item.op === "eq") return left === right;
  if (item.op === "ne") return left !== right;
  if (item.op === "contains") return Array.isArray(left) ? left.includes(right) : String(left ?? "").includes(String(right ?? ""));
  if (item.op === "gt") return Number(left) > Number(right);
  if (item.op === "gte") return Number(left) >= Number(right);
  if (item.op === "lt") return Number(left) < Number(right);
  if (item.op === "lte") return Number(left) <= Number(right);
  return Boolean(value);
}

async function executeVisualBuilderChild(input: {
  entry: BuilderEntry;
  value: unknown;
  userId: number;
  runId: number;
  depth?: number;
}): Promise<unknown> {
  if (input.entry.type === "agent") {
    const agent = await getAiAgent(Number(input.entry.agentId));
    if (!agent || agent.status !== 1) throw new HTTPException(409, { message: `Agent ${input.entry.agentId} 不存在或已停用` });
    const result = await generateAiText({
      purpose: "agent",
      input: `${agent.instructions}\n\n${stringifyWorkflowValue(input.value)}`,
      modelId: agent.modelId,
      trace: { sourceType: "visual_workflow_agent", sourceId: input.runId, userId: input.userId, runId: input.runId },
    });
    return { text: result.text };
  }
  if (input.entry.type === "tool") {
    const toolEntry = input.entry as Extract<BuilderEntry, { type: "tool" }>;
    const tool = (await listAiTools({ activeOnly: false })).find((item) => String(item.id) === toolEntry.toolId || item.code === toolEntry.toolId);
    if (!tool || tool.status !== 1) throw new HTTPException(409, { message: `Tool ${toolEntry.toolId} 不存在或已停用` });
    if (isAiToolApprovalRequired(tool)) throw new HTTPException(409, { message: `Tool ${tool.name} 需要通过 Agent 审批流程执行，Workflow 不能绕过审批` });
    const toolInput = input.value && typeof input.value === "object" && !Array.isArray(input.value)
      ? input.value as Record<string, unknown>
      : { value: input.value };
    return executeAgentTool(tool, toolInput, { userId: input.userId, requestId: `visual-workflow-${input.runId}` });
  }
  if (input.entry.type === "workflow") {
    if ((input.depth ?? 0) >= 8) throw new HTTPException(409, { message: "子 Workflow 调用深度超过 8 层安全上限" });
    const workflowEntry = input.entry as Extract<BuilderEntry, { type: "workflow" }>;
    const row = (await sqlite
      .prepare(
        `SELECT id FROM sys_ai_workflow_definition
         WHERE (id::text = ? OR code = ?) AND status = 'published' AND deleted_at IS NULL`,
      )
      .get(workflowEntry.workflowId, workflowEntry.workflowId)) as { id: number } | undefined;
    if (!row) throw new HTTPException(409, { message: `子 Workflow ${workflowEntry.workflowId} 不存在或尚未发布` });
    const result: VisualWorkflowExecutionResult = await executeVisualWorkflow({
      definitionId: row.id,
      userId: input.userId,
      value: stringifyWorkflowValue(input.value),
      depth: (input.depth ?? 0) + 1,
      parentRunId: input.runId,
      parentNodeId: workflowEntry.id,
    });
    if (result.status === "suspended") {
      return {
        __workflowChildSuspended: true,
        childRunId: result.runId,
        value: input.value,
      } satisfies SuspendedChildWorkflow;
    }
    return result.value;
  }
  throw new HTTPException(409, { message: `当前 Workflow 运行器不允许直接执行 ${input.entry.type} 子节点` });
}

export function validateVisualWorkflowGraph(graph: unknown): VisualWorkflowGraph {
  if (!graph || typeof graph !== "object") throw new HTTPException(400, { message: "工作流图不是有效对象" });
  const value = graph as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(value.nodes) || value.nodes.length < 2 || value.nodes.length > 100) {
    throw new HTTPException(400, { message: "工作流至少需要两个节点，且不能超过 100 个节点" });
  }
  const nodes = value.nodes.map((raw) => {
    const node = raw as Partial<VisualWorkflowNode>;
    if (!node.id || typeof node.id !== "string" || !nodeTypes.has(node.type as VisualWorkflowNode["type"])) {
      throw new HTTPException(400, { message: "工作流包含未知节点或缺少节点 ID" });
    }
    return {
      id: node.id,
      type: node.type as VisualWorkflowNode["type"],
      position: {
        x: Number(node.position?.x ?? 0),
        y: Number(node.position?.y ?? 0),
      },
      data: node.data && typeof node.data === "object" ? node.data : {},
    };
  });
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length) throw new HTTPException(400, { message: "工作流节点 ID 必须唯一" });
  const edges = (Array.isArray(value.edges) ? value.edges : []).map((raw) => {
    const edge = raw as { id?: string; source?: string; target?: string; label?: string };
    if (!edge.source || !edge.target || !ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) {
      throw new HTTPException(400, { message: "工作流包含无效连线" });
    }
    return { id: edge.id, source: edge.source, target: edge.target, label: edge.label };
  });
  if (!nodes.some((node) => node.type === "input") || !nodes.some((node) => node.type === "output")) {
    throw new HTTPException(400, { message: "工作流必须包含输入和输出节点" });
  }
  const outgoing = new Map<string, string[]>();
  edges.forEach((edge) => outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new HTTPException(400, { message: "工作流不能包含循环依赖" });
    if (visited.has(id)) return;
    visiting.add(id);
    (outgoing.get(id) ?? []).forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  nodes.forEach((node) => visit(node.id));
  return { nodes, edges };
}

export async function listVisualWorkflowDefinitions() {
  return sqlite
    .prepare(
      `SELECT definition.id, definition.code, definition.name, definition.description,
        definition.status, definition.current_version AS "currentVersion", definition.updated_at AS "updatedAt",
        COALESCE((SELECT COUNT(*)::int FROM sys_ai_workflow_definition_version version WHERE version.definition_id = definition.id), 0) AS "versionCount"
       FROM sys_ai_workflow_definition definition
       WHERE definition.deleted_at IS NULL ORDER BY definition.updated_at DESC, definition.id DESC`,
    )
    .all();
}

export async function getVisualWorkflowDefinition(id: number) {
  const row = (await sqlite
    .prepare(
      `SELECT definition.id, definition.code, definition.name, definition.description,
        definition.status, definition.current_version AS "currentVersion",
        version.id AS "versionId", version.version, version.graph_json AS "graphJson",
        version.input_schema_json AS "inputSchemaJson",
        version.output_schema_json AS "outputSchemaJson",
        version.status AS "versionStatus"
       FROM sys_ai_workflow_definition definition
       LEFT JOIN sys_ai_workflow_definition_version version
         ON version.definition_id = definition.id AND version.version = definition.current_version
       WHERE definition.id = ? AND definition.deleted_at IS NULL`,
    )
    .get(id)) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...row,
    graph: row.graphJson ? JSON.parse(String(row.graphJson)) : null,
    inputSchema: row.inputSchemaJson ? JSON.parse(String(row.inputSchemaJson)) : {},
    outputSchema: row.outputSchemaJson ? JSON.parse(String(row.outputSchemaJson)) : {},
  };
}

export async function createVisualWorkflowVersion(input: {
  code: string;
  name: string;
  description?: string | null;
  graph: unknown;
  userId: number;
}) {
  const graph = validateVisualWorkflowGraph(input.graph);
  const schemas = getWorkflowSchemas(graph);
  const description = input.description?.trim() || `${input.name.trim()} 工作流`;
  // Drafts can still contain legacy nodes while they are being migrated. The
  // publish gate below is the point at which the Mastra contract is required.
  let compatibility: Record<string, unknown> = { nodeTypes: [...nodeTypes] };
  try {
    compatibility = {
      ...compatibility,
      mastraBuilder: compileVisualWorkflowToMastraBuilder(graph, input.code, description),
    };
  } catch (error) {
    compatibility = {
      ...compatibility,
      mastraBuilder: null,
      mastraBuilderError: error instanceof Error ? error.message : String(error),
    };
  }
  return sqlite.transaction(async (tx) => {
    const definition = (await tx
      .prepare("SELECT id FROM sys_ai_workflow_definition WHERE code = ? AND deleted_at IS NULL")
      .get(input.code)) as { id: number } | undefined;
    let definitionId = definition?.id;
    if (!definitionId) {
      const created = await tx
        .prepare(
          `INSERT INTO sys_ai_workflow_definition (code, name, description, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?) RETURNING id`,
        )
      .run(input.code, input.name.trim(), description, input.userId, input.userId);
      definitionId = Number(created.lastInsertRowid);
    } else {
      await tx.prepare("UPDATE sys_ai_workflow_definition SET name = ?, description = ?, updated_by = ?, updated_at = now() WHERE id = ?").run(input.name.trim(), description, input.userId, definitionId);
    }
    const next = (await tx
      .prepare("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM sys_ai_workflow_definition_version WHERE definition_id = ?")
      .get(definitionId)) as { version: number };
    const created = await tx
      .prepare(
        `INSERT INTO sys_ai_workflow_definition_version
         (definition_id, version, graph_json, input_schema_json, output_schema_json, compatibility_json, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .run(
        definitionId,
        Number(next.version),
        JSON.stringify(graph),
        JSON.stringify(schemas.input),
        JSON.stringify(schemas.output),
        JSON.stringify(compatibility),
        input.userId,
      );
    return { definitionId, versionId: Number(created.lastInsertRowid), version: Number(next.version), graph };
  });
}

export async function publishVisualWorkflowVersion(input: { definitionId: number; version: number; userId: number }) {
  return sqlite.transaction(async (tx) => {
    const version = (await tx.prepare(
      `SELECT version.id, version.graph_json AS "graphJson", definition.code, definition.description
       FROM sys_ai_workflow_definition_version version
       INNER JOIN sys_ai_workflow_definition definition ON definition.id = version.definition_id
       WHERE version.definition_id = ? AND version.version = ? AND definition.deleted_at IS NULL`,
    ).get(input.definitionId, input.version)) as { id: number; graphJson: string; code: string; description: string } | undefined;
    if (!version) throw new HTTPException(404, { message: "工作流版本不存在" });
    const graph = validateVisualWorkflowGraph(JSON.parse(version.graphJson));
    const agentRows = (await tx.prepare(
      "SELECT id, code FROM sys_ai_agent WHERE status = 1 AND deleted_at IS NULL",
    ).all()) as Array<{ id: number; code: string }>;
    const toolRows = (await tx.prepare(
      "SELECT id, code FROM sys_ai_tool WHERE status = 1 AND deleted_at IS NULL",
    ).all()) as Array<{ id: number; code: string }>;
    const workflowRows = (await tx.prepare(
      `SELECT id, code FROM sys_ai_workflow_definition
       WHERE status = 'published' AND deleted_at IS NULL AND id <> ?`,
    ).all(input.definitionId)) as Array<{ id: number; code: string }>;
    const modelRows = (await tx.prepare(
      `SELECT model.id FROM sys_ai_model model
       INNER JOIN sys_ai_provider provider ON provider.id = model.provider_id
       WHERE model.status = 1 AND provider.status = 1
         AND model.deleted_at IS NULL AND provider.deleted_at IS NULL`,
    ).all()) as Array<{ id: number }>;
    const knowledgeRows = (await tx.prepare(
      "SELECT id FROM sys_ai_knowledge_base WHERE status = 1 AND deleted_at IS NULL",
    ).all()) as Array<{ id: number }>;
    compileVisualWorkflowToMastraBuilder(graph, version.code, version.description, {
      agents: new Set(agentRows.flatMap((row) => [String(row.id), row.code])),
      tools: new Set(toolRows.flatMap((row) => [String(row.id), row.code])),
      workflows: new Set(workflowRows.flatMap((row) => [String(row.id), row.code])),
      models: new Set(modelRows.map((row) => String(row.id))),
      knowledgeBases: new Set(knowledgeRows.map((row) => String(row.id))),
    });
    await tx.prepare("UPDATE sys_ai_workflow_definition_version SET status = 'retired' WHERE definition_id = ? AND status = 'published'").run(input.definitionId);
    await tx.prepare("UPDATE sys_ai_workflow_definition_version SET status = 'published', published_at = now() WHERE definition_id = ? AND version = ?").run(input.definitionId, input.version);
    await tx.prepare("UPDATE sys_ai_workflow_definition SET status = 'published', current_version = ?, updated_by = ?, updated_at = now() WHERE id = ?").run(input.version, input.userId, input.definitionId);
    return { definitionId: input.definitionId, version: input.version, status: "published" as const };
  });
}

async function executeVisualWorkflowLegacy(input: { definitionId: number; userId: number; value: string }) {
  const startedAt = performance.now();
  const definition = (await getVisualWorkflowDefinition(input.definitionId)) as
    | { graph: unknown; status: string; code: string }
    | null;
  if (!definition?.graph || definition.status !== "published") throw new HTTPException(409, { message: "工作流尚未发布" });
  const graph = validateVisualWorkflowGraph(definition.graph);
  const initialData = parseWorkflowInput(input.value);
  const run = await createAiWorkflowRun({ workflowCode: String(definition.code), userId: input.userId, definitionId: input.definitionId, resourceType: "visual_workflow", resourceId: String(input.definitionId), workflowInput: { value: initialData }, initialStatus: "running" });
  const incoming = new Map<string, string[]>();
  graph.edges.forEach((edge) => incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]));
  const output = new Map<string, unknown>();
  try {
    const mastraResult = await executeMastraLinearVisualWorkflow({ graph, value: input.value, definitionId: input.definitionId, runId: run.id });
    if (mastraResult !== null) {
      await finishAiWorkflowRun({ id: run.id, status: "completed", output: { value: mastraResult, orchestrator: "mastra" }, durationMs: Math.round(performance.now() - startedAt) });
      return { runId: run.id, value: mastraResult, orchestrator: "mastra" as const };
    }
    const ordered = topologicalVisualWorkflowOrder(graph);
    if (!ordered) throw new HTTPException(400, { message: "工作流依赖关系无法排序" });
    let stepNo = 0;
    for (const node of ordered) {
      const values = (incoming.get(node.id) ?? []).map((id) => output.get(id));
      const value = node.type === "parallel" && values.length > 1 ? values : (values[0] ?? initialData);
      const nodeOutput = await runPersistedAiWorkflowStep({
        runId: run.id,
        stepNo: ++stepNo,
        stepCode: node.id,
        stepInput: { node, value },
        execute: async () => {
          if (node.type === "input") return initialData;
          if (node.type === "transform") return String(node.data?.template ?? "{{value}}").replaceAll("{{value}}", String(value ?? ""));
          if (node.type === "mapping") {
            const config = parseNodeJson(node, "mapConfig");
            if (!config || typeof config !== "object" || Array.isArray(config)) throw new HTTPException(400, { message: `Mapping 节点 ${node.id} 配置无效` });
            const context = { inputData: value, initData: initialData, stepResults: output };
            return Object.fromEntries(Object.entries(config).map(([key, descriptor]) => {
              if (!descriptor || typeof descriptor !== "object") return [key, descriptor];
              const item = descriptor as Record<string, unknown>;
              if (typeof item.template === "string") return [key, renderWorkflowTemplate(item.template, context)];
              if ("value" in item) return [key, item.value];
              if (typeof item.step === "string") return [key, resolveWorkflowPath(`stepResults.${item.step}${item.path ? `.${String(item.path)}` : ""}`, context)];
              if (item.initData === true) return [key, resolveWorkflowPath(`initData${item.path ? `.${String(item.path)}` : ""}`, context)];
              return [key, undefined];
            }));
          }
          if (node.type === "agent" || node.type === "tool") {
            return executeVisualBuilderChild({ entry: compileBuilderEntry(node), value, userId: input.userId, runId: run.id });
          }
          if (node.type === "parallel") {
            const children = parseNodeJson(node, "children");
            if (!Array.isArray(children) || children.length < 2) throw new HTTPException(400, { message: `Parallel 节点 ${node.id} 至少需要两个子节点` });
            const results = await Promise.all(children.map((child) => executeVisualBuilderChild({
              entry: asBuilderExecutableEntry(child, `Parallel 节点 ${node.id} 子节点`),
              value,
              userId: input.userId,
              runId: run.id,
            })));
            return Object.fromEntries(results.map((result, index) => [`branch-${index + 1}`, result]));
          }
          if (node.type === "condition") {
            const children = parseNodeJson(node, "children");
            if (!Array.isArray(children) || !children.length) throw new HTTPException(400, { message: `Branch 节点 ${node.id} 至少需要一个分支` });
            const fallbackPredicate = parseNodeJson(node, "predicate");
            const defaultBranch = children.find((child) => child && typeof child === "object" && Boolean((child as { isDefault?: boolean }).isDefault));
            const matchedBranch = children.find((child) => {
              if (!child || typeof child !== "object" || (child as { isDefault?: boolean }).isDefault) return false;
              const predicate = (child as { predicate?: unknown }).predicate ?? fallbackPredicate;
              return evaluateWorkflowPredicate(predicate, value);
            }) ?? defaultBranch;
            if (!matchedBranch) return null;
            return executeVisualBuilderChild({ entry: asBuilderExecutableEntry(matchedBranch, `Branch 节点 ${node.id} 命中分支`), value, userId: input.userId, runId: run.id });
          }
          if (node.type === "foreach") {
            if (!Array.isArray(value)) throw new HTTPException(400, { message: `Foreach 节点 ${node.id} 需要数组输入，请先使用 Mapping 生成数组` });
            const body = asBuilderExecutableEntry(parseNodeJson(node, "body"), `Foreach 节点 ${node.id} 循环体`);
            const concurrency = Math.min(Math.max(Math.round(nodeDataNumber(node, "concurrency", 3)), 1), 20);
            const results: unknown[] = [];
            for (let offset = 0; offset < value.length; offset += concurrency) {
              const batch = await Promise.all(value.slice(offset, offset + concurrency).map((item) => executeVisualBuilderChild({ entry: body, value: item, userId: input.userId, runId: run.id })));
              results.push(...batch);
            }
            return results;
          }
          if (node.type === "loop") {
            const body = asBuilderExecutableEntry(parseNodeJson(node, "body"), `Loop 节点 ${node.id} 循环体`);
            let current: unknown = value;
            const loopType = node.data?.loopType === "dowhile" ? "dowhile" : "dountil";
            for (let iteration = 0; iteration < 20; iteration += 1) {
              current = await executeVisualBuilderChild({ entry: body, value: current, userId: input.userId, runId: run.id });
              const matched = evaluateWorkflowPredicate(parseNodeJson(node, "predicate"), current);
              if ((loopType === "dountil" && matched) || (loopType === "dowhile" && !matched)) break;
              if (iteration === 19) throw new HTTPException(409, { message: `Loop 节点 ${node.id} 超过 20 次安全上限` });
            }
            return current;
          }
          if (node.type === "sleep") {
            await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(Math.round(nodeDataNumber(node, "duration", 1000)), 0), 86_400_000)));
            return value;
          }
          if (node.type === "sleepUntil") {
            const date = nodeDataString(node, "date");
            if (!date || Number.isNaN(Date.parse(date))) throw new HTTPException(400, { message: `Sleep Until 节点 ${node.id} 时间无效` });
            const delay = Math.min(Math.max(Date.parse(date) - Date.now(), 0), 86_400_000);
            await new Promise((resolve) => setTimeout(resolve, delay));
            return value;
          }
          if (node.type === "workflow") throw new HTTPException(409, { message: `子 Workflow 节点 ${node.id} 已保存，但当前运行器需要先加载 Mastra Workflow Registry` });
          if (node.type === "model") return (await generateAiText({ purpose: "agent", input: String(value ?? ""), modelId: Number(node.data?.modelId) || null })).text;
          return value;
        },
      });
      output.set(node.id, nodeOutput);
    }
    const last = graph.nodes.find((node) => node.type === "output");
    const result = output.get(last?.id ?? graph.nodes.at(-1)?.id ?? "") ?? null;
    await finishAiWorkflowRun({ id: run.id, status: "completed", output: { value: result }, durationMs: Math.round(performance.now() - startedAt) });
    return { runId: run.id, value: result };
  } catch (error) {
    await finishAiWorkflowRun({ id: run.id, status: "failed", errorMessage: error instanceof Error ? error.message : String(error), durationMs: Math.round(performance.now() - startedAt) });
    throw error;
  }
}

type VisualWorkflowContinuation = {
  nextIndex: number;
  initialData: unknown;
  outputs: Record<string, unknown>;
  state: Record<string, unknown>;
  waiting?: {
    waitId: number;
    nodeId: string;
    stepNo: number;
    waitType: "approval" | "event" | "timer" | "child_workflow";
    input: unknown;
  } | null;
};

type SuspendedChildWorkflow = {
  __workflowChildSuspended: true;
  childRunId: number;
  value: unknown;
};

function isSuspendedChildWorkflow(value: unknown): value is SuspendedChildWorkflow {
  return Boolean(
    value &&
      typeof value === "object" &&
      "__workflowChildSuspended" in value &&
      (value as SuspendedChildWorkflow).__workflowChildSuspended === true,
  );
}

const maxWorkflowDepth = 8;
const maxInlineSleepMs = 30_000;

function continuationFrom(value: unknown, initialData: unknown): VisualWorkflowContinuation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { nextIndex: 0, initialData, outputs: {}, state: {}, waiting: null };
  }
  const item = value as Partial<VisualWorkflowContinuation>;
  return {
    nextIndex: Math.max(Number(item.nextIndex) || 0, 0),
    initialData: item.initialData ?? initialData,
    outputs: item.outputs && typeof item.outputs === "object" ? item.outputs : {},
    state: item.state && typeof item.state === "object" ? item.state : {},
    waiting: item.waiting ?? null,
  };
}

function validateStructuredValue(value: unknown, schema: unknown, nodeId: string) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return value;
  const contract = schema as { type?: string; required?: string[]; properties?: Record<string, { type?: string }> };
  if (contract.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new HTTPException(409, { message: `LLM 节点 ${nodeId} 没有返回 Schema 要求的对象` });
    }
    for (const key of contract.required ?? []) {
      if (!(key in (value as Record<string, unknown>))) {
        throw new HTTPException(409, { message: `LLM 节点 ${nodeId} 缺少结构化字段 ${key}` });
      }
    }
  }
  if (contract.type === "array" && !Array.isArray(value)) {
    throw new HTTPException(409, { message: `LLM 节点 ${nodeId} 没有返回 Schema 要求的数组` });
  }
  return value;
}

function aggregateWorkflowValues(node: VisualWorkflowNode, value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  const mode = nodeDataString(node, "aggregateMode") ?? "array";
  if (mode === "first") return values[0] ?? null;
  if (mode === "last") return values.at(-1) ?? null;
  if (mode === "flatten") return values.flatMap((item) => Array.isArray(item) ? item : [item]);
  if (mode === "unique") {
    const seen = new Set<string>();
    return values.filter((item) => {
      const key = stringifyWorkflowValue(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (mode === "object") {
    return Object.assign({}, ...values.filter((item) => item && typeof item === "object" && !Array.isArray(item)));
  }
  return values;
}

async function withWorkflowTimeout<T>(execute: () => Promise<T>, timeoutMs: number) {
  if (timeoutMs <= 0) return execute();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      execute(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`任务超过 ${timeoutMs} ms 超时限制`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function executeRetryNode(input: {
  node: VisualWorkflowNode;
  value: unknown;
  userId: number;
  runId: number;
  depth: number;
}) {
  const body = asBuilderExecutableEntry(parseNodeJson(input.node, "body"), `Retry 节点 ${input.node.id} 的主任务`);
  const fallbackRaw = parseNodeJson(input.node, "fallback");
  const fallback = fallbackRaw ? asBuilderExecutableEntry(fallbackRaw, `Retry 节点 ${input.node.id} 的兜底任务`) : null;
  const retries = Math.min(Math.max(Math.round(nodeDataNumber(input.node, "retries", 2)), 0), 5);
  const backoffMs = Math.min(Math.max(Math.round(nodeDataNumber(input.node, "backoffMs", 500)), 0), 60_000);
  const timeoutMs = Math.min(Math.max(Math.round(nodeDataNumber(input.node, "timeoutMs", 30_000)), 100), 600_000);
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await withWorkflowTimeout(
        () => executeVisualBuilderChild({ ...input, entry: body }),
        timeoutMs,
      );
      return { value: result, attempts: attempt + 1, fallbackUsed: false };
    } catch (error) {
      lastError = error;
      if (attempt < retries && backoffMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs * 2 ** attempt));
      }
    }
  }
  if (fallback) {
    const result = await withWorkflowTimeout(
      () => executeVisualBuilderChild({ ...input, entry: fallback }),
      timeoutMs,
    );
    return { value: result, attempts: retries + 1, fallbackUsed: true };
  }
  throw lastError;
}

async function executeGovernedVisualNode(input: {
  node: VisualWorkflowNode;
  value: unknown;
  initialData: unknown;
  outputs: Map<string, unknown>;
  state: Record<string, unknown>;
  userId: number;
  runId: number;
  depth: number;
}): Promise<unknown> {
  const { node, value } = input;
  const context = { inputData: value, initData: input.initialData, stepResults: input.outputs, state: input.state };
  if (node.type === "input") return input.initialData;
  if (node.type === "output") return value;
  if (node.type === "transform") return String(node.data?.template ?? "{{value}}").replaceAll("{{value}}", stringifyWorkflowValue(value));
  if (node.type === "mapping") {
    const config = parseNodeJson(node, "mapConfig");
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new HTTPException(400, { message: `Mapping 节点 ${node.id} 配置无效` });
    return Object.fromEntries(Object.entries(config).map(([key, descriptor]) => {
      if (!descriptor || typeof descriptor !== "object") return [key, descriptor];
      const item = descriptor as Record<string, unknown>;
      if (typeof item.template === "string") return [key, renderWorkflowTemplate(item.template, context)];
      if ("value" in item) return [key, item.value];
      if (typeof item.step === "string") return [key, resolveWorkflowPath(`stepResults.${item.step}${item.path ? `.${String(item.path)}` : ""}`, context)];
      if (item.initData === true) return [key, resolveWorkflowPath(`initData${item.path ? `.${String(item.path)}` : ""}`, context)];
      if (typeof item.state === "string") return [key, resolveWorkflowPath(`state.${item.state}`, context)];
      return [key, undefined];
    }));
  }
  if (node.type === "agent" || node.type === "tool" || node.type === "workflow") {
    return executeVisualBuilderChild({ entry: compileBuilderEntry(node), value, userId: input.userId, runId: input.runId, depth: input.depth });
  }
  if (node.type === "llm") {
    const prompt = renderWorkflowTemplate(nodeDataString(node, "prompt") ?? "${inputData}", context);
    const systemPrompt = nodeDataString(node, "systemPrompt");
    const modelId = nodeDataString(node, "modelSelection") === "fixed" ? Number(nodeDataString(node, "modelId")) || null : null;
    const purposeValue = nodeDataString(node, "purpose") ?? "agent";
    const purpose = purposeValue === "rag"
      ? "ragAnswer"
      : purposeValue === "eval"
        ? "evalJudge"
        : purposeValue === "chat"
          ? "chat"
          : "agent";
    const result = await generateAiText({
      purpose,
      modelId,
      messages: [
        ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
        { role: "user", content: prompt },
      ],
      temperature: node.data?.temperature == null ? undefined : nodeDataNumber(node, "temperature", 0.7),
      maxOutputTokens: node.data?.maxOutputTokens == null ? undefined : nodeDataNumber(node, "maxOutputTokens", 4096),
      timeoutMs: node.data?.timeoutMs == null ? undefined : nodeDataNumber(node, "timeoutMs", 0),
      trace: { sourceType: "visual_workflow_llm", sourceId: input.runId, userId: input.userId, runId: input.runId },
    });
    const outputSchema = parseNodeJson(node, "outputSchema");
    if (!outputSchema) return { text: result.text, invocationId: result.invocationId, usage: result.usage };
    let structured: unknown;
    try {
      structured = JSON.parse(result.text);
    } catch {
      throw new HTTPException(409, { message: `LLM 节点 ${node.id} 要求结构化输出，但模型没有返回有效 JSON` });
    }
    return { value: validateStructuredValue(structured, outputSchema, node.id), invocationId: result.invocationId, usage: result.usage };
  }
  if (node.type === "aggregate") return aggregateWorkflowValues(node, value);
  if (node.type === "retry") return executeRetryNode({ node, value, userId: input.userId, runId: input.runId, depth: input.depth });
  if (node.type === "parallel") {
    const children = parseNodeJson(node, "children");
    if (!Array.isArray(children) || children.length < 2) throw new HTTPException(400, { message: `Parallel 节点 ${node.id} 至少需要两个子节点` });
    const results = await Promise.all(children.map((child) => executeVisualBuilderChild({
      entry: asBuilderExecutableEntry(child, `Parallel 节点 ${node.id} 子节点`), value, userId: input.userId, runId: input.runId, depth: input.depth,
    })));
    return Object.fromEntries(results.map((result, index) => [`branch-${index + 1}`, result]));
  }
  if (node.type === "condition") {
    const children = parseNodeJson(node, "children");
    if (!Array.isArray(children) || !children.length) throw new HTTPException(400, { message: `Branch 节点 ${node.id} 至少需要一个分支` });
    const fallbackPredicate = parseNodeJson(node, "predicate");
    const defaultBranch = children.find((child) => child && typeof child === "object" && Boolean((child as { isDefault?: boolean }).isDefault));
    const matchedBranch = children.find((child) => {
      if (!child || typeof child !== "object" || (child as { isDefault?: boolean }).isDefault) return false;
      return evaluateWorkflowPredicate((child as { predicate?: unknown }).predicate ?? fallbackPredicate, value);
    }) ?? defaultBranch;
    if (!matchedBranch) return null;
    return executeVisualBuilderChild({ entry: asBuilderExecutableEntry(matchedBranch, `Branch 节点 ${node.id} 命中分支`), value, userId: input.userId, runId: input.runId, depth: input.depth });
  }
  if (node.type === "foreach") {
    if (!Array.isArray(value)) throw new HTTPException(400, { message: `Foreach 节点 ${node.id} 需要数组输入` });
    const body = asBuilderExecutableEntry(parseNodeJson(node, "body"), `Foreach 节点 ${node.id} 循环体`);
    const concurrency = Math.min(Math.max(Math.round(nodeDataNumber(node, "concurrency", 3)), 1), 20);
    const results: unknown[] = [];
    for (let offset = 0; offset < value.length; offset += concurrency) {
      const batch = await Promise.all(value.slice(offset, offset + concurrency).map((item) => executeVisualBuilderChild({ entry: body, value: item, userId: input.userId, runId: input.runId, depth: input.depth })));
      results.push(...batch);
    }
    return results;
  }
  if (node.type === "loop") {
    const body = asBuilderExecutableEntry(parseNodeJson(node, "body"), `Loop 节点 ${node.id} 循环体`);
    let current: unknown = value;
    const loopType = node.data?.loopType === "dowhile" ? "dowhile" : "dountil";
    for (let iteration = 0; iteration < 20; iteration += 1) {
      current = await executeVisualBuilderChild({ entry: body, value: current, userId: input.userId, runId: input.runId, depth: input.depth });
      const matched = evaluateWorkflowPredicate(parseNodeJson(node, "predicate"), current);
      if ((loopType === "dountil" && matched) || (loopType === "dowhile" && !matched)) return current;
    }
    throw new HTTPException(409, { message: `Loop 节点 ${node.id} 超过 20 次安全上限` });
  }
  if (node.type === "sleep" || node.type === "sleepUntil") {
    const delay = node.type === "sleep"
      ? Math.min(Math.max(Math.round(nodeDataNumber(node, "duration", 1000)), 0), 86_400_000)
      : Math.min(Math.max(Date.parse(nodeDataString(node, "date") ?? "") - Date.now(), 0), 86_400_000);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return value;
  }
  if (node.type === "knowledge") {
    const query = renderWorkflowTemplate(nodeDataString(node, "queryTemplate") ?? "${inputData}", context);
    const ids = parseNodeJson(node, "knowledgeBaseIds");
    const citations = await searchKnowledge({
      query,
      knowledgeBaseIds: Array.isArray(ids) ? ids.map(Number).filter(Boolean) : undefined,
      userId: input.userId,
      limit: Math.min(Math.max(Math.round(nodeDataNumber(node, "limit", 8)), 1), 20),
      requestId: `visual-workflow-${input.runId}`,
    });
    return { query, citations };
  }
  if (node.type === "state") {
    const key = nodeDataString(node, "stateKey") as string;
    const action = nodeDataString(node, "stateAction") ?? "set";
    const configured = nodeDataString(node, "stateValue");
    const nextValue = configured ? renderWorkflowTemplate(configured, context) : value;
    if (action === "increment") input.state[key] = Number(input.state[key] ?? 0) + Number(nextValue ?? 1);
    else if (action === "append") input.state[key] = [...(Array.isArray(input.state[key]) ? input.state[key] as unknown[] : []), nextValue];
    else if (action === "merge") input.state[key] = { ...(input.state[key] && typeof input.state[key] === "object" ? input.state[key] as Record<string, unknown> : {}), ...(nextValue && typeof nextValue === "object" ? nextValue as Record<string, unknown> : {}) };
    else input.state[key] = nextValue;
    return value;
  }
  if (node.type === "terminate") {
    const status = nodeDataString(node, "terminateStatus") ?? "success";
    const message = renderWorkflowTemplate(nodeDataString(node, "message") ?? "Workflow 已终止", context);
    if (status === "failure") throw new HTTPException(409, { message });
    return { __workflowTerminate: true, value, message };
  }
  if (node.type === "memoryRead") {
    const query = renderWorkflowTemplate(nodeDataString(node, "queryTemplate") ?? "${inputData}", context).toLowerCase();
    const limit = Math.min(Math.max(Math.round(nodeDataNumber(node, "limit", 5)), 1), 20);
    const memories = await listAiMemories({ userId: input.userId, agentId: Number(nodeDataString(node, "agentId")) || null });
    const ranked = (memories as Array<Record<string, unknown>>)
      .sort((left, right) => {
        const leftHit = String(left.content ?? "").toLowerCase().includes(query) ? 1 : 0;
        const rightHit = String(right.content ?? "").toLowerCase().includes(query) ? 1 : 0;
        return rightHit - leftHit || Number(right.importance ?? 0) - Number(left.importance ?? 0);
      })
      .slice(0, limit);
    return { query, memories: ranked };
  }
  if (node.type === "memoryCandidate") {
    const content = renderWorkflowTemplate(nodeDataString(node, "contentTemplate") ?? "${inputData}", context);
    return createWorkflowMemoryCandidate({ userId: input.userId, agentId: Number(nodeDataString(node, "agentId")) || null, content });
  }
  if (node.type === "documentParser") {
    const path = nodeDataString(node, "documentIdPath");
    const documentId = Number(nodeDataString(node, "documentId") ?? (path ? resolveWorkflowPath(path, context) : 0));
    if (!documentId) throw new HTTPException(400, { message: `文档解析节点 ${node.id} 没有获得有效 documentId` });
    const jobId = await enqueueAiJob({
      jobType: "knowledge_parser",
      payload: { documentId },
      userId: input.userId,
      resourceType: "knowledge_document",
      resourceId: documentId,
      idempotencyKey: `workflow-parser:${input.runId}:${node.id}:${documentId}`,
    });
    return { jobId, documentId, status: "queued" };
  }
  if (node.type === "model") return (await generateAiText({ purpose: "agent", input: stringifyWorkflowValue(value), modelId: Number(node.data?.modelId) || null })).text;
  return value;
}

async function suspendVisualWorkflow(input: {
  runId: number;
  userId: number;
  node: VisualWorkflowNode;
  stepNo: number;
  value: unknown;
  continuation: VisualWorkflowContinuation;
}) {
  const stepId = await startAiWorkflowStep({
    runId: input.runId,
    stepNo: input.stepNo,
    stepCode: input.node.id,
    stepInput: { node: input.node, value: input.value },
  });
  const now = Date.now();
  let waitType: "approval" | "event" | "timer" = "timer";
  let resumeAt: Date | null = null;
  let timeoutAt: Date | null = null;
  let correlationKey: string | null = null;
  if (input.node.type === "approval") {
    waitType = "approval";
    timeoutAt = new Date(now + Math.min(Math.max(nodeDataNumber(input.node, "timeoutMs", 604_800_000), 60_000), 2_592_000_000));
  } else if (input.node.type === "waitEvent" || input.node.type === "humanInput") {
    waitType = "event";
    correlationKey = renderWorkflowTemplate(nodeDataString(input.node, "correlationKey") ?? `human-input:${input.runId}:${input.node.id}`, {
      inputData: input.value,
      initData: input.continuation.initialData,
      stepResults: new Map(Object.entries(input.continuation.outputs)),
      state: input.continuation.state,
    });
    timeoutAt = new Date(now + Math.min(Math.max(nodeDataNumber(input.node, "timeoutMs", 86_400_000), 60_000), 2_592_000_000));
  } else if (input.node.type === "sleep") {
    resumeAt = new Date(now + Math.min(Math.max(nodeDataNumber(input.node, "duration", 1000), 0), 86_400_000));
  } else {
    resumeAt = new Date(nodeDataString(input.node, "date") as string);
  }
  const wait = await createAiWorkflowWait({
    runId: input.runId,
    stepId,
    nodeId: input.node.id,
    waitType,
    correlationKey,
    waitInput: {
      value: input.value,
      title: nodeDataString(input.node, "title"),
      description: nodeDataString(input.node, "description"),
      schema: parseNodeJson(input.node, "schema"),
    },
    resumeAt,
    timeoutAt,
  });
  await finishAiWorkflowStep({ id: stepId, status: "suspended", output: { waitId: wait.id, waitType } });
  const continuation = {
    ...input.continuation,
    waiting: { waitId: wait.id, nodeId: input.node.id, stepNo: input.stepNo, waitType, input: input.value },
  } satisfies VisualWorkflowContinuation;
  await saveAiWorkflowContinuation({ runId: input.runId, continuation });
  const availableAt = resumeAt ?? timeoutAt;
  if (availableAt) {
    await enqueueAiJob({
      jobType: "workflow_resume",
      payload: { runId: input.runId, waitId: wait.id },
      userId: input.userId,
      resourceType: "workflow_run",
      resourceId: input.runId,
      availableAt,
      idempotencyKey: `workflow-resume:${input.runId}:${wait.id}`,
    });
  }
  const output = { value: input.value, status: "suspended", wait: { id: wait.id, waitType, correlationKey, resumeAt, timeoutAt } };
  await finishAiWorkflowRun({ id: input.runId, status: "suspended", output });
  return { runId: input.runId, ...output };
}

async function suspendVisualWorkflowForChild(input: {
  runId: number;
  stepId: number;
  stepNo: number;
  node: VisualWorkflowNode;
  childRunId: number;
  value: unknown;
  continuation: VisualWorkflowContinuation;
}) {
  const wait = await createAiWorkflowWait({
    runId: input.runId,
    stepId: input.stepId,
    nodeId: input.node.id,
    waitType: "child_workflow",
    childRunId: input.childRunId,
    correlationKey: `child-workflow:${input.childRunId}`,
    waitInput: { value: input.value, childRunId: input.childRunId },
  });
  await finishAiWorkflowStep({
    id: input.stepId,
    status: "suspended",
    output: { waitId: wait.id, waitType: "child_workflow", childRunId: input.childRunId },
  });
  const continuation = {
    ...input.continuation,
    waiting: {
      waitId: wait.id,
      nodeId: input.node.id,
      stepNo: input.stepNo,
      waitType: "child_workflow" as const,
      input: input.value,
    },
  } satisfies VisualWorkflowContinuation;
  await saveAiWorkflowContinuation({ runId: input.runId, continuation });
  const output = {
    value: input.value,
    status: "suspended" as const,
    wait: {
      id: wait.id,
      waitType: "child_workflow" as const,
      correlationKey: `child-workflow:${input.childRunId}`,
      childRunId: input.childRunId,
    },
  };
  await finishAiWorkflowRun({ id: input.runId, status: "suspended", output });
  return { runId: input.runId, ...output };
}

async function runGovernedVisualWorkflow(input: {
  definitionId: number;
  userId: number;
  runId: number;
  graph: VisualWorkflowGraph;
  continuation: VisualWorkflowContinuation;
  depth: number;
}): Promise<VisualWorkflowExecutionResult> {
  const ordered = topologicalVisualWorkflowOrder(input.graph);
  if (!ordered) throw new HTTPException(400, { message: "工作流依赖关系无法排序" });
  const incoming = new Map<string, string[]>();
  input.graph.edges.forEach((edge) => incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]));
  const output = new Map(Object.entries(input.continuation.outputs));
  let continuation = input.continuation;

  if (continuation.waiting) {
    const waits = await listAiWorkflowWaits({ runId: input.runId, userId: input.userId });
    const wait = waits.find((item) => Number(item.id) === continuation.waiting?.waitId);
    if (!wait || wait.status === "pending") {
      return { runId: input.runId, value: continuation.waiting.input, status: "suspended" as const, wait };
    }
    const childResolution = continuation.waiting.waitType === "child_workflow" && wait.resolution && typeof wait.resolution === "object"
      ? wait.resolution as { status?: string; value?: unknown; errorMessage?: string | null; childRunId?: number }
      : null;
    if (childResolution && childResolution.status !== "completed") {
      const errorMessage = childResolution.errorMessage || `子 Workflow Run #${childResolution.childRunId ?? wait.childRunId} 执行失败`;
      await failSuspendedAiWorkflowStep({
        runId: input.runId,
        stepNo: continuation.waiting.stepNo,
        errorMessage,
        output: childResolution,
      });
      throw new HTTPException(409, { message: errorMessage });
    }
    const waitOutput = continuation.waiting.waitType === "approval"
      ? { approved: wait.status === "approved", status: wait.status, resolution: wait.resolution, value: continuation.waiting.input }
      : continuation.waiting.waitType === "timer"
        ? continuation.waiting.input
        : continuation.waiting.waitType === "child_workflow"
          ? childResolution?.value ?? null
          : { status: wait.status, event: wait.resolution, value: continuation.waiting.input };
    output.set(continuation.waiting.nodeId, waitOutput);
    await completeSuspendedAiWorkflowStep({ runId: input.runId, stepNo: continuation.waiting.stepNo, output: waitOutput });
    continuation = {
      ...continuation,
      nextIndex: continuation.nextIndex + 1,
      outputs: Object.fromEntries(output),
      waiting: null,
    };
    await saveAiWorkflowContinuation({ runId: input.runId, continuation });
  }

  for (let index = continuation.nextIndex; index < ordered.length; index += 1) {
    const node = ordered[index] as VisualWorkflowNode;
    const values = (incoming.get(node.id) ?? []).map((id) => output.get(id));
    const value = node.type === "aggregate" || values.length > 1 ? values : (values[0] ?? continuation.initialData);
    const persistentSleep = node.type === "sleep" && nodeDataNumber(node, "duration", 1000) > maxInlineSleepMs;
    const persistentSleepUntil = node.type === "sleepUntil" && Math.max(Date.parse(nodeDataString(node, "date") ?? "") - Date.now(), 0) > maxInlineSleepMs;
    if (["approval", "waitEvent", "humanInput"].includes(node.type) || persistentSleep || persistentSleepUntil) {
      return suspendVisualWorkflow({
        runId: input.runId,
        userId: input.userId,
        node,
        stepNo: index + 1,
        value,
        continuation: { ...continuation, nextIndex: index, outputs: Object.fromEntries(output) },
      });
    }
    const stepId = await startAiWorkflowStep({
      runId: input.runId,
      stepNo: index + 1,
      stepCode: node.id,
      stepInput: { node, value, state: continuation.state },
    });
    const stepStartedAt = performance.now();
    let nodeOutput: unknown;
    try {
      nodeOutput = await executeGovernedVisualNode({
        node,
        value,
        initialData: continuation.initialData,
        outputs: output,
        state: continuation.state,
        userId: input.userId,
        runId: input.runId,
        depth: input.depth,
      });
      if (isSuspendedChildWorkflow(nodeOutput)) {
        return await suspendVisualWorkflowForChild({
          runId: input.runId,
          stepId,
          stepNo: index + 1,
          node,
          childRunId: nodeOutput.childRunId,
          value,
          continuation: { ...continuation, nextIndex: index, outputs: Object.fromEntries(output) },
        });
      }
      await finishAiWorkflowStep({
        id: stepId,
        status: "completed",
        output: nodeOutput,
        durationMs: Math.round(performance.now() - stepStartedAt),
      });
    } catch (error) {
      await finishAiWorkflowStep({
        id: stepId,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: Math.round(performance.now() - stepStartedAt),
      });
      throw error;
    }
    if (nodeOutput && typeof nodeOutput === "object" && "__workflowTerminate" in nodeOutput) {
      const value = (nodeOutput as unknown as { value: unknown }).value;
      await finishAiWorkflowRun({ id: input.runId, status: "completed", output: { value, terminatedBy: node.id, orchestrator: "admin-base" } });
      return { runId: input.runId, value, status: "completed" as const, orchestrator: "admin-base" as const };
    }
    output.set(node.id, nodeOutput);
    continuation = { ...continuation, nextIndex: index + 1, outputs: Object.fromEntries(output) };
    await saveAiWorkflowContinuation({ runId: input.runId, continuation });
  }
  const outputNode = ordered.find((node) => node.type === "output");
  const result = output.get(outputNode?.id ?? ordered.at(-1)?.id ?? "") ?? null;
  await finishAiWorkflowRun({ id: input.runId, status: "completed", output: { value: result, orchestrator: "admin-base" } });
  return { runId: input.runId, value: result, status: "completed" as const, orchestrator: "admin-base" as const };
}

export async function executeVisualWorkflow(input: {
  definitionId: number;
  userId: number;
  value: string;
  depth?: number;
  parentRunId?: number | null;
  parentNodeId?: string | null;
}): Promise<VisualWorkflowExecutionResult> {
  const depth = input.depth ?? 0;
  if (depth > maxWorkflowDepth) throw new HTTPException(409, { message: "Workflow 调用深度超过安全上限" });
  const definition = (await getVisualWorkflowDefinition(input.definitionId)) as
    | { graph: unknown; status: string; code: string }
    | null;
  if (!definition?.graph || definition.status !== "published") throw new HTTPException(409, { message: "工作流尚未发布" });
  const graph = validateVisualWorkflowGraph(definition.graph);
  const internalNodes = graph.nodes.filter((node) => node.type !== "input" && node.type !== "output");
  if (internalNodes.every((node) => node.type === "transform") && !internalNodes.some((node) => adminBaseRuntimeNodeTypes.has(node.type))) {
    const result = await executeVisualWorkflowLegacy(input);
    return { ...result, status: "completed" as const };
  }
  const initialData = parseWorkflowInput(input.value);
  const run = await createAiWorkflowRun({
    workflowCode: String(definition.code),
    userId: input.userId,
    definitionId: input.definitionId,
    parentRunId: input.parentRunId ?? null,
    parentNodeId: input.parentNodeId ?? null,
    callDepth: depth,
    resourceType: "visual_workflow",
    resourceId: String(input.definitionId),
    workflowInput: { value: initialData },
    initialStatus: "running",
  });
  const continuation = continuationFrom(null, initialData);
  await saveAiWorkflowContinuation({ runId: run.id, continuation });
  try {
    return await runGovernedVisualWorkflow({ definitionId: input.definitionId, userId: input.userId, runId: run.id, graph, continuation, depth });
  } catch (error) {
    await finishAiWorkflowRun({ id: run.id, status: "failed", errorMessage: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function settleParentWorkflowRuns(input: {
  childRunId: number;
  childStatus: "completed" | "failed" | "cancelled";
  value?: unknown;
  errorMessage?: string | null;
}) {
  const parents = await resolveChildWorkflowWaits(input);
  for (const parent of parents) {
    await enqueueAiJob({
      jobType: "workflow_resume",
      payload: { runId: parent.runId, waitId: parent.id },
      userId: parent.userId,
      resourceType: "workflow_run",
      resourceId: parent.runId,
      priority: 50,
      idempotencyKey: `workflow-parent-resume:${parent.runId}:${input.childRunId}`,
    });
  }
}

export async function resumeVisualWorkflow(input: {
  runId: number;
  userId: number;
  waitId?: number;
  depth?: number;
}): Promise<VisualWorkflowExecutionResult> {
  let run = await getAiWorkflowRuntimeRun({ id: input.runId, userId: input.userId });
  if (!run) throw new HTTPException(404, { message: "Workflow Run 不存在" });
  if (["completed", "failed", "cancelled"].includes(String(run.status))) {
    const value = (run.output as { value?: unknown } | null)?.value ?? null;
    await settleParentWorkflowRuns({
      childRunId: input.runId,
      childStatus: run.status as "completed" | "failed" | "cancelled",
      value,
      errorMessage: run.status === "failed" ? "子 Workflow 执行失败" : null,
    });
    return { runId: input.runId, status: run.status, value };
  }
  if (input.waitId) {
    const waits = await listAiWorkflowWaits({ runId: input.runId, userId: input.userId });
    const wait = waits.find((item) => Number(item.id) === input.waitId);
    if (wait?.status === "pending" && wait.waitType === "timer") {
      await resolveDueAiWorkflowTimer({ id: input.waitId, runId: input.runId, userId: input.userId });
    } else if (wait?.status === "pending" && wait.timeoutAt && Date.parse(String(wait.timeoutAt)) <= Date.now()) {
      await sqlite
        .prepare(
          `UPDATE sys_ai_workflow_wait SET status = 'expired', resolution_json = ?, decided_at = now(), updated_at = now()
           WHERE id = ? AND run_id = ? AND status = 'pending'`,
        )
        .run(JSON.stringify({ reason: "timeout" }), input.waitId, input.runId);
    }
  }
  const claimed = await sqlite
    .prepare(
      `UPDATE sys_ai_workflow_run SET status = 'running', error_message = NULL, updated_at = now()
       WHERE id = ? AND user_id = ? AND status = 'suspended' RETURNING id`,
    )
    .get(input.runId, input.userId);
  if (!claimed) {
    run = await getAiWorkflowRuntimeRun({ id: input.runId, userId: input.userId });
    if (run?.status === "running") throw new HTTPException(409, { message: "Workflow Run 正在由其他执行器恢复" });
    return { runId: input.runId, status: run?.status ?? "missing", value: (run?.output as { value?: unknown } | null)?.value ?? null };
  }
  run = await getAiWorkflowRuntimeRun({ id: input.runId, userId: input.userId });
  const definitionId = Number(run?.definitionId);
  if (!definitionId) throw new HTTPException(409, { message: "Workflow Run 缺少可恢复的定义版本" });
  const definition = await getVisualWorkflowDefinition(definitionId) as { graph?: unknown } | null;
  if (!definition?.graph) throw new HTTPException(409, { message: "Workflow 定义不存在，无法恢复" });
  const graph = validateVisualWorkflowGraph(definition.graph);
  const initialData = (run?.input as { value?: unknown } | null)?.value;
  const continuation = continuationFrom(run?.continuation, initialData);
  try {
    const result = await runGovernedVisualWorkflow({
      definitionId,
      userId: input.userId,
      runId: input.runId,
      graph,
      continuation,
      depth: input.depth ?? Number(run?.callDepth ?? 0),
    });
    if (result.status === "completed") {
      await settleParentWorkflowRuns({
        childRunId: input.runId,
        childStatus: "completed",
        value: result.value,
      });
    }
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await finishAiWorkflowRun({ id: input.runId, status: "failed", errorMessage });
    await settleParentWorkflowRuns({
      childRunId: input.runId,
      childStatus: "failed",
      errorMessage,
    });
    throw error;
  }
}
