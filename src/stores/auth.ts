"use client";

import { create } from "zustand";
import { clearAuthToken, getAuthToken, setAuthToken } from "@/lib/auth-token";
import { request } from "@/lib/request";
import { useSaasContextStore } from "@/stores/saas-context";

export type AdminUser = {
  id: number;
  username: string;
  nickname: string;
  email?: string | null;
  mobile?: string | null;
  deptId?: number | null;
  status: number;
  mustChangePassword?: boolean;
};

export type MenuNode = {
  id: number;
  parentId: number;
  type: "menu" | "route" | "nested";
  key: string;
  name: string;
  path?: string | null;
  icon?: string | null;
  order: number;
  status: number;
  hidden: number;
  link: number;
  children?: MenuNode[];
};

type LoginPayload = {
  username: string;
  password: string;
  remember?: boolean;
  captchaId?: string;
  captchaCode?: string;
};

type LoginResult = {
  token: string;
  user: AdminUser;
  access: string[];
  mustChangePassword?: boolean;
};

type InfoResult = {
  user: AdminUser;
  access: string[];
};

type AuthState = {
  token: string | null;
  user: AdminUser | null;
  access: string[];
  menus: MenuNode[];
  initialized: boolean;
  loading: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  logout: () => Promise<void>;
  initSession: (force?: boolean) => Promise<void>;
  initMenus: () => Promise<void>;
  hasAccess: (auth?: string) => boolean;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  token: getAuthToken(),
  user: null,
  access: [],
  menus: [],
  initialized: false,
  loading: false,

  async login(payload) {
    set({ loading: true });
    try {
      const result = await request<LoginResult>("/api/system/login", {
        method: "POST",
        body: payload,
        skipAuthRedirect: true,
      });
      setAuthToken(result.token);
      set({
        token: result.token,
        user: result.user,
        access: result.access,
        initialized: true,
      });
      await useSaasContextStore
        .getState()
        .initialize(result.user.id)
        .catch(() => null);
      await get().initMenus();
    } finally {
      set({ loading: false });
    }
  },

  async logout() {
    try {
      if (get().token) {
        await request("/api/system/logout", {
          method: "POST",
          silent: true,
          skipAuthRedirect: true,
        });
      }
    } finally {
      useSaasContextStore.getState().reset();
      clearAuthToken();
      set({
        token: null,
        user: null,
        access: [],
        menus: [],
        initialized: false,
      });
      if (typeof window !== "undefined") {
        window.location.replace("/login");
      }
    }
  },

  async initSession(force = false) {
    const token = getAuthToken();
    if (!token) {
      useSaasContextStore.getState().reset();
      set({ token: null, user: null, access: [], menus: [], initialized: false, loading: false });
      return;
    }

    if (!force && get().initialized && get().user) return;

    set({ loading: true, token });
    try {
      const result = await request<InfoResult>("/api/system/info");
      set({
        token,
        user: result.user,
        access: result.access,
        initialized: true,
      });
      await useSaasContextStore
        .getState()
        .initialize(result.user.id)
        .catch(() => null);
      await get().initMenus();
    } catch (error) {
      useSaasContextStore.getState().reset();
      clearAuthToken();
      set({
        token: null,
        user: null,
        access: [],
        menus: [],
        initialized: false,
      });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  async initMenus() {
    const token = getAuthToken();
    if (!token) return;
    const menus = await request<MenuNode[]>("/api/system/menu");
    set({ menus });
  },

  hasAccess(auth) {
    if (!auth) return true;
    return get().access.includes(auth);
  },
}));
