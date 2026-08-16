import { db } from "@/lib/db";
import { handler, ok, parseBody, requireCapability, notFound, badRequest } from "@/lib/api";
import { emit } from "@/lib/events";
import { assertSameOperator, isCrew } from "@/lib/scope";
import { forbidden } from "@/lib/errors";
import { z } from "zod";

/**
 * Reports what actually happened to a departure.
 *
 * `TripStatus` has carried DEPARTED and ARRIVED since the first schema and
 * *nothing in the system ever set them*. Every trip sat at SCHEDULED until it
 * was archived, which meant every arrival time the platform displayed was a
 * timetable guess and punctuality reporting was impossible. This is the handler
 * that closes that gap, and the driver is the only person in a position to.
 *
 * Boarding is opened by staff or by the conductor; departure and arrival are
 * reported by the driver, who is the one who knows.
 */

const operateSchema = z.object({
  action: z.enum(["BOARDING", "DEPARTED", "ARRIVED"]),
});

type Ctx = { params: Promise<{ id: string }> };

/** Which status a trip must already be in for each report to make sense. */
const REQUIRES: Record<string, string[]> = {
  BOARDING: ["SCHEDULED"],
  DEPARTED: ["SCHEDULED", "BOARDING"],
  ARRIVED: ["DEPARTED"],
};

export async function POST(req: Request, { params }: Ctx) {
  return handler(async () => {
    const user = await requireCapability("OPERATE_TRIP", req);
    const { id } = await params;
    const { action } = await parseBody(req, operateSchema);

    const trip = await db.trip.findUnique({
      where: { id },
      include: {
        route: { select: { origin: true, destination: true } },
        bus: { select: { operatorId: true } },
      },
    });
    if (!trip) throw notFound("That departure could not be found.");

    assertSameOperator(user, trip.bus.operatorId);

    // A driver reports on their own bus, not on the whole timetable.
    if (isCrew(user.role) && trip.driverId !== user.id) {
      throw forbidden("You are not rostered to drive that departure.");
    }

    if (!REQUIRES[action]!.includes(trip.status)) {
      throw badRequest(
        `A departure that is ${trip.status.toLowerCase()} cannot be marked ${action.toLowerCase()}.`,
      );
    }

    const now = new Date();
    const corridor = `${trip.route.origin} – ${trip.route.destination}`;

    if (action === "BOARDING") {
      await db.trip.update({ where: { id }, data: { status: "BOARDING" } });
      return ok({ status: "BOARDING" });
    }

    if (action === "DEPARTED") {
      const passengers = await db.bookingSeat.count({
        where: { tripId: id, booking: { status: { in: ["CONFIRMED", "CHECKED_IN"] } } },
      });

      // Anyone still unscanned when the bus pulls away did not travel. Marking
      // them now is what makes the no-show report real rather than notional,
      // and it has to happen here because departure is the only moment the
      // system can be sure boarding is over.
      const noShows = await db.bookingSeat.updateMany({
        where: { tripId: id, boardedAt: null, noShow: false },
        data: { noShow: true },
      });

      await db.trip.update({
        where: { id },
        data: { status: "DEPARTED", actualDepartureAt: now },
      });

      const delayMin = Math.round((now.getTime() - trip.departureAt.getTime()) / 60_000);

      await emit(
        {
          type: "trip.departed",
          tripId: id,
          corridor,
          departureAt: trip.departureAt,
          actualDepartureAt: now,
          delayMin,
          passengers,
        },
        { actorId: user.id, req },
      );

      return ok({ status: "DEPARTED", delayMin, passengers, noShows: noShows.count });
    }

    // ARRIVED: the journey is over, so the bookings on it are complete.
    const completed = await db.booking.updateMany({
      where: { tripId: id, status: "CHECKED_IN" },
      data: { status: "COMPLETED" },
    });

    await db.trip.update({
      where: { id },
      data: { status: "ARRIVED", actualArrivalAt: now },
    });

    const delayMin = Math.round((now.getTime() - trip.arrivalAt.getTime()) / 60_000);

    await emit(
      {
        type: "trip.arrived",
        tripId: id,
        corridor,
        actualArrivalAt: now,
        delayMin,
        completed: completed.count,
      },
      { actorId: user.id, req },
    );

    return ok({ status: "ARRIVED", delayMin, completed: completed.count });
  });
}
