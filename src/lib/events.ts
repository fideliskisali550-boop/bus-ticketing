import "server-only";
import { audit } from "./audit";
import { notify } from "./notify";
import { publish } from "./stream";
import {
  staffOf,
  platformStaff,
  operatorOfTrip,
  recipients,
  isImminent,
  type Delivery,
  type Recipient,
} from "./recipients";

/**
 * The domain event bus.
 *
 * Before this existed, every route handler decided for itself what to record
 * and whom to tell. Audit coverage grew good that way — twenty-eight call sites
 * — but notifications did not: four call sites in the whole application, every
 * one of them addressed to a single passenger. A booking could be created,
 * paid, ticketed and issued a QR code without one operational user learning of
 * it, because no handler had been written to say so.
 *
 * That is a structural problem, not an oversight to be patched twenty times
 * over. Handlers now state what happened and nothing else; four subscribers
 * decide the consequences:
 *
 *   audit         — the immutable trail, for every event without exception
 *   notification  — role-routed, operator-scoped, volume-controlled
 *   stream        — live dashboard invalidation over SSE
 *
 * Adding a role means adding a routing rule here rather than editing every
 * handler that might concern it.
 */

export type DomainEvent =
  | { type: "user.registered"; userId: string; fullName: string }
  | {
      type: "booking.created";
      bookingId: string;
      reference: string;
      passengerId: string;
      tripId: string;
      seats: string[];
      amount: number;
      holdsUntil: Date;
      corridor: string;
      departureAt: Date;
    }
  | {
      type: "booking.confirmed";
      bookingId: string;
      reference: string;
      passengerId: string;
      tripId: string;
      seatCount: number;
      amount: number;
      corridor: string;
      departureAt: Date;
    }
  | {
      type: "booking.cancelled";
      bookingId: string;
      reference: string;
      passengerId: string;
      tripId: string;
      refundAmount: number;
      corridor: string;
      departureAt: Date;
    }
  | {
      type: "booking.expired";
      bookingId: string;
      reference: string;
      passengerId: string;
      tripId: string;
      seats: string[];
      corridor: string;
    }
  | {
      type: "payment.failed";
      paymentId: string;
      bookingId: string;
      reference: string;
      passengerId: string;
      tripId: string;
      amount: number;
      reason: string;
    }
  | {
      type: "refund.requested";
      refundId: string;
      bookingId: string;
      reference: string;
      passengerId: string;
      tripId: string;
      amount: number;
      /** Above this an officer must approve rather than it settling itself. */
      needsApproval: boolean;
    }
  | {
      type: "refund.settled";
      refundId: string;
      bookingId: string;
      reference: string;
      passengerId: string;
      tripId: string;
      amount: number;
    }
  | {
      type: "ticket.scanned";
      bookingId: string;
      reference: string;
      passengerId: string;
      tripId: string;
      passengerName: string;
      seatNumbers: string[];
    }
  | {
      type: "trip.crewed";
      tripId: string;
      corridor: string;
      departureAt: Date;
      driverId: string | null;
      conductorId: string | null;
    }
  | {
      type: "trip.cancelled";
      tripId: string;
      corridor: string;
      departureAt: Date;
      affected: number;
    }
  | {
      type: "trip.departed";
      tripId: string;
      corridor: string;
      departureAt: Date;
      actualDepartureAt: Date;
      /** Minutes behind schedule; negative is early. */
      delayMin: number;
      passengers: number;
    }
  | {
      type: "trip.arrived";
      tripId: string;
      corridor: string;
      actualArrivalAt: Date;
      delayMin: number;
      completed: number;
    }
  | {
      type: "operator.applied";
      operatorId: string;
      name: string;
    }
  | {
      type: "operator.approved";
      operatorId: string;
      name: string;
      ownerId: string;
    };

export type EventType = DomainEvent["type"];

/** Extra context a handler has but the event body should not carry. */
type EmitContext = {
  /** Who caused it. Absent for system-driven events like a hold expiring. */
  actorId?: string | null;
  req?: Request;
};

const KES = (amount: number) => `Ksh ${amount.toLocaleString("en-KE")}`;
const hhmm = (d: Date) => d.toISOString().slice(11, 16);

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

