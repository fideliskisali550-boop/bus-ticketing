import { db } from "@/lib/db";
import { handler, ok, parseBody, requireUser, requireCapability, notFound, badRequest } from "@/lib/api";
import { emit } from "@/lib/events";
import { assertSameOperator, operatorScope, isCrew } from "@/lib/scope";
import { rosterFor } from "@/lib/manifest";
import { z } from "zod";

/**
 * Crew rostering, and the roster a crew member sees.
 *
 * `Trip.driverId` existed from the first schema pointing at a role that did not
 * exist, so any user at all could be assigned and nothing ever read it back.
 * Assignment is now a real operation with a real audience: the driver and
 * conductor are told, because being rostered on a departure is the single most
 * consequential thing that happens to them in this system.
 */

/** The caller's own roster, for the crew dashboard. */
export async function GET(req: Request) {
  return handler(async () => {
    const user = await requireUser(req);
    const days = Math.min(14, Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? "3")));

    if (!isCrew(user.role)) {
      throw badRequest("Only drivers and conductors have a roster.");
    }

    const trips = await rosterFor(user.id, days);

    return ok({
      trips: trips.map((t) => ({
        ...t,
        corridor: `${t.route.origin} – ${t.route.destination}`,
        // Which seat the caller occupies on this departure decides what the
        // dashboard offers them: a driver reports departure, a conductor scans.
        assignedAs: t.driverId === user.id ? "DRIVER" : "CONDUCTOR",
      })),
      role: user.role,
    });
  });
}

const assignSchema = z.object({
  tripId: z.string().min(1),
  driverId: z.string().nullable().optional(),
  conductorId: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  return handler(async () => {
    const user = await requireCapability("MANAGE_SCHEDULE", req);
    const { tripId, driverId, conductorId } = await parseBody(req, assignSchema);

    const trip = await db.trip.findUnique({
      where: { id: tripId },
      include: {
        route: { select: { origin: true, destination: true } },
        bus: { select: { operatorId: true } },
      },
    });
    if (!trip) throw notFound("That departure could not be found.");

    assertSameOperator(user, trip.bus.operatorId);

    // Crew must work for the company that owns the bus. Rostering somebody
    // else's driver is operationally meaningless and would also put a user from
    // one company inside another company's scope.
    const scope = operatorScope(user) ?? trip.bus.operatorId;

    for (const [id, role] of [
      [driverId, "DRIVER"],
      [conductorId, "CONDUCTOR"],
    ] as const) {
      if (!id) continue;
      const member = await db.user.findUnique({
        where: { id },
        select: { role: true, operatorId: true, isActive: true },
      });
      if (!member || !member.isActive) throw badRequest("That crew member is not available.");
      if (member.role !== role) throw badRequest(`That user is not a ${role.toLowerCase()}.`);
      if (member.operatorId !== scope) {
        throw badRequest("Crew must work for the company operating the bus.");
      }
    }

    const updated = await db.trip.update({
      where: { id: tripId },
      data: {
        ...(driverId !== undefined ? { driverId } : {}),
        ...(conductorId !== undefined ? { conductorId } : {}),
      },
      select: { driverId: true, conductorId: true },
    });

    await emit(
      {
        type: "trip.crewed",
        tripId,
        corridor: `${trip.route.origin} – ${trip.route.destination}`,
        departureAt: trip.departureAt,
        driverId: updated.driverId,
        conductorId: updated.conductorId,
      },
      { actorId: user.id, req },
    );

    return ok({ trip: updated });
  });
}
