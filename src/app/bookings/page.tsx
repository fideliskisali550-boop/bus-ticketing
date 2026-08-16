import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { BookingsList } from "@/components/bookings-list";

export const metadata: Metadata = { title: "My tickets" };

export default async function BookingsPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login?next=/bookings");

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
        My tickets
      </h1>
      <p className="mt-1 text-sm text-muted">
        Every booking you have made, with tickets ready to download.
      </p>
      <BookingsList scope="mine" />
    </div>
  );
}
