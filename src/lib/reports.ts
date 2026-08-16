import "server-only";
import { db } from "@/lib/db";
import { operatorScope, type Scoped } from "@/lib/scope";
import {
  KENYA_UTC_OFFSET_HOURS,
  formatDayLabel,
  formatDateLong,
  formatDate,
  toKenyaDateInput,
} from "@/lib/time";

/**
 * Operational reports over a calendar period, computed once and rendered both
 * on screen and into every export. That single source is the point: a PDF whose
 * revenue disagrees with the dashboard is worse than no PDF, so the CSV, the
 * workbook and the page all read from this one function rather than each
 * re-deriving the figures their own way.
 *
 * Every number is scoped to the caller's operator through `operatorScope`, the
 * same rule the rest of the back office obeys, so a company admin's monthly
 * report is their company's month and never the platform's.
 */

export type ReportPeriod = "day" | "week" | "month" | "year";

export const REPORT_PERIODS: ReportPeriod[] = ["day", "week", "month", "year"];

export function isReportPeriod(value: string): value is ReportPeriod {
  return (REPORT_PERIODS as string[]).includes(value);
}

type Bucket = { key: string; label: string };
type Granularity = "hour" | "day" | "month";

export type Report = {
  period: ReportPeriod;
  /** Human title for the period, e.g. "July 2026" or "Tuesday 24 July 2026". */
  label: string;
  range: { from: string; to: string };
  operator: string;
  generatedAt: string;
  generatedBy: string;
  summary: {
    revenue: number;
    bookings: number;
    passengers: number;
    ticketsVerified: number;
    completedTrips: number;
    activeBuses: number;
    cancellations: number;
    occupancy: number;
    averageFare: number;
  };
  deltas: { revenue: number | null; bookings: number | null };
  series: { label: string; revenue: number; bookings: number }[];
  routePerformance: { route: string; revenue: number; bookings: number; seats: number }[];
  paymentMethods: { method: string; count: number; amount: number }[];
  statusBreakdown: { status: string; count: number }[];
};

const OFFSET_MS = KENYA_UTC_OFFSET_HOURS * 3_600_000;
const num = (value: unknown) => (value == null ? 0 : Number(value));
const pad = (n: number) => String(n).padStart(2, "0");

/** Midnight in Nairobi for the given Kenyan calendar Y/M/D, as a UTC instant. */
const kenyaMidnight = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d) - OFFSET_MS);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Resolves a period into its window, the equivalent window immediately before
 * it (for the comparison), a display label, and the bucketing the trend chart
 * should use. Boundaries are Kenyan calendar boundaries.
 */
function resolvePeriod(period: ReportPeriod, now: Date) {
  const k = new Date(now.getTime() + OFFSET_MS);
  const y = k.getUTCFullYear();
  const m = k.getUTCMonth();
  const d = k.getUTCDate();
  const weekday = k.getUTCDay(); // 0 = Sunday

  let from: Date;
  let to: Date;
  let prevFrom: Date;
  let granularity: Granularity;

  switch (period) {
    case "day": {
      from = kenyaMidnight(y, m, d);
      to = kenyaMidnight(y, m, d + 1);
      prevFrom = kenyaMidnight(y, m, d - 1);
      granularity = "hour";
      break;
    }
    case "week": {
      // Weeks run Monday–Sunday, the Kenyan operating week.
      const daysFromMonday = (weekday + 6) % 7;
      from = kenyaMidnight(y, m, d - daysFromMonday);
      to = kenyaMidnight(y, m, d - daysFromMonday + 7);
      prevFrom = kenyaMidnight(y, m, d - daysFromMonday - 7);
      granularity = "day";
      break;
    }
    case "month": {
      from = kenyaMidnight(y, m, 1);
      to = kenyaMidnight(y, m + 1, 1);
      prevFrom = kenyaMidnight(y, m - 1, 1);
      granularity = "day";
      break;
    }
    case "year": {
      from = kenyaMidnight(y, 0, 1);
      to = kenyaMidnight(y + 1, 0, 1);
      prevFrom = kenyaMidnight(y - 1, 0, 1);
      granularity = "month";
      break;
    }
  }

  const label =
    period === "day"
      ? formatDateLong(from)
      : period === "week"
        ? `Week of ${formatDate(from)} – ${formatDate(new Date(to.getTime() - 86_400_000))}`
        : period === "month"
          ? new Date(from.getTime() + OFFSET_MS).toLocaleString("en-GB", {
              month: "long",
              year: "numeric",
              timeZone: "Africa/Nairobi",
            })
          : String(y);

  return { from, to, prevFrom, prevTo: from, label, granularity };
}

