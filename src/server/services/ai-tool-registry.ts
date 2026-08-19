import { z } from "zod";
import type { DbClient } from "@/server/db";
import { executeWebSearch, hasActiveWebSearchProvider } from "./ai-web-search-service";
import { recordBackgroundOperationLog } from "./operation-log-service";
import {
  executeModuleAgentTool,
  getModuleAgentInputSchema,
  isModuleAgentHandlerKey,
  moduleAgentHandlerKeys,
  moduleAgentRiskLevels,
  type ModuleAgentHandlerKey,
} from "./ai-module-agent-service";

export const coreAiToolHandlerKeys = [
  "current_time",
  "calculator",
  "system_status",
  "operation_log_summary",
  "web_search",
  "browser_location",
] as const;
export const aiToolHandlerKeys = [...coreAiToolHandlerKeys, ...moduleAgentHandlerKeys] as const;
export type AiToolHandlerKey = (typeof aiToolHandlerKeys)[number];
export type AiToolRiskLevel = "low" | "medium" | "high" | "critical";

export type AiToolExecutionContext = {
  dbClient: DbClient;
  userId?: number;
  requestId?: string;
  approvedModuleMutation?: boolean;
  hasAbility: (ability: string) => Promise<boolean>;
};

type AiToolRegistryDefinition = {
  label: string;
  description: string;
  inputSchema: z.ZodType;
  riskLevel: AiToolRiskLevel;
  approvalRequired: boolean;
  systemOnly: boolean;
  execute?: (
    input: Record<string, unknown>,
    context: AiToolExecutionContext,
  ) => Promise<unknown> | unknown;
};

const calculatorInputSchema = z.object({
  expression: z.string().min(1).describe("要计算的四则运算表达式"),
});
const operationLogInputSchema = z.object({
  hours: z.number().int().min(1).max(168).default(24),
});
const webSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(500).describe("要搜索的公开网络问题或关键词"),
  limit: z.number().int().min(1).max(10).default(5).describe("最多返回的来源数量"),
});
const browserLocationInputSchema = z.object({
  reason: z.string().trim().min(1).max(300).describe("说明为什么当前任务需要用户的大致位置"),
});

function calculate(expression: string) {
  const compact = expression.replace(/\s+/g, "");
  if (!/^[0-9+\-*/().]+$/.test(compact)) throw new Error("表达式只允许数字和 + - * / ( )");
  const tokens = compact.match(/\d+(?:\.\d+)?|[()+\-*/]/g) ?? [];
  let index = 0;
  const parsePrimary = (): number => {
    const token = tokens[index++];
    if (token === "(") {
      const result = parseAddSub();
      if (tokens[index++] !== ")") throw new Error("括号不匹配");
      return result;
    }
    if (token === "-") return -parsePrimary();
    const number = Number(token);
    if (!Number.isFinite(number)) throw new Error("表达式格式错误");
    return number;
  };
  const parseMulDiv = (): number => {
    let result = parsePrimary();
    while (tokens[index] === "*" || tokens[index] === "/") {
      const operator = tokens[index++];
      const right = parsePrimary();
      result = operator === "*" ? result * right : result / right;
    }
    return result;
  };
  const parseAddSub = (): number => {
    let result = parseMulDiv();
    while (tokens[index] === "+" || tokens[index] === "-") {
      const operator = tokens[index++];
      const right = parseMulDiv();
      result = operator === "+" ? result + right : result - right;
    }
    return result;
  };
  const result = parseAddSub();
  if (index !== tokens.length || !Number.isFinite(result)) throw new Error("表达式无法计算");
  return result;
}

