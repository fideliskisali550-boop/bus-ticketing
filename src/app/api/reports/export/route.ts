import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { handler, requireCapability, badRequest } from "@/lib/api";
import { audit } from "@/lib/audit";
import { buildReport, isReportPeriod, type Report, type ReportPeriod } from "@/lib/reports";
import { KES } from "@/lib/policy";
import { formatDateTimeFull } from "@/lib/time";

/** pdfkit and exceljs need Node APIs that the edge runtime does not provide. */
export const runtime = "nodejs";

type Format = "csv" | "xlsx" | "pdf";
const FORMATS: Format[] = ["csv", "xlsx", "pdf"];

/**
 * Downloads a period report as a spreadsheet, workbook or PDF. A download is a
 * plain link, so the session arrives as `?sid=` rather than as the header the
 * fetch helper attaches — `requireCapability` reads it from the request.
 *
 * Every format is rendered from the one `buildReport`, so the figures never
 * drift between the screen and the file, and the export is audited like the
 * bookings export it sits beside.
 */
export async function GET(req: Request) {
  return handler(async () => {
    const user = await requireCapability("VIEW_ANALYTICS", req);
    const q = new URL(req.url).searchParams;

    const rawPeriod = q.get("period") ?? "month";
    const period: ReportPeriod = isReportPeriod(rawPeriod) ? rawPeriod : "month";

    const rawFormat = (q.get("format") ?? "xlsx").toLowerCase();
    if (!FORMATS.includes(rawFormat as Format)) {
      throw badRequest("Unsupported export format. Use csv, xlsx or pdf.");
    }
    const format = rawFormat as Format;

    const report = await buildReport(user, period);

    await audit({
      userId: user.id,
      action: "EXPORT_REPORT",
      entity: "Report",
      metadata: { period, format, from: report.range.from, to: report.range.to },
      req,
    });

    const base = `SafiriConnect-${period}-report-${report.range.from}`;

    if (format === "csv") {
      return file(toCsv(report), "text/csv; charset=utf-8", `${base}.csv`);
    }
    if (format === "pdf") {
      return file(
        await toPdf(report),
        "application/pdf",
        `${base}.pdf`,
      );
    }
    return file(
      await toXlsx(report),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      `${base}.xlsx`,
    );
  });
}

function file(body: string | Uint8Array, contentType: string, filename: string) {
  return new Response(typeof body === "string" ? body : (body as BodyInit), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  }) as never;
}

/* ----------------------------------------------------------------- CSV ---- */

/** RFC-4180 escaping: quote fields, double any embedded quote. */
const cell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (...cells: unknown[]) => cells.map(cell).join(",");

function toCsv(r: Report): string {
  const s = r.summary;
  const lines: string[] = [
    row("SafiriConnect report"),
    row("Operator", r.operator),
    row("Period", periodTitle(r)),
    row("Generated", formatDateTimeFull(r.generatedAt), "by", r.generatedBy),
    "",
    row("Summary", "Value"),
    row("Revenue (KES)", s.revenue),
    row("Bookings", s.bookings),
    row("Passengers (seats)", s.passengers),
    row("Tickets verified", s.ticketsVerified),
    row("Completed trips", s.completedTrips),
    row("Active buses", s.activeBuses),
    row("Cancellations", s.cancellations),
    row("Fleet occupancy (%)", s.occupancy),
    row("Average fare (KES)", s.averageFare),
    "",
    row("Trend", "Revenue (KES)", "Bookings"),
    ...r.series.map((p) => row(p.label, p.revenue, p.bookings)),
    "",
    row("Route", "Revenue (KES)", "Bookings", "Seats"),
    ...r.routePerformance.map((p) => row(p.route, p.revenue, p.bookings, p.seats)),
    "",
    row("Payment method", "Count", "Amount (KES)"),
    ...r.paymentMethods.map((p) => row(p.method, p.count, p.amount)),
    "",
    row("Booking status", "Count"),
    ...r.statusBreakdown.map((p) => row(p.status, p.count)),
  ];
  return lines.join("\r\n");
}

/* --------------------------------------------------------------- Excel ---- */

async function toXlsx(r: Report): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SafiriConnect";
  wb.created = new Date();

  const brandFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6D5AE6" } } as const;
  const headerRow = (sheet: ReturnType<typeof wb.addWorksheet>) => {
    const h = sheet.getRow(1);
    h.font = { bold: true, color: { argb: "FFFFFFFF" } };
    h.fill = brandFill;
    h.alignment = { vertical: "middle" };
    h.height = 22;
  };

  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Measure", key: "k", width: 30 },
    { header: "Value", key: "v", width: 24 },
  ];
  headerRow(summary);
  const s = r.summary;
  summary.addRows([
    { k: "Operator", v: r.operator },
    { k: "Period", v: periodTitle(r) },
    { k: "Generated", v: formatDateTimeFull(r.generatedAt) },
    { k: "Generated by", v: r.generatedBy },
    { k: "Revenue (KES)", v: s.revenue },
    { k: "Bookings", v: s.bookings },
    { k: "Passengers (seats)", v: s.passengers },
    { k: "Tickets verified", v: s.ticketsVerified },
    { k: "Completed trips", v: s.completedTrips },
    { k: "Active buses", v: s.activeBuses },
    { k: "Cancellations", v: s.cancellations },
    { k: "Fleet occupancy (%)", v: s.occupancy },
    { k: "Average fare (KES)", v: s.averageFare },
  ]);

  const trend = wb.addWorksheet("Trend");
  trend.columns = [
    { header: "Period", key: "label", width: 16 },
    { header: "Revenue (KES)", key: "revenue", width: 16 },
    { header: "Bookings", key: "bookings", width: 12 },
  ];
  headerRow(trend);
  r.series.forEach((p) => trend.addRow(p));
  trend.getColumn("revenue").numFmt = "#,##0";

  const routes = wb.addWorksheet("Routes");
  routes.columns = [
    { header: "Route", key: "route", width: 30 },
    { header: "Revenue (KES)", key: "revenue", width: 16 },
    { header: "Bookings", key: "bookings", width: 12 },
    { header: "Seats", key: "seats", width: 10 },
  ];
  headerRow(routes);
  r.routePerformance.forEach((p) => routes.addRow(p));
  routes.getColumn("revenue").numFmt = "#,##0";

  const methods = wb.addWorksheet("Payments");
  methods.columns = [
    { header: "Method", key: "method", width: 16 },
    { header: "Count", key: "count", width: 10 },
    { header: "Amount (KES)", key: "amount", width: 16 },
  ];
  headerRow(methods);
  r.paymentMethods.forEach((p) => methods.addRow(p));
  methods.getColumn("amount").numFmt = "#,##0";

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

