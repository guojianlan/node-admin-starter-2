import { Suspense } from "react";
import { AdminAppLayout } from "@/ui/shell/AdminAppLayout";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <AdminAppLayout>{children}</AdminAppLayout>
    </Suspense>
  );
}
