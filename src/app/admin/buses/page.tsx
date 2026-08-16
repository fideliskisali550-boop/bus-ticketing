import type { Metadata } from "next";
import { AdminBuses } from "@/components/admin-buses";

export const metadata: Metadata = { title: "Fleet" };

export default function AdminBusesPage() {
  return <AdminBuses />;
}
