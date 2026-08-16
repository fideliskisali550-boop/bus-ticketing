import { db } from "@/lib/db";
import { handler, ok, requireCapability } from "@/lib/api";
import { bookingScope, paymentScope, tripScope, operatorScope } from "@/lib/scope";
import { KENYA_UTC_OFFSET_HOURS } from "@/lib/time";

/**
 * The booking clerk's dashboard, in one payload.
 *
 * A clerk works a shift at a counter: how many tickets have I sold today, how
 * much money has come in, how many passengers are still to board a departure
 * that is about to leave, and what have I just sold. None of that is analytics —
 * the clerk has no `VIEW_ANALYTICS` and must not see company-wide revenue trends
 * — so it is computed here, scoped to their own company, rather than borrowed
 * from the operations overview. That overview requiring a capability the clerk
 * lacks is exactly why landing them on it showed a page that never loaded.
 *
 * Every figure is restricted to the caller's operator through the same scope
 * helpers the rest of the back office uses, so a clerk at one company can never
 * see another's counter.
 */
export async function GET(req: Request) {
  return handler(async () => {
    const user = await requireCapability("SELL_TICKETS", req);

    // "Today" is the Kenyan calendar day, not the server's. Take the UTC instant
    // of local midnight so the window lines up with how a clerk thinks about a
    // shift, wherever the process happens to run.
    const now = new Date();
    const offsetMs = KENYA_UTC_OFFSET_HOURS * 3_600_000;
    const kenyaNow = new Date(now.getTime() + offsetMs);
    const startOfToday = new Date(
      Date.UTC(kenyaNow.getUTCFullYear(), kenyaNow.getUTCMonth(), kenyaNow.getUTCDate()) - offsetMs,
    );
    const endOfToday = new Date(startOfToday.getTime() + 86_400_000);

    const bScope = bookingScope(user);
    const pScope = paymentScope(user);
    const tScope = tripScope(user);
    const scope = operatorScope(user);

    const [
      todayBookings,
      todaySeats,
      todayRevenueAgg,
      verifiedToday,
      boardedToday,
      waitingVerification,
      invalidAttempts,
      upcomingDepartures,
      recentBookings,
    ] = await Promise.all([
      // Tickets sold today, by anyone at this company.
      db.booking.count({
        where: { ...bScope, createdAt: { gte: startOfToday, lt: endOfToday } },
      }),
      // Seats sold today — a booking can carry several.
      db.bookingSeat.count({
        where: { booking: { ...bScope, createdAt: { gte: startOfToday, lt: endOfToday } } },
      }),
      // Money actually collected today.
      db.payment.aggregate({
        _sum: { amount: true },
        where: {
          ...pScope,
          status: "SUCCESS",
          kind: "CHARGE",
          createdAt: { gte: startOfToday, lt: endOfToday },
        },
      }),
      // Tickets verified today (the verify step, distinct from boarding).
      db.ticket.count({
        where: { verifiedAt: { gte: startOfToday, lt: endOfToday }, booking: bScope },
      }),
      // Passengers boarded today.
      db.ticket.count({
        where: { checkedInAt: { gte: startOfToday, lt: endOfToday }, booking: bScope },
      }),
      // On today's departures, tickets not yet verified — the queue at the gate.
      // Scope rides on the trip filter so this stays within the company.
      db.ticket.count({
        where: {
          verifiedAt: null,
          booking: {
            status: "CONFIRMED",
            trip: { ...tScope, departureAt: { gte: startOfToday, lt: endOfToday } },
          },
        },
      }),
      // Invalid verification attempts recorded today — the rejections logged at
      // the desk. Scoped by operator on the audit row.
      db.auditLog.count({
        where: {
          action: "VERIFY_REJECTED",
          createdAt: { gte: startOfToday, lt: endOfToday },
          ...(scope ? { operatorId: scope } : {}),
        },
      }),
      // Departures still to leave today, most imminent first.
      db.trip.findMany({
        where: {
          ...tScope,
          departureAt: { gte: now, lt: endOfToday },
          status: { in: ["SCHEDULED", "BOARDING"] },
        },
        orderBy: { departureAt: "asc" },
        take: 6,
        select: {
          id: true,
          departureAt: true,
          status: true,
          seatsBooked: true,
          route: { select: { origin: true, destination: true } },
          bus: { select: { registration: true, capacity: true } },
        },
      }),
      // The clerk's own recent sales, newest first.
      db.booking.findMany({
        where: bScope,
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          reference: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          channel: true,
          user: { select: { fullName: true } },
          _count: { select: { seats: true } },
          trip: { select: { route: { select: { origin: true, destination: true } } } },
        },
      }),
    ]);

    return ok({
      today: {
        bookings: todayBookings,
        seats: todaySeats,
        revenue: todayRevenueAgg._sum.amount ?? 0,
        verified: verifiedToday,
        boarded: boardedToday,
        waiting: waitingVerification,
        invalidAttempts,
      },
      upcomingDepartures: upcomingDepartures.map((t) => ({
        id: t.id,
        departureAt: t.departureAt,
        status: t.status,
        route: `${t.route.origin} – ${t.route.destination}`,
        seatsBooked: t.seatsBooked,
        capacity: t.bus.capacity,
        bus: t.bus.registration,
      })),
      recentBookings: recentBookings.map((b) => ({
        id: b.id,
        reference: b.reference,
        passenger: b.user.fullName,
        route: `${b.trip.route.origin} – ${b.trip.route.destination}`,
        seats: b._count.seats,
        amount: b.totalAmount,
        status: b.status,
        channel: b.channel,
        createdAt: b.createdAt,
      })),
    });
  });
}
