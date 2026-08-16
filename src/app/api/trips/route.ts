import { db } from "@/lib/db";
import { stopNames } from "@/lib/stops";
import { Prisma } from "@prisma/client";
import {
  handler,
  ok,
  parseBody,
  requireCapability,
  badRequest,
  conflict,
  forbidden,
} from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { computeFare, fareLooksReasonable } from "@/lib/fares";
import { activeFareRules } from "@/lib/fare-rules";
import { tripSchema } from "@/lib/validation";
import { releaseExpired, type ExpiredHold } from "@/lib/bookings";
import { can, tripScope } from "@/lib/scope";
import { emit } from "@/lib/events";
import { audit } from "@/lib/audit";

/**
 * Public trip search. Powers both the passenger search page and the admin trip
 * list; the `scope=all` flag (staff only) is what separates them.
 */
export async function GET(req: Request) {
  return handler(async () => {
    const url = new URL(req.url);
    const q = url.searchParams;

    const origin = q.get("origin")?.trim();
    const destination = q.get("destination")?.trim();
    const date = q.get("date");
    const minSeats = Number(q.get("minSeats") ?? "1");
    const maxFare = q.get("maxFare") ? Number(q.get("maxFare")) : undefined;
    const sort = q.get("sort") ?? "departure";

    // Clamp pagination so a hand-crafted `limit=100000` cannot be used to
    // exhaust memory or turn the endpoint into a data dump.
    const page = Math.max(1, Number(q.get("page") ?? "1"));
    const perPage = Math.min(50, Math.max(1, Number(q.get("perPage") ?? "12")));

    // Reclaim lapsed holds so the seat counts returned here are truthful.
    await announceExpired(await releaseExpired(), req);

    // Staff may ask for the unfiltered schedule — past departures, cancelled
    // services and all. The role is verified here, not taken on trust from the
    // query string.
    let scopeAll = false;
    let operatorFilter: Record<string, unknown> = {};
    if (q.get("scope") === "all") {
      const user = await getCurrentUser();
      if (!user || !can(user.role, "MANAGE_SCHEDULE")) {
        throw forbidden("Only operations staff may list all departures.");
      }
      scopeAll = true;
      // Scoped to the caller's own fleet: a route manager at one company has no
      // business reading another company's timetable.
      operatorFilter = tripScope(user);
    }

    const status = q.get("status");
    const operator = q.get("operator")?.trim();

    const where: Prisma.TripWhereInput = {
      ...operatorFilter,
      ...(scopeAll
        ? status && status !== "ALL"
          ? { status: status as Prisma.EnumTripStatusFilter["equals"] }
          : {}
        : {
            status: { in: ["SCHEDULED", "BOARDING"] },
            // Never surface a departure that has already left.
            departureAt: { gte: new Date() },
          }),
      route: {
        ...(origin ? { origin: { contains: origin } } : {}),
        ...(destination ? { destination: { contains: destination } } : {}),
        // Passengers must not be shown departures on a retired route; staff
        // still need to see them in order to manage them.
        ...(scopeAll ? {} : { isActive: true }),
      },
      ...(maxFare ? { fare: { lte: maxFare } } : {}),
      ...(operator && operator !== "ALL"
        ? { bus: { operator: { name: operator } } }
        : {}),
    };

    if (date) {
      const from = new Date(`${date}T00:00:00`);
      if (Number.isNaN(from.getTime())) throw badRequest("Invalid date.");
      const to = new Date(from);
      to.setDate(to.getDate() + 1);
      // For passengers, keep the "not in the past" floor when the chosen day is
      // today. Staff reviewing a past date want the whole day.
      where.departureAt = scopeAll
        ? { gte: from, lt: to }
        : { gte: from > new Date() ? from : new Date(), lt: to };
    }

    const orderBy: Prisma.TripOrderByWithRelationInput =
      sort === "fare-asc"
        ? { fare: "asc" }
        : sort === "fare-desc"
          ? { fare: "desc" }
          : { departureAt: "asc" };

    const [rows, total] = await Promise.all([
      db.trip.findMany({
        where,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
        include: { route: true, bus: { include: { operator: true } } },
      }),
      db.trip.count({ where }),
    ]);

    // Availability filtering happens here rather than in SQL because it compares
    // two columns across a relation (bus.capacity vs trip.seatsBooked), which
    // Prisma cannot express in a where clause.
    const trips = rows
      .map(shapeTrip)
      // Staff must still see sold-out departures; passengers should not.
      .filter((t) => scopeAll || t.seatsAvailable >= minSeats);

    /**
     * A search that matches nothing must never be a dead end.
     *
     * An empty result is almost always over-constrained rather than genuinely
     * unserved — most often by the travel date. Telling the passenger only
     * "no departures" leaves them to guess which filter to relax and try dates
     * one at a time, which is the worst part of any booking flow.
     *
     * So when a search comes back empty we answer the questions they were
     * about to ask: what is the next departure after the date they chose, what
     * was the last one before it, and if the corridor itself has nothing, what
     * else runs from where they are.
     */
    let suggestions: ReturnType<typeof shapeTrip>[] = [];
    let earlier: ReturnType<typeof shapeTrip>[] = [];
    let similarRoutes: { origin: string; destination: string; departures: number }[] = [];
    let suggestionReason: string | null = null;

    if (trips.length === 0 && !scopeAll) {
      const { departureAt: _dropDate, ...withoutDate } = where;

      const chosen = date ? new Date(`${date}T00:00:00`) : new Date();

      const [after, before] = await Promise.all([
        // The next departures on or after the chosen day.
        db.trip.findMany({
          where: {
            ...withoutDate,
            departureAt: { gte: new Date(Math.max(chosen.getTime(), Date.now())) },
          },
          orderBy: { departureAt: "asc" },
          take: 6,
          include: { route: true, bus: { include: { operator: true } } },
        }),
        // And the last ones before it, still in the future — useful when the
        // passenger could travel a day or two earlier instead.
        date
          ? db.trip.findMany({
              where: {
                ...withoutDate,
                departureAt: { gte: new Date(), lt: chosen },
              },
              orderBy: { departureAt: "desc" },
              take: 3,
              include: { route: true, bus: { include: { operator: true } } },
            })
          : Promise.resolve([]),
      ]);

      suggestions = after.map(shapeTrip).filter((t) => t.seatsAvailable >= minSeats);
      earlier = before.map(shapeTrip).filter((t) => t.seatsAvailable >= minSeats);

      if (suggestions.length || earlier.length) {
        suggestionReason = date ? "no-departures-on-date" : "no-departures-match";
      } else if (origin) {
        // Nothing at all on this corridor: offer what does run from here, so
        // the passenger can reroute rather than start over.
        const alternatives = await db.route.findMany({
          where: {
            isActive: true,
            origin: { contains: origin },
            ...(destination ? { NOT: { destination: { contains: destination } } } : {}),
            trips: { some: { departureAt: { gte: new Date() }, status: "SCHEDULED" } },
          },
          select: {
            origin: true,
            destination: true,
            _count: {
              select: {
                trips: { where: { departureAt: { gte: new Date() }, status: "SCHEDULED" } },
              },
            },
          },
          take: 8,
        });

        similarRoutes = alternatives
          .map((r) => ({
            origin: r.origin,
            destination: r.destination,
            departures: r._count.trips,
          }))
          .sort((a, b) => b.departures - a.departures);

        if (similarRoutes.length) suggestionReason = "no-service-on-corridor";
      }
    }

    return ok({
      trips,
      total,
      page,
      perPage,
      pages: Math.ceil(total / perPage),
      suggestions,
      earlier,
      similarRoutes,
      suggestionReason,
    });
  });
}