const ENTITY: Record<EventType, string> = {
  "user.registered": "User",
  "booking.created": "Booking",
  "booking.confirmed": "Booking",
  "booking.cancelled": "Booking",
  "booking.expired": "Booking",
  "payment.failed": "Payment",
  "refund.requested": "Refund",
  "refund.settled": "Refund",
  "ticket.scanned": "Booking",
  "trip.crewed": "Trip",
  "trip.cancelled": "Trip",
  "trip.departed": "Trip",
  "trip.arrived": "Trip",
  "operator.applied": "Operator",
  "operator.approved": "Operator",
};

/** The row the event is *about*, which is not always the one it names first. */
function subjectOf(event: DomainEvent): string | null {
  switch (event.type) {
    case "user.registered":
      return event.userId;
    case "payment.failed":
      return event.paymentId;
    case "refund.requested":
    case "refund.settled":
      return event.refundId;
    case "operator.applied":
    case "operator.approved":
      return event.operatorId;
    case "trip.crewed":
    case "trip.cancelled":
    case "trip.departed":
    case "trip.arrived":
      return event.tripId;
    default:
      return event.bookingId;
  }
}

async function auditSubscriber(
  event: DomainEvent,
  ctx: EmitContext,
  operatorId: string | null,
) {
  const { type, ...payload } = event;
  await audit({
    userId: ctx.actorId ?? null,
    action: type.toUpperCase().replace(/\./g, "_"),
    entity: ENTITY[type],
    entityId: subjectOf(event),
    operatorId,
    metadata: payload,
    req: ctx.req,
  });
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
/* -------------------------------------------------------------------------- */

type Message = {
  title: string;
  body: string;
  link?: string;
  category: string;
  groupKey?: string;
};

/** Delivers one message to a list of recipients at their assigned volume. */
async function deliver(list: Recipient[], message: Message) {
  await Promise.all(
    list.map(({ userId, delivery }) =>
      notify({
        userId,
        ...message,
        // DIGEST still writes the row — the bell shows it — but never rings a
        // phone. Aggregation happens on read, in the digest query.
        alsoEmail: delivery === "PUSH",
        alsoSms: delivery === "PUSH",
        groupKey: delivery === "DIGEST" ? (message.groupKey ?? message.category) : undefined,
      }),
    ),
  );
}

const to = (userIds: string[], delivery: Delivery) => ({ userIds, delivery });
const one = (userId: string | null | undefined, delivery: Delivery) =>
  ({ userIds: userId ? [userId] : [], delivery });

/**
 * Sends a passenger their own receipt.
 *
 * Deliberately bypasses the "never notify the actor of their own action" rule.
 * That rule is about awareness traffic — a clerk does not need telling that the
 * booking they just cancelled is cancelled. A receipt is different: the
 * passenger who just paid is exactly the person who must be sent the ticket,
 * and suppressing it because they caused it silently removed every
 * confirmation the system sends.
 */
const receipt = (userId: string, message: Message) =>
  deliver([{ userId, delivery: "PUSH" as const }], message);

async function notificationSubscriber(
  event: DomainEvent,
  ctx: EmitContext,
  operatorId: string | null,
) {
  const actor = ctx.actorId;

  switch (event.type) {
    case "user.registered": {
      await receipt(event.userId, {
        title: "Welcome to SafiriConnect",
        body: "Your account is ready. Search a route and book your first trip.",
        link: "/search",
        category: "account",
      });
      // Platform growth is a trend, not an interruption.
      await deliver(
        recipients([to(await platformStaff(["SUPER_ADMIN"]), "DIGEST")], actor),
        {
          title: "New passenger registered",
          body: `${event.fullName} created an account.`,
          link: "/admin/users",
          category: "account",
          groupKey: `registrations:${new Date().toISOString().slice(0, 10)}`,
        },
      );
      break;
    }

    case "booking.created": {
      const minutes = Math.max(
        1,
        Math.round((event.holdsUntil.getTime() - Date.now()) / 60_000),
      );
      // The passenger used to hear nothing until payment succeeded, so a hold
      // that lapsed unpaid was silent at both ends.
      await receipt(event.passengerId, {
        title: `Seats held — pay within ${minutes} minutes`,
        body: `${event.seats.length} seat${event.seats.length === 1 ? "" : "s"} on ${event.corridor} are held under ${event.reference}. The hold lapses at ${hhmm(event.holdsUntil)}.`,
        link: `/checkout/${event.bookingId}`,
        category: "booking",
      });
      // Staff get a dashboard counter, not five hundred messages a day.
      break;
    }

    case "booking.confirmed": {
      await receipt(event.passengerId, {
        title: "Payment received — your ticket is ready",
        body: `Booking ${event.reference} for ${event.corridor} is confirmed. Show the QR code on your ticket when boarding.`,
        link: `/bookings/${event.bookingId}`,
        category: "booking",
      });

      const day = event.departureAt.toISOString().slice(0, 10);
      await deliver(
        recipients(
          [
            to(await staffOf(operatorId, ["COMPANY_ADMIN", "FINANCE_OFFICER"]), "DIGEST"),
            // The conductor is only told once the bus is nearly loading; before
            // that the manifest they open will be current anyway.
            isImminent(event.departureAt)
              ? to(await conductorOf(event.tripId), "IN_APP")
              : to([], "DASHBOARD"),
          ],
          actor,
        ),
        {
          title: "Booking confirmed",
          body: `${event.reference} · ${event.corridor} · ${event.seatCount} seat(s) · ${KES(event.amount)}.`,
          link: "/admin/bookings",
          category: "booking",
          groupKey: `sales:${day}`,
        },
      );
      break;
    }

    case "booking.expired": {
      await receipt(event.passengerId, {
        title: "Your seat hold has lapsed",
        body: `${event.reference} on ${event.corridor} was not paid in time, so the seats have gone back on sale. You can book again.`,
        link: "/search",
        category: "booking",
      });
      break;
    }

    case "booking.cancelled": {
      const refund =
        event.refundAmount > 0 ? ` A refund of ${KES(event.refundAmount)} is due.` : "";
      await receipt(event.passengerId, {
        title: "Booking cancelled",
        body: `${event.reference} on ${event.corridor} has been cancelled.${refund}`,
        link: `/bookings/${event.bookingId}`,
        category: "booking",
      });

      // Close to departure this stops being bookkeeping and starts being
      // something the gate and the bus need to know.
      if (isImminent(event.departureAt)) {
        await deliver(
          recipients(
            [
              to(await staffOf(operatorId, ["BOOKING_STAFF"]), "IN_APP"),
              to(await conductorOf(event.tripId), "IN_APP"),
            ],
            actor,
          ),
          {
            title: "Cancellation on a departure boarding soon",
            body: `${event.reference} · ${event.corridor} · departs ${hhmm(event.departureAt)}.`,
            link: "/admin/bookings",
            category: "booking",
          },
        );
      }
      break;
    }

    case "payment.failed": {
      await receipt(event.passengerId, {
        title: "Payment did not go through",
        body: `${event.reason} Your seats are still held for a short while — try again from your booking.`,
        link: `/checkout/${event.bookingId}`,
        category: "payment",
      });
      await deliver(
        recipients([to(await staffOf(operatorId, ["FINANCE_OFFICER"]), "DIGEST")], actor),
        {
          title: "Payment failed",
          body: `${event.reference} · ${KES(event.amount)} · ${event.reason}`,
          link: "/admin/bookings",
          category: "payment",
          groupKey: `failures:${new Date().toISOString().slice(0, 10)}`,
        },
      );
      break;
    }

    case "refund.requested": {
      await deliver(
        recipients(
          [
            to(
              await staffOf(operatorId, ["FINANCE_OFFICER", "COMPANY_ADMIN"]),
              event.needsApproval ? "PUSH" : "DIGEST",
            ),
          ],
          actor,
        ),
        {
          title: event.needsApproval ? "Refund needs approval" : "Refund requested",
          body: `${event.reference} · ${KES(event.amount)}.`,
          link: "/admin/refunds",
          category: "refund",
          groupKey: `refunds:${new Date().toISOString().slice(0, 10)}`,
        },
      );
      break;
    }

    case "refund.settled": {
      await receipt(event.passengerId, {
        title: "Refund on its way",
        body: `${KES(event.amount)} for ${event.reference} has been released and should reach your M-Pesa within three working days.`,
        link: `/bookings/${event.bookingId}`,
        category: "refund",
      });
      break;
    }

    case "ticket.scanned":
      // Boarding is a live count on the manifest. Nobody needs telling.
      break;

    case "trip.crewed": {
      await deliver(
        recipients(
          [one(event.driverId, "PUSH"), one(event.conductorId, "PUSH")],
          actor,
        ),
        {
          title: "You are rostered on a departure",
          body: `${event.corridor} · ${event.departureAt.toISOString().slice(0, 10)} at ${hhmm(event.departureAt)}.`,
          link: "/crew",
          category: "roster",
        },
      );
      break;
    }

    case "trip.cancelled": {
      // Passengers are messaged individually by the handler, because each
      // message names their own booking and refund.
      await deliver(
        recipients(
          [
            to(
              await staffOf(operatorId, ["COMPANY_ADMIN", "ROUTE_MANAGER", "BOOKING_STAFF"]),
              "PUSH",
            ),
            to(await crewOf(event.tripId), "PUSH"),
            to(await platformStaff(["PLATFORM_SUPPORT"]), "IN_APP"),
          ],
          actor,
        ),
        {
          title: "Departure cancelled",
          body: `${event.corridor} on ${event.departureAt.toISOString().slice(0, 10)} · ${event.affected} booking(s) affected.`,
          link: "/admin/trips",
          category: "trip",
        },
      );
      break;
    }

    case "trip.departed": {
      // Only lateness is worth a message; on time is a dashboard tick.
      if (event.delayMin >= 15) {
        await deliver(
          recipients([to(await staffOf(operatorId, ["ROUTE_MANAGER"]), "IN_APP")], actor),
          {
            title: `Departure ${event.delayMin} min late`,
            body: `${event.corridor} left at ${hhmm(event.actualDepartureAt)} with ${event.passengers} passenger(s).`,
            link: "/admin/trips",
            category: "trip",
          },
        );
      }
      break;
    }

    case "trip.arrived":
      break;

    case "operator.applied": {
      await deliver(
        recipients([to(await platformStaff(["SUPER_ADMIN"]), "PUSH")], actor),
        {
          title: "Transport company applied",
          body: `${event.name} has applied to sell on the platform.`,
          link: "/admin/operators",
          category: "operator",
        },
      );
      break;
    }

    case "operator.approved": {
      await receipt(event.ownerId, {
        title: "Your company has been approved",
        body: `${event.name} can now add buses, publish a timetable and start selling.`,
        link: "/admin",
        category: "operator",
      });
      break;
    }
  }
}

/** The conductor rostered on a trip, if any. */
async function conductorOf(tripId: string): Promise<string[]> {
  const { db } = await import("./db");
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    select: { conductorId: true },
  });
  return trip?.conductorId ? [trip.conductorId] : [];
}