/* ----------------------------------------------------------------- PDF ---- */

async function toPdf(r: Report): Promise<Uint8Array> {
  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const ink = "#0f172a";
  const brand = "#6d5ae6";
  const muted = "#64748b";
  const line = "#e2e8f0";
  const left = 48;
  const width = doc.page.width - 96;

  // Header band
  doc.rect(0, 0, doc.page.width, 92).fill(brand);
  doc.fillColor("#ffffff").fontSize(22).font("Helvetica-Bold").text("SafiriConnect", left, 28);
  doc.fontSize(11).font("Helvetica").text(`${periodTitle(r)} — operations report`, left, 58);
  doc
    .fontSize(9)
    .text(r.operator, 0, 34, { align: "right", width: doc.page.width - left });

  let y = 118;
  const s = r.summary;

  // Summary KPI grid, three across.
  const cells: [string, string][] = [
    ["Revenue", KES(s.revenue)],
    ["Bookings", s.bookings.toLocaleString()],
    ["Passengers", s.passengers.toLocaleString()],
    ["Tickets verified", s.ticketsVerified.toLocaleString()],
    ["Completed trips", s.completedTrips.toLocaleString()],
    ["Active buses", s.activeBuses.toLocaleString()],
    ["Cancellations", s.cancellations.toLocaleString()],
    ["Fleet occupancy", `${s.occupancy}%`],
    ["Average fare", KES(s.averageFare)],
  ];
  const colW = width / 3;
  cells.forEach(([label, value], i) => {
    const cx = left + (i % 3) * colW;
    const cy = y + Math.floor(i / 3) * 52;
    doc.fillColor(muted).fontSize(8).font("Helvetica").text(label.toUpperCase(), cx, cy);
    doc.fillColor(ink).fontSize(15).font("Helvetica-Bold").text(value, cx, cy + 12, { width: colW - 8 });
  });
  y += Math.ceil(cells.length / 3) * 52 + 8;

  const table = (
    title: string,
    headers: string[],
    rows: (string | number)[][],
    widths: number[],
  ) => {
    if (y > doc.page.height - 140) {
      doc.addPage();
      y = 56;
    }
    doc.fillColor(ink).fontSize(13).font("Helvetica-Bold").text(title, left, y);
    y += 20;
    doc.moveTo(left, y).lineTo(left + width, y).strokeColor(line).stroke();
    y += 8;

    doc.fontSize(9).font("Helvetica-Bold").fillColor(muted);
    let x = left;
    headers.forEach((h, i) => {
      doc.text(h.toUpperCase(), x, y, { width: widths[i]!, align: i === 0 ? "left" : "right" });
      x += widths[i]!;
    });
    y += 16;

    doc.font("Helvetica").fillColor(ink).fontSize(10);
    for (const r0 of rows) {
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = 56;
      }
      x = left;
      r0.forEach((val, i) => {
        doc.fillColor(i === 0 ? ink : muted).text(String(val), x, y, {
          width: widths[i]!,
          align: i === 0 ? "left" : "right",
        });
        x += widths[i]!;
      });
      y += 15;
    }
    y += 18;
  };

  table(
    "Route performance",
    ["Route", "Revenue", "Bookings", "Seats"],
    r.routePerformance.map((p) => [p.route, KES(p.revenue), p.bookings, p.seats]),
    [width - 210, 110, 60, 40],
  );

  table(
    "Payment methods",
    ["Method", "Count", "Amount"],
    r.paymentMethods.map((p) => [p.method, p.count, KES(p.amount)]),
    [width - 200, 80, 120],
  );

  doc
    .fillColor("#94a3b8")
    .fontSize(8)
    .text(
      `Generated ${formatDateTimeFull(r.generatedAt)} EAT by ${r.generatedBy} · safiriconnect.co.ke`,
      left,
      doc.page.height - 54,
      { width, align: "center" },
    );

  doc.end();
  const pdf = await done;
  return new Uint8Array(pdf);
}

function periodTitle(r: Report): string {
  const noun = { day: "Daily", week: "Weekly", month: "Monthly", year: "Annual" }[r.period];
  return `${noun} report · ${r.label}`;
}
