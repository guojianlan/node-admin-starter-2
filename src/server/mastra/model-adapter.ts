import type { MastraModelConfig } from "@mastra/core/llm";
import type { LanguageModel } from "ai";

export function toMastraLanguageModel(model: LanguageModel): MastraModelConfig {
  if (typeof model === "string") {
    throw new Error("Admin Base Mastra 只接受现有 Provider 创建的 AI SDK LanguageModel");
  }
  return model as unknown as MastraModelConfig;
}
