import "server-only";
import { getRouteGraph, findPaths } from "./journey-graph";
import { loadCandidateTrips, materialise } from "./journey-planner";
import { kenyanDayStart } from "./time";

/**
 * The single source of truth for "can somebody travel on this day".
 *
 * This exists because there used to be two answers. The search results came
 * from the journey planner, which walks the route graph and will happily build
 * Bomet → Nakuru → Meru → Chuka out of three separate buses. The calendar came
 * from its own SQL aggregate that matched `Route.origin` and
 * `Route.destination` directly, so it only ever counted departures where one
 * route ran the whole way.
 *
 * On a corridor with no direct service those two disagree completely: the
 * planner lists eight itineraries leaving on the 20th while the calendar greys
 * the 20th out as having no service. Both were working exactly as written; the
 * mistake was having written availability twice.
 *
 * So availability is defined once, here, in the planner's terms — a day is
 * available when a journey can be *completed* from it, whether that takes one
 * bus or four. Everything that shows availability calls this.
 */

/** Fewer bookable seats than this on the best itinerary and the day is filling up. */
export const LOW_SEATS_THRESHOLD = 10;

export type DayStatus = "available" | "limited" | "soldout" | "none";

export type DayAvailability = {
  /** yyyy-MM-dd, Kenyan wall-clock. */
  date: string;
  status: DayStatus;
  /** Itineraries that can be started on this day and completed. */
  journeys: number;
  /** How many of those need no change of bus. */
  direct: number;
  /** Seats on the roomiest bookable itinerary — the real limit on party size. */
  seatsLeft: number;
  cheapestFare: number | null;
  /** True when every option that day involves at least one change. */
  requiresTransfer: boolean;
};

export type AvailabilityResult = {
  calendar: DayAvailability[];
  summary: {
    bookableDays: number;
    firstAvailable: string | null;
    cheapest: number | null;
    /** False when the towns are not linked at all, however many changes. */
    pathExists: boolean;
  };
};

export type AvailabilityOptions = {
  origin: string;
  destination: string;
  /** First day of the window, yyyy-MM-dd. */
  from: string;
  days: number;
  minSeats?: number;
  maxTransfers?: number;
};

const ymdAfter = (ymd: string, days: number) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Day-by-day availability for a corridor.
 *
 * One graph traversal and one indexed read cover the whole month; every day is
 * then resolved in memory. Planning each day against the database separately
 * would be thirty round trips to render one calendar.
 */
export async function getAvailability({
  origin,
  destination,
  from,
  days,
  minSeats = 1,
  maxTransfers = 3,
}: AvailabilityOptions): Promise<AvailabilityResult> {
  const graph = await getRouteGraph();
  const paths = findPaths(graph, origin, destination, { maxTransfers, limit: 5 });

  const emptyCalendar = (): DayAvailability[] =>
    Array.from({ length: days }, (_, i) => ({
      date: ymdAfter(from, i),
      status: "none" as DayStatus,
      journeys: 0,
      direct: 0,
      seatsLeft: 0,
      cheapestFare: null,
      requiresTransfer: false,
    }));

  if (!paths.length) {
    return {
      calendar: emptyCalendar(),
      summary: { bookableDays: 0, firstAvailable: null, cheapest: null, pathExists: false },
    };
  }

  const windowStart = new Date(kenyanDayStart(from));
  // A journey begun on the last day of the window can still be running two days
  // later, and its later legs have to be loaded or it will look unbookable.
  const windowEnd = new Date(kenyanDayStart(ymdAfter(from, days + 3)));

  const routeIds = [...new Set(paths.flatMap((p) => p.edges.map((e) => e.routeId)))];
  const tripsByRoute = await loadCandidateTrips(routeIds, windowStart, windowEnd);

  const now = Date.now();

  const calendar = Array.from({ length: days }, (_, i): DayAvailability => {
    const date = ymdAfter(from, i);
    const dayStart = kenyanDayStart(date);
    const dayEnd = dayStart + 86_400_000;

    if (dayEnd <= now) {
      // Already over; nothing can be booked on it whatever the timetable says.
      return {
        date,
        status: "none",
        journeys: 0,
        direct: 0,
        seatsLeft: 0,
        cheapestFare: null,
        requiresTransfer: false,
      };
    }

    const notBefore = new Date(Math.max(dayStart, now));
    const startsBefore = new Date(dayEnd);

    let bookable = 0;
    let direct = 0;
    let seatsLeft = 0;
    let cheapest: number | null = null;
    let anyDeparture = false;

    for (const path of paths) {
      // Asked twice on purpose: once for what can be booked, and once ignoring
      // seats entirely. The difference between the two is exactly what
      // separates "fully booked" from "no service", which is the distinction
      // the passenger most needs and the one a seat-filtered query cannot make.
      const journey = materialise(path, tripsByRoute, notBefore, { minSeats, startsBefore });

      if (journey) {
        bookable++;
        if (journey.isDirect) direct++;
        seatsLeft = Math.max(seatsLeft, journey.seatsAvailable);
        cheapest = cheapest == null ? journey.totalFare : Math.min(cheapest, journey.totalFare);
      } else if (
        !anyDeparture &&
        materialise(path, tripsByRoute, notBefore, { minSeats: 0, startsBefore })
      ) {
        anyDeparture = true;
      }
    }

    const status: DayStatus = bookable
      ? seatsLeft <= LOW_SEATS_THRESHOLD
        ? "limited"
        : "available"
      : anyDeparture
        ? "soldout"
        : "none";

    return {
      date,
      status,
      journeys: bookable,
      direct,
      seatsLeft,
      cheapestFare: cheapest,
      requiresTransfer: bookable > 0 && direct === 0,
    };
  });

  const bookableDays = calendar.filter((d) => d.journeys > 0);

  return {
    calendar,
    summary: {
      bookableDays: bookableDays.length,
      firstAvailable: bookableDays[0]?.date ?? null,
      cheapest: bookableDays.reduce<number | null>(
        (min, d) =>
          d.cheapestFare != null && (min == null || d.cheapestFare < min) ? d.cheapestFare : min,
        null,
      ),
      pathExists: true,
    },
  };
}
