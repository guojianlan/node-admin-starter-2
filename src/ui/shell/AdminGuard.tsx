"use client";

import { Spin } from "antd";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { adminRoutes } from "@/router/route-manifest";
import { findMenuByPath } from "@/router/menu-utils";
import { useAuthStore } from "@/stores/auth";
import { useDictStore } from "@/stores/dict";
import { ForbiddenPage } from "@/ui/states/ForbiddenPage";
import { NotFoundPage } from "@/ui/states/NotFoundPage";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const access = useAuthStore((state) => state.access);
  const menus = useAuthStore((state) => state.menus);
  const initialized = useAuthStore((state) => state.initialized);
  const loading = useAuthStore((state) => state.loading);
  const initSession = useAuthStore((state) => state.initSession);
  const initDicts = useDictStore((state) => state.initDicts);

  useEffect(() => {
    if (!token) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
      return;
    }
    void initSession();
    void initDicts();
  }, [initDicts, initSession, pathname, router, token]);

  const route = useMemo(
    () => adminRoutes.find((item) => item.path === pathname),
    [pathname],
  );

  const menu = useMemo(() => findMenuByPath(menus, pathname), [menus, pathname]);

  if (!token || loading || !initialized) {
    return <Spin fullscreen description="加载后台权限..." />;
  }

  if (!route) {
    return <NotFoundPage />;
  }

  if (route.auth && !access.includes(route.auth)) {
    return <ForbiddenPage />;
  }

  if (!menu && pathname !== "/dashboard" && !route.adminHidden) {
    return <ForbiddenPage />;
  }

  return <>{children}</>;
}
