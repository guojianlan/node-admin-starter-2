import { describe, expect, it } from "vitest";
import { classifyAiError } from "@/server/services/ai-reliability-service";

describe("AI reliability error classification", () => {
  it("classifies common upstream throttling messages as rate limits", () => {
    expect(classifyAiError(new Error("Too Many Requests"))).toMatchObject({ type: "rate_limit" });
    expect(classifyAiError(new Error("HTTP 429"))).toMatchObject({ type: "rate_limit" });
    expect(classifyAiError(new Error("rate limit exceeded"))).toMatchObject({ type: "rate_limit" });
  });

  it("redacts Provider secrets from persisted error messages", () => {
    const result = classifyAiError(new Error("apiKey=secret-value Bearer private-token sk-private"));
    expect(result.message).not.toContain("secret-value");
    expect(result.message).not.toContain("private-token");
    expect(result.message).not.toContain("sk-private");
  });
});
