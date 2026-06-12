"use client";

import { useAuthStore } from "@/stores/auth";

type AuthButtonProps = {
  auth?: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

export function AuthButton({ auth, children, fallback = null }: AuthButtonProps) {
  const hasAccess = useAuthStore((state) => state.hasAccess);
  return hasAccess(auth) ? <>{children}</> : <>{fallback}</>;
}
