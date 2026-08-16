import PDFDocument from "pdfkit";
import { stopNames } from "@/lib/stops";
import { can } from "@/lib/scope";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { handler, requireUser, notFound, forbidden, badRequest } from "@/lib/api";
import { KES } from "@/lib/policy";
import { formatDepartureLine, formatTime, formatDateTimeFull } from "@/lib/time";

/** Node APIs (Buffer, pdfkit streams) are unavailable on the edge runtime. */
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Renders the boarding pass. Generated on demand rather than stored, so a
 * ticket reprinted after a schedule change always shows current details.
 */
export async function GET(req: Request, { params }: Ctx) {
  return handler(async () => {
    // Downloads are plain links, so the session arrives as ?sid= rather than
    // as the header the fetch helper would normally attach.
    const user = await requireUser(req);
    const { id } = await params;

    const booking = await db.booking.findUnique({
      where: { id },
      include: {
        seats: true,
        ticket: true,
        user: { select: { id: true, fullName: true, email: true, phone: true } },
        trip: { include: { route: true, bus: true } },
        payments: { where: { status: "SUCCESS" }, take: 1 },
      },
    });

    if (!booking) throw notFound("That booking could not be found.");

    const isStaff = can(user.role, "VIEW_ANY_BOOKING") || can(user.role, "CANCEL_ANY_BOOKING");
    if (booking.userId !== user.id && !isStaff) throw forbidden();

    if (!booking.ticket) {
      throw badRequest("No ticket has been issued for this booking yet.");
    }

    const qr = await QRCode.toBuffer(booking.ticket.qrToken, {
      width: 240,
      margin: 1,
      errorCorrectionLevel: "M",
    });

    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));

    const done = new Promise<Buffer>((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
    });

    const ink = "#0f172a";
    const brand = "#0d7a5f";
    const muted = "#64748b";
    const { route, bus } = booking.trip;

    // Header band
    doc.rect(0, 0, doc.page.width, 96).fill(brand);
    doc.fillColor("#ffffff").fontSize(24).font("Helvetica-Bold").text("SafiriConnect", 48, 30);
    doc.fontSize(10).font("Helvetica").text("Boarding Pass · Long-distance Coach Services", 48, 60);
    // Verification code is the headline identifier — what a clerk reads and
    // types at the gate — with the booking reference beneath it.
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#e8e5fb")
      .text("VERIFICATION CODE", 0, 24, { align: "right", width: doc.page.width - 48 });
    doc
      .fontSize(17)
      .font("Helvetica-Bold")
      .fillColor("#ffffff")
      .text(booking.ticket.verificationCode ?? booking.reference, 0, 36, {
        align: "right",
        width: doc.page.width - 48,
      });
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#e8e5fb")
      .text(`Ref ${booking.reference}`, 0, 60, { align: "right", width: doc.page.width - 48 });

    let y = 128;

    doc.fillColor(ink).fontSize(20).font("Helvetica-Bold");
    doc.text(`${route.origin}  →  ${route.destination}`, 48, y);
    y += 30;

    doc.fillColor(muted).fontSize(10).font("Helvetica");
    doc.text(
      `${formatDepartureLine(booking.trip.departureAt)}  ·  arrives ${formatTime(booking.trip.arrivalAt)} EAT`,
      48,
      y,
    );
    y += 28;

    doc.image(qr, doc.page.width - 48 - 130, 128, { width: 130 });
    doc
      .fillColor(muted)
      .fontSize(7)
      .text("Scan at boarding", doc.page.width - 48 - 130, 264, { width: 130, align: "center" });

    /** Two-column label/value grid, kept narrow so the QR block is never overlapped. */
    const field = (label: string, value: string, col: 0 | 1, row: number) => {
      const x = 48 + col * 170;
      const top = y + row * 40;
      doc.fillColor(muted).fontSize(8).font("Helvetica").text(label.toUpperCase(), x, top);
      doc.fillColor(ink).fontSize(12).font("Helvetica-Bold").text(value, x, top + 12, { width: 160 });
    };

    field("Booked by", booking.user.fullName, 0, 0);
    field("Contact", booking.user.phone, 1, 0);
    field("Bus", `${bus.registration}`, 0, 1);
    field("Model", bus.model, 1, 1);
    field("Seats", booking.seats.map((s) => s.seatNumber).join(", "), 0, 2);
    field("Total paid", KES(booking.totalAmount), 1, 2);
    field("Status", booking.status, 0, 3);
    field("Receipt", booking.payments[0]?.receiptNumber ?? "—", 1, 3);

    y += 4 * 40 + 12;

    // Passenger manifest for this booking
    doc.moveTo(48, y).lineTo(doc.page.width - 48, y).strokeColor("#e2e8f0").stroke();
    y += 16;

    doc.fillColor(ink).fontSize(13).font("Helvetica-Bold").text("Passengers", 48, y);
    y += 20;

    doc.fontSize(9).font("Helvetica-Bold").fillColor(muted);
    doc.text("SEAT", 48, y);
    doc.text("NAME", 110, y);
    doc.text("PHONE", 330, y);
    y += 14;

    doc.font("Helvetica").fillColor(ink).fontSize(10);
    for (const seat of booking.seats) {
      doc.text(seat.seatNumber, 48, y);
      doc.text(seat.passengerName, 110, y, { width: 210 });
      doc.text(seat.passengerPhone, 330, y);
      y += 16;
    }

    y += 16;
    if (route.stops) {
      const stops = stopNames(route.stops);
      if (stops.length) {
        doc.fillColor(muted).fontSize(9).text(`Stops: ${stops.join(" · ")}`, 48, y, {
          width: doc.page.width - 96,
        });
        y += 24;
      }
    }

    // Conditions of carriage
    doc.moveTo(48, y).lineTo(doc.page.width - 48, y).strokeColor("#e2e8f0").stroke();
    y += 14;

    doc.fillColor(muted).fontSize(8).font("Helvetica");
    doc.text(
      [
        "Arrive at the terminus at least 30 minutes before departure. This pass must be presented, printed or on screen,",
        "together with the national ID used at booking. Tickets are non-transferable. Cancellations are refunded on a",
        "sliding scale: 100% more than 48 hours before departure, 75% within 48 hours, 50% within 24 hours, and nothing",
        "within 6 hours of departure. SafiriConnect is not liable for delays caused by weather or road conditions.",
      ].join(" "),
      48,
      y,
      { width: doc.page.width - 96, lineGap: 2 },
    );

    doc.fillColor("#94a3b8").fontSize(7);
    doc.text(
      `Issued ${formatDateTimeFull(booking.ticket.issuedAt)} EAT · safiriconnect.co.ke`,
      48,
      doc.page.height - 60,
      { width: doc.page.width - 96, align: "center" },
    );

    doc.end();
    const pdf = await done;

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="SafiriConnect-${booking.reference}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    }) as never;
  });
}
