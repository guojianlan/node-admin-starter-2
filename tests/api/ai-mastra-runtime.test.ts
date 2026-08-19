import { Agent } from "@mastra/core/agent";
import { createMockModel } from "@mastra/core/test-utils/llm-mock";
import { describe, expect, it, vi } from "vitest";
import {
  getAiOrchestrator,
  getMastraPostgresConfig,
  mastraRuntimeSchema,
  resolveAgentOrchestrator,
} from "@/server/mastra/config";
import { createAdminBaseMastraRequestContext } from "@/server/mastra/request-context";
import { adaptMastraAgentStream } from "@/server/mastra/stream-adapter";
import { createMastraToolSet } from "@/server/mastra/tool-adapter";
import type { AiToolRow } from "@/server/services/ai-agent-service";

const calculatorTool: AiToolRow = {
  id: 1,
  name: "计算器",
  code: "calculator",
  description: "执行基础计算",
  handlerKey: "calculator",
  inputSchemaJson: null,
  configJson: null,
  riskLevel: "low",
  approvalRequired: false,
  approvalMode: "always",
  status: 1,
  sort: 0,
  isSystem: true,
};

describe("Mastra runtime boundary", () => {
  it("keeps legacy as the default and enables only the first migrated Agent", () => {
    expect(getAiOrchestrator({ ADMIN_BASE_AI_ORCHESTRATOR: "" })).toBe("legacy");
    expect(
      resolveAgentOrchestrator("general-assistant", {
        ADMIN_BASE_AI_ORCHESTRATOR: "mastra",
      }),
    ).toBe("mastra");
    expect(
      resolveAgentOrchestrator("module-development-agent", {
        ADMIN_BASE_AI_ORCHESTRATOR: "mastra",
      }),
    ).toBe("legacy");
    expect(() => getAiOrchestrator({ ADMIN_BASE_AI_ORCHESTRATOR: "unknown" })).toThrow(
      "只支持 legacy 或 mastra",
    );
  });

  it("prepares isolated PostgreSQL storage without runtime DDL initialization", () => {
    const config = getMastraPostgresConfig({
      DATABASE_URL: "postgres://admin:secret@localhost:5432/admin_base",
    });
    expect(config).toMatchObject({
      id: "admin-base-mastra",
      schemaName: mastraRuntimeSchema,
      disableInit: true,
    });
    expect(() => getMastraPostgresConfig({ DATABASE_URL: " " })).toThrow("需要 DATABASE_URL");
  });

  it("injects identity, abilities, request id and data scope into RequestContext", () => {
    const context = createAdminBaseMastraRequestContext({
      userId: 7,
      abilities: ["system.aiChat.chat"],
      requestId: "request-7",
      dataScope: {
        kind: "restricted",
        userId: 7,
        userDeptId: 3,
        scopes: ["current_dept"],
        deptIds: [3],
        selfOnly: false,
      },
    });
    expect(context.get("userId")).toBe(7);
    expect(context.get("abilities")).toEqual(["system.aiChat.chat"]);
    expect(context.get("requestId")).toBe("request-7");
    expect(context.get("dataScope")).toMatchObject({ deptIds: [3], kind: "restricted" });
  });

  it("maps governed tools to Mastra without bypassing approval or execution hooks", async () => {
    const execute = vi.fn(async (_tool: AiToolRow, input: Record<string, unknown>) => ({
      result: input.expression,
    }));
    const tools = createMastraToolSet({
      tools: [calculatorTool],
      requiresApproval: () => true,
      execute,
    });
    const tool = tools.calculator as {
      id: string;
      requireApproval?: boolean;
      execute?: (input: unknown, context: unknown) => Promise<unknown>;
    };

    expect(tool).toMatchObject({ id: "calculator", requireApproval: true });
    await expect(tool.execute?.({ expression: "1+1" }, {} as never)).resolves.toEqual({
      result: "1+1",
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("normalizes a real Mastra Agent stream to the existing Admin Base stream contract", async () => {
    const agent = new Agent({
      id: "runtime-contract-test",
      name: "Runtime contract test",
      instructions: "Return the test response.",
      model: createMockModel({ mockText: "Mastra stream ready", version: "v2" }),
    });
    const output = await agent.stream("test");
    const parts = [];
    for await (const part of adaptMastraAgentStream(output)) parts.push(part);

    expect(parts).toContainEqual({ type: "text-delta", text: "Mastra stream ready" });
    expect(parts.some((part) => part.type === "finish-step")).toBe(true);
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: "finish",
        finishReason: "stop",
        totalUsage: expect.objectContaining({ inputTokens: 10, outputTokens: 20 }),
      }),
    );
  });
});
