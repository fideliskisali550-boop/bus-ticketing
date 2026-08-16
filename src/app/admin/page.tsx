import type { Metadata } from "next";
import { AdminHome } from "@/components/admin-home";

export const metadata: Metadata = { title: "Operations" };

export default function AdminHomePage() {
  return <AdminHome />;
}
