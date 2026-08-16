import { db } from "@/lib/db";
import { stopNames } from "@/lib/stops";
import { handler, ok, parseBody, requireCapability, notFound, badRequest } from "@/lib/api";
import { tripUpdateSchema } from "@/lib/validation";
import { takenSeats } from "@/lib/bookings";
import { buildSeatMap, isBookable } from "@/lib/policy";
import { audit } from "@/lib/audit";
import { emit } from "@/lib/events";
import { requestRefund } from "@/lib/refunds";
import { notify } from "@/lib/notify";

type Ctx = { params: Promise<{ id: string }> };

/** Full trip detail including the rendered seat map and current occupancy. */
export async function GET(_req: Request, { params }: Ctx) {
  return handler(async () => {
    const { id } = await params;

    const trip = await db.trip.findUnique({
      where: { id },
      include: { route: true, bus: true, driver: { select: { fullName: true } } },
    });

    if (!trip) throw notFound("That trip could not be found.");

    const taken = await takenSeats(trip.id);

    return ok({
      trip: {
        id: trip.id,
        departureAt: trip.departureAt,
        arrivalAt: trip.arrivalAt,
        fare: trip.fare,
        status: trip.status,
        capacity: trip.bus.capacity,
        seatsAvailable: trip.bus.capacity - taken.length,
        bookable: isBookable(trip.departureAt, trip.status),
        driverName: trip.driver?.fullName ?? null,
        route: {
          origin: trip.route.origin,
          destination: trip.route.destination,
          distanceKm: trip.route.distanceKm,
          durationMin: trip.route.durationMin,
          stops: stopNames(trip.route.stops),
        },
        bus: {
          registration: trip.bus.registration,
          model: trip.bus.model,
          hasWifi: trip.bus.hasWifi,
          hasChargingPorts: trip.bus.hasChargingPorts,
          hasToilet: trip.bus.hasToilet,
          hasAirCon: trip.bus.hasAirCon,
        },
      },
      seatMap: buildSeatMap(trip.bus.capacity, trip.bus.seatsPerRow, trip.bus.aisleAfter),
      takenSeats: taken,
    });
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  return handler(async () => {
    const user = await requireCapability("MANAGE_SCHEDULE");
    const { id } = await params;
    const data = await parseBody(req, tripUpdateSchema);

    const existing = await db.trip.findUnique({
      where: { id },
      include: { route: true },
    });
    if (!existing) throw notFound("That trip could not be found.");

    const trip = await db.trip.update({
      where: { id },
      data: {
        ...data,
        driverId: data.driverId === "" ? null : data.driverId,
      },
      include: { route: true, bus: true },
    });

    // Cancelling a departure must reach the people booked on it — silently
    // flipping the status would strand passengers at the terminus.
    if (data.status === "CANCELLED" && existing.status !== "CANCELLED") {
      const affected = await db.booking.findMany({
        where: { tripId: id, status: { in: ["PENDING", "CONFIRMED"] } },
        select: { id: true, userId: true, reference: true, totalAmount: true },
      });

      await db.booking.updateMany({
        where: { id: { in: affected.map((b) => b.id) } },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelReason: "Trip cancelled by the operator",
        },
      });

      // Operator-side cancellation is always refunded in full, regardless of
      // how close to departure it happens — the passenger is not at fault.
      for (const booking of affected) {
        await db.booking.update({
          where: { id: booking.id },
          data: { refundAmount: booking.totalAmount },
        });

        // Auto-approved: the passenger did nothing wrong, so making them wait
        // on a finance queue for the operator's own cancellation would be
        // indefensible.
        await requestRefund({
          bookingId: booking.id,
          amount: booking.totalAmount,
          percent: 100,
          reason: "Trip cancelled by the operator",
          requestedById: user.id,
          autoApprove: true,
          req,
        });
        await notify({
          userId: booking.userId,
          title: "Your trip has been cancelled",
          body: `Booking ${booking.reference} for ${trip.route.origin} – ${trip.route.destination} was cancelled by the operator. A full refund has been issued.`,
          link: `/bookings/${booking.id}`,
          alsoEmail: true,
          alsoSms: true,
        });
      }

      await db.bookingSeat.deleteMany({ where: { bookingId: { in: affected.map((b) => b.id) } } });
      await db.trip.update({ where: { id }, data: { seatsBooked: 0 } });

      // Passengers are told individually above, because each message names
      // their own booking. This tells the operations side that a departure has
      // gone, which nobody used to hear at all.
      await emit(
        {
          type: "trip.cancelled",
          tripId: id,
          corridor: `${trip.route.origin} – ${trip.route.destination}`,
          departureAt: trip.departureAt,
          affected: affected.length,
        },
        { actorId: user.id, req },
      );
    }

    await audit({ userId: user.id, action: "TRIP_UPDATE", entity: "Trip", entityId: id, metadata: data, req });
    return ok({ trip });
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return handler(async () => {
    const user = await requireCapability("MANAGE_SCHEDULE");
    const { id } = await params;

    const active = await db.booking.count({
      where: { tripId: id, status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] } },
    });

    // Deleting a trip with live bookings would orphan paying passengers.
    // Cancelling it instead keeps the history and triggers refunds.
    if (active > 0) {
      throw badRequest(
        `This trip has ${active} active booking${active === 1 ? "" : "s"}. Cancel the trip instead of deleting it.`,
      );
    }

    await db.trip.delete({ where: { id } });
    await audit({ userId: user.id, action: "TRIP_DELETE", entity: "Trip", entityId: id, req });
    return ok({ success: true });
  });
}
