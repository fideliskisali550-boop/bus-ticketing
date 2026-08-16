import "server-only";
import { db } from "./db";
import { getRouteGraph, findPaths, type Path } from "./journey-graph";
import { kenyanDayStart } from "./time";

/**
 * Turns candidate paths through the route graph into journeys a passenger can
 * actually board.
 *
 * A path says Chuka → Nairobi → Nakuru → Bomet is possible. That is not yet an
 * itinerary: it becomes one only when each leg is matched to a real departure
 * that leaves after the previous one arrives, with enough time in between to
 * cross a bus park. This module does that matching.
 */

/** Time to get off one bus, cross the stage and board the next. */
export const MIN_TRANSFER_MIN = 45;

/**
 * A single wait longer than this stops being a connection and becomes a stay.
 *
 * Set generously on purpose. On corridors running once or twice a day an
 * overnight wait at the interchange is simply how the journey is made — an
 * eight-hour cap, which is what this was, rejected almost every real
 * connection and left the planner reporting no route on journeys that people
 * genuinely travel. The waiting time is returned with the itinerary so the
 * interface can say plainly that there is a night in Nairobi.
 */
export const MAX_TRANSFER_MIN = 15 * 60;

/**
 * And a ceiling on the whole thing, so no amount of chaining produces an
 * itinerary that is technically valid and practically absurd.
 */
export const MAX_JOURNEY_MIN = 52 * 60;

/** How far ahead to look for the first leg when no date is given. */
const DEFAULT_WINDOW_DAYS = 30;

export type JourneyLeg = {
  tripId: string;
  from: string;
  to: string;
  departureAt: Date;
  arrivalAt: Date;
  fare: number;
  seatsAvailable: number;
  operator: { name: string; code: string; colour: string; rating: number } | null;
  bus: { registration: string; model: string; vehicleClass: string };
};

export type Journey = {
  id: string;
  legs: JourneyLeg[];
  origin: string;
  destination: string;
  departureAt: Date;
  arrivalAt: Date;
  /** Door to door, including time spent waiting between buses. */
  totalMinutes: number;
  ridingMinutes: number;
  waitingMinutes: number;
  transfers: number;
  totalFare: number;
  /** The tightest seat count on any leg — the real limit on party size. */
  seatsAvailable: number;
  isDirect: boolean;
};

export type CandidateTrip = {
  id: string;
  routeId: string;
  origin: string;
  destination: string;
  departureAt: Date;
  arrivalAt: Date;
  fare: number;
  seatsAvailable: number;
  operator: JourneyLeg["operator"];
  bus: JourneyLeg["bus"];
};

/**
 * Loads every departure that could serve any leg of any candidate path, in one
 * query.
 *
 * Fetching per leg would mean a round trip for each of a dozen legs across four
 * paths, and the whole point of holding the graph in memory is to keep the
 * database work to a single indexed read.
 */
export async function loadCandidateTrips(
  routeIds: string[],
  from: Date,
  to: Date,
): Promise<Map<string, CandidateTrip[]>> {
  if (!routeIds.length) return new Map();

  const rows = await db.trip.findMany({
    where: {
      routeId: { in: routeIds },
      status: { in: ["SCHEDULED", "BOARDING"] },
      departureAt: { gte: from, lte: to },
    },
    orderBy: { departureAt: "asc" },
    select: {
      id: true,
      routeId: true,
      departureAt: true,
      arrivalAt: true,
      fare: true,
      seatsBooked: true,
      route: { select: { origin: true, destination: true } },
      bus: {
        select: {
          registration: true,
          model: true,
          vehicleClass: true,
          capacity: true,
          operator: { select: { name: true, code: true, colour: true, rating: true } },
        },
      },
    },
  });

  const byRoute = new Map<string, CandidateTrip[]>();

  for (const t of rows) {
    // Sold-out departures are kept deliberately. The calendar has to be able to
    // tell "fully booked" apart from "nothing runs", and it can only do that if
    // it can see the departures that exist but have no seats left.
    const seatsAvailable = Math.max(0, t.bus.capacity - t.seatsBooked);

    const trip: CandidateTrip = {
      id: t.id,
      routeId: t.routeId,
      origin: t.route.origin,
      destination: t.route.destination,
      departureAt: t.departureAt,
      arrivalAt: t.arrivalAt,
      fare: t.fare,
      seatsAvailable,
      operator: t.bus.operator,
      bus: {
        registration: t.bus.registration,
        model: t.bus.model,
        vehicleClass: t.bus.vehicleClass,
      },
    };

    if (!byRoute.has(t.routeId)) byRoute.set(t.routeId, []);
    byRoute.get(t.routeId)!.push(trip);
  }

  return byRoute;
}

