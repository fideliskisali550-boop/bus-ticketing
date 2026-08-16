import type { Metadata } from "next";
import { BookingsList } from "@/components/bookings-list";

export const metadata: Metadata = { title: "All bookings" };

export default function AdminBookingsPage() {
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Bookings</h1>
      <p className="mt-1 text-sm text-muted">
        Every booking across the network, searchable and exportable.
      </p>
      <BookingsList scope="all" />
    </>
  );
}