/** Shared projection so search results and suggestions have the same shape. */
function shapeTrip(t: {
  id: string;
  departureAt: Date;
  arrivalAt: Date;
  fare: number;
  status: string;
  seatsBooked: number;
  route: {
    id: string;
    origin: string;
    destination: string;
    distanceKm: number;
    durationMin: number;
    stops: string;
    isInternational: boolean;
    baseFare: number;
  };
  bus: {
    registration: string;
    model: string;
    capacity: number;
    vehicleClass: string;
    hasWifi: boolean;
    hasChargingPorts: boolean;
    hasToilet: boolean;
    hasAirCon: boolean;
    operator: { name: string; code: string; colour: string; rating: number } | null;
  };
}) {
  return {
    id: t.id,
    departureAt: t.departureAt,
    arrivalAt: t.arrivalAt,
    fare: t.fare,
    status: t.status,
    seatsAvailable: t.bus.capacity - t.seatsBooked,
    capacity: t.bus.capacity,
    route: {
      id: t.route.id,
      origin: t.route.origin,
      destination: t.route.destination,
      distanceKm: t.route.distanceKm,
      durationMin: t.route.durationMin,
      stops: stopNames(t.route.stops),
      isInternational: t.route.isInternational,
      baseFare: t.route.baseFare,
    },
    bus: {
      registration: t.bus.registration,
      model: t.bus.model,
      vehicleClass: t.bus.vehicleClass,
      hasWifi: t.bus.hasWifi,
      hasChargingPorts: t.bus.hasChargingPorts,
      hasToilet: t.bus.hasToilet,
      hasAirCon: t.bus.hasAirCon,
    },
    operator: t.bus.operator,
  };
}

