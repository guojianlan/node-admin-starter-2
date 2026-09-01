import { createTool } from "@mastra/core/tools";
import type { ToolsInput } from "@mastra/core/agent";
import type { AiToolRow } from "@/server/services/ai-agent-service";
import { getAiToolInputSchema } from "@/server/services/ai-tool-registry";

export function createMastraToolSet(input: {
  tools: AiToolRow[];
  requiresApproval: (tool: AiToolRow) => boolean;
  execute: (
    tool: AiToolRow,
    toolInput: Record<string, unknown>,
    toolCallId?: string,
  ) => Promise<unknown>;
}): ToolsInput {
  return Object.fromEntries(
    input.tools.map((tool) => [
      tool.code,
      createTool({
        id: tool.code,
        description: tool.description,
        inputSchema: getAiToolInputSchema(tool.handlerKey),
        requireApproval: input.requiresApproval(tool),
        execute: async (toolInput, context) =>
          input.execute(
            tool,
            (toolInput ?? {}) as Record<string, unknown>,
            context.agent?.toolCallId,
          ),
      }),
    ]),
  );
}
