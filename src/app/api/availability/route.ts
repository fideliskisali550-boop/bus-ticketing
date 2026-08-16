import { handler, ok, badRequest } from "@/lib/api";
import { getAvailability } from "@/lib/availability";

/**
 * Day-by-day availability for a corridor, so the date picker can show which
 * days are bookable before the passenger commits to one.
 *
 * The work is done by the availability service, which is also what the journey
 * search runs on. That sharing is the point: this endpoint used to aggregate
 * departures in SQL on its own, matching origin and destination against a
 * single route, and so reported "no service" on days where the search was
 * simultaneously offering eight itineraries with a change. One engine, one
 * answer.
 */
export async function GET(req: Request) {
  return handler(async () => {
    const q = new URL(req.url).searchParams;

    const origin = q.get("origin")?.trim();
    const destination = q.get("destination")?.trim();
    /** First day of the window, yyyy-MM-dd in Kenyan terms. */
    const from = q.get("from");
    const days = Math.min(92, Math.max(1, Number(q.get("days") ?? "35")));
    const minSeats = Math.min(6, Math.max(1, Number(q.get("minSeats") ?? "1")));

    if (!from || Number.isNaN(Date.parse(`${from}T00:00:00Z`))) {
      throw badRequest("Provide `from` as yyyy-MM-dd.");
    }
    if (!origin || !destination) {
      throw badRequest("Provide both `origin` and `destination`.");
    }

    const started = Date.now();
    const result = await getAvailability({ origin, destination, from, days, minSeats });

    return ok(
      { ...result, tookMs: Date.now() - started },
      200,
      // Deliberately uncached. An administrator who adds a departure or cancels
      // one expects to see it on the next refresh, and a thirty-second cache
      // makes the calendar look broken for exactly as long as it takes someone
      // to check their work.
      { "Cache-Control": "no-store" },
    );
  });
}
