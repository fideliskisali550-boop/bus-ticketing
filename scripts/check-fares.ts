/**
 * Sanity check on seeded pricing: prints the actual fare range passengers will
 * see on key corridors, so the numbers can be compared against real-world rates
 * rather than taken on trust.
 *
 *   npx tsx scripts/check-fares.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/** Corridors with a known real-world fare, and what that fare actually is. */
const BENCHMARKS: { origin: string; destination: string; expected: [number, number] }[] = [
  { origin: "Nakuru", destination: "Nairobi", expected: [400, 700] },
  // Premium coaches on this corridor genuinely charge 2,500-3,500, so the
  // upper bound reflects executive service, not just the economy walk-up rate.
  { origin: "Nairobi", destination: "Mombasa", expected: [1500, 3500] },
  { origin: "Kisumu", destination: "Nairobi", expected: [1200, 2200] },
  { origin: "Eldoret", destination: "Nairobi", expected: [1000, 2000] },
  { origin: "Nairobi", destination: "Nyeri", expected: [400, 900] },
  { origin: "Nairobi", destination: "Kisii", expected: [1000, 1900] },
  { origin: "Nairobi", destination: "Arusha", expected: [1500, 3200] },
  { origin: "Nairobi", destination: "Kampala", expected: [2200, 4500] },
  { origin: "Nairobi", destination: "Kigali", expected: [4000, 8000] },
  { origin: "Nairobi", destination: "Dar es Salaam", expected: [3000, 7000] },
];

async function main() {
  console.log("Corridor                        base   observed fare range   expected        class spread");
  console.log("─".repeat(100));

  let failures = 0;

  for (const b of BENCHMARKS) {
    const route = await db.route.findFirst({
      where: { origin: b.origin, destination: b.destination },
      include: {
        trips: {
          where: { departureAt: { gte: new Date() } },
          include: { bus: { select: { vehicleClass: true } } },
        },
      },
    });

    if (!route) {
      console.log(`${(b.origin + " → " + b.destination).padEnd(30)} ROUTE NOT FOUND`);
      failures++;
      continue;
    }

    const fares = route.trips.map((t) => t.fare);
    if (!fares.length) {
      console.log(`${(b.origin + " → " + b.destination).padEnd(30)} ${String(route.baseFare).padStart(5)}   (no upcoming departures)`);
      continue;
    }

    const min = Math.min(...fares);
    const max = Math.max(...fares);

    // Cheapest and dearest by class, to show the tiering is doing something.
    const byClass = new Map<string, number[]>();
    for (const t of route.trips) {
      const k = t.bus.vehicleClass;
      if (!byClass.has(k)) byClass.set(k, []);
      byClass.get(k)!.push(t.fare);
    }
    const spread = [...byClass.entries()]
      .sort()
      .map(([k, v]) => `${k[0]}${k.slice(1, 3).toLowerCase()} ${Math.min(...v)}`)
      .join("  ");

    const withinRange = min >= b.expected[0] * 0.8 && max <= b.expected[1] * 1.25;
    if (!withinRange) failures++;

    console.log(
      `${(b.origin + " → " + b.destination).padEnd(30)} ` +
        `${String(route.baseFare).padStart(5)}   ` +
        `${String(min).padStart(6)}–${String(max).padEnd(12)} ` +
        `${(b.expected[0] + "–" + b.expected[1]).padEnd(15)} ` +
        `${spread}  ${withinRange ? "OK" : "<-- OUT OF RANGE"}`,
    );
  }

  // Nothing anywhere in the network should be absurd.
  const extremes = await db.trip.findMany({
    where: { departureAt: { gte: new Date() } },
    orderBy: { fare: "desc" },
    take: 3,
    include: { route: { select: { origin: true, destination: true, baseFare: true } } },
  });

  console.log("\nHighest fares currently on sale:");
  for (const t of extremes) {
    const ratio = (t.fare / t.route.baseFare).toFixed(2);
    console.log(
      `  ${t.route.origin} → ${t.route.destination}: KES ${t.fare.toLocaleString()} (base ${t.route.baseFare.toLocaleString()}, ×${ratio})`,
    );
  }

  const cheap = await db.trip.findFirst({
    where: { departureAt: { gte: new Date() } },
    orderBy: { fare: "asc" },
    include: { route: { select: { origin: true, destination: true } } },
  });
  if (cheap) {
    console.log(`\nLowest fare: ${cheap.route.origin} → ${cheap.route.destination}: KES ${cheap.fare}`);
  }

  console.log(failures === 0 ? "\nAll benchmarks within range." : `\n${failures} corridor(s) outside expected range.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().finally(() => db.$disconnect());
