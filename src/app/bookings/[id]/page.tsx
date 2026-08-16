import { Link } from "@/components/tab-link";
import { stopNames } from "@/lib/stops";
import { can } from "@/lib/scope";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import QRCode from "qrcode";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { refundFor } from "@/lib/policy";
import { BookingDetail } from "@/components/booking-detail";

type Props = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Booking" };

export default async function BookingPage({ params }: Props) {
  const { id } = await params;
  const session = await getCurrentUser();
  if (!session) redirect(`/login?next=/bookings/${id}`);

  const booking = await db.booking.findUnique({
    where: { id },
    include: {
      seats: true,
      payments: { orderBy: { createdAt: "desc" } },
      ticket: true,
      user: { select: { fullName: true, email: true, phone: true } },
      trip: {
        include: {
          route: true,
          bus: { select: { registration: true, model: true } },
          driver: { select: { fullName: true } },
        },
      },
    },
  });

  if (!booking) notFound();

  // Object-level check — a booking id is not authority to view it.
  const isStaff = can(session.role, "VIEW_ANY_BOOKING");
  if (booking.userId !== session.id && !isStaff) notFound();

  // Rendered server-side as a data URI so the QR never needs a network request
  // and works offline once the page is loaded.
  const qrDataUrl = booking.ticket
    ? await QRCode.toDataURL(booking.ticket.qrToken, { width: 320, margin: 1 })
    : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link href="/bookings" className="btn-ghost -ml-3 mb-4 text-sm">
        <ChevronLeft className="h-4 w-4" /> All bookings
      </Link>

      <BookingDetail
        qrDataUrl={qrDataUrl}
        booking={{
          id: booking.id,
          reference: booking.reference,
          verificationCode: booking.ticket?.verificationCode ?? null,
          status: booking.status,
          totalAmount: booking.totalAmount,
          createdAt: booking.createdAt.toISOString(),
          cancelledAt: booking.cancelledAt?.toISOString() ?? null,
          cancelReason: booking.cancelReason,
          refundAmount: booking.refundAmount,
          refundPreview:
            booking.status === "CONFIRMED"
              ? refundFor(booking.totalAmount, booking.trip.departureAt)
              : null,
          seats: booking.seats.map((s) => ({
            seatNumber: s.seatNumber,
            passengerName: s.passengerName,
            passengerPhone: s.passengerPhone,
          })),
          payments: booking.payments.map((p) => ({
            method: p.method,
            status: p.status,
            amount: p.amount,
            receiptNumber: p.receiptNumber,
            completedAt: p.completedAt?.toISOString() ?? null,
          })),
          ticket: booking.ticket
            ? { checkedInAt: booking.ticket.checkedInAt?.toISOString() ?? null }
            : null,
          user: booking.user,
          trip: {
            departureAt: booking.trip.departureAt.toISOString(),
            arrivalAt: booking.trip.arrivalAt.toISOString(),
            fare: booking.trip.fare,
            status: booking.trip.status,
            route: {
              origin: booking.trip.route.origin,
              destination: booking.trip.route.destination,
              distanceKm: booking.trip.route.distanceKm,
              stops: stopNames(booking.trip.route.stops),
            },
            bus: booking.trip.bus,
            driver: booking.trip.driver,
          },
        }}
      />
    </div>
  );
}
