import type { Metadata } from "next";
import { RefundsQueue } from "@/components/refunds-queue";

export const metadata: Metadata = { title: "Refunds" };

export default function RefundsPage() {
  return <RefundsQueue />;
}
