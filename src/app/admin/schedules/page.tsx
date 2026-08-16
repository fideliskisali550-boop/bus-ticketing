import type { Metadata } from "next";
import { SchedulesAdmin } from "@/components/schedules-admin";

export const metadata: Metadata = { title: "Schedules" };

export default function SchedulesPage() {
  return <SchedulesAdmin />;
}
