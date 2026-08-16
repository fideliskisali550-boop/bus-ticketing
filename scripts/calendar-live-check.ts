export {};

/**
 * Proves the calendar tracks the timetable rather than a snapshot of it.
 *
 * Adds a departure on a day the corridor has no service, checks the calendar
 * turns that day on, cancels the departure, checks it turns back off, then
 * fills a bus and checks the day reports as sold out. Nothing here touches the
 * calendar code — if it is genuinely reading live data these all pass on their
 * own.
 *
 *   npx tsx scripts/calendar-live-check.ts [baseUrl]
 */

import { PrismaClient } from "@prisma/client";

const BASE_URL = process.argv[2] ?? "http://localhost:3000";
const db = new PrismaClient();

const kenyanDayStart = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`) - 3 * 3_600_000;

type Day = { date: string; status: string; journeys: number; seatsLeft: number };

async function dayStatus(origin: string, destination: string, date: string): Promise<Day> {
  const res = await fetch(
    `${BASE_URL}/api/availability?origin=${origin}&destination=${destination}&from=${date}&days=1`,
  );
  const body = (await res.json()) as { calendar: Day[] };
  return body.calendar[0]!;
}

let failures = 0;

function expect(label: string, actual: unknown, wanted: unknown) {
  const pass = actual === wanted;
  if (!pass) failures++;
  console.log(`  ${pass ? "ok  " : "FAIL"} ${label}: ${actual}${pass ? "" : ` (wanted ${wanted})`}`);
}

async function main() {
  // A direct corridor, so the test measures the timetable and not the planner's
  // willingness to route around the change.
  const route = await db.route.findFirst({
    where: { isActive: true },
    select: { id: true, origin: true, destination: true, durationMin: true, baseFare: true },
  });
  if (!route) throw new Error("No routes seeded.");

  const bus = await db.bus.findFirst({ select: { id: true, capacity: true } });
  if (!bus) throw new Error("No buses seeded.");

  // Far enough out that the seeded timetable has run dry.
  const date = new Date(Date.now() + 75 * 86_400_000).toISOString().slice(0, 10);
  const departureAt = new Date(kenyanDayStart(date) + 9 * 3_600_000);
  const arrivalAt = new Date(departureAt.getTime() + route.durationMin * 60_000);

  console.log(`${route.origin} -> ${route.destination} on ${date}\n`);

  console.log("baseline (no departure scheduled)");
  const before = await dayStatus(route.origin, route.destination, date);
  expect("status", before.status, "none");

  console.log("\nafter scheduling a departure");
  const trip = await db.trip.create({
    data: {
      routeId: route.id,
      busId: bus.id,
      departureAt,
      arrivalAt,
      fare: route.baseFare,
      status: "SCHEDULED",
      seatsBooked: 0,
    },
  });
  const added = await dayStatus(route.origin, route.destination, date);
  expect("status", added.status, "available");
  expect("journeys", added.journeys, 1);
  expect("seats", added.seatsLeft, bus.capacity);

  console.log("\nafter selling every seat");
  await db.trip.update({
    where: { id: trip.id },
    data: { seatsBooked: bus.capacity },
  });
  const full = await dayStatus(route.origin, route.destination, date);
  expect("status", full.status, "soldout");

  console.log("\nafter cancelling the departure");
  await db.trip.update({
    where: { id: trip.id },
    data: { seatsBooked: 0, status: "CANCELLED" },
  });
  const cancelled = await dayStatus(route.origin, route.destination, date);
  expect("status", cancelled.status, "none");

  await db.trip.delete({ where: { id: trip.id } });
  console.log(`\n(test departure removed)`);

  console.log(failures ? `\nFAILED with ${failures} assertion(s)` : "\nCalendar tracks live data.");
  await db.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
