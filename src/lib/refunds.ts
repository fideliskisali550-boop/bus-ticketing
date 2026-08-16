import "server-only";
import { db } from "./db";
import { emit } from "./events";
import { badRequest, notFound } from "./errors";
import type { Scoped } from "./scope";

/**
 * Refunds, as money that actually moves.
 *
 * The refund amount used to be written to `Booking.refundAmount` and left
 * there. No payment row was ever created, nothing was ever marked settled, and
 * so cancelled value silently stayed in revenue — the reports said the company
 * had earned money it had agreed to give back.
 *
 * A refund is a transaction with a life: requested, reviewed, settled. It is
 * modelled that way here, and it is deliberately *not* something the person who
 * modifies bookings can approve on their own.
 */

/**
 * Above this, a human signs it off.
 *
 * Small refunds settle themselves because making a finance officer approve a
 * KES 400 return is how approval queues become rubber stamps. Large ones stop
 * and wait.
 */
export const APPROVAL_THRESHOLD_KES = 5_000;

/**
 * Opens a refund against a cancelled booking.
 *
 * Called from the cancellation paths rather than by a person, so that no route
 * to cancellation can forget to account for the money.
 */
export async function requestRefund({
  bookingId,
  amount,
  percent,
  reason,
  requestedById,
  /** Operator-side cancellations are not the passenger's fault and skip review. */
  autoApprove = false,
  req,
}: {
  bookingId: string;
  amount: number;
  percent: number;
  reason?: string;
  requestedById?: string | null;
  autoApprove?: boolean;
  req?: Request;
}) {
  if (amount <= 0) return null;

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      reference: true,
      userId: true,
      tripId: true,
      payments: {
        where: { status: "SUCCESS", kind: "CHARGE" },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!booking) throw notFound("That booking could not be found.");

  const needsApproval = !autoApprove && amount > APPROVAL_THRESHOLD_KES;

  const refund = await db.refund.create({
    data: {
      bookingId,
      paymentId: booking.payments[0]?.id ?? null,
      amount,
      percent,
      reason,
      requestedById: requestedById ?? null,
      status: needsApproval ? "REQUESTED" : "APPROVED",
      ...(needsApproval ? {} : { reviewedAt: new Date() }),
    },
  });

  await emit(
    {
      type: "refund.requested",
      refundId: refund.id,
      bookingId,
      reference: booking.reference,
      passengerId: booking.userId,
      tripId: booking.tripId,
      amount,
      needsApproval,
    },
    { actorId: requestedById, req },
  );

  // Anything not needing review is paid out immediately; there is nobody to
  // wait for.
  if (!needsApproval) await settleRefund(refund.id, req);

  return refund;
}

/**
 * Records the money going back.
 *
 * The settlement is a `Payment` of kind REFUND rather than a status change on
 * the original charge. Flipping the charge to REFUNDED — which is what the code
 * did before — erased the fact that money was ever collected, so a month's
 * takings would shrink retrospectively and never reconcile against M-Pesa.
 */
export async function settleRefund(refundId: string, req?: Request) {
  const refund = await db.refund.findUnique({
    where: { id: refundId },
    include: {
      booking: {
        select: { id: true, reference: true, userId: true, tripId: true },
      },
    },
  });
  if (!refund) throw notFound("That refund could not be found.");
  if (refund.status === "SETTLED") return refund;
  if (refund.status !== "APPROVED") {
    throw badRequest("A refund must be approved before it can be settled.");
  }

  await db.$transaction([
    db.payment.create({
      data: {
        bookingId: refund.bookingId,
        kind: "REFUND",
        status: "SUCCESS",
        // Stored negative so that summing the column gives net revenue without
        // every report having to remember to subtract.
        amount: -refund.amount,
        method: "MPESA",
        completedAt: new Date(),
        receiptNumber: `RF${refund.id.slice(-8).toUpperCase()}`,
      },
    }),
    db.refund.update({
      where: { id: refundId },
      data: { status: "SETTLED", settledAt: new Date() },
    }),
  ]);

  await emit(
    {
      type: "refund.settled",
      refundId,
      bookingId: refund.bookingId,
      reference: refund.booking.reference,
      passengerId: refund.booking.userId,
      tripId: refund.booking.tripId,
      amount: refund.amount,
    },
    { req },
  );

  return db.refund.findUnique({ where: { id: refundId } });
}

/** A finance officer's decision on a refund waiting for one. */
export async function reviewRefund({
  refundId,
  approve,
  note,
  reviewer,
  req,
}: {
  refundId: string;
  approve: boolean;
  note?: string;
  reviewer: Scoped;
  req?: Request;
}) {
  const refund = await db.refund.findUnique({ where: { id: refundId } });
  if (!refund) throw notFound("That refund could not be found.");
  if (refund.status !== "REQUESTED") {
    throw badRequest("That refund has already been decided.");
  }

  await db.refund.update({
    where: { id: refundId },
    data: {
      status: approve ? "APPROVED" : "REJECTED",
      reviewedById: reviewer.id,
      reviewedAt: new Date(),
      reviewNote: note,
    },
  });

  if (approve) return settleRefund(refundId, req);
  return db.refund.findUnique({ where: { id: refundId } });
}
