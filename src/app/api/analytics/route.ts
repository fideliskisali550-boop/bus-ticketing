import { db } from "@/lib/db";
import { handler, ok, requireCapability } from "@/lib/api";
import { operatorScope } from "@/lib/scope";
import { subDays, startOfDay } from "date-fns";
import { toKenyaDateInput, formatDayLabel, KENYA_UTC_OFFSET_HOURS } from "@/lib/time";

/**
 * Aggregates for the operations dashboard.
 *
 * Every figure here is computed by the database. An earlier version pulled the
 * window's payments into memory to bucket them by day, and grouped bookings by
 * trip before re-querying those trips by id — which took several seconds once
 * the dataset reached a realistic size, because the id list ran to thousands of
 * entries. Aggregation is what a database is for; the same work in SQL takes
 * tens of milliseconds.
 *
 * These raw queries are the one place in the codebase that is not
 * provider-agnostic. The only dialect-specific part is the expression turning a
 * stored timestamp into a Kenyan calendar day, isolated in `kenyanDayExpr` with
 * the PostgreSQL equivalent noted alongside.
 */

/**
 * SQLite stores Prisma `DateTime` as integer milliseconds. Dividing to seconds
 * and shifting by the Kenyan offset buckets each row into the day it actually
 * happened in Nairobi, rather than the server's day.
 *
 * PostgreSQL equivalent:
 *   to_char("createdAt" AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD')
 */
const kenyanDayExpr = (column: string) =>
  `date(${column} / 1000, 'unixepoch', '+${KENYA_UTC_OFFSET_HOURS} hours')`;

/** SQLite SUM/COUNT come back as BigInt, which JSON cannot serialise. */
const num = (value: unknown) => (value == null ? 0 : Number(value));

/**
 * Dashboards tolerate a little staleness far better than a five-second wait.
 * Results are cached briefly per reporting window, so flipping between 7, 30
 * and 90 days feels instant after the first look.
 */
const cache = new Map<string, { at: number; payload: Record<string, unknown> }>();
const CACHE_TTL_MS = 20_000;

