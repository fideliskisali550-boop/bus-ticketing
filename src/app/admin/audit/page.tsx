import type { Metadata } from "next";
import { AdminAudit } from "@/components/admin-audit";
import { RequireRole } from "@/components/require-role";

export const metadata: Metadata = { title: "Audit trail" };

/** See the note in the staff page about where this gate lives and why. */
export default function AdminAuditPage() {
  return (
    <RequireRole section="audit">
      <AdminAudit />
    </RequireRole>
  );
}
