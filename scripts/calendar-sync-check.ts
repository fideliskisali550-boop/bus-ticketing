/**
 * Proves the calendar and the search agree.
 *
 * Both are asked over HTTP, against the running application, because that is
 * the pairing the passenger actually sees — the calendar drawn from
 * /api/availability sitting directly above the results drawn from
 * /api/journeys. A day the search can serve but the calendar greys out is the
 * exact defect this check exists to catch, and it fails the run.
 *
 *   npx tsx scripts/calendar-sync-check.ts [baseUrl]
 */

export {};

const BASE = process.argv[2] ?? "http://localhost:3000";

const CORRIDORS: [string, string][] = [
  ["Bomet", "Chuka"],
  ["Chuka", "Bomet"],
  ["Chuka", "Kisumu"],
  ["Nakuru", "Mombasa"],
  ["Meru", "Kampala"],
  ["Eldoret", "Kigali"],
];

/** Days sampled per corridor — enough to catch a systematic mismatch. */
const SAMPLE = 8;

type Day = {
  date: string;
  status: string;
  journeys: number;
  direct: number;
  seatsLeft: number;
  requiresTransfer: boolean;
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  const body = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(body)}`);
  return body as T;
}

/** Midnight in Nairobi, as a UTC instant. */
const kenyanDayStart = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`) - 3 * 3_600_000;

const todayInKenya = () =>
  new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

async function main() {
  const from = todayInKenya();
  let failures = 0;
  const timings: number[] = [];

  for (const [origin, destination] of CORRIDORS) {
    const started = Date.now();
    const availability = await get<{
      calendar: Day[];
      summary: { bookableDays: number; firstAvailable: string | null; pathExists: boolean };
    }>(`/api/availability?origin=${origin}&destination=${destination}&from=${from}&days=30`);
    const calendarMs = Date.now() - started;
    timings.push(calendarMs);

    const { calendar, summary } = availability;

    console.log(
      `\n${origin} -> ${destination}  ${summary.bookableDays}/30 days bookable  ` +
        `first ${summary.firstAvailable ?? "none"}  ${calendarMs}ms`,
    );

    const step = Math.max(1, Math.floor(calendar.length / SAMPLE));

    for (let i = 0; i < calendar.length; i += step) {
      const day = calendar[i]!;

      const plan = await get<{ journeys: { departureAt: string }[] }>(
        `/api/journeys?origin=${origin}&destination=${destination}&date=${day.date}`,
      );

      // Only itineraries that actually start on the day in question count; the
      // planner deliberately looks a little past it.
      const dayEnd = kenyanDayStart(day.date) + 86_400_000;
      const sameDay = plan.journeys.filter((j) => Date.parse(j.departureAt) < dayEnd);

      const calendarSays = day.journeys > 0;
      const searchSays = sameDay.length > 0;

      if (calendarSays !== searchSays) {
        failures++;
        console.log(
          `  MISMATCH ${day.date}: calendar=${day.status} (${day.journeys}) ` +
            `search=${sameDay.length} journeys`,
        );
      } else {
        console.log(
          `  ok ${day.date}  ${day.status.padEnd(9)} ` +
            `cal ${day.journeys} / search ${sameDay.length}` +
            (day.requiresTransfer ? "  (change needed)" : ""),
        );
      }
    }
  }

  timings.sort((a, b) => a - b);
  console.log(
    `\ncalendar: median ${timings[timings.length >> 1]}ms, slowest ${timings[timings.length - 1]}ms`,
  );
  console.log(failures ? `FAILED with ${failures} mismatch(es)` : "All sampled days agree.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
