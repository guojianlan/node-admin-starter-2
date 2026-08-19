import { z } from "zod";
import {
  aiRuntimePreflightInputSchema,
  aiRuntimePreflightWorkflowCode,
  runAiRuntimePreflightWorkflow,
} from "./workflows/ai-runtime-preflight";

type AiWorkflowExecutionContext = {
  userId: number;
  abilities: string[];
  requestId: string;
};

type AiWorkflowDefinition = {
  code: string;
  name: string;
  description: string;
  category: "diagnostic" | "business";
  riskLevel: "low" | "medium" | "high" | "critical";
  inputSchema: z.ZodType;
  execute: (input: unknown, context: AiWorkflowExecutionContext) => Promise<unknown>;
};

export class AiWorkflowNotFoundError extends Error {
  readonly status = 404;

  constructor(message: string) {
    super(message);
    this.name = "AiWorkflowNotFoundError";
  }
}

const workflowRegistry = new Map<string, AiWorkflowDefinition>([
  [
    aiRuntimePreflightWorkflowCode,
    {
      code: aiRuntimePreflightWorkflowCode,
      name: "AI 运行环境预检",
      description: "确定性检查 Agent、Provider、Model、Tool、审批和数据权限上下文，不调用外部模型",
      category: "diagnostic",
      riskLevel: "low",
      inputSchema: aiRuntimePreflightInputSchema,
      execute: (workflowInput, context) =>
        runAiRuntimePreflightWorkflow({
          workflowInput: aiRuntimePreflightInputSchema.parse(workflowInput),
          ...context,
        }),
    },
  ],
]);

export function listAiWorkflowDefinitions() {
  return [...workflowRegistry.values()].map((definition) => ({
    code: definition.code,
    name: definition.name,
    description: definition.description,
    category: definition.category,
    riskLevel: definition.riskLevel,
  }));
}

export function getAiWorkflowDefinition(code: string) {
  return workflowRegistry.get(code) ?? null;
}

export async function executeRegisteredAiWorkflow(input: {
  code: string;
  workflowInput: unknown;
  context: AiWorkflowExecutionContext;
}) {
  const definition = getAiWorkflowDefinition(input.code);
  if (!definition) throw new AiWorkflowNotFoundError(`AI 工作流 ${input.code} 尚未注册`);
  return definition.execute(definition.inputSchema.parse(input.workflowInput), input.context);
}
