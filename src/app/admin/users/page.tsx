import type { Metadata } from "next";
import { AdminUsers } from "@/components/admin-users";
import { RequireRole } from "@/components/require-role";

export const metadata: Metadata = { title: "Users" };

/**
 * Staff administration. The gate is client-side because server rendering cannot
 * tell which of several signed-in accounts this tab is using; `/api/users`
 * enforces the same rule server-side, so this decides what is shown, not what
 * is permitted.
 */
export default function AdminUsersPage() {
  return (
    <RequireRole section="users">
      <AdminUsers />
    </RequireRole>
  );
}
