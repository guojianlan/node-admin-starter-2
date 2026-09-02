"use client";

export type SaasContextSelection = {
  tenantId: number;
  workspaceId: number;
};

const activeUserKey = "admin-base:saas-context:active-user";

function selectionKey(userId: number) {
  return `admin-base:saas-context:${userId}`;
}

function readPositiveInteger(value: string | null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function activateSaasContextUser(userId: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(activeUserKey, String(userId));
}

export function deactivateSaasContextUser() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(activeUserKey);
}

export function readSaasContextSelection(userId: number): SaasContextSelection | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(selectionKey(userId)) || "null",
    ) as Partial<SaasContextSelection> | null;
    const tenantId = readPositiveInteger(String(parsed?.tenantId ?? ""));
    const workspaceId = readPositiveInteger(String(parsed?.workspaceId ?? ""));
    return tenantId && workspaceId ? { tenantId, workspaceId } : null;
  } catch {
    return null;
  }
}

export function saveSaasContextSelection(userId: number, selection: SaasContextSelection) {
  if (typeof window === "undefined") return;
  activateSaasContextUser(userId);
  window.localStorage.setItem(selectionKey(userId), JSON.stringify(selection));
}

export function clearSaasContextSelection(userId: number) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(selectionKey(userId));
}

export function getActiveSaasContextHeaders() {
  if (typeof window === "undefined") return null;
  const userId = readPositiveInteger(window.localStorage.getItem(activeUserKey));
  if (!userId) return null;
  const selection = readSaasContextSelection(userId);
  if (!selection) return null;
  return {
    "X-SaaS-Tenant-Id": String(selection.tenantId),
    "X-SaaS-Workspace-Id": String(selection.workspaceId),
  };
}
