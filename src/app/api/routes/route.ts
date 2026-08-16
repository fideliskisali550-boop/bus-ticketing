import { db } from "@/lib/db";
import { stopNames, parseStops, serializeStops } from "@/lib/stops";
import { handler, ok, parseBody, requireCapability, requireOffice, conflict } from "@/lib/api";
import { routeSchema } from "@/lib/validation";
import { estimateBaseFare } from "@/lib/fares";
import { audit } from "@/lib/audit";
import { invalidateRouteGraph } from "@/lib/journey-graph";

/**
 * Every existing consumer wants `stops` as plain names, so that is what it
 * stays. The detailed form rides alongside for the admin route builder, which
 * meant none of the passenger-facing callers had to change.
 */
const shape = (r: { stops: string } & Record<string, unknown>) => ({
  ...r,
  stops: stopNames(r.stops),
  stopDetails: parseStops(r.stops),
});

export async function GET(req: Request) {
  return handler(async () => {
    const q = new URL(req.url).searchParams;
    const search = q.get("search")?.trim();
    const includeInactive = q.get("includeInactive") === "true";
    const international = q.get("international");

    // Departure counts are a correlated subquery per row. Across a network of
    // ~2,000 routes that alone took the endpoint past 300ms, so it is opt-in:
    // only the routes admin screen needs the numbers, and it asks page by page.
    const withCounts = q.get("withCounts") === "true";

    const page = Math.max(1, Number(q.get("page") ?? "1"));
    const perPage = Math.min(500, Math.max(1, Number(q.get("perPage") ?? "200")));

    const where = {
      ...(includeInactive ? {} : { isActive: true }),
      ...(international === "true"
        ? { isInternational: true }
        : international === "false"
          ? { isInternational: false }
          : {}),
      ...(search
        ? { OR: [{ origin: { contains: search } }, { destination: { contains: search } }] }
        : {}),
    };

    const [routes, total] = await Promise.all([
      db.route.findMany({
        where,
        orderBy: [{ origin: "asc" }, { destination: "asc" }],
        skip: (page - 1) * perPage,
        take: perPage,
        ...(withCounts ? { include: { _count: { select: { trips: true } } } } : {}),
      }),
      db.route.count({ where }),
    ]);

    return ok({
      routes: routes.map(shape),
      total,
      page,
      perPage,
      pages: Math.ceil(total / perPage),
    });
  });
}

export async function POST(req: Request) {
  return handler(async () => {
    const user = await requireCapability("MANAGE_NETWORK");
    const { fareChangeReason, ...data } = await parseBody(req, routeSchema);

    const existing = await db.route.findUnique({
      where: { origin_destination: { origin: data.origin, destination: data.destination } },
    });
    if (existing) throw conflict(`${data.origin} – ${data.destination} already exists.`);

    // An operator who does not supply a fare gets a distance-based estimate
    // rather than a zero, so a route can never go on sale unpriced.
    const baseFare = data.baseFare ?? estimateBaseFare(data.distanceKm, data.isInternational);

    // Link the endpoints to the place catalogue where we recognise them, so the
    // route joins the searchable network rather than floating free.
    const [originLoc, destinationLoc] = await Promise.all([
      db.location.findFirst({ where: { name: data.origin }, select: { id: true } }),
      db.location.findFirst({ where: { name: data.destination }, select: { id: true } }),
    ]);

    const route = await db.route.create({
      data: {
        ...data,
        baseFare,
        originId: originLoc?.id ?? null,
        destinationId: destinationLoc?.id ?? null,
        stops: serializeStops(data.stops),
      },
    });

    // A new corridor changes the shape of the network, so the cached graph is
    // stale the moment this returns. Without this the route would be invisible
    // to journey search and to the calendar for up to five minutes.
    invalidateRouteGraph();

    // The opening fare is the first entry in the route's price history.
    await db.fareHistory.create({
      data: {
        routeId: route.id,
        oldFare: 0,
        newFare: baseFare,
        reason: fareChangeReason || "Route created",
        changedBy: user.id,
      },
    });

    await audit({
      userId: user.id,
      action: "ROUTE_CREATE",
      entity: "Route",
      entityId: route.id,
      metadata: { ...data, baseFare },
      req,
    });

    return ok({ route: shape(route) }, 201);
  });
}
