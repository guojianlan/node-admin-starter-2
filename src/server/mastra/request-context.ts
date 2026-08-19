import { RequestContext } from "@mastra/core/request-context";
import type { ResolvedDataScope } from "@/server/services/data-scope";

export type AdminBaseMastraRequestContext = {
  userId: number;
  abilities: string[];
  requestId: string;
  dataScope: ResolvedDataScope;
  workflowRunId?: number;
};

export function createAdminBaseMastraRequestContext(values: AdminBaseMastraRequestContext) {
  const context = new RequestContext<AdminBaseMastraRequestContext>();
  context.set("userId", values.userId);
  context.set("abilities", [...values.abilities]);
  context.set("requestId", values.requestId);
  context.set("dataScope", {
    ...values.dataScope,
    scopes: [...values.dataScope.scopes],
    deptIds: [...values.dataScope.deptIds],
  });
  if (values.workflowRunId) context.set("workflowRunId", values.workflowRunId);
  return context;
}
