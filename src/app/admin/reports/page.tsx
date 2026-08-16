import type { Metadata } from "next";
import { RequireRole } from "@/components/require-role";
import { ReportsView } from "@/components/reports-view";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <RequireRole section="reports">
      <ReportsView />
    </RequireRole>
  );
}