/**
 * Walks a path leg by leg, taking the earliest departure that can actually be
 * caught after the previous leg lands.
 *
 * Earliest-arrival chaining is the standard approach for timetabled journeys:
 * taking the first catchable bus on each leg never produces a later arrival
 * than waiting for a later one would, so a single forward pass is enough.
 */
export type MaterialiseOptions = {
  /** Reject legs with fewer seats than this. Zero means "ignore seats". */
  minSeats?: number;
  /**
   * Latest the journey may start. The calendar uses this to ask "can this be
   * begun on Tuesday?" — without it every day would resolve to the same
   * itinerary, whichever one happens to leave first.
   */
  startsBefore?: Date;
};

export function materialise(
  path: Path,
  tripsByRoute: Map<string, CandidateTrip[]>,
  notBefore: Date,
  { minSeats = 1, startsBefore }: MaterialiseOptions = {},
): Journey | null {
  /**
   * Walks the path leg by leg, taking the earliest departure that can actually
   * be caught after the previous one lands.
   *
   * It tries a few departures per leg rather than only the first. Taking the
   * earliest bus on every leg sounds optimal and is not: the first bus out of
   * Chuka may arrive in Nairobi just after the day's last Kisumu service has
   * gone, where a later one connects the same evening. Committing to the first
   * option and giving up when the next leg fails is what made the planner
   * report no route on journeys that plainly exist.
   *
   * The branching is tiny — at most a few options across at most four legs —
   * so exploring it costs nothing and removes a whole class of false negative.
   */
  const CANDIDATES_PER_LEG = 4;

  function walk(legIndex: number, readyAt: Date, chosen: JourneyLeg[]): JourneyLeg[] | null {
    if (legIndex === path.edges.length) return chosen;

    const edge = path.edges[legIndex]!;
    const options = tripsByRoute.get(edge.routeId);
    if (!options?.length) return null;

    const earliest =
      legIndex === 0 ? readyAt : new Date(readyAt.getTime() + MIN_TRANSFER_MIN * 60_000);

    const catchable = options
      .filter(
        (t) =>
          t.departureAt >= earliest &&
          t.seatsAvailable >= minSeats &&
          // Only the first leg is pinned to the requested day; later legs may
          // legitimately run over into the next one.
          !(legIndex === 0 && startsBefore && t.departureAt >= startsBefore),
      )
      .slice(0, CANDIDATES_PER_LEG);

    for (const trip of catchable) {
      if (legIndex > 0) {
        const waitMin = (trip.departureAt.getTime() - readyAt.getTime()) / 60_000;
        // Options are in departure order, so once one waits too long, so does
        // every option after it.
        if (waitMin > MAX_TRANSFER_MIN) break;
      }

      const leg: JourneyLeg = {
        tripId: trip.id,
        from: trip.origin,
        to: trip.destination,
        departureAt: trip.departureAt,
        arrivalAt: trip.arrivalAt,
        fare: trip.fare,
        seatsAvailable: trip.seatsAvailable,
        operator: trip.operator,
        bus: trip.bus,
      };

      const start = chosen[0]?.departureAt ?? leg.departureAt;
      if ((trip.arrivalAt.getTime() - start.getTime()) / 60_000 > MAX_JOURNEY_MIN) continue;

      const result = walk(legIndex + 1, trip.arrivalAt, [...chosen, leg]);
      if (result) return result;
    }

    return null;
  }

  const legs = walk(0, notBefore, []);
  if (!legs?.length) return null;

  const departureAt = legs[0]!.departureAt;
  const arrivalAt = legs[legs.length - 1]!.arrivalAt;
  const totalMinutes = Math.round(
    (arrivalAt.getTime() - departureAt.getTime()) / 60_000,
  );
  const ridingMinutes = legs.reduce(
    (sum, l) => sum + Math.round((l.arrivalAt.getTime() - l.departureAt.getTime()) / 60_000),
    0,
  );

  return {
    id: legs.map((l) => l.tripId).join("+"),
    legs,
    origin: legs[0]!.from,
    destination: legs[legs.length - 1]!.to,
    departureAt,
    arrivalAt,
    totalMinutes,
    ridingMinutes,
    waitingMinutes: Math.max(0, totalMinutes - ridingMinutes),
    transfers: legs.length - 1,
    totalFare: legs.reduce((sum, l) => sum + l.fare, 0),
    seatsAvailable: Math.min(...legs.map((l) => l.seatsAvailable)),
    isDirect: legs.length === 1,
  };
}

