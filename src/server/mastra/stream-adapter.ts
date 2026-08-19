import type { ChunkType, MastraModelOutput } from "@mastra/core/stream";

export type AdminBaseAgentStreamPart =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | { type: "tool-result"; toolCallId: string; toolName: string; output: unknown }
  | {
      type: "tool-approval-request";
      toolCall: { toolCallId: string; toolName: string; input: unknown };
    }
  | {
      type: "finish-step";
      usage: unknown;
      performance: { stepTimeMs: number };
    }
  | {
      type: "finish";
      finishReason: string;
      rawFinishReason?: string;
      totalUsage: unknown;
    }
  | { type: "error"; error: unknown };

export function adaptMastraAgentStream(
  output: Pick<MastraModelOutput, "fullStream">,
): AsyncIterable<AdminBaseAgentStreamPart> {
  return {
    async *[Symbol.asyncIterator]() {
      let stepStartedAt = performance.now();
      const reader = (output.fullStream as ReadableStream<ChunkType>).getReader();
      try {
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          if (chunk.type === "text-delta") {
            yield { type: "text-delta", text: chunk.payload.text };
          } else if (chunk.type === "tool-call") {
            yield {
              type: "tool-call",
              toolCallId: chunk.payload.toolCallId,
              toolName: chunk.payload.toolName,
              input: chunk.payload.args ?? {},
            };
          } else if (chunk.type === "tool-result") {
            yield {
              type: "tool-result",
              toolCallId: chunk.payload.toolCallId,
              toolName: chunk.payload.toolName,
              output: chunk.payload.result,
            };
          } else if (chunk.type === "tool-call-approval") {
            yield {
              type: "tool-approval-request",
              toolCall: {
                toolCallId: chunk.payload.toolCallId,
                toolName: chunk.payload.toolName,
                input: chunk.payload.args ?? {},
              },
            };
          } else if (chunk.type === "step-finish") {
            const now = performance.now();
            yield {
              type: "finish-step",
              usage: chunk.payload.output.usage,
              performance: { stepTimeMs: Math.max(now - stepStartedAt, 0) },
            };
            stepStartedAt = now;
          } else if (chunk.type === "finish") {
            yield {
              type: "finish",
              finishReason: String(chunk.payload.stepResult.reason || "stop"),
              rawFinishReason: chunk.payload.stepResult.rawReason,
              totalUsage: chunk.payload.output.usage,
            };
          } else if (chunk.type === "error") {
            yield { type: "error", error: chunk.payload.error };
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}
