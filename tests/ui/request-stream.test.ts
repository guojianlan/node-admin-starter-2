import { describe, expect, it } from "vitest";
import { parseEventStreamBlock } from "@/lib/request";

describe("SSE event parsing", () => {
  it("keeps the persisted numeric event id for replay cursors", () => {
    expect(
      parseEventStreamBlock(
        "id: 42\nevent: delta\ndata: {\"text\":\"hello\"}",
      ),
    ).toEqual({ event: "delta", data: { text: "hello" }, id: 42 });
  });

  it("ignores malformed ids without dropping an otherwise valid event", () => {
    expect(
      parseEventStreamBlock("id: not-a-number\nevent: finish\ndata: {\"finishReason\":\"stop\"}"),
    ).toEqual({ event: "finish", data: { finishReason: "stop" } });
  });
});