export async function GET(req: Request) {
  return handler(async () => {
    const user = await requireCapability("VIEW_ANALYTICS", req);

    const days = Math.min(
      90,
      Math.max(7, Number(new URL(req.url).searchParams.get("days") ?? "30")),
    );

    // Every figure below is restricted to the caller's own company. This
    // endpoint used to return whole-platform revenue to any staff account,
    // which on a fifteen-operator marketplace meant each company could read
    // every competitor's takings.
    const scope = operatorScope(user);

    // A join to the owning operator, expressed once. Raw SQL is used here for
    // speed -- this endpoint went from 17s to 10ms on it -- so the scoping has
    // to be spliced into the SQL rather than added to a Prisma `where`.
    const paymentJoin = scope
      ? `JOIN Booking b2 ON b2.id = Payment.bookingId
         JOIN Trip   t2 ON t2.id = b2.tripId
         JOIN Bus    x2 ON x2.id = t2.busId`
      : "";
    const paymentWhere = scope ? `AND x2.operatorId = ?` : "";
    const bookingWhere = scope ? `AND bus.operatorId = ?` : "";
    const scopeArg = scope ? [scope] : [];

    const bookingWhereScope = scope ? { trip: { bus: { operatorId: scope } } } : {};
    const tripWhereScope = scope ? { bus: { operatorId: scope } } : {};

    const cacheKey = `analytics:${days}:${scope ?? "platform"}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return ok(hit.payload);

    const now = new Date();
    const since = startOfDay(subDays(now, days));
    const priorStart = subDays(since, days);

    const sinceMs = since.getTime();
    const priorMs = priorStart.getTime();
    const nowMs = now.getTime();

    const [
      totals,
      priorTotals,
      seriesRows,
      routeRows,
      statusRows,
      methodRows,
      occupancyRows,
      firstPaymentRows,
      counts,
      recentBookings,
    ] = await Promise.all([
      db.$queryRawUnsafe<{ revenue: unknown }[]>(
        `SELECT SUM(Payment.amount) AS revenue FROM Payment
         ${paymentJoin}
          WHERE Payment.status = 'SUCCESS' AND Payment.createdAt >= ? ${paymentWhere}`,
        sinceMs,
        ...scopeArg,
      ),
      db.$queryRawUnsafe<{ revenue: unknown }[]>(
        `SELECT SUM(Payment.amount) AS revenue FROM Payment
         ${paymentJoin}
          WHERE Payment.status = 'SUCCESS'
            AND Payment.createdAt >= ? AND Payment.createdAt < ? ${paymentWhere}`,
        priorMs,
        sinceMs,
        ...scopeArg,
      ),

      // Daily revenue, grouped by Kenyan calendar day in the database.
      db.$queryRawUnsafe<{ day: string; revenue: unknown; bookings: unknown }[]>(
        `SELECT ${kenyanDayExpr("Payment.createdAt")} AS day,
                SUM(Payment.amount) AS revenue, COUNT(*) AS bookings
           FROM Payment
         ${paymentJoin}
          WHERE Payment.status = 'SUCCESS' AND Payment.createdAt >= ? ${paymentWhere}
          GROUP BY day ORDER BY day`,
        sinceMs,
        ...scopeArg,
      ),

      // Revenue by route: one indexed join, replacing a group-by-trip followed
      // by a findMany with thousands of ids in an IN clause.
      db.$queryRawUnsafe<{ route: string; revenue: unknown; bookings: unknown }[]>(
        `SELECT r.origin || ' – ' || r.destination AS route,
                SUM(b.totalAmount) AS revenue, COUNT(*) AS bookings
           FROM Booking b
           JOIN Trip t  ON t.id = b.tripId
           JOIN Route r ON r.id = t.routeId
           JOIN Bus bus ON bus.id = t.busId
          WHERE b.status IN ('CONFIRMED','CHECKED_IN','COMPLETED')
            AND b.createdAt >= ? ${bookingWhere}
          GROUP BY r.id
          ORDER BY revenue DESC
          LIMIT 6`,
        sinceMs,
        ...scopeArg,
      ),

      db.$queryRawUnsafe<{ status: string; count: unknown }[]>(
        `SELECT b.status AS status, COUNT(*) AS count FROM Booking b
           JOIN Trip t  ON t.id = b.tripId
           JOIN Bus bus ON bus.id = t.busId
          WHERE b.createdAt >= ? ${bookingWhere} GROUP BY b.status`,
        sinceMs,
        ...scopeArg,
      ),

      db.$queryRawUnsafe<{ method: string; count: unknown; amount: unknown }[]>(
        `SELECT Payment.method AS method, COUNT(*) AS count, SUM(Payment.amount) AS amount
           FROM Payment
         ${paymentJoin}
          WHERE Payment.status = 'SUCCESS' AND Payment.createdAt >= ? ${paymentWhere}
          GROUP BY Payment.method`,
        sinceMs,
        ...scopeArg,
      ),

      // Fleet utilisation across departures that have already run.
      db.$queryRawUnsafe<{ seats: unknown; filled: unknown }[]>(
        `SELECT SUM(bs.capacity) AS seats, SUM(t.seatsBooked) AS filled
           FROM Trip t JOIN Bus bs ON bs.id = t.busId
          WHERE t.departureAt >= ? AND t.departureAt <= ?
            ${scope ? "AND bs.operatorId = ?" : ""}`,
        sinceMs,
        nowMs,
        ...scopeArg,
      ),

      db.$queryRawUnsafe<{ first: unknown }[]>(
        `SELECT MIN(Payment.createdAt) AS first FROM Payment
         ${paymentJoin}
          WHERE Payment.status = 'SUCCESS' ${paymentWhere}`,
        ...scopeArg,
      ),

      // Small counts that are already fast, kept as Prisma for readability.
      Promise.all([
        db.booking.count({ where: { ...bookingWhereScope, createdAt: { gte: since } } }),
        db.booking.count({
          where: { ...bookingWhereScope, createdAt: { gte: priorStart, lt: since } },
        }),
        db.bookingSeat.count({
          where: { booking: { ...bookingWhereScope, createdAt: { gte: since } } },
        }),
        db.trip.count({
          where: { ...tripWhereScope, departureAt: { gte: now }, status: "SCHEDULED" },
        }),
        db.bus.count({ where: { ...(scope ? { operatorId: scope } : {}), status: "ACTIVE" } }),
        db.route.count({ where: { isActive: true } }),
        // Passengers belong to the platform, so a company counts the people who
        // have travelled with it rather than everyone holding an account.
        scope
          ? db.user
              .findMany({
                where: { bookings: { some: bookingWhereScope } },
                select: { id: true },
              })
              .then((r) => r.length)
          : db.user.count({ where: { role: "PASSENGER" } }),
        db.user.count({ where: { role: "PASSENGER", createdAt: { gte: since } } }),
      ]),

      db.booking.findMany({
        where: bookingWhereScope,
        take: 8,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          reference: true,
          totalAmount: true,
          status: true,
          createdAt: true,
          user: { select: { fullName: true } },
          _count: { select: { seats: true } },
          trip: { select: { route: { select: { origin: true, destination: true } } } },
        },
      }),
    ]);

    const [
      bookingsCount,
      priorBookingsCount,
      passengers,
      upcomingTrips,
      activeBuses,
      totalRoutes,
      totalUsers,
      newUsers,
    ] = counts;

    const revenue = num(totals[0]?.revenue);
    const priorRevenue = num(priorTotals[0]?.revenue);

    // Fill in days with no takings, so the chart shows a continuous series
    // rather than silently skipping quiet days.
    const byDay = new Map(seriesRows.map((r) => [r.day, r]));
    const series = Array.from({ length: days }, (_, i) => {
      const date = toKenyaDateInput(subDays(now, days - 1 - i));
      const row = byDay.get(date);
      return {
        date,
        label: formatDayLabel(new Date(`${date}T12:00:00Z`)),
        revenue: num(row?.revenue),
        bookings: num(row?.bookings),
      };
    });

    const cancelledCount = num(statusRows.find((r) => r.status === "CANCELLED")?.count);
    const totalSeats = num(occupancyRows[0]?.seats);
    const filledSeats = num(occupancyRows[0]?.filled);

    // A period-on-period comparison is only meaningful when the earlier period
    // is actually covered by our records. Comparing a month of trading against
    // the weeks before the system went live yields a true division but a
    // meaningless number, so in that case no delta is reported at all.
    const firstPaymentMs = num(firstPaymentRows[0]?.first);
    const comparable = firstPaymentMs > 0 && firstPaymentMs <= priorMs;

    const delta = (current: number, prior: number): number | null =>
      !comparable || prior === 0 ? null : Math.round(((current - prior) / prior) * 100);

    // Verification desk activity for today, in Kenyan calendar time. Cheap
    // counts, computed alongside the window figures and cached with them.
    const offsetMs = KENYA_UTC_OFFSET_HOURS * 3_600_000;
    const kenyaNow = new Date(now.getTime() + offsetMs);
    const startOfToday = new Date(
      Date.UTC(kenyaNow.getUTCFullYear(), kenyaNow.getUTCMonth(), kenyaNow.getUTCDate()) - offsetMs,
    );
    const endOfToday = new Date(startOfToday.getTime() + 86_400_000);
    const [verifiedToday, boardedToday, waitingVerification, invalidAttempts] = await Promise.all([
      db.ticket.count({
        where: { verifiedAt: { gte: startOfToday, lt: endOfToday }, booking: bookingWhereScope },
      }),
      db.ticket.count({
        where: { checkedInAt: { gte: startOfToday, lt: endOfToday }, booking: bookingWhereScope },
      }),
      db.ticket.count({
        where: {
          verifiedAt: null,
          booking: {
            status: "CONFIRMED",
            trip: { ...tripWhereScope, departureAt: { gte: startOfToday, lt: endOfToday } },
          },
        },
      }),
      db.auditLog.count({
        where: {
          action: "VERIFY_REJECTED",
          createdAt: { gte: startOfToday, lt: endOfToday },
          ...(scope ? { operatorId: scope } : {}),
        },
      }),
    ]);

    const payload = {
      window: { days, since },
      verification: {
        verified: verifiedToday,
        boarded: boardedToday,
        waiting: waitingVerification,
        invalidAttempts,
      },
      kpis: {
        revenue,
        revenueDelta: delta(revenue, priorRevenue),
        bookings: bookingsCount,
        bookingsDelta: delta(bookingsCount, priorBookingsCount),
        passengers,
        cancellationRate: bookingsCount
          ? Math.round((cancelledCount / bookingsCount) * 100)
          : 0,
        occupancy: totalSeats ? Math.round((filledSeats / totalSeats) * 100) : 0,
        // Revenue divided by bookings is the average *booking value* — a family
        // booking four seats counts once. The per-seat fare is the other one.
        averageBookingValue: bookingsCount ? Math.round(revenue / bookingsCount) : 0,
        averageFare: passengers ? Math.round(revenue / passengers) : 0,
        upcomingTrips,
        activeBuses,
        totalRoutes,
        totalUsers,
        newUsers,
      },
      series,
      topRoutes: routeRows.map((r) => ({
        route: r.route,
        revenue: num(r.revenue),
        bookings: num(r.bookings),
      })),
      statusBreakdown: statusRows.map((r) => ({
        status: r.status,
        count: num(r.count),
      })),
      paymentMethods: methodRows.map((r) => ({
        method: r.method,
        count: num(r.count),
        amount: num(r.amount),
      })),
      recentBookings: recentBookings.map((b) => ({
        id: b.id,
        reference: b.reference,
        passenger: b.user.fullName,
        route: `${b.trip.route.origin} – ${b.trip.route.destination}`,
        seats: b._count.seats,
        amount: b.totalAmount,
        status: b.status,
        createdAt: b.createdAt,
      })),
    };

    cache.set(cacheKey, { at: Date.now(), payload });
    return ok(payload);
  });
}
