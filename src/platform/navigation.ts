"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useNavigationAdapter() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  return {
    pathname,
    search: searchParams.toString(),
    replace: (url: string) => router.replace(url, { scroll: false }),
    push: (url: string) => router.push(url, { scroll: false }),
  };
}
