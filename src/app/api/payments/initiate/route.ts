import { db } from "@/lib/db";
import { handler, ok, parseBody, requireUser, notFound, forbidden, badRequest } from "@/lib/api";
import { payInitSchema } from "@/lib/validation";
import { mpesa, isSimulated } from "@/lib/mpesa";
import { audit } from "@/lib/audit";

export async function POST(req: Request) {
  return handler(async () => {
    const user = await requireUser();
    const { bookingId, method, phone } = await parseBody(req, payInitSchema);

    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: { trip: { include: { route: true } }, user: { select: { phone: true } } },
    });

    if (!booking) throw notFound("That booking could not be found.");
    if (booking.userId !== user.id && user.role === "PASSENGER") throw forbidden();

    if (booking.status === "CONFIRMED") {
      throw badRequest("This booking has already been paid for.");
    }
    if (booking.status !== "PENDING") {
      throw badRequest("This booking can no longer be paid for.");
    }
    // The hold is the whole point of the PENDING state; paying against a lapsed
    // one would take money for seats that have already gone back on sale.
    if (booking.holdsUntil < new Date()) {
      throw badRequest("Your seat hold has expired. Please select your seats again.");
    }

    // Amount comes from the stored booking, never from the request body — a
    // client-supplied price is a client-controlled discount.
    const amount = booking.totalAmount;
    const payerPhone = phone ?? booking.user.phone;

    const push = await mpesa.stkPush({
      phone: payerPhone,
      amount,
      reference: booking.reference,
    });

    const payment = await db.payment.create({
      data: {
        bookingId,
        method,
        status: "PENDING",
        amount,
        phone: payerPhone,
        checkoutRequestId: push.checkoutRequestId,
      },
    });

    await audit({
      userId: user.id,
      action: "PAYMENT_INITIATE",
      entity: "Payment",
      entityId: payment.id,
      metadata: { bookingId, amount, method },
      req,
    });

    return ok({
      paymentId: payment.id,
      checkoutRequestId: push.checkoutRequestId,
      message: push.customerMessage,
      amount,
      phone: payerPhone,
      simulated: isSimulated,
    });
  });
}
