import { describe, expect, it } from "vitest";
import { estimateAiTokens, governAiChatContext } from "@/server/services/ai-context-service";
import { resolveAiOutputTokens } from "@/server/services/ai-runtime-service";
import type { AiChatMessageRow } from "@/server/services/ai-chat-service";

function message(id: number, content: string): AiChatMessageRow {
  return {
    id,
    sessionId: 1,
    userId: 1,
    role: id % 2 ? "user" : "assistant",
    content,
    status: "completed",
    errorMessage: null,
    parentMessageId: null,
    regeneratedFromId: null,
    finishReason: null,
    usageJson: null,
    metadataJson: null,
    providerId: null,
    modelId: null,
    durationMs: null,
    createdAt: new Date(2026, 0, id).toISOString(),
    updatedAt: new Date(2026, 0, id).toISOString(),
  };
}

describe("AI context and output governance", () => {
  it("estimates CJK text more conservatively than Latin prose", () => {
    expect(estimateAiTokens("后台系统需要可靠的上下文治理")).toBeGreaterThanOrEqual(14);
    expect(estimateAiTokens("admin systems need reliable context governance")).toBeLessThan(20);
  });

  it("compacts old Chinese messages when the context budget is exceeded", () => {
    const messages = Array.from({ length: 8 }, (_, index) =>
      message(index + 1, `第 ${index + 1} 轮：${"这是需要保留语义的中文上下文。".repeat(90)}`),
    );
    const governed = governAiChatContext({
      messages,
      contextWindow: 4096,
      maxOutputTokens: 1024,
    });

    expect(governed.stats.compactedMessages).toBeGreaterThan(0);
    expect(governed.stats.includedMessages).toBeLessThan(messages.length);
    expect(governed.summary).toContain("用户:");
    expect(governed.compactedThroughMessageId).toBeTruthy();
  });

  it("uses the model limit and system ceiling instead of a fixed 32K cap", () => {
    expect(resolveAiOutputTokens({ requested: 64_000, modelLimit: 100_000 })).toBe(64_000);
    expect(resolveAiOutputTokens({ requested: 120_000, modelLimit: 80_000 })).toBe(80_000);
    expect(resolveAiOutputTokens({ requested: 200_000, modelLimit: 200_000 })).toBe(131_072);
  });
});