export type PlanOptions = {
  origin: string;
  destination: string;
  /** yyyy-MM-dd. Omitted means "the next departure, whenever that is". */
  date?: string | null;
  minSeats?: number;
  maxTransfers?: number;
  /** How many days past the requested date to keep looking. */
  windowDays?: number;
};

export type Plan = {
  journeys: Journey[];
  direct: Journey[];
  connecting: Journey[];
  /** True when the towns are connected in the graph even if nothing was bookable. */
  pathExists: boolean;
  searchedFrom: Date;
  searchedTo: Date;
};

/**
 * Finds journeys between two towns, direct or connecting.
 *
 * The order matters: direct services first, because a passenger will nearly
 * always prefer one bus. Connections are offered as well, not instead —
 * "no direct service" is useful information, "no way to get there" is usually
 * false and always unhelpful.
 */
export async function planJourneys({
  origin,
  destination,
  date,
  minSeats = 1,
  maxTransfers = 3,
  windowDays = DEFAULT_WINDOW_DAYS,
}: PlanOptions): Promise<Plan> {
  const graph = await getRouteGraph();

  const paths = findPaths(graph, origin, destination, { maxTransfers, limit: 5 });

  const now = new Date();

  // Midnight in Nairobi, not on whatever machine happens to be serving the
  // request. Parsing "2026-07-20T00:00:00" without a zone gave host-local
  // midnight, which on a server west of Kenya lands mid-morning EAT and
  // silently discarded every early departure on the requested day — the
  // calendar would offer a 09:15 bus that the search then could not find.
  const searchedFrom = date
    ? new Date(Math.max(kenyanDayStart(date), now.getTime()))
    : now;

  // A dated search still looks past that day, because a connection begun on
  // the chosen date can legitimately finish on the next one.
  const searchedTo = new Date(
    searchedFrom.getTime() + (date ? 3 : windowDays) * 86_400_000,
  );

  if (!paths.length) {
    return {
      journeys: [],
      direct: [],
      connecting: [],
      pathExists: false,
      searchedFrom,
      searchedTo,
    };
  }

  const routeIds = [...new Set(paths.flatMap((p) => p.edges.map((e) => e.routeId)))];
  const tripsByRoute = await loadCandidateTrips(routeIds, searchedFrom, searchedTo);

  const journeys: Journey[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    // Offering only the very first departure on a corridor would hide the rest
    // of the day's timetable, so each path is materialised a few times from
    // successively later starting points.
    let cursor = searchedFrom;

    for (let attempt = 0; attempt < 4; attempt++) {
      const journey = materialise(path, tripsByRoute, cursor, { minSeats });
      if (!journey) break;

      if (!seen.has(journey.id)) {
        seen.add(journey.id);
        journeys.push(journey);
      }

      // Next time, start just after this journey's first leg left.
      cursor = new Date(journey.legs[0]!.departureAt.getTime() + 60_000);
    }
  }

  journeys.sort((a, b) => {
    // Direct beats connecting; then earliest arrival; then cheapest.
    if (a.isDirect !== b.isDirect) return a.isDirect ? -1 : 1;
    const arrival = a.arrivalAt.getTime() - b.arrivalAt.getTime();
    if (arrival !== 0) return arrival;
    return a.totalFare - b.totalFare;
  });

  return {
    journeys,
    direct: journeys.filter((j) => j.isDirect),
    connecting: journeys.filter((j) => !j.isDirect),
    pathExists: true,
    searchedFrom,
    searchedTo,
  };
}