/** The ordered, gap-free list of buckets a period's trend chart plots. */
function bucketsFor(period: ReportPeriod, from: Date, to: Date): Bucket[] {
  if (period === "day") {
    const ymd = toKenyaDateInput(from);
    return Array.from({ length: 24 }, (_, h) => ({
      key: `${ymd}T${pad(h)}`,
      label: `${pad(h)}:00`,
    }));
  }
  if (period === "year") {
    const y = new Date(from.getTime() + OFFSET_MS).getUTCFullYear();
    return Array.from({ length: 12 }, (_, i) => ({
      key: `${y}-${pad(i + 1)}`,
      label: MONTHS[i]!,
    }));
  }
  // Daily buckets for a week or a month.
  const days: Bucket[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += 86_400_000) {
    const day = new Date(t);
    days.push({ key: toKenyaDateInput(day), label: formatDayLabel(day) });
  }
  return days;
}

/** The SQLite expression that buckets a stored-ms timestamp into Kenyan time. */
function bucketExpr(column: string, granularity: Granularity) {
  const base = `${column} / 1000, 'unixepoch', '+${KENYA_UTC_OFFSET_HOURS} hours'`;
  if (granularity === "hour") return `strftime('%Y-%m-%dT%H', ${base})`;
  if (granularity === "month") return `strftime('%Y-%m', ${base})`;
  return `date(${base})`;
}

