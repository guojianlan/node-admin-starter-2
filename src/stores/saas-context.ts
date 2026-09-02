"use client";

import { create } from "zustand";
import { ApiError, request } from "@/lib/request";
import {
  activateSaasContextUser,
  clearSaasContextSelection,
  deactivateSaasContextUser,
  saveSaasContextSelection,
} from "@/lib/saas-context";

export type SaasTenantContextOption = {
  id: number;
  name: string;
  code: string;
  status: "active" | "suspended" | "archived";
  role: "owner" | "admin" | "member" | "viewer";
};

export type SaasWorkspaceContextOption = {
  id: number;
  tenantId: number;
  name: string;
  code: string;
  status: "active" | "archived";
  role: "owner" | "editor" | "reviewer" | "viewer" | null;
  tenantRole: "owner" | "admin" | "member" | "viewer";
};

export type EffectiveSaasModule = {
  id: number;
  code: string;
  name: string;
  routeKey: string;
  routePath: string;
  requiredAbility: string;
  capabilities: string[];
};

export type SaasCurrentContext = {
  tenants: SaasTenantContextOption[];
  workspaces: SaasWorkspaceContextOption[];
  currentTenantId: number | null;
  currentWorkspaceId: number | null;
  currentTenant: SaasTenantContextOption | null;
  currentWorkspace: SaasWorkspaceContextOption | null;
  defaultTenantId: number | null;
  defaultWorkspaceId: number | null;
  effectiveModules: EffectiveSaasModule[];
};

type SaasContextState = {
  userId: number | null;
  context: SaasCurrentContext | null;
  error: string | null;
  initialized: boolean;
  loading: boolean;
  initialize: (userId: number, force?: boolean) => Promise<SaasCurrentContext | null>;
  selectTenant: (tenantId: number) => Promise<SaasCurrentContext>;
  selectWorkspace: (workspaceId: number) => Promise<SaasCurrentContext>;
  reset: () => void;
};

function persistContext(userId: number, context: SaasCurrentContext) {
  if (context.currentTenantId && context.currentWorkspaceId) {
    saveSaasContextSelection(userId, {
      tenantId: context.currentTenantId,
      workspaceId: context.currentWorkspaceId,
    });
  }
}

export const useSaasContextStore = create<SaasContextState>((set, get) => ({
  userId: null,
  context: null,
  error: null,
  initialized: false,
  loading: false,

  async initialize(userId, force = false) {
    if (!force && get().initialized && get().userId === userId) return get().context;
    activateSaasContextUser(userId);
    set({ userId, loading: true, error: null });
    try {
      let context: SaasCurrentContext;
      try {
        context = await request<SaasCurrentContext>("/api/saas/context", { silent: true });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        clearSaasContextSelection(userId);
        context = await request<SaasCurrentContext>("/api/saas/context", { silent: true });
      }
      persistContext(userId, context);
      set({ context, initialized: true, error: null });
      return context;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "当前工作上下文加载失败" });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  async selectTenant(tenantId) {
    const userId = get().userId;
    if (!userId) throw new Error("SaaS context user is not initialized");
    set({ loading: true, error: null });
    try {
      const context = await request<SaasCurrentContext>("/api/saas/context", {
        method: "PUT",
        body: { tenantId },
      });
      persistContext(userId, context);
      set({ context, initialized: true, error: null });
      return context;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Tenant 切换失败" });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  async selectWorkspace(workspaceId) {
    const userId = get().userId;
    const tenantId = get().context?.currentTenantId;
    if (!userId || !tenantId) throw new Error("SaaS context is not initialized");
    set({ loading: true, error: null });
    try {
      const context = await request<SaasCurrentContext>("/api/saas/context", {
        method: "PUT",
        body: { tenantId, workspaceId },
      });
      persistContext(userId, context);
      set({ context, initialized: true, error: null });
      return context;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Workspace 切换失败" });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  reset() {
    deactivateSaasContextUser();
    set({ userId: null, context: null, error: null, initialized: false, loading: false });
  },
}));
