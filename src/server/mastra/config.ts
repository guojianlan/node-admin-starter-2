import { PostgresStore, type PostgresStoreConfig } from "@mastra/pg";

export type AiOrchestrator = "legacy" | "mastra";
type OrchestratorEnv = { ADMIN_BASE_AI_ORCHESTRATOR?: string };
type DatabaseEnv = { DATABASE_URL?: string };

export const mastraRuntimeSchema = "mastra_runtime";
export const mastraRuntimeStorageId = "admin-base-mastra";

const firstMastraAgentCodes = new Set(["general-assistant"]);

export function getAiOrchestrator(env?: OrchestratorEnv): AiOrchestrator {
  const value = (env?.ADMIN_BASE_AI_ORCHESTRATOR ?? process.env.ADMIN_BASE_AI_ORCHESTRATOR)
    ?.trim()
    .toLowerCase();
  if (!value || value === "legacy") return "legacy";
  if (value === "mastra") return "mastra";
  throw new Error("ADMIN_BASE_AI_ORCHESTRATOR 只支持 legacy 或 mastra");
}

export function resolveAgentOrchestrator(agentCode: string, env?: OrchestratorEnv): AiOrchestrator {
  if (getAiOrchestrator(env) !== "mastra") return "legacy";
  return firstMastraAgentCodes.has(agentCode) ? "mastra" : "legacy";
}

export function getMastraPostgresConfig(env?: DatabaseEnv): PostgresStoreConfig {
  const connectionString = (env?.DATABASE_URL ?? process.env.DATABASE_URL)?.trim();
  if (!connectionString) throw new Error("Mastra Runtime 需要 DATABASE_URL");
  return {
    id: mastraRuntimeStorageId,
    connectionString,
    schemaName: mastraRuntimeSchema,
    disableInit: true,
  };
}

export function createMastraPostgresStore(env?: DatabaseEnv) {
  return new PostgresStore(getMastraPostgresConfig(env));
}
