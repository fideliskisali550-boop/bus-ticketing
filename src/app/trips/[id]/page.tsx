import { Link } from "@/components/tab-link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { SeatPicker } from "@/components/seat-picker";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const trip = await db.trip.findUnique({
    where: { id },
    select: { route: { select: { origin: true, destination: true } } },
  });

  return {
    title: trip
      ? `${trip.route.origin} to ${trip.route.destination}`
      : "Trip not found",
  };
}

export default async function TripPage({ params }: Props) {
  const { id } = await params;

  const [trip, session] = await Promise.all([
    db.trip.findUnique({
      where: { id },
      select: { id: true, route: { select: { origin: true, destination: true } } },
    }),
    getCurrentUser(),
  ]);

  if (!trip) notFound();

  // The picker needs the account holder's name and phone to pre-fill the first
  // passenger; fetched here so the client never has to make an extra round trip.
  const profile = session
    ? await db.user.findUnique({
        where: { id: session.id },
        select: { fullName: true, phone: true },
      })
    : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Link href="/search" className="btn-ghost -ml-3 mb-4 text-sm">
        <ChevronLeft className="h-4 w-4" /> Back to results
      </Link>

      <h1 className="mb-6 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
        {trip.route.origin} → {trip.route.destination}
      </h1>

      <SeatPicker
        tripId={trip.id}
        signedIn={Boolean(session)}
        defaultName={profile?.fullName ?? ""}
        defaultPhone={profile?.phone ?? ""}
      />
    </div>
  );
}
