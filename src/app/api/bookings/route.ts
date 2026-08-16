import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { handler, ok, parseBody, requireUser, limit } from "@/lib/api";
import { createBookingSchema } from "@/lib/validation";
import { createBooking, releaseExpired, type ExpiredHold } from "@/lib/bookings";
import { audit } from "@/lib/audit";
import { emit } from "@/lib/events";
import { bookingScope, can } from "@/lib/scope";

/** The caller's bookings, or all bookings when staff pass ?scope=all. */
export async function GET(req: Request) {
  return handler(async () => {
    const user = await requireUser();
    const q = new URL(req.url).searchParams;

    // "All bookings" means all the bookings this user is entitled to, which is
    // their own company's — not the platform's. Before operator scoping existed
    // this returned every booking on the system to any staff account.
    const mayListOthers =
      can(user.role, "VIEW_ANY_BOOKING") || can(user.role, "CANCEL_ANY_BOOKING");
    const scopeAll = q.get("scope") === "all" && mayListOthers;

    const status = q.get("status");
    const search = q.get("search")?.trim();
    const page = Math.max(1, Number(q.get("page") ?? "1"));
    const perPage = Math.min(100, Math.max(1, Number(q.get("perPage") ?? "10")));

    await announceExpired(await releaseExpired(), req);

    const where: Prisma.BookingWhereInput = {
      // Non-staff are pinned to their own rows here. This is the authorisation
      // boundary for the whole endpoint — there is no code path that widens it.
      ...(scopeAll ? bookingScope(user) : { userId: user.id }),
      ...(status && status !== "ALL"
        ? { status: status as Prisma.EnumBookingStatusFilter["equals"] }
        : {}),
      ...(search
        ? {
            OR: [
              { reference: { contains: search.toUpperCase() } },
              { user: { fullName: { contains: search } } },
              { user: { email: { contains: search.toLowerCase() } } },
              { seats: { some: { passengerName: { contains: search } } } },
            ],
          }
        : {}),
    };

    const [bookings, total] = await Promise.all([
      db.booking.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          seats: { select: { seatNumber: true, passengerName: true } },
          trip: { include: { route: true, bus: { select: { registration: true } } } },
          payments: { orderBy: { createdAt: "desc" }, take: 1 },
          ticket: { select: { id: true, checkedInAt: true, verificationCode: true } },
          ...(scopeAll
            ? { user: { select: { fullName: true, email: true, phone: true } } }
            : {}),
        },
      }),
      db.booking.count({ where }),
    ]);

    return ok({ bookings, total, page, perPage, pages: Math.ceil(total / perPage) });
  });
}

/** Reserves seats and opens a 15-minute payment window. */
export async function POST(req: Request) {
  return handler(async () => {
    const user = await requireUser();

    // Caps automated seat-hoarding: a script cannot hold the whole bus by
    // firing off booking after booking.
    limit(`booking:${user.id}`, 10, 10 * 60_000);

    const { tripId, seats } = await parseBody(req, createBookingSchema);
    const booking = await createBooking(user.id, tripId, seats);

    // One event, and the bus decides the rest: the passenger learns their hold
    // is ticking, booking staff learn a sale is pending, and the audit trail
    // records it. None of that used to happen beyond the audit line.
    await emit(
      {
        type: "booking.created",
        bookingId: booking.id,
        reference: booking.reference,
        passengerId: user.id,
        tripId,
        seats: seats.map((s) => s.seatNumber),
        amount: booking.totalAmount,
        holdsUntil: booking.holdsUntil,
        corridor: `${booking.trip.route.origin} – ${booking.trip.route.destination}`,
        departureAt: booking.trip.departureAt,
      },
      { actorId: user.id, req },
    );

    return ok({ booking }, 201);
  });
}

/**
 * Announces holds the opportunistic sweep just reclaimed.
 *
 * The passenger who lost the seats used to hear nothing at all, and staff never
 * learned the seats were back on sale.
 */
async function announceExpired(expired: ExpiredHold[], req: Request) {
  for (const hold of expired) {
    await emit(
      {
        type: "booking.expired",
        bookingId: hold.id,
        reference: hold.reference,
        passengerId: hold.userId,
        tripId: hold.tripId,
        seats: hold.seats,
        corridor: hold.corridor,
      },
      // No actor: the clock did this, not a person.
      { req },
    );
  }
}
