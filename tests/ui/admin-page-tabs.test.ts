import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRememberedPageHref,
  readStoredPageTabs,
  writeStoredPageTabs,
} from "@/ui/shell/admin-page-tabs";

describe("admin page tab persistence", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the latest full href for an opened route", () => {
    writeStoredPageTabs([
      {
        path: "/system/user",
        href: "/system/user?username=demo&status=1",
        title: "用户管理",
        closable: true,
      },
    ]);

    expect(getRememberedPageHref("/system/user")).toBe("/system/user?username=demo&status=1");
    expect(getRememberedPageHref("/system/dept")).toBe("/system/dept");
  });

  it("discards a stored href that points outside its route", () => {
    values.set(
      "admin-base-page-tabs",
      JSON.stringify([
        {
          path: "/system/user",
          href: "/system/dept?status=1",
          title: "用户管理",
          closable: true,
        },
      ]),
    );

    expect(readStoredPageTabs()[0]?.href).toBe("/system/user");
  });
});
