import type { Metadata } from "next";
import { AdminVerify } from "@/components/admin-verify";

export const metadata: Metadata = { title: "Ticket verification" };

export default function TicketVerificationPage() {
  return <AdminVerify />;
}
