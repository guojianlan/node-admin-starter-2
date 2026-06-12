"use client";

import { create } from "zustand";
import { request } from "@/lib/request";

export type DictOption = {
  label: string;
  value: string | number;
  color?: string | null;
};

type DictState = {
  dicts: Record<string, DictOption[]>;
  initialized: boolean;
  initDicts: () => Promise<void>;
  getOptions: (code: string) => DictOption[];
};

export const useDictStore = create<DictState>((set, get) => ({
  dicts: {},
  initialized: false,

  async initDicts() {
    if (get().initialized) return;
    const dicts = await request<Record<string, DictOption[]>>("/api/system/dict/list/all", {
      silent: true,
    });
    set({ dicts, initialized: true });
  },

  getOptions(code) {
    return get().dicts[code] ?? [];
  },
}));