export async function buildReport(
  user: Scoped & { fullName: string },
  period: ReportPeriod,
): Promise<Report> {
  const now = new Date();
  const { from, to, prevFrom, prevTo, label, granularity } = resolvePeriod(period, now);
  const scope = operatorScope(user);

  const fromMs = from.getTime();
  const toMs = to.getTime();
  const prevFromMs = prevFrom.getTime();
  const prevToMs = prevTo.getTime();

  // Prisma `where` fragments for the scoped counts.
  const bookingScoped = scope ? { trip: { bus: { operatorId: scope } } } : {};
  const paymentScoped = scope ? { booking: { trip: { bus: { operatorId: scope } } } } : {};
  const tripScoped = scope ? { bus: { operatorId: scope } } : {};

  // Raw-SQL scope splicing, matching the analytics endpoint: the series and the
  // grouped breakdowns run as one indexed join rather than as N per-row reads.
  const paymentJoin = scope
    ? `JOIN Booking b2 ON b2.id = Payment.bookingId
       JOIN Trip   t2 ON t2.id = b2.tripId
       JOIN Bus    x2 ON x2.id = t2.busId`
    : "";
  const paymentWhere = scope ? `AND x2.operatorId = ?` : "";
  const bookingWhere = scope ? `AND bus.operatorId = ?` : "";
  const scopeArg = scope ? [scope] : [];

  const revBucket = bucketExpr("Payment.createdAt", granularity);
  const bookBucket = bucketExpr("b.createdAt", granularity);

  const [
    revenueAgg,
    prevRevenueAgg,
    bookings,
    prevBookings,
    passengers,
    ticketsVerified,
    completedTrips,
    activeBuses,
    cancellations,
    occupancyRows,
    revenueSeries,
    bookingSeries,
    routeRows,
    methodRows,
    statusRows,
    firstPaymentRows,
  ] = await Promise.all([
    db.payment.aggregate({
      _sum: { amount: true },
      where: { ...paymentScoped, status: "SUCCESS", kind: "CHARGE", createdAt: { gte: from, lt: to } },
    }),
    db.payment.aggregate({
      _sum: { amount: true },
      where: {
        ...paymentScoped,
        status: "SUCCESS",
        kind: "CHARGE",
        createdAt: { gte: prevFrom, lt: prevTo },
      },
    }),
    db.booking.count({ where: { ...bookingScoped, createdAt: { gte: from, lt: to } } }),
    db.booking.count({ where: { ...bookingScoped, createdAt: { gte: prevFrom, lt: prevTo } } }),
    db.bookingSeat.count({
      where: { booking: { ...bookingScoped, createdAt: { gte: from, lt: to } } },
    }),
    db.ticket.count({ where: { checkedInAt: { gte: from, lt: to }, booking: bookingScoped } }),
    db.trip.count({ where: { ...tripScoped, status: "ARRIVED", departureAt: { gte: from, lt: to } } }),
    db.bus.count({ where: { ...(scope ? { operatorId: scope } : {}), status: "ACTIVE" } }),
    db.booking.count({
      where: { ...bookingScoped, status: "CANCELLED", cancelledAt: { gte: from, lt: to } },
    }),

    // Occupancy across departures that ran within the window.
    db.$queryRawUnsafe<{ seats: unknown; filled: unknown }[]>(
      `SELECT SUM(bs.capacity) AS seats, SUM(t.seatsBooked) AS filled
         FROM Trip t JOIN Bus bs ON bs.id = t.busId
        WHERE t.departureAt >= ? AND t.departureAt < ? ${scope ? "AND bs.operatorId = ?" : ""}`,
      fromMs,
      toMs,
      ...scopeArg,
    ),

    db.$queryRawUnsafe<{ bucket: string; revenue: unknown }[]>(
      `SELECT ${revBucket} AS bucket, SUM(Payment.amount) AS revenue
         FROM Payment ${paymentJoin}
        WHERE Payment.status = 'SUCCESS' AND Payment.kind = 'CHARGE'
          AND Payment.createdAt >= ? AND Payment.createdAt < ? ${paymentWhere}
        GROUP BY bucket`,
      fromMs,
      toMs,
      ...scopeArg,
    ),

    db.$queryRawUnsafe<{ bucket: string; n: unknown }[]>(
      `SELECT ${bookBucket} AS bucket, COUNT(*) AS n
         FROM Booking b
         JOIN Trip t  ON t.id = b.tripId
         JOIN Bus bus ON bus.id = t.busId
        WHERE b.createdAt >= ? AND b.createdAt < ? ${bookingWhere}
        GROUP BY bucket`,
      fromMs,
      toMs,
      ...scopeArg,
    ),

    db.$queryRawUnsafe<{ route: string; revenue: unknown; bookings: unknown; seats: unknown }[]>(
      `SELECT r.origin || ' – ' || r.destination AS route,
              SUM(b.totalAmount) AS revenue, COUNT(DISTINCT b.id) AS bookings,
              COUNT(bsseat.id) AS seats
         FROM Booking b
         JOIN Trip t  ON t.id = b.tripId
         JOIN Route r ON r.id = t.routeId
         JOIN Bus bus ON bus.id = t.busId
         LEFT JOIN BookingSeat bsseat ON bsseat.bookingId = b.id
        WHERE b.status IN ('CONFIRMED','CHECKED_IN','COMPLETED')
          AND b.createdAt >= ? AND b.createdAt < ? ${bookingWhere}
        GROUP BY r.id
        ORDER BY revenue DESC
        LIMIT 8`,
      fromMs,
      toMs,
      ...scopeArg,
    ),

    db.$queryRawUnsafe<{ method: string; count: unknown; amount: unknown }[]>(
      `SELECT Payment.method AS method, COUNT(*) AS count, SUM(Payment.amount) AS amount
         FROM Payment ${paymentJoin}
        WHERE Payment.status = 'SUCCESS' AND Payment.kind = 'CHARGE'
          AND Payment.createdAt >= ? AND Payment.createdAt < ? ${paymentWhere}
        GROUP BY Payment.method`,
      fromMs,
      toMs,
      ...scopeArg,
    ),

    db.$queryRawUnsafe<{ status: string; count: unknown }[]>(
      `SELECT b.status AS status, COUNT(*) AS count
         FROM Booking b
         JOIN Trip t  ON t.id = b.tripId
         JOIN Bus bus ON bus.id = t.busId
        WHERE b.createdAt >= ? AND b.createdAt < ? ${bookingWhere}
        GROUP BY b.status`,
      fromMs,
      toMs,
      ...scopeArg,
    ),

    // The earliest takings on record, to decide whether a period-on-period
    // comparison is meaningful at all.
    db.$queryRawUnsafe<{ first: unknown }[]>(
      `SELECT MIN(Payment.createdAt) AS first FROM Payment ${paymentJoin}
        WHERE Payment.status = 'SUCCESS' ${paymentWhere}`,
      ...scopeArg,
    ),
  ]);

  const revenue = num(revenueAgg._sum.amount);
  const prevRevenue = num(prevRevenueAgg._sum.amount);
  const totalSeats = num(occupancyRows[0]?.seats);
  const filledSeats = num(occupancyRows[0]?.filled);

  // A comparison is only shown when the previous period is one the system was
  // actually trading through. Measuring this month against the weeks before the
  // company's first sale gives a true division and a meaningless number — a
  // five-figure "growth" that is really just an empty prior period — so in that
  // case, and when the prior total is zero, no delta is reported.
  const firstPaymentMs = num(firstPaymentRows[0]?.first);
  const comparable = firstPaymentMs > 0 && firstPaymentMs <= prevFromMs;
  const delta = (current: number, prior: number): number | null =>
    !comparable || prior === 0 ? null : Math.round(((current - prior) / prior) * 100);

  const revByBucket = new Map(revenueSeries.map((r) => [r.bucket, num(r.revenue)]));
  const bookByBucket = new Map(bookingSeries.map((r) => [r.bucket, num(r.n)]));
  const series = bucketsFor(period, from, to).map((b) => ({
    label: b.label,
    revenue: revByBucket.get(b.key) ?? 0,
    bookings: bookByBucket.get(b.key) ?? 0,
  }));

  return {
    period,
    label,
    range: { from: toKenyaDateInput(from), to: toKenyaDateInput(new Date(to.getTime() - 86_400_000)) },
    operator: scope ? await operatorName(scope) : "All operators",
    generatedAt: now.toISOString(),
    generatedBy: user.fullName,
    summary: {
      revenue,
      bookings,
      passengers,
      ticketsVerified,
      completedTrips,
      activeBuses,
      cancellations,
      occupancy: totalSeats ? Math.round((filledSeats / totalSeats) * 100) : 0,
      averageFare: passengers ? Math.round(revenue / passengers) : 0,
    },
    deltas: { revenue: delta(revenue, prevRevenue), bookings: delta(bookings, prevBookings) },
    series,
    routePerformance: routeRows.map((r) => ({
      route: r.route,
      revenue: num(r.revenue),
      bookings: num(r.bookings),
      seats: num(r.seats),
    })),
    paymentMethods: methodRows.map((r) => ({
      method: r.method,
      count: num(r.count),
      amount: num(r.amount),
    })),
    statusBreakdown: statusRows.map((r) => ({ status: r.status, count: num(r.count) })),
  };
}

async function operatorName(operatorId: string): Promise<string> {
  const op = await db.operator.findUnique({ where: { id: operatorId }, select: { name: true } });
  return op?.name ?? "Your company";
}
