import { db } from "@/lib/db";
import { stopNames, parseStops, serializeStops } from "@/lib/stops";
import { handler, ok, parseBody, requireCapability, requireOffice, notFound } from "@/lib/api";
import { routeUpdateSchema } from "@/lib/validation";
import { audit } from "@/lib/audit";
import { invalidateRouteGraph } from "@/lib/journey-graph";

type Ctx = { params: Promise<{ id: string }> };

/** Route detail, including its price history. */
export async function GET(_req: Request, { params }: Ctx) {
  return handler(async () => {
    await requireOffice();
    const { id } = await params;

    const route = await db.route.findUnique({
      where: { id },
      include: {
        fareHistory: { orderBy: { createdAt: "desc" }, take: 25 },
        _count: { select: { trips: true } },
      },
    });

    if (!route) throw notFound("That route could not be found.");

    return ok({
      route: { ...route, stops: stopNames(route.stops), stopDetails: parseStops(route.stops) },
    });
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  return handler(async () => {
    const user = await requireOffice();
    const { id } = await params;
    const { stops, fareChangeReason, ...rest } = await parseBody(
      req,
      routeUpdateSchema,
    );

    const existing = await db.route.findUnique({ where: { id } });
    if (!existing) throw notFound("That route could not be found.");

    const route = await db.route.update({
      where: { id },
      // `stops` is a JSON string column, so the array has to be serialised
      // rather than spread through with the scalar fields.
      data: { ...rest, ...(stops ? { stops: serializeStops(stops) } : {}) },
    });

    // Duration, activity and endpoints all feed the cached graph.
    invalidateRouteGraph();

    // A fare change is recorded, never silently applied. Existing trips keep
    // the fare they were scheduled at — repricing a journey someone has
    // already paid for would be indefensible — so this affects future
    // departures only.
    if (rest.baseFare !== undefined && rest.baseFare !== existing.baseFare) {
      await db.fareHistory.create({
        data: {
          routeId: id,
          oldFare: existing.baseFare,
          newFare: rest.baseFare,
          reason: fareChangeReason || "Fare updated",
          changedBy: user.id,
        },
      });

      await audit({
        userId: user.id,
        action: "FARE_UPDATE",
        entity: "Route",
        entityId: id,
        metadata: {
          route: `${existing.origin} – ${existing.destination}`,
          from: existing.baseFare,
          to: rest.baseFare,
          reason: fareChangeReason,
        },
        req,
      });
    }

    await audit({
      userId: user.id,
      action: "ROUTE_UPDATE",
      entity: "Route",
      entityId: id,
      metadata: { ...rest, stops },
      req,
    });

    return ok({ route: { ...route, stops: stopNames(route.stops), stopDetails: parseStops(route.stops) } });
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return handler(async () => {
    const user = await requireOffice();
    const { id } = await params;

    // Trips reference routes, and those trips carry booking history. Deleting
    // the route would break that chain, so a route in use is retired instead.
    const trips = await db.trip.count({ where: { routeId: id } });
    if (trips > 0) {
      await db.route.update({ where: { id }, data: { isActive: false } });
      invalidateRouteGraph();
      await audit({ userId: user.id, action: "ROUTE_DEACTIVATE", entity: "Route", entityId: id, req });
      return ok({ success: true, deactivated: true });
    }

    await db.route.delete({ where: { id } });
    invalidateRouteGraph();
    await audit({ userId: user.id, action: "ROUTE_DELETE", entity: "Route", entityId: id, req });
    return ok({ success: true, deactivated: false });
  });
}