/** Schedules a new departure. Staff only. */
export async function POST(req: Request) {
  return handler(async () => {
    const user = await requireCapability("MANAGE_SCHEDULE");
    const data = await parseBody(req, tripSchema);

    if (data.departureAt < new Date()) {
      throw badRequest("Departure time must be in the future.");
    }

    const bus = await db.bus.findUnique({ where: { id: data.busId } });
    if (!bus) throw badRequest("That bus does not exist.");
    if (bus.status !== "ACTIVE") {
      throw badRequest(`${bus.registration} is ${bus.status.toLowerCase()} and cannot be scheduled.`);
    }

    const route = await db.route.findUnique({ where: { id: data.routeId } });
    if (!route) throw badRequest("That route does not exist.");

    // The fare is derived from the route's market rate, the class of vehicle
    // assigned, and whatever pricing rules are in force. An explicit fare is
    // still honoured — an operator may have a reason — but it is checked
    // against the corridor's normal price first, which is what stops a
    // mistyped amount from putting a KES 500 journey on sale at KES 8,000.
    const rules = await activeFareRules(data.routeId);
    const derived = computeFare({
      baseFare: route.baseFare,
      vehicleClass: bus.vehicleClass,
      departureAt: data.departureAt,
      routeId: route.id,
      rules,
    });

    const fare = data.fare ?? derived.total;

    const sanity = fareLooksReasonable(fare, route.baseFare);
    if (!sanity.ok) throw badRequest(sanity.reason);

    // A bus cannot be in two places at once. Reject any overlap with an
    // existing trip for the same vehicle.
    const clash = await db.trip.findFirst({
      where: {
        busId: data.busId,
        status: { notIn: ["CANCELLED", "ARRIVED"] },
        departureAt: { lt: data.arrivalAt },
        arrivalAt: { gt: data.departureAt },
      },
      include: { route: true },
    });

    if (clash) {
      throw conflict(
        `${bus.registration} is already assigned to ${clash.route.origin} – ${clash.route.destination} at that time.`,
      );
    }

    const trip = await db.trip.create({
      data: { ...data, fare, driverId: data.driverId || null },
      include: { route: true, bus: { include: { operator: true } } },
    });

    await audit({
      userId: user.id,
      action: "TRIP_CREATE",
      entity: "Trip",
      entityId: trip.id,
      metadata: { ...data, fare, derivedFrom: derived },
      req,
    });

    return ok({ trip, fareBreakdown: derived }, 201);
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
