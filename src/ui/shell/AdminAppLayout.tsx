"use client";

import { AdminGuard } from "./AdminGuard";
import { AdminShell } from "./AdminShell";

export function AdminAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminGuard>
      <AdminShell>{children}</AdminShell>
    </AdminGuard>
  );
}
