"use client";

import { createContext, createElement, useContext, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type NavigationScopeValue = {
  pathname: string;
  search: string;
};

const NavigationScopeContext = createContext<NavigationScopeValue | null>(null);

export function NavigationScope({
  pathname,
  search,
  children,
}: NavigationScopeValue & { children: ReactNode }) {
  return createElement(
    NavigationScopeContext.Provider,
    { value: { pathname, search } },
    children,
  );
}

export function useNavigationAdapter() {
  const globalPathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const scopedLocation = useContext(NavigationScopeContext);

  return {
    pathname: scopedLocation?.pathname ?? globalPathname,
    search: scopedLocation?.search ?? searchParams.toString(),
    replace: (url: string) => router.replace(url, { scroll: false }),
    push: (url: string) => router.push(url, { scroll: false }),
  };
}