const coreRegistry: Record<(typeof coreAiToolHandlerKeys)[number], AiToolRegistryDefinition> = {
  current_time: {
    label: "当前时间",
    description: "读取服务器当前时间和时区",
    inputSchema: z.object({}),
    riskLevel: "low",
    approvalRequired: false,
    systemOnly: false,
    execute: () => ({ now: new Date().toISOString(), timezone: "Asia/Shanghai" }),
  },
  calculator: {
    label: "计算器",
    description: "执行基础四则运算",
    inputSchema: calculatorInputSchema,
    riskLevel: "low",
    approvalRequired: false,
    systemOnly: false,
    execute: (input) => {
      const expression = String(input.expression || "");
      return { expression, result: calculate(expression) };
    },
  },
  system_status: {
    label: "系统状态",
    description: "读取当前管理员有权查看的系统运行指标",
    inputSchema: z.object({}),
    riskLevel: "low",
    approvalRequired: false,
    systemOnly: true,
    execute: async (_input, context) => {
      const total = (value: unknown) =>
        Number((value as { total?: number } | undefined)?.total ?? 0);
      const metrics = [
        {
          key: "activeUsers",
          ability: "system.user.query",
          query:
            "SELECT COUNT(1)::int AS total FROM sys_user WHERE deleted_at IS NULL AND status = 1",
        },
        {
          key: "onlineSessions",
          ability: "system.onlineUser.query",
          query: "SELECT COUNT(1)::int AS total FROM sys_access_token WHERE expires_at > now()",
        },
        {
          key: "todayLogins",
          ability: "system.loginLog.query",
          query:
            "SELECT COUNT(1)::int AS total FROM sys_login_record WHERE created_at >= CURRENT_DATE",
        },
        {
          key: "todayOperations",
          ability: "system.operationLog.query",
          query:
            "SELECT COUNT(1)::int AS total FROM sys_operation_log WHERE created_at >= CURRENT_DATE",
        },
      ] as const;
      const result: Record<string, number> = {};
      const hiddenMetrics: string[] = [];
      for (const metric of metrics) {
        if (!(await context.hasAbility(metric.ability))) {
          hiddenMetrics.push(metric.key);
          continue;
        }
        result[metric.key] = total(await context.dbClient.prepare(metric.query).get());
      }
      return { ...result, hiddenMetrics };
    },
  },
  operation_log_summary: {
    label: "操作日志摘要",
    description: "读取近期操作日志模块和风险等级统计",
    inputSchema: operationLogInputSchema,
    riskLevel: "medium",
    approvalRequired: true,
    systemOnly: true,
    execute: async (input, context) => {
      if (!(await context.hasAbility("system.operationLog.query")))
        throw new Error("没有操作日志查询权限");
      const hours = Math.min(Math.max(Number(input.hours || 24), 1), 168);
      const rows = await context.dbClient
        .prepare(
          `SELECT module, risk_level AS "riskLevel", COUNT(1)::int AS total
         FROM sys_operation_log WHERE created_at >= now() - (? * interval '1 hour')
         GROUP BY module, risk_level ORDER BY total DESC LIMIT 30`,
        )
        .all(hours);
      return { hours, rows };
    },
  },
  web_search: {
    label: "联网搜索",
    description: "搜索公开网络信息并返回真实、可点击的来源；不能读取任意指定 URL",
    inputSchema: webSearchInputSchema,
    riskLevel: "low",
    approvalRequired: false,
    systemOnly: true,
    execute: async (input, context) => {
      const startedAt = performance.now();
      try {
        const result = await executeWebSearch({
          query: String(input.query || ""),
          limit: Number(input.limit || 5),
          dbClient: context.dbClient,
        });
        await recordBackgroundOperationLog(
          {
            userId: context.userId,
            requestId: context.requestId,
            module: "system.aiWebSearch",
            action: "search",
            resource: "web-search",
            riskLevel: "low",
            durationMs: performance.now() - startedAt,
            details: {
              query: result.query,
              resultCount: result.results.length,
              providerCode: result.provider?.code ?? null,
              attempts: result.attempts.map((attempt) => ({
                providerCode: attempt.providerCode,
                status: attempt.status,
                durationMs: attempt.durationMs,
                resultCount: attempt.resultCount,
                error: attempt.error,
              })),
            },
          },
          context.dbClient,
        );
        return result;
      } catch (error) {
        await recordBackgroundOperationLog(
          {
            userId: context.userId,
            requestId: context.requestId,
            module: "system.aiWebSearch",
            action: "search",
            resource: "web-search",
            success: false,
            status: 502,
            riskLevel: "medium",
            message: error instanceof Error ? error.message : String(error),
            durationMs: performance.now() - startedAt,
            details: { query: String(input.query || "") },
          },
          context.dbClient,
        );
        throw error;
      }
    },
  },
  browser_location: {
    label: "浏览器位置",
    description: "请求用户允许一次性读取浏览器大致位置；该工具只能由当前浏览器执行",
    inputSchema: browserLocationInputSchema,
    riskLevel: "medium",
    approvalRequired: true,
    systemOnly: true,
    execute: () => {
      throw new Error("浏览器位置必须通过 Client Tool 结果接口提交");
    },
  },
};

export function isAiToolHandlerKey(value: string): value is AiToolHandlerKey {
  return (aiToolHandlerKeys as readonly string[]).includes(value);
}

export function getAiToolDefinition(handlerKey: AiToolHandlerKey): AiToolRegistryDefinition {
  if (isModuleAgentHandlerKey(handlerKey)) {
    return {
      label: handlerKey,
      description: `受控模块开发工具 ${handlerKey}`,
      inputSchema: getModuleAgentInputSchema(handlerKey),
      riskLevel: moduleAgentRiskLevels[handlerKey],
      approvalRequired: handlerKey === "module_publish" || handlerKey === "module_rollback",
      systemOnly: true,
    };
  }
  return coreRegistry[handlerKey];
}

export function getAiToolInputSchema(handlerKey: string) {
  if (!isAiToolHandlerKey(handlerKey)) throw new Error(`工具处理器 ${handlerKey} 尚未注册`);
  return getAiToolDefinition(handlerKey).inputSchema;
}

export function listAiToolRegistryOptions() {
  return aiToolHandlerKeys.map((handlerKey) => ({
    handlerKey,
    ...getAiToolDefinition(handlerKey),
  }));
}

export async function isAiToolRuntimeAvailable(handlerKey: string, dbClient: DbClient) {
  if (handlerKey === "web_search") return hasActiveWebSearchProvider(dbClient);
  return true;
}

export async function executeRegisteredAiTool(
  tool: { code: string; handlerKey: string; isSystem: boolean; riskLevel: AiToolRiskLevel },
  input: Record<string, unknown>,
  context: AiToolExecutionContext,
) {
  if (!isAiToolHandlerKey(tool.handlerKey))
    throw new Error(`工具处理器 ${tool.handlerKey} 尚未注册`);
  const definition = getAiToolDefinition(tool.handlerKey);
  if (definition.systemOnly && !tool.isSystem)
    throw new Error("该工具处理器只允许系统内置工具调用");
  const parsed = definition.inputSchema.parse(input) as Record<string, unknown>;
  if (isModuleAgentHandlerKey(tool.handlerKey)) {
    return executeModuleAgentTool(tool, parsed, {
      dbClient: context.dbClient,
      userId: context.userId,
      approvedMutation: context.approvedModuleMutation,
    });
  }
  if (!definition.execute) throw new Error(`工具处理器 ${tool.handlerKey} 尚未实现`);
  return definition.execute(parsed, context);
}

export type { ModuleAgentHandlerKey };
