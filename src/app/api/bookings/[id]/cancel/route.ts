import { db } from "@/lib/db";
import { can } from "@/lib/scope";
import { handler, ok, parseBody, requireUser, notFound, forbidden, badRequest } from "@/lib/api";
import { cancelBookingSchema } from "@/lib/validation";
import { refundFor } from "@/lib/policy";
import { audit } from "@/lib/audit";
import { emit } from "@/lib/events";
import { requestRefund } from "@/lib/refunds";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  return handler(async () => {
    const user = await requireUser();
    const { id } = await params;
    const { reason } = await parseBody(req, cancelBookingSchema);

    const booking = await db.booking.findUnique({
      where: { id },
      include: { trip: { include: { route: true } }, seats: true },
    });

    if (!booking) throw notFound("That booking could not be found.");

    const isStaff = can(user.role, "VIEW_ANY_BOOKING") || can(user.role, "CANCEL_ANY_BOOKING");
    if (booking.userId !== user.id && !isStaff) throw forbidden();

    if (booking.status === "CANCELLED") {
      throw badRequest("This booking has already been cancelled.");
    }
    if (booking.status === "CHECKED_IN" || booking.status === "COMPLETED") {
      throw badRequest("A booking cannot be cancelled after boarding.");
    }
    if (booking.trip.departureAt < new Date()) {
      throw badRequest("This trip has already departed.");
    }

    // A PENDING booking was never paid for, so nothing is owed back.
    const refund =
      booking.status === "CONFIRMED"
        ? refundFor(booking.totalAmount, booking.trip.departureAt)
        : { amount: 0, percent: 0, tier: "Unpaid booking" };

    await db.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelReason: reason || (isStaff && booking.userId !== user.id ? "Cancelled by operator" : "Cancelled by passenger"),
          refundAmount: refund.amount,
        },
      });

      // Releasing the seat rows is what returns the seats to sale.
      await tx.bookingSeat.deleteMany({ where: { bookingId: id } });

      await tx.trip.update({
        where: { id: booking.tripId },
        data: { seatsBooked: { decrement: booking.seats.length } },
      });

      // The original charge is deliberately left alone. Marking it REFUNDED —
      // which is what this did — erased the fact that money was ever collected,
      // so a month's takings shrank retrospectively and never reconciled. The
      // refund is recorded below as its own movement instead.
    });

    if (refund.amount > 0) {
      await requestRefund({
        bookingId: id,
        amount: refund.amount,
        percent: refund.percent,
        reason,
        requestedById: user.id,
        req,
      });
    }

    await emit(
      {
        type: "booking.cancelled",
        bookingId: id,
        reference: booking.reference,
        passengerId: booking.userId,
        tripId: booking.tripId,
        refundAmount: refund.amount,
        corridor: `${booking.trip.route.origin} – ${booking.trip.route.destination}`,
        departureAt: booking.trip.departureAt,
      },
      { actorId: user.id, req },
    );

    return ok({ success: true, refund });
  });
}
