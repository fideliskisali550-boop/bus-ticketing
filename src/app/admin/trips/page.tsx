import type { Metadata } from "next";
import { AdminTrips } from "@/components/admin-trips";

export const metadata: Metadata = { title: "Departures" };

export default function AdminTripsPage() {
  return <AdminTrips />;
}
