import { createTool } from "@mastra/core/tools";
import type { ToolsInput } from "@mastra/core/agent";
import type { AiToolRow } from "@/server/services/ai-agent-service";
import { getAiToolInputSchema } from "@/server/services/ai-tool-registry";

export function createMastraToolSet(input: {
  tools: AiToolRow[];
  requiresApproval: (tool: AiToolRow) => boolean;
  execute: (tool: AiToolRow, toolInput: Record<string, unknown>) => Promise<unknown>;
}): ToolsInput {
  return Object.fromEntries(
    input.tools.map((tool) => [
      tool.code,
      createTool({
        id: tool.code,
        description: tool.description,
        inputSchema: getAiToolInputSchema(tool.handlerKey),
        requireApproval: input.requiresApproval(tool),
        execute: async (toolInput) =>
          input.execute(tool, (toolInput ?? {}) as Record<string, unknown>),
      }),
    ]),
  );
}
