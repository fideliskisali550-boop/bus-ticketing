import type { Metadata } from "next";
import { AdminRoutes } from "@/components/admin-routes";

export const metadata: Metadata = { title: "Routes" };

export default function AdminRoutesPage() {
  return <AdminRoutes />;
}
