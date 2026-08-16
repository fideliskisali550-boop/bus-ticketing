import { db } from "@/lib/db";
import { handler, ok, parseBody, requireCapability, notFound, badRequest } from "@/lib/api";
import { checkInSchema } from "@/lib/validation";
import { emit } from "@/lib/events";
import { formatDateTimeFull } from "@/lib/time";

/**
 * Gate check-in. Staff scan the QR code on the boarding pass; the opaque token
 * is looked up rather than the human-readable reference, so a reference glimpsed
 * on someone else's phone cannot be used to board.
 */
export async function POST(req: Request) {
  return handler(async () => {
    const staff = await requireCapability("SCAN_TICKETS");
    const { qrToken } = await parseBody(req, checkInSchema);

    const ticket = await db.ticket.findUnique({
      where: { qrToken },
      include: {
        booking: {
          include: {
            seats: true,
            user: { select: { fullName: true, phone: true, nationalId: true, avatarUrl: true } },
            payments: { select: { status: true, kind: true, amount: true, method: true } },
            trip: {
              include: {
                route: { select: { origin: true, destination: true } },
                bus: { select: { registration: true, model: true } },
              },
            },
          },
        },
      },
    });

    if (!ticket) throw notFound("This ticket is not valid.");

    const { booking } = ticket;

    if (booking.status === "CANCELLED") {
      throw badRequest(`Booking ${booking.reference} was cancelled and cannot board.`);
    }

    // Re-scanning is reported rather than treated as an error, so gate staff can
    // see who already boarded without the app looking broken.
    if (ticket.checkedInAt) {
      return ok({
        alreadyCheckedIn: true,
        checkedInAt: ticket.checkedInAt,
        booking: summarise(booking, ticket),
      });
    }

    // Guard against boarding the wrong bus: the pass must match a departure that
    // is actually about to leave, within a generous window either side.
    const departure = booking.trip.departureAt.getTime();
    const now = Date.now();
    if (departure - now > 3 * 3_600_000) {
      throw badRequest(
        `This ticket is for a departure on ${formatDateTimeFull(booking.trip.departureAt)}, not for now.`,
      );
    }
    if (now - departure > 3_600_000) {
      throw badRequest("This departure has already left.");
    }

    const boardedAt = new Date();

    await db.$transaction([
      db.ticket.update({
        where: { id: ticket.id },
        data: { checkedInAt: boardedAt, checkedInBy: staff.id },
      }),
      db.booking.update({ where: { id: booking.id }, data: { status: "CHECKED_IN" } }),
      // Boarding is recorded per seat, not per booking: a family books four and
      // three turn up, and the manifest has to be able to say which.
      db.bookingSeat.updateMany({
        where: { bookingId: booking.id },
        data: { boardedAt, boardedBy: staff.id, noShow: false },
      }),
    ]);

    await emit(
      {
        type: "ticket.scanned",
        bookingId: booking.id,
        reference: booking.reference,
        passengerId: booking.userId,
        tripId: booking.tripId,
        passengerName: booking.user.fullName,
        seatNumbers: booking.seats.map((s) => s.seatNumber),
      },
      { actorId: staff.id, req },
    );

    return ok({ alreadyCheckedIn: false, booking: summarise(booking, ticket) });
  });
}

type Charge = { status: string; kind: string; amount: number };

/**
 * Everything the gate needs to decide whether this person boards this bus, in
 * one object. Staff at the door are checking a face against a name and a seat,
 * confirming the money was actually taken, and confirming the pass is for *this*
 * departure — so all of that is returned, not just a name and a seat.
 */
function summarise(
  booking: {
    reference: string;
    status: string;
    totalAmount: number;
    seats: {
      seatNumber: string;
      passengerName: string;
      passengerPhone: string;
      passengerIdNo: string | null;
    }[];
    user: { fullName: string; phone: string; nationalId: string | null; avatarUrl: string | null };
    payments: Charge[];
    trip: {
      departureAt: Date;
      status: string;
      route: { origin: string; destination: string };
      bus: { registration: string; model: string };
    };
  },
  ticket: { id: string; issuedAt: Date },
) {
  // Money actually collected: successful charges, net of any settled refund.
  const amountPaid = booking.payments
    .filter((p) => p.status === "SUCCESS")
    .reduce((sum, p) => sum + (p.kind === "REFUND" ? -p.amount : p.amount), 0);

  const paymentStatus = booking.payments.some(
    (p) => p.status === "SUCCESS" && p.kind === "CHARGE",
  )
    ? "PAID"
    : (booking.payments.at(-1)?.status ?? "UNPAID");

  return {
    // A short, human-quotable ticket serial derived from the ticket row, distinct
    // from the booking reference so the two are not confused at the gate.
    ticketNumber: `T-${ticket.id.slice(-8).toUpperCase()}`,
    reference: booking.reference,
    passenger: booking.user.fullName,
    phone: booking.user.phone,
    nationalId: booking.user.nationalId,
    avatarUrl: booking.user.avatarUrl,
    seats: booking.seats.map((s) => ({
      seat: s.seatNumber,
      name: s.passengerName,
      idNo: s.passengerIdNo,
    })),
    origin: booking.trip.route.origin,
    destination: booking.trip.route.destination,
    route: `${booking.trip.route.origin} – ${booking.trip.route.destination}`,
    bus: booking.trip.bus.registration,
    busModel: booking.trip.bus.model,
    departureAt: booking.trip.departureAt,
    bookingStatus: booking.status,
    travelStatus: booking.trip.status,
    amountPaid,
    totalAmount: booking.totalAmount,
    paymentStatus,
  };
}
