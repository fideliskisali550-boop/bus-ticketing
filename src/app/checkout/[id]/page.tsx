import { notFound, redirect } from "next/navigation";
import { can } from "@/lib/scope";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Checkout } from "@/components/checkout";

export const metadata: Metadata = { title: "Checkout" };

type Props = { params: Promise<{ id: string }> };

export default async function CheckoutPage({ params }: Props) {
  const { id } = await params;
  const session = await getCurrentUser();

  if (!session) redirect(`/login?next=/checkout/${id}`);

  const booking = await db.booking.findUnique({
    where: { id },
    include: {
      seats: { select: { seatNumber: true, passengerName: true } },
      user: { select: { phone: true } },
      trip: {
        include: {
          route: { select: { origin: true, destination: true } },
          bus: { select: { registration: true, model: true } },
        },
      },
    },
  });

  if (!booking) notFound();

  // Object-level authorisation: a booking id in the URL is not authority to
  // pay for, or read, someone else's booking.
  const isStaff = can(session.role, "VIEW_ANY_BOOKING");
  if (booking.userId !== session.id && !isStaff) notFound();

  // Nothing to do here for a booking that is already settled or dead.
  if (booking.status === "CANCELLED" || booking.status === "EXPIRED") {
    redirect(`/bookings/${booking.id}`);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
        Complete your booking
      </h1>
      <p className="mt-1 text-sm text-muted">
        Your seats are held while you pay.
      </p>

      <div className="mt-6">
        <Checkout
          booking={{
            id: booking.id,
            reference: booking.reference,
            status: booking.status,
            totalAmount: booking.totalAmount,
            holdsUntil: booking.holdsUntil.toISOString(),
            seats: booking.seats,
            trip: {
              departureAt: booking.trip.departureAt.toISOString(),
              fare: booking.trip.fare,
              route: booking.trip.route,
              bus: booking.trip.bus,
            },
          }}
          defaultPhone={booking.user.phone}
        />
      </div>
    </div>
  );
}
