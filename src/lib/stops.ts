/**
 * Intermediate stops on a route.
 *
 * A stop started life as a bare name — `["Voi", "Mtito Andei"]` — which is all
 * a passenger needs to read "via Voi". Operations needs more than that: when
 * the bus is due there, and whether it may pick up, set down, or both. A stage
 * that only sets down is a real thing on Kenyan corridors, and a timetable that
 * cannot express it will sell somebody a ticket they cannot use.
 *
 * The richer shape lives in the same `Route.stops` JSON column, so this needed
 * no migration. `parseStops` accepts either form, which means existing rows and
 * anything written before this change keep working untouched — the old bare
 * names simply read as "picks up and sets down, time unknown".
 */

export type RouteStop = {
  name: string;
  /** Minutes after departure that the bus is due here. Null when not timed. */
  offsetMin: number | null;
  /** May passengers board here? */
  pickup: boolean;
  /** May passengers alight here? */
  dropoff: boolean;
};

const DEFAULTS = { offsetMin: null, pickup: true, dropoff: true } as const;

/** Normalises one entry of either shape into a full stop. */
function normalise(entry: unknown): RouteStop | null {
  if (typeof entry === "string") {
    const name = entry.trim();
    return name ? { name, ...DEFAULTS } : null;
  }

  if (entry && typeof entry === "object") {
    const raw = entry as Partial<RouteStop>;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) return null;

    return {
      name,
      offsetMin:
        typeof raw.offsetMin === "number" && Number.isFinite(raw.offsetMin)
          ? Math.max(0, Math.round(raw.offsetMin))
          : null,
      // Absent means yes: a stop nobody marked up is an ordinary one.
      pickup: raw.pickup !== false,
      dropoff: raw.dropoff !== false,
    };
  }

  return null;
}

/**
 * Reads the stored column into stops, tolerating both formats and malformed
 * JSON. A route with an unreadable stops column should render as a direct
 * service, not crash the page that lists it.
 */
export function parseStops(raw: string | null | undefined): RouteStop[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalise).filter((s): s is RouteStop => s !== null);
  } catch {
    return [];
  }
}

/**
 * Just the names, in order.
 *
 * Everything passenger-facing — the "via Voi · Mtito Andei" line, the ticket
 * PDF, the search results — wants this and nothing more, so the API keeps
 * returning it alongside the detailed form and those callers never had to change.
 */
export function stopNames(raw: string | null | undefined): string[] {
  return parseStops(raw).map((s) => s.name);
}

/**
 * Serialises for storage, dropping anything unnamed.
 *
 * Takes `unknown[]` deliberately: callers hand it whatever the request body
 * validated to — bare strings, partially specified objects, a mixture — and
 * `normalise` is the one place that decides what a well-formed stop is. Typing
 * the parameter tightly would only push that same coercion out to every caller.
 */
export function serializeStops(stops: readonly unknown[] | null | undefined): string {
  if (!stops) return "[]";
  const clean = stops.map(normalise).filter((s): s is RouteStop => s !== null);
  return JSON.stringify(clean);
}