/** Driver and conductor rostered on a trip. */
async function crewOf(tripId: string): Promise<string[]> {
  const { db } = await import("./db");
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    select: { driverId: true, conductorId: true },
  });
  return [trip?.driverId, trip?.conductorId].filter((x): x is string => Boolean(x));
}

/* -------------------------------------------------------------------------- */
/* The bus                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Which company an event concerns, so notifications and the live stream reach
 * that company and no other.
 */
async function operatorFor(event: DomainEvent): Promise<string | null> {
  if ("tripId" in event) return operatorOfTrip(event.tripId);
  if ("operatorId" in event) return event.operatorId;
  return null;
}

/**
 * Publishes a domain event.
 *
 * Never throws and never rejects. A notification that fails to send must not
 * roll back the booking that caused it — the passenger has paid, and losing
 * their seat because an email bounced would be indefensible. Failures are
 * logged for an operator to notice.
 *
 * Awaited rather than fired and forgotten: on serverless the process can be
 * frozen the moment the response is returned, and a detached promise is simply
 * lost. The work is a handful of indexed writes.
 */
export async function emit(event: DomainEvent, ctx: EmitContext = {}) {
  let operatorId: string | null = null;
  try {
    operatorId = await operatorFor(event);
  } catch (error) {
    console.error(`[events] could not resolve operator for ${event.type}`, error);
  }

  const results = await Promise.allSettled([
    auditSubscriber(event, ctx, operatorId),
    notificationSubscriber(event, ctx, operatorId),
    publish(event.type, operatorId, subjectOf(event)),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      console.error(`[events] subscriber failed for ${event.type}`, result.reason);
    }
  }
}
