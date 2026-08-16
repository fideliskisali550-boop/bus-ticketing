import { db } from "@/lib/db";
import {
  handler,
  ok,
  parseBody,
  requireCapability,
  notFound,
  badRequest,
  conflict,
  forbidden,
} from "@/lib/api";
import { can } from "@/lib/scope";
import { operatorScope } from "@/lib/scope";
import { verifyActionSchema } from "@/lib/validation";
import { normaliseCode } from "@/lib/verification";
import { audit } from "@/lib/audit";
import { emit } from "@/lib/events";
import { formatDateTimeFull } from "@/lib/time";

/**
 * The ticket-verification desk.
 *
 * A clerk types the short verification code (or the booking reference, or scans
 * the QR), sees the whole booking, and then acts: verify, board, reject, or —
 * for an administrator — undo. The verify step is kept distinct from boarding so
 * "who confirmed this ticket, and when" is answerable, and so a second verify is
 * caught rather than waved through.
 *
 * A passenger cannot reach any of this: the capability is staff-and-admin only,
 * enforced here rather than in the UI, and every lookup is scoped to the caller's
 * own company.
 */

/* -------------------------------------------------------------- GET (find) -- */

export async function GET(req: Request) {
  return handler<unknown>(async () => {
    const user = await requireCapability("VERIFY_TICKETS", req);
    const scope = operatorScope(user);
    const params = new URL(req.url).searchParams;

    const scopeWhere = scope ? { booking: { trip: { bus: { operatorId: scope } } } } : {};

    // Passenger-name search returns a short list to choose from.
    const name = params.get("name")?.trim();
    if (name) {
      if (name.length < 2) throw badRequest("Type at least two letters of a name.");
      const tickets = await db.ticket.findMany({
        where: {
          ...scopeWhere,
          booking: {
            ...(scope ? { trip: { bus: { operatorId: scope } } } : {}),
            OR: [
              { user: { fullName: { contains: name } } },
              { seats: { some: { passengerName: { contains: name } } } },
            ],
          },
        },
        take: 10,
        orderBy: { booking: { trip: { departureAt: "desc" } } },
        select: {
          id: true,
          verificationCode: true,
          verifiedAt: true,
          checkedInAt: true,
          booking: {
            select: {
              reference: true,
              status: true,
              user: { select: { fullName: true } },
              trip: {
                select: {
                  departureAt: true,
                  route: { select: { origin: true, destination: true } },
                },
              },
            },
          },
        },
      });

      return ok({
        matches: tickets.map((t) => ({
          ticketId: t.id,
          verificationCode: t.verificationCode,
          reference: t.booking.reference,
          passenger: t.booking.user.fullName,
          route: `${t.booking.trip.route.origin} – ${t.booking.trip.route.destination}`,
          departureAt: t.booking.trip.departureAt,
          bookingStatus: t.booking.status,
          verified: Boolean(t.verifiedAt),
          boarded: Boolean(t.checkedInAt),
        })),
      });
    }

    // Single lookup by code / reference / QR token.
    const q = params.get("q")?.trim();
    if (!q) throw badRequest("Enter a verification code or booking reference.");

    const upper = normaliseCode(q);
    const found = await db.ticket.findFirst({
      where: {
        AND: [
          scopeWhere,
          {
            OR: [
              { qrToken: q }, // the QR token is case-sensitive
              { verificationCode: upper },
              { booking: { reference: upper } },
            ],
          },
        ],
      },
      select: { id: true },
    });

    if (!found) {
      // A scoped miss is either a genuine typo or a valid code that belongs to
      // another company. Tell the clerk which — reporting a real ticket as "no
      // such code" is exactly what makes a working system look broken.
      if (scope) {
        const elsewhere = await db.ticket.findFirst({
          where: {
            OR: [{ qrToken: q }, { verificationCode: upper }, { booking: { reference: upper } }],
          },
          select: {
            booking: {
              select: {
                trip: { select: { bus: { select: { operator: { select: { name: true } } } } } },
              },
            },
          },
        });
        if (elsewhere) {
          const operator = elsewhere.booking.trip.bus.operator?.name ?? "another company";
          throw forbidden(
            `That ticket belongs to ${operator}. Only ${operator}'s staff, or an administrator, can verify it.`,
          );
        }
      }
      throw notFound("No ticket matches that code. Check it and try again.");
    }

    const detail = await buildDetail(found.id);
    return ok({ ticket: detail });
  });
}

