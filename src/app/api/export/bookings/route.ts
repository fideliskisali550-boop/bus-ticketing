import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { handler, requireCapability } from "@/lib/api";
import { audit } from "@/lib/audit";
import { formatSortable, toKenyaDateInput } from "@/lib/time";

export const runtime = "nodejs";

/**
 * Sales export for accounting. Produces a genuine .xlsx workbook — a renamed
 * CSV opens with mangled dates and loses the currency formatting that makes the
 * figures readable.
 */
export async function GET(req: Request) {
  return handler(async () => {
    const user = await requireCapability("VIEW_ANALYTICS", req);
    const q = new URL(req.url).searchParams;

    const from = q.get("from") ? new Date(q.get("from")!) : undefined;
    const to = q.get("to") ? new Date(q.get("to")!) : undefined;
    const status = q.get("status");

    const where: Prisma.BookingWhereInput = {
      ...(status && status !== "ALL" ? { status: status as "CONFIRMED" } : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    };

    const bookings = await db.booking.findMany({
      where,
      orderBy: { createdAt: "desc" },
      // Bounded so a wide date range cannot exhaust server memory.
      take: 10_000,
      include: {
        user: { select: { fullName: true, email: true, phone: true } },
        seats: { select: { seatNumber: true, passengerName: true } },
        payments: { where: { status: { in: ["SUCCESS", "REFUNDED"] } }, take: 1 },
        trip: { include: { route: true, bus: { select: { registration: true } } } },
      },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = "SafiriConnect";
    wb.created = new Date();

    const sheet = wb.addWorksheet("Bookings", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    sheet.columns = [
      { header: "Reference", key: "reference", width: 14 },
      { header: "Booked on (EAT)", key: "createdAt", width: 18 },
      { header: "Passenger", key: "passenger", width: 24 },
      { header: "Email", key: "email", width: 28 },
      { header: "Phone", key: "phone", width: 16 },
      { header: "Route", key: "route", width: 26 },
      { header: "Departure (EAT)", key: "departure", width: 18 },
      { header: "Bus", key: "bus", width: 12 },
      { header: "Seats", key: "seats", width: 18 },
      { header: "No. of seats", key: "seatCount", width: 12 },
      { header: "Amount (KES)", key: "amount", width: 15 },
      { header: "Status", key: "status", width: 13 },
      { header: "Payment", key: "method", width: 11 },
      { header: "Receipt", key: "receipt", width: 16 },
      { header: "Refund (KES)", key: "refund", width: 14 },
    ];

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D7A5F" } };
    header.alignment = { vertical: "middle" };
    header.height = 22;

    for (const b of bookings) {
      sheet.addRow({
        reference: b.reference,
        createdAt: formatSortable(b.createdAt),
        passenger: b.user.fullName,
        email: b.user.email,
        phone: b.user.phone,
        route: `${b.trip.route.origin} – ${b.trip.route.destination}`,
        departure: formatSortable(b.trip.departureAt),
        bus: b.trip.bus.registration,
        seats: b.seats.map((s) => s.seatNumber).join(", "),
        seatCount: b.seats.length,
        amount: b.totalAmount,
        status: b.status,
        method: b.payments[0]?.method ?? "—",
        receipt: b.payments[0]?.receiptNumber ?? "—",
        refund: b.refundAmount ?? 0,
      });
    }

    sheet.getColumn("amount").numFmt = "#,##0";
    sheet.getColumn("refund").numFmt = "#,##0";
    sheet.autoFilter = { from: "A1", to: "O1" };

    // Summary sheet so the workbook answers the obvious questions without
    // anyone having to write a pivot table.
    const summary = wb.addWorksheet("Summary");
    const paid = bookings.filter((b) => b.status !== "CANCELLED");
    const gross = paid.reduce((s, b) => s + b.totalAmount, 0);
    const refunded = bookings.reduce((s, b) => s + (b.refundAmount ?? 0), 0);

    summary.columns = [
      { header: "Measure", key: "k", width: 30 },
      { header: "Value", key: "v", width: 22 },
    ];
    summary.getRow(1).font = { bold: true };

    summary.addRows([
      { k: "Report generated", v: formatSortable(new Date()) },
      { k: "Period from", v: from ? toKenyaDateInput(from) : "All time" },
      { k: "Period to", v: to ? toKenyaDateInput(to) : "All time" },
      { k: "Total bookings", v: bookings.length },
      { k: "Seats sold", v: paid.reduce((s, b) => s + b.seats.length, 0) },
      { k: "Cancelled bookings", v: bookings.filter((b) => b.status === "CANCELLED").length },
      { k: "Gross revenue (KES)", v: gross },
      { k: "Refunds issued (KES)", v: refunded },
      { k: "Net revenue (KES)", v: gross - refunded },
    ]);
    summary.getColumn("v").numFmt = "#,##0";

    await audit({
      userId: user.id,
      action: "EXPORT_BOOKINGS",
      entity: "Booking",
      metadata: { rows: bookings.length, from, to, status },
      req,
    });

    const buffer = await wb.xlsx.writeBuffer();

    return new Response(buffer as ArrayBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="SafiriConnect-bookings-${toKenyaDateInput(new Date())}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    }) as never;
  });
}
