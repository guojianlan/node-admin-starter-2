import { describe, expect, it } from "vitest";
import { linkifyCitationMarkers } from "@/components/ai/citation-markers";

describe("StreamingMarkdown citation markers", () => {
  it("turns in-range citation markers into local markdown links", () => {
    expect(linkifyCitationMarkers("结论 [1][3]，无效 [4]。", 3)).toBe(
      "结论 [[1]](#citation-1)[[3]](#citation-3)，无效 [4]。",
    );
  });

  it("does not rewrite inline or fenced code", () => {
    const content = ["正文 [1]", "`示例 [1]`", "```text", "数组 [1]", "```"].join("\n");
    expect(linkifyCitationMarkers(content, 1)).toBe(
      ["正文 [[1]](#citation-1)", "`示例 [1]`", "```text", "数组 [1]", "```"].join("\n"),
    );
  });
});
