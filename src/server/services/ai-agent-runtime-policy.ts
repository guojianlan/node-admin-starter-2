import type { AiToolRow } from "./ai-agent-service";
import { getAiToolDefinition, isAiToolHandlerKey } from "./ai-tool-registry";

export function isAiToolApprovalRequired(tool: AiToolRow) {
  if (
    isAiToolHandlerKey(tool.handlerKey) &&
    getAiToolDefinition(tool.handlerKey).approvalRequired
  ) {
    return true;
  }
  if (tool.handlerKey === "module_publish" || tool.handlerKey === "module_rollback") {
    return true;
  }
  if (tool.approvalMode === "always") return true;
  if (tool.approvalMode === "never") return false;
  return tool.approvalRequired;
}
