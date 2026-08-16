import { handler, ok, requireCapability } from "@/lib/api";
import { buildReport, isReportPeriod, type ReportPeriod } from "@/lib/reports";

/**
 * The reporting dashboard's data. A read-only aggregate over a calendar period,
 * scoped to the caller's operator by `buildReport`. The same function feeds the
 * export endpoint, so what a manager sees on screen is exactly what downloads.
 */
export async function GET(req: Request) {
  return handler(async () => {
    const user = await requireCapability("VIEW_ANALYTICS", req);

    const raw = new URL(req.url).searchParams.get("period") ?? "month";
    const period: ReportPeriod = isReportPeriod(raw) ? raw : "month";

    const report = await buildReport(user, period);
    return ok(report);
  });
}
