import { db } from "@/lib/db";
import { handler, ok, requireUser, notFound, forbidden, badRequest } from "@/lib/api";
import { mpesa } from "@/lib/mpesa";
import { issueTicket } from "@/lib/bookings";
import { audit } from "@/lib/audit";
import { emit } from "@/lib/events";

/**
 * Polled by the checkout page while the customer enters their M-Pesa PIN.
 *
 * This doubles as the settlement point: when the gateway reports success, the
 * booking is confirmed and the ticket issued inside one transaction. In a live
 * deployment Daraja would also POST a callback here; both paths are safe to run
 * because the transition is guarded on `status: "PENDING"` and is therefore
 * idempotent — a duplicate callback updates zero rows.
 */
export async function GET(req: Request) {
  return handler(async () => {
    const user = await requireUser();
    const checkoutRequestId = new URL(req.url).searchParams.get("checkoutRequestId");
    if (!checkoutRequestId) throw badRequest("Missing checkoutRequestId.");

    const payment = await db.payment.findUnique({
      where: { checkoutRequestId },
      include: { booking: { include: { trip: { include: { route: true } } } } },
    });

    if (!payment) throw notFound("Unknown payment.");
    if (payment.booking.userId !== user.id && user.role === "PASSENGER") throw forbidden();

    // Already settled — report the stored result rather than re-querying.
    if (payment.status === "SUCCESS" || payment.status === "FAILED") {
      return ok({
        status: payment.status,
        receiptNumber: payment.receiptNumber,
        failureReason: payment.failureReason,
        bookingId: payment.bookingId,
      });
    }

    const outcome = await mpesa.queryStatus(checkoutRequestId);
    if (!outcome) {
      return ok({ status: "PENDING", bookingId: payment.bookingId });
    }

    if (outcome.status === "FAILED") {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED", failureReason: outcome.reason, completedAt: new Date() },
      });

      // Failure used to be entirely silent: the passenger was left holding a
      // PENDING booking with no indication the payment had not gone through.
      await emit(
        {
          type: "payment.failed",
          paymentId: payment.id,
          bookingId: payment.bookingId,
          reference: payment.booking.reference,
          passengerId: payment.booking.userId,
          tripId: payment.booking.tripId,
          amount: payment.amount,
          reason: outcome.reason,
        },
        { actorId: user.id, req },
      );

      // The booking stays PENDING so the passenger can retry within the hold
      // window without losing the seats they picked.
      return ok({
        status: "FAILED",
        failureReason: outcome.reason,
        bookingId: payment.bookingId,
        holdsUntil: payment.booking.holdsUntil,
      });
    }

    await db.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "SUCCESS",
          receiptNumber: outcome.receiptNumber,
          completedAt: new Date(),
        },
      });

      await tx.booking.updateMany({
        // The status guard makes a repeated callback a no-op instead of a
        // double confirmation.
        where: { id: payment.bookingId, status: "PENDING" },
        data: { status: "CONFIRMED" },
      });
    });

    const ticket = await issueTicket(payment.bookingId);

    const { booking } = payment;

    await audit({
      userId: user.id,
      action: "PAYMENT_SUCCESS",
      entity: "Payment",
      entityId: payment.id,
      metadata: { receiptNumber: outcome.receiptNumber, amount: payment.amount },
      req,
    });

    // Confirmation is the moment the whole business cares about: the passenger
    // gets a ticket, staff see the sale, administrators see the revenue.
    await emit(
      {
        type: "booking.confirmed",
        bookingId: booking.id,
        reference: booking.reference,
        passengerId: booking.userId,
        tripId: booking.tripId,
        seatCount: await db.bookingSeat.count({ where: { bookingId: booking.id } }),
        amount: payment.amount,
        corridor: `${booking.trip.route.origin} – ${booking.trip.route.destination}`,
        departureAt: booking.trip.departureAt,
      },
      { actorId: user.id, req },
    );

    return ok({
      status: "SUCCESS",
      receiptNumber: outcome.receiptNumber,
      bookingId: payment.bookingId,
      ticketId: ticket.id,
    });
  });
}
