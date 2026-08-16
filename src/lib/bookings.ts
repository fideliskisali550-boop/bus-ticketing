import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { conflict, badRequest, notFound } from "./api";
import { bookingReference, isBookable, HOLD_MINUTES, seatLabels } from "./policy";
import { ticketVerificationCode } from "./verification";
import { randomBytes } from "crypto";

export type SeatRequest = {
  seatNumber: string;
  passengerName: string;
  passengerPhone: string;
  passengerIdNo?: string;
};

/**
 * Creates a PENDING booking that holds the requested seats.
 *
 * Double-booking is the failure the SRS calls out by name, so it is prevented
 * structurally rather than by checking-then-writing: BookingSeat carries a
 * unique constraint on (tripId, seatNumber), and the whole insert runs in one
 * transaction. Two people who tap the same seat in the same millisecond both
 * reach the INSERT; the database lets exactly one through and the other gets
 * P2002, which we translate into a friendly 409. There is no window in which
 * both succeed.
 */
export async function createBooking(
  userId: string,
  tripId: string,
  seats: SeatRequest[],
) {
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    include: { bus: true, route: true },
  });

  if (!trip) throw notFound("That trip no longer exists.");

  if (!isBookable(trip.departureAt, trip.status)) {
    throw badRequest(
      "Booking for this trip has closed. Please choose a later departure.",
    );
  }

  // Reject labels the bus does not physically have before touching the database.
  const valid = new Set(seatLabels(trip.bus.capacity, trip.bus.seatsPerRow));
  const unknown = seats.filter((s) => !valid.has(s.seatNumber));
  if (unknown.length) {
    throw badRequest(
      `This bus has no seat ${unknown.map((s) => s.seatNumber).join(", ")}.`,
    );
  }

  const totalAmount = trip.fare * seats.length;
  const holdsUntil = new Date(Date.now() + HOLD_MINUTES * 60_000);

  // Two different unique constraints can fire here, and they mean opposite
  // things. A clash on (tripId, seatNumber) is a genuine seat conflict the
  // passenger must resolve. A clash on `reference` is our own random string
  // happening to repeat — invisible to the user, and fixed by drawing again.
  // Reporting the second as "that seat was taken" would be simply wrong, so
  // they are handled separately and the reference collision is retried.
  const MAX_REFERENCE_ATTEMPTS = 5;

  for (let attempt = 1; ; attempt++) {
    try {
      return await insert();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const target = (error.meta?.target ?? []) as string[] | string;
        const fields = Array.isArray(target) ? target : [target];

        if (fields.includes("reference") && attempt < MAX_REFERENCE_ATTEMPTS) {
          continue;
        }

        if (fields.includes("seatNumber") || fields.includes("tripId")) {
          throw conflict(
            "One of those seats was just taken by another passenger. Please pick a different seat.",
            { seats: seats.map((s) => s.seatNumber) },
          );
        }
      }
      throw error;
    }
  }

  async function insert() {
    return db.$transaction(async (tx) => {
      // Reclaim any lapsed holds on this trip first, so seats abandoned by a
      // user who closed the tab become bookable again immediately.
      await releaseExpired(tx, tripId);

      const booking = await tx.booking.create({
        data: {
          reference: bookingReference(),
          userId,
          tripId,
          totalAmount,
          holdsUntil,
          seats: {
            create: seats.map((s) => ({
              tripId,
              seatNumber: s.seatNumber,
              passengerName: s.passengerName,
              passengerPhone: s.passengerPhone,
              passengerIdNo: s.passengerIdNo || null,
            })),
          },
        },
        include: { seats: true, trip: { include: { route: true, bus: true } } },
      });

      await tx.trip.update({
        where: { id: tripId },
        data: { seatsBooked: { increment: seats.length } },
      });

      return booking;
    });
  }
}

/** A hold that lapsed, with enough detail to tell the passenger it happened. */
export type ExpiredHold = {
  id: string;
  reference: string;
  userId: string;
  tripId: string;
  seats: string[];
  corridor: string;
};

/**
 * Expires PENDING bookings whose hold has lapsed and returns their seats.
 * Called opportunistically before any read or write that depends on accurate
 * availability, which keeps the system correct without a background worker —
 * important because serverless deployments have nowhere to run a cron loop.
 *
 * Returns what it expired rather than a count, so the caller can announce it.
 * The announcement deliberately does not happen here: this runs inside a
 * transaction at two of its call sites, and emitting from inside one would fire
 * notifications for work that might still be rolled back.
 */
export async function releaseExpired(
  tx: Prisma.TransactionClient | typeof db = db,
  tripId?: string,
) {
  const stale = await tx.booking.findMany({
    where: {
      status: "PENDING",
      holdsUntil: { lt: new Date() },
      ...(tripId ? { tripId } : {}),
    },
    select: {
      id: true,
      tripId: true,
      reference: true,
      userId: true,
      seats: { select: { seatNumber: true } },
      trip: { select: { route: { select: { origin: true, destination: true } } } },
    },
  });

  if (!stale.length) return [];

  await tx.booking.updateMany({
    where: { id: { in: stale.map((b) => b.id) } },
    data: { status: "EXPIRED" },
  });

  // Freeing the seat rows is what actually makes the seats selectable again;
  // the unique constraint is on BookingSeat, not on Booking.
  await tx.bookingSeat.deleteMany({
    where: { bookingId: { in: stale.map((b) => b.id) } },
  });

  // Decrement each trip's counter by the seats that trip actually lost.
  const perTrip = new Map<string, number>();
  for (const b of stale) {
    perTrip.set(b.tripId, (perTrip.get(b.tripId) ?? 0) + b.seats.length);
  }
  for (const [id, count] of perTrip) {
    await tx.trip.update({
      where: { id },
      data: { seatsBooked: { decrement: count } },
    });
  }

  return stale.map(
    (b): ExpiredHold => ({
      id: b.id,
      reference: b.reference,
      userId: b.userId,
      tripId: b.tripId,
      seats: b.seats.map((s) => s.seatNumber),
      corridor: `${b.trip.route.origin} – ${b.trip.route.destination}`,
    }),
  );
}

/** Seat labels currently unavailable on a trip, after reclaiming lapsed holds. */
export async function takenSeats(tripId: string) {
  await releaseExpired(db, tripId);
  const rows = await db.bookingSeat.findMany({
    where: { tripId },
    select: { seatNumber: true },
  });
  return rows.map((r) => r.seatNumber);
}

/** Issues the boarding pass once payment has cleared. */
export async function issueTicket(bookingId: string) {
  const existing = await db.ticket.findUnique({ where: { bookingId } });
  if (existing) return existing;

  // The verification code is unique; a collision over a billion values is
  // vanishingly unlikely but not impossible, so a few retries turn it from a
  // failed booking into a non-event. The QR token's space is large enough that
  // it is not worth the same treatment.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.ticket.create({
        data: {
          bookingId,
          qrToken: randomBytes(24).toString("base64url"),
          verificationCode: ticketVerificationCode(),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error) && attempt < 4) continue;
      throw error;
    }
  }
  // Unreachable: the loop either returns or throws.
  throw new Error("Could not issue a ticket.");
}

/** Prisma's unique-constraint error, without importing the whole error namespace. */
function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && (error as { code: string }).code === "P2002",
  );
}