/* ----------------------------------------------------------- POST (action) -- */

export async function POST(req: Request) {
  return handler<unknown>(async () => {
    const staff = await requireCapability("VERIFY_TICKETS", req);
    const { ticketId, action, reason, override } = await parseBody(req, verifyActionSchema);

    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      include: {
        booking: {
          include: {
            seats: true,
            user: { select: { id: true, fullName: true } },
            trip: { select: { departureAt: true, busId: true, bus: { select: { operatorId: true } } } },
          },
        },
      },
    });

    if (!ticket) throw notFound("That ticket could not be found.");

    // Company scoping: an operator's clerk only acts on their own tickets.
    const scope = operatorScope(staff);
    if (scope && ticket.booking.trip.bus.operatorId !== scope) {
      throw forbidden("That ticket belongs to another transport company.");
    }

    const { booking } = ticket;
    const isAdmin = can(staff.role, "OVERRIDE_VERIFICATION");
    const now = new Date();

    if (action === "verify") {
      if (booking.status === "CANCELLED") {
        throw badRequest(`Booking ${booking.reference} was cancelled and cannot be verified.`);
      }
      if (ticket.verifiedAt && !(override && isAdmin)) {
        throw conflict(
          `Ticket ${booking.reference} was already verified. An administrator can re-verify it.`,
        );
      }
      await db.ticket.update({
        where: { id: ticket.id },
        data: { verifiedAt: now, verifiedBy: staff.id },
      });
      await audit({
        userId: staff.id,
        action: "VERIFY_TICKET",
        entity: "Ticket",
        entityId: ticket.id,
        operatorId: ticket.booking.trip.bus.operatorId,
        metadata: { reference: booking.reference, code: ticket.verificationCode, override: Boolean(override) },
        req,
      });
      return ok({ ticket: await buildDetail(ticket.id) });
    }

    if (action === "board") {
      if (booking.status === "CANCELLED") {
        throw badRequest(`Booking ${booking.reference} was cancelled and cannot board.`);
      }
      if (ticket.checkedInAt && !(override && isAdmin)) {
        throw conflict(
          `Ticket ${booking.reference} was already boarded. An administrator can re-board it.`,
        );
      }

      await db.$transaction([
        db.ticket.update({
          where: { id: ticket.id },
          data: {
            checkedInAt: now,
            checkedInBy: staff.id,
            // Boarding implies verification; fill it in if the clerk skipped the
            // explicit step, so the record is never "boarded but unverified".
            verifiedAt: ticket.verifiedAt ?? now,
            verifiedBy: ticket.verifiedBy ?? staff.id,
          },
        }),
        db.booking.update({ where: { id: booking.id }, data: { status: "CHECKED_IN" } }),
        db.bookingSeat.updateMany({
          where: { bookingId: booking.id },
          data: { boardedAt: now, boardedBy: staff.id, noShow: false },
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

      // Boarding is allowed regardless of the clock so a demo is not blocked by
      // seed dates, but an out-of-window boarding is flagged for the clerk.
      const departure = booking.trip.departureAt.getTime();
      const ms = now.getTime();
      const warning =
        departure - ms > 3 * 3_600_000
          ? `Heads up: this departs on ${formatDateTimeFull(booking.trip.departureAt)}, not now.`
          : ms - departure > 3_600_000
            ? "Heads up: this departure has already left."
            : null;

      return ok({ ticket: await buildDetail(ticket.id), warning });
    }

    if (action === "reject") {
      // A rejection is a recorded event, not a mutation: it feeds the "invalid
      // verification attempts" figure and leaves an audit trail of who refused
      // what and why.
      await audit({
        userId: staff.id,
        action: "VERIFY_REJECTED",
        entity: "Ticket",
        entityId: ticket.id,
        operatorId: ticket.booking.trip.bus.operatorId,
        metadata: { reference: booking.reference, code: ticket.verificationCode, reason: reason || null },
        req,
      });
      return ok({ ticket: await buildDetail(ticket.id), rejected: true });
    }

    // action === "cancel": undo a verification/boarding. Administrators only.
    if (!isAdmin) {
      throw forbidden("Only an administrator can cancel a verification.");
    }
    await db.$transaction([
      db.ticket.update({
        where: { id: ticket.id },
        data: { verifiedAt: null, verifiedBy: null, checkedInAt: null, checkedInBy: null },
      }),
      // If it had boarded, return the booking to confirmed and clear the seats.
      ...(booking.status === "CHECKED_IN"
        ? [
            db.booking.update({ where: { id: booking.id }, data: { status: "CONFIRMED" } }),
            db.bookingSeat.updateMany({
              where: { bookingId: booking.id },
              data: { boardedAt: null, boardedBy: null, noShow: false },
            }),
          ]
        : []),
    ]);
    await audit({
      userId: staff.id,
      action: "CANCEL_VERIFICATION",
      entity: "Ticket",
      entityId: ticket.id,
      operatorId: ticket.booking.trip.bus.operatorId,
      metadata: { reference: booking.reference, code: ticket.verificationCode, reason: reason || null },
      req,
    });
    return ok({ ticket: await buildDetail(ticket.id), cancelled: true });
  });
}

/* ------------------------------------------------------------- serialiser -- */

/** Re-reads a ticket fresh and shapes the full verification record for the UI. */
async function buildDetail(ticketId: string) {
  const t = await db.ticket.findUnique({
    where: { id: ticketId },
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
  if (!t) return null;

  const staffIds = [t.verifiedBy, t.checkedInBy].filter((v): v is string => Boolean(v));
  const staff = staffIds.length
    ? await db.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, fullName: true } })
    : [];
  const nameOf = (id: string | null) => (id ? (staff.find((s) => s.id === id)?.fullName ?? null) : null);

  const { booking } = t;
  const amountPaid = booking.payments
    .filter((p) => p.status === "SUCCESS")
    .reduce((sum, p) => sum + (p.kind === "REFUND" ? -p.amount : p.amount), 0);
  const paymentStatus = booking.payments.some((p) => p.status === "SUCCESS" && p.kind === "CHARGE")
    ? "PAID"
    : (booking.payments.at(-1)?.status ?? "UNPAID");

  return {
    ticketId: t.id,
    verificationCode: t.verificationCode,
    reference: booking.reference,
    passenger: booking.user.fullName,
    phone: booking.user.phone,
    nationalId: booking.user.nationalId,
    avatarUrl: booking.user.avatarUrl,
    seats: booking.seats.map((s) => ({ seat: s.seatNumber, name: s.passengerName, idNo: s.passengerIdNo })),
    origin: booking.trip.route.origin,
    destination: booking.trip.route.destination,
    route: `${booking.trip.route.origin} – ${booking.trip.route.destination}`,
    bus: booking.trip.bus.registration,
    busModel: booking.trip.bus.model,
    departureAt: booking.trip.departureAt,
    bookingStatus: booking.status,
    travelStatus: booking.trip.status,
    bookingDate: booking.createdAt,
    amountPaid,
    totalAmount: booking.totalAmount,
    paymentStatus,
    // Verification lifecycle.
    verifiedAt: t.verifiedAt,
    verifiedBy: nameOf(t.verifiedBy),
    boardedAt: t.checkedInAt,
    boardedBy: nameOf(t.checkedInBy),
    isVerified: Boolean(t.verifiedAt),
    isBoarded: Boolean(t.checkedInAt),
  };
}
