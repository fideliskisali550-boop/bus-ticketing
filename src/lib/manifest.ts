import "server-only";
import { db } from "./db";
import { notFound } from "./errors";
import { can, isCrew, type Scoped } from "./scope";
import { forbidden } from "./errors";

/**
 * The passenger manifest — who is on this bus.
 *
 * Nothing in the system could answer that question, which for a transport
 * business is the central operational document. A conductor works from it at
 * the door, a clerk reconciles against it at the gate, and after departure it
 * is the record of who actually travelled.
 *
 * It is derived, never stored. A manifest table would be a second copy of the
 * booking rows and would start disagreeing with them the first time a
 * cancellation was processed while a bus was loading. The single source of
 * truth is `BookingSeat`; this module reads it.
 */

/** What a driver may see: counts, never names. */
export type DriverView = {
  tripId: string;
  corridor: string;
  departureAt: Date;
  arrivalAt: Date;
  status: string;
  bus: { registration: string; model: string; capacity: number };
  expected: number;
  boarded: number;
  noShow: number;
};

export type ManifestSeat = {
  seatNumber: string;
  passengerName: string;
  passengerPhone: string;
  bookingReference: string;
  bookingStatus: string;
  boardedAt: Date | null;
  noShow: boolean;
};

export type Manifest = DriverView & {
  seats: ManifestSeat[];
  conductor: { id: string; fullName: string } | null;
  driver: { id: string; fullName: string } | null;
};

/**
 * Everything a manifest needs, in one query.
 *
 * Only seats on bookings that are actually travelling appear. A cancelled
 * booking's seat rows are deleted on cancellation, so they cannot show up here,
 * but a PENDING hold can — and must not, because an unpaid hold is not a
 * passenger and a conductor counting heads against it would come up short.
 */
export async function getManifest(tripId: string, viewer: Scoped): Promise<Manifest> {
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    include: {
      route: { select: { origin: true, destination: true } },
      bus: {
        select: { registration: true, model: true, capacity: true, operatorId: true },
      },
      driver: { select: { id: true, fullName: true } },
      conductor: { select: { id: true, fullName: true } },
    },
  });

  if (!trip) throw notFound("That departure could not be found.");

  // Crew see the trips they are rostered on and no others; office staff see
  // their own company's.
  if (isCrew(viewer.role)) {
    if (trip.driverId !== viewer.id && trip.conductorId !== viewer.id) {
      throw forbidden("You are not rostered on that departure.");
    }
  } else if (viewer.operatorId && trip.bus.operatorId !== viewer.operatorId) {
    throw forbidden("That departure belongs to another transport company.");
  }

  const seats = await db.bookingSeat.findMany({
    where: {
      tripId,
      booking: { status: { in: ["CONFIRMED", "CHECKED_IN", "COMPLETED"] } },
    },
    orderBy: { seatNumber: "asc" },
    select: {
      seatNumber: true,
      passengerName: true,
      passengerPhone: true,
      boardedAt: true,
      noShow: true,
      booking: { select: { reference: true, status: true } },
    },
  });

  const boarded = seats.filter((s) => s.boardedAt).length;
  const noShow = seats.filter((s) => s.noShow).length;

  const base: DriverView = {
    tripId: trip.id,
    corridor: `${trip.route.origin} – ${trip.route.destination}`,
    departureAt: trip.departureAt,
    arrivalAt: trip.arrivalAt,
    status: trip.status,
    bus: {
      registration: trip.bus.registration,
      model: trip.bus.model,
      capacity: trip.bus.capacity,
    },
    expected: seats.length,
    boarded,
    noShow,
  };

  // A driver has no operational need for passenger names or phone numbers, so
  // they are not sent to one. Data minimisation is cheaper to enforce at the
  // query than to remember in every template.
  const withNames = can(viewer.role, "VIEW_MANIFEST");

  return {
    ...base,
    driver: trip.driver,
    conductor: trip.conductor,
    seats: withNames
      ? seats.map((s) => ({
          seatNumber: s.seatNumber,
          passengerName: s.passengerName,
          passengerPhone: s.passengerPhone,
          bookingReference: s.booking.reference,
          bookingStatus: s.booking.status,
          boardedAt: s.boardedAt,
          noShow: s.noShow,
        }))
      : [],
  };
}

/** Departures a crew member is rostered on, around today. */
export async function rosterFor(userId: string, days = 3) {
  const from = new Date(Date.now() - 12 * 3_600_000);
  const to = new Date(Date.now() + days * 86_400_000);

  return db.trip.findMany({
    where: {
      OR: [{ driverId: userId }, { conductorId: userId }],
      departureAt: { gte: from, lte: to },
      status: { not: "CANCELLED" },
    },
    orderBy: { departureAt: "asc" },
    select: {
      id: true,
      departureAt: true,
      arrivalAt: true,
      status: true,
      seatsBooked: true,
      driverId: true,
      conductorId: true,
      actualDepartureAt: true,
      actualArrivalAt: true,
      route: { select: { origin: true, destination: true } },
      bus: { select: { registration: true, model: true, capacity: true } },
    },
  });
}
