import { db } from "@/lib/db";
import { stopNames } from "@/lib/stops";
import { handler, ok, requireUser, notFound, forbidden } from "@/lib/api";
import { can, assertSameOperator } from "@/lib/scope";
import { refundFor } from "@/lib/policy";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handler(async () => {
    const user = await requireUser();
    const { id } = await params;

    const booking = await db.booking.findUnique({
      where: { id },
      include: {
        seats: true,
        payments: { orderBy: { createdAt: "desc" } },
        ticket: true,
        user: { select: { id: true, fullName: true, email: true, phone: true } },
        trip: {
          include: {
            route: true,
            bus: true,
            driver: { select: { fullName: true } },
          },
        },
      },
    });

    if (!booking) throw notFound("That booking could not be found.");

    // An object-level check, not just a route-level one: knowing a booking id
    // must not be enough to read someone else's passenger details.
    const isStaff = can(user.role, "VIEW_ANY_BOOKING") || can(user.role, "CANCEL_ANY_BOOKING");
    if (booking.userId !== user.id && !isStaff) throw forbidden();

    return ok({
      booking: {
        ...booking,
        trip: {
          ...booking.trip,
          route: {
            ...booking.trip.route,
            stops: stopNames(booking.trip.route.stops),
          },
        },
        // Shown on the detail page so the passenger knows what cancelling now
        // would actually return to them, before they commit to it.
        refundPreview:
          booking.status === "CONFIRMED"
            ? refundFor(booking.totalAmount, booking.trip.departureAt)
            : null,
      },
    });
  });
}
