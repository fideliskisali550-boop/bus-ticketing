/**
 * Seeds a realistic demonstration dataset:
 *
 *   - Kenya's 47 counties, their principal towns, named bus terminals and
 *     border posts, plus East African destinations.
 *   - A route network priced from real market fares, not generated numbers.
 *   - A mixed-class fleet, so Economy / VIP / Executive pricing is visible.
 *   - Departures through the day on the busy corridors, so a search at any
 *     hour finds something.
 *   - Enough booking history for the analytics dashboard to show real trends.
 *
 * Volume is deliberately bounded. SQLite handles this dataset comfortably;
 * generating every seat of every departure for a year would not make the demo
 * more convincing, only slower.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "crypto";
import { buildLocations } from "./data/locations";
import { DEPARTURES_BY_FREQUENCY } from "./data/routes";
import { buildNetwork, describeNetwork } from "./data/network";
import { OPERATORS, operatorsFor } from "./data/operators";
import { BUSES, classesFor } from "./data/fleet";
import { computeFare, type VehicleClass, type FareRule } from "../src/lib/fares";
import { KENYA_UTC_OFFSET_HOURS } from "../src/lib/time";

const db = new PrismaClient();

/**
 * How far back and forward the schedule runs.
 *
 * History feeds the analytics dashboard; the future window is what passengers
 * can book. Both are kept tight because every scheduled day multiplies through
 * departures into bookings, seats, payments and tickets — and a database that
 * takes minutes to seed and hundreds of megabytes to store makes the whole
 * application feel slow for no demonstrable benefit.
 */
const HISTORY_DAYS = 7;
// A month of bookable dates, matching how far ahead Kenyan operators actually
// sell. A fortnight was too short: a passenger looking a few weeks out found
// nothing, which reads as a broken system rather than a booking horizon.
const FUTURE_DAYS = 21;

/**
 * The network runs to nearly two thousand corridors so that any plausible
 * search finds something. Generating a full year of history for every one of
 * them would produce millions of rows without making the demo more convincing,
 * so booking history is kept to the busy corridors: the quiet ones get upcoming
 * departures only, which is all a passenger searching them needs.
 */
const HISTORY_FOR_QUIET_ROUTES = false;

const id = () => randomUUID();

/**
 * SQLite runs each statement in its own transaction, so inserting tens of
 * thousands of rows one await at a time takes minutes. Rows are built in memory
 * and flushed with createMany in chunks. Ids are supplied explicitly because
 * createMany does not return them and child rows need to reference parents.
 */
async function bulk<T>(
  label: string,
  rows: T[],
  insert: (chunk: T[]) => Promise<unknown>,
  chunkSize = 5000,
) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await insert(rows.slice(i, i + chunkSize));
  }
  console.log(`  ${rows.length.toLocaleString().padStart(7)} ${label}`);
}

const FIRST = ["Amina", "Brian", "Cynthia", "David", "Esther", "Felix", "Grace", "Hassan", "Irene", "James", "Kevin", "Lydia", "Mercy", "Nathan", "Otieno", "Purity", "Quincy", "Rose", "Samuel", "Terry", "Victor", "Wanjiru", "Yusuf", "Zainab", "Collins", "Faith", "Dennis", "Joyce"];
const LAST = ["Kamau", "Ochieng", "Mwangi", "Wafula", "Njoroge", "Kiplagat", "Mutiso", "Abdalla", "Chebet", "Omondi", "Karanja", "Wekesa", "Njeri", "Barasa", "Cheruiyot", "Kimani", "Achieng", "Maina"];

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Booking references must be unique. Six characters from a 32-symbol alphabet
 * is ~1.07 billion combinations, but by the birthday bound tens of thousands of
 * rows collide with meaningful probability. Drawing against a set of references
 * already issued keeps the seed deterministic rather than failing on P2002.
 */
const issuedReferences = new Set<string>();

function reference() {
  for (;;) {
    const candidate = `SC-${Array.from({ length: 6 }, () => pick([...REF_ALPHABET])).join("")}`;
    if (!issuedReferences.has(candidate)) {
      issuedReferences.add(candidate);
      return candidate;
    }
  }
}

/** Seat label for a given index, matching lib/policy.ts buildSeatMap. */
function seatLabel(index: number, seatsPerRow = 4) {
  const letters = "ABCDEF";
  return `${Math.floor(index / seatsPerRow) + 1}${letters[index % seatsPerRow]}`;
}

async function main() {
  const startedAt = Date.now();

  console.log("Clearing existing data…");
  // Children before parents — SQLite enforces the foreign keys.
  await db.auditLog.deleteMany();
  await db.notification.deleteMany();
  await db.ticket.deleteMany();
  await db.payment.deleteMany();
  await db.bookingSeat.deleteMany();
  await db.booking.deleteMany();
  await db.trip.deleteMany();
  await db.session.deleteMany();
  await db.refund.deleteMany();
  await db.scheduleTemplate.deleteMany();
  await db.operatorRoute.deleteMany();
  await db.fareHistory.deleteMany();
  await db.fareRule.deleteMany();
  await db.user.deleteMany();
  await db.bus.deleteMany();
  await db.route.deleteMany();
  await db.location.deleteMany();
  await db.setting.deleteMany();
  await db.operator.deleteMany();

  // ------------------------------------------------------------------ people
  console.log("Creating platform users…");
  const password = await bcrypt.hash("Password123", 12);

  // Platform plane: these accounts belong to SafiriConnect itself and carry no
  // operatorId, which is what lets them see across every company.
  const admin = await db.user.create({
    data: { email: "admin@safiriconnect.co.ke", phone: "254700000001", fullName: "Fidelis Atonga", passwordHash: password, role: "SUPER_ADMIN", emailVerified: true },
  });

  await db.user.create({
    data: { email: "support@safiriconnect.co.ke", phone: "254700000004", fullName: "Alice Nyambura", passwordHash: password, role: "PLATFORM_SUPPORT", emailVerified: true },
  });

  const demoPassenger = await db.user.create({
    data: { email: "passenger@example.com", phone: "254700000003", fullName: "Peter Kimani", passwordHash: password, role: "PASSENGER", emailVerified: true, nationalId: "29384756" },
  });

  const passengerRows: Prisma.UserCreateManyInput[] = Array.from({ length: 80 }, (_, i) => ({
    id: id(),
    email: `passenger${i + 1}@example.com`,
    phone: `2547${String(20000000 + i).padStart(8, "0")}`,
    fullName: `${pick(FIRST)} ${pick(LAST)}`,
    passwordHash: password,
    role: "PASSENGER" as const,
    emailVerified: Math.random() > 0.2,
    createdAt: new Date(Date.now() - randInt(1, 150) * 86_400_000),
  }));
  await db.user.createMany({ data: passengerRows });
  const passengerIds = [demoPassenger.id, ...passengerRows.map((p) => p.id as string)];

  // --------------------------------------------------------------- locations
  console.log("Seeding locations…");
  const locations = buildLocations();
  const locationRows: Prisma.LocationCreateManyInput[] = locations.map((l) => ({
    id: id(),
    name: l.name,
    type: l.type,
    county: l.county ?? null,
    country: l.country ?? "KE",
    latitude: l.latitude ?? null,
    longitude: l.longitude ?? null,
    aliases: JSON.stringify(l.aliases ?? []),
  }));
  await bulk("locations", locationRows, (c) => db.location.createMany({ data: c }));

  /** name -> id, for wiring routes to their endpoints. */
  const locationByName = new Map(locationRows.map((l) => [l.name as string, l.id as string]));

  // ------------------------------------------------------------------ routes
  console.log("Building the route network…");
  // Curated corridors carry real market fares; the rest are derived from the
  // seeded coordinates so that any plausible search finds a service.
  const NETWORK = buildNetwork();
  const networkStats = describeNetwork(NETWORK);

  const routeRows: Prisma.RouteCreateManyInput[] = NETWORK.map((r) => ({
    id: id(),
    origin: r.origin,
    destination: r.destination,
    originId: locationByName.get(r.origin) ?? null,
    destinationId: locationByName.get(r.destination) ?? null,
    distanceKm: r.distanceKm,
    durationMin: r.durationMin,
    stops: JSON.stringify(r.stops),
    baseFare: r.baseFare,
    isInternational: r.isInternational ?? false,
  }));
  await bulk("routes", routeRows, (c) => db.route.createMany({ data: c }));

  // -------------------------------------------------------------- fare rules
  console.log("Seeding fare rules…");
  const fareRuleRows: Prisma.FareRuleCreateManyInput[] = [
    {
      id: id(),
      name: "Weekend loading",
      kind: "WEEKEND",
      multiplier: 1.1,
      daysOfWeek: JSON.stringify([0, 5, 6]),
      priority: 10,
    },
    {
      id: id(),
      name: "December festive season",
      kind: "PEAK_SEASON",
      multiplier: 1.25,
      startsAt: new Date(new Date().getFullYear(), 11, 15),
      endsAt: new Date(new Date().getFullYear() + 1, 0, 5),
      priority: 20,
    },
    {
      id: id(),
      name: "Midweek off-peak discount",
      kind: "OFF_PEAK",
      multiplier: 0.95,
      daysOfWeek: JSON.stringify([2, 3]),
      priority: 5,
      isActive: false, // available to switch on from the admin screens
    },
  ];
  await db.fareRule.createMany({ data: fareRuleRows });

  /** The rules the fare engine should apply while seeding. */
  const activeRules: FareRule[] = fareRuleRows
    .filter((r) => r.isActive !== false)
    .map((r) => ({
      name: r.name as string,
      kind: r.kind as FareRule["kind"],
      multiplier: r.multiplier as number,
      startsAt: (r.startsAt as Date) ?? null,
      endsAt: (r.endsAt as Date) ?? null,
      daysOfWeek: JSON.parse((r.daysOfWeek as string) ?? "[]"),
      priority: r.priority as number,
    }));

  // --------------------------------------------------------------- operators
  console.log("Seeding operators…");
  const operatorRows: Prisma.OperatorCreateManyInput[] = OPERATORS.map((o) => ({
    id: id(),
    name: o.name,
    code: o.code,
    colour: o.colour,
    rating: o.rating,
    tagline: o.tagline,
  }));
  await db.operator.createMany({ data: operatorRows });
  const operatorIdByName = new Map(operatorRows.map((o) => [o.name as string, o.id as string]));
  const operatorIds = operatorRows.map((o) => o.id as string);

  // ---------------------------------------------------------- operator staff
  console.log("Creating operator staff…");
  // Every company gets its own back office and crew. This is what operator
  // scoping is for: each of these accounts can see its own employer's fleet,
  // timetable, bookings and revenue, and none of anybody else's.
  const staffRows: Prisma.UserCreateManyInput[] = [];
  const driversByOperator = new Map<string, string[]>();
  const conductorsByOperator = new Map<string, string[]>();

  const CREW_FIRST = ["Joseph", "Peter", "Daniel", "Michael", "Stephen", "Anthony", "Charles", "George", "Grace", "Mercy", "Alice", "Faith"];

  OPERATORS.forEach((operator, oi) => {
    const operatorId = operatorIdByName.get(operator.name)!;
    const slug = operator.code.toLowerCase();

    const office: [string, Prisma.UserCreateManyInput["role"], string][] = [
      ["admin", "COMPANY_ADMIN", `${pick(FIRST)} ${pick(LAST)}`],
      ["ops", "ROUTE_MANAGER", `${pick(FIRST)} ${pick(LAST)}`],
      ["finance", "FINANCE_OFFICER", `${pick(FIRST)} ${pick(LAST)}`],
      ["desk", "BOOKING_STAFF", `${pick(FIRST)} ${pick(LAST)}`],
    ];

    office.forEach(([prefix, role, fullName], i) => {
      staffRows.push({
        id: id(),
        email: `${prefix}@${slug}.co.ke`,
        phone: `2547${String(30000000 + oi * 100 + i).padStart(8, "0")}`,
        fullName,
        passwordHash: password,
        role,
        operatorId,
        emailVerified: true,
      });
    });

    const drivers: string[] = [];
    const conductors: string[] = [];

    for (let i = 0; i < 4; i++) {
      const driverId = id();
      drivers.push(driverId);
      staffRows.push({
        id: driverId,
        email: `driver${i + 1}@${slug}.co.ke`,
        phone: `2547${String(40000000 + oi * 100 + i).padStart(8, "0")}`,
        fullName: `${pick(CREW_FIRST)} ${pick(LAST)}`,
        passwordHash: password,
        role: "DRIVER",
        operatorId,
        emailVerified: true,
      });

      const conductorId = id();
      conductors.push(conductorId);
      staffRows.push({
        id: conductorId,
        email: `conductor${i + 1}@${slug}.co.ke`,
        phone: `2547${String(50000000 + oi * 100 + i).padStart(8, "0")}`,
        fullName: `${pick(CREW_FIRST)} ${pick(LAST)}`,
        passwordHash: password,
        role: "CONDUCTOR",
        operatorId,
        emailVerified: true,
      });
    }

    driversByOperator.set(operatorId, drivers);
    conductorsByOperator.set(operatorId, conductors);
  });

  await bulk("staff", staffRows, (c) => db.user.createMany({ data: c }));

  // The first company gets recognisable demo credentials, so the walkthrough
  // does not depend on remembering a generated address.
  const demoOperatorId = operatorIdByName.get(OPERATORS[0]!.name)!;
  await db.user.create({
    data: {
      email: "staff@safiriconnect.co.ke", phone: "254700000002",
      fullName: "Janet Wambui", passwordHash: password,
      role: "BOOKING_STAFF", operatorId: demoOperatorId, emailVerified: true,
    },
  });
  await db.user.create({
    data: {
      email: "company@safiriconnect.co.ke", phone: "254700000005",
      fullName: "Samuel Kiptanui", passwordHash: password,
      role: "COMPANY_ADMIN", operatorId: demoOperatorId, emailVerified: true,
    },
  });
  const demoDriver = await db.user.create({
    data: {
      email: "driver@safiriconnect.co.ke", phone: "254700000006",
      fullName: "Joseph Mwangi", passwordHash: password,
      role: "DRIVER", operatorId: demoOperatorId, emailVerified: true,
    },
  });
  const demoConductor = await db.user.create({
    data: {
      email: "conductor@safiriconnect.co.ke", phone: "254700000007",
      fullName: "Grace Achieng", passwordHash: password,
      role: "CONDUCTOR", operatorId: demoOperatorId, emailVerified: true,
    },
  });
  await db.user.create({
    data: {
      email: "finance@safiriconnect.co.ke", phone: "254700000008",
      fullName: "Esther Wanjiru", passwordHash: password,
      role: "FINANCE_OFFICER", operatorId: demoOperatorId, emailVerified: true,
    },
  });

  driversByOperator.get(demoOperatorId)!.push(demoDriver.id);
  conductorsByOperator.get(demoOperatorId)!.push(demoConductor.id);

  // ------------------------------------------------------------------- fleet
  console.log("Seeding fleet…");
  // Every operator gets its own vehicles, so a corridor can genuinely be served
  // by several companies at different prices — which is the point of a booking
  // platform rather than a single fleet.
  const busRows: Prisma.BusCreateManyInput[] = [];
  const plateSeries = "ABCDEFGHJKLMNPQRSTUVWXYZ";

  OPERATORS.forEach((operator, oi) => {
    BUSES.forEach((b, bi) => {
      const index = oi * BUSES.length + bi;
      busRows.push({
        id: id(),
        operatorId: operatorIdByName.get(operator.name)!,
        // Unique plates across the whole combined fleet.
        registration: `K${plateSeries[oi % plateSeries.length]}${plateSeries[bi % plateSeries.length]} ${String(100 + bi)}${plateSeries[oi % plateSeries.length]}`,
        model: b.model,
        capacity: b.capacity,
        seatsPerRow: b.capacity <= 26 ? 3 : 4,
        aisleAfter: b.capacity <= 26 ? 1 : 2,
        hasWifi: b.wifi,
        hasChargingPorts: b.ports,
        hasToilet: b.toilet,
        hasAirCon: b.vehicleClass !== "ECONOMY" || b.capacity > 40,
        vehicleClass: b.vehicleClass,
        // One vehicle per operator in the workshop, so the fleet screen shows a
        // real-world state rather than a suspiciously perfect roster.
        status: index % 37 === 0 ? ("MAINTENANCE" as const) : ("ACTIVE" as const),
      });
    });
  });

  await bulk("buses", busRows, (c) => db.bus.createMany({ data: c }));

  // ------------------------------------------------------- corridors served
  console.log("Linking operators to corridors…");
  // Which company sells on which corridor, and at what price. The route itself
  // is platform infrastructure — several companies run Nairobi–Mombasa — so the
  // fare belongs to this link rather than to the route.
  const operatorRouteRows: Prisma.OperatorRouteCreateManyInput[] = [];

  routeRows.forEach((routeRow, i) => {
    const route = NETWORK[i]!;
    for (const operator of operatorsFor(route.origin, route.destination)) {
      const operatorId = operatorIdByName.get(operator.name);
      if (!operatorId) continue;
      operatorRouteRows.push({
        id: id(),
        operatorId,
        routeId: routeRow.id as string,
        // Companies price within a few percent of each other on the same road;
        // a flat copy of the market rate would make the comparison pointless.
        baseFare: Math.round((route.baseFare * (0.92 + Math.random() * 0.16)) / 50) * 50,
      });
    }
  });

  await bulk("operator routes", operatorRouteRows, (c) =>
    db.operatorRoute.createMany({ data: c }),
  );

  type FleetBus = {
    id: string;
    capacity: number;
    seatsPerRow: number;
    vehicleClass: VehicleClass;
    operatorName: string;
  };

  const operatorNameById = new Map(operatorRows.map((o) => [o.id as string, o.name as string]));

  const activeBuses: FleetBus[] = busRows
    .filter((b) => b.status === "ACTIVE")
    .map((b) => ({
      id: b.id as string,
      capacity: b.capacity as number,
      seatsPerRow: b.seatsPerRow as number,
      vehicleClass: b.vehicleClass as VehicleClass,
      operatorName: operatorNameById.get(b.operatorId as string)!,
    }));

  /** Buses grouped by class, so a corridor gets a plausible vehicle. */
  const busesByClass = new Map<VehicleClass, typeof activeBuses>();
  for (const b of activeBuses) {
    if (!busesByClass.has(b.vehicleClass)) busesByClass.set(b.vehicleClass, []);
    busesByClass.get(b.vehicleClass)!.push(b);
  }

  // ------------------------------------------------------------------- trips
  console.log("Scheduling departures…");

  type TripSeed = {
    id: string;
    fare: number;
    capacity: number;
    seatsPerRow: number;
    departureAt: Date;
    past: boolean;
    tier: "high" | "medium" | "low";
  };

  const trips: TripSeed[] = [];
  const tripRows: Prisma.TripCreateManyInput[] = [];

  for (let dayOffset = -HISTORY_DAYS; dayOffset <= FUTURE_DAYS; dayOffset++) {
    for (const [index, route] of NETWORK.entries()) {
      const frequency = route.frequency ?? "medium";
      const hours = DEPARTURES_BY_FREQUENCY[frequency]!;

      // Quiet corridors carry upcoming departures but no history. A passenger
      // searching them needs a service to book; the analytics dashboard draws
      // its trends from the busy corridors, where the volume actually is.
      const quiet = frequency === "low";
      if (quiet && !HISTORY_FOR_QUIET_ROUTES && dayOffset < 0) continue;

      // Every corridor runs daily. Alternate-day service was what made
      // connecting journeys impossible: a passenger arriving at a change point
      // faced a forty-hour wait for the onward bus, so no itinerary could be
      // assembled. Concentrating the network onto a third as many corridors
      // paid for daily service on all of them.

      const routeRow = routeRows[index]!;
      // Class depends on distance as well as frequency: premium tiers only
      // appear on journeys long enough to justify them.
      const classPool = classesFor(frequency, route.distanceKm);

      for (const hour of hours) {
        // A little natural variation, rather than a perfectly regular timetable.
        if (Math.random() < 0.12) continue;

        // Departure times are Kenyan wall-clock times: a 21:00 service leaves
        // Nairobi at 21:00 EAT. Built in UTC explicitly rather than with
        // setHours, which would anchor the timetable to whatever timezone the
        // machine running the seed happens to be in — producing a schedule
        // that is silently three hours out on any non-Kenyan laptop.
        const departureAt = new Date();
        departureAt.setUTCDate(departureAt.getUTCDate() + dayOffset);
        departureAt.setUTCHours(
          hour - KENYA_UTC_OFFSET_HOURS,
          pick([0, 0, 0, 15, 30]),
          0,
          0,
        );

        const arrivalAt = new Date(departureAt.getTime() + route.durationMin * 60_000);

        // Assign a vehicle belonging to a company that credibly serves this
        // corridor, in a class the journey justifies — so the same route shows
        // several operators at different prices, as it would in reality.
        const wantedClass = pick(classPool);
        const carriers = new Set(
          operatorsFor(route.origin, route.destination).map((o) => o.name),
        );

        const byClass = busesByClass.get(wantedClass) ?? activeBuses;
        const candidates = byClass.filter((b) => carriers.has(b.operatorName));
        const bus = pick(candidates.length ? candidates : byClass);

        // The fare is derived, never invented: route market rate, adjusted for
        // the class of vehicle assigned and any rule in force that day.
        const fare = computeFare({
          baseFare: route.baseFare,
          vehicleClass: bus.vehicleClass,
          departureAt,
          routeId: routeRow.id as string,
          rules: activeRules,
        }).total;

        const past = departureAt < new Date();
        const tripId = id();

        // Crew are drawn from the company that owns the bus. Rostering a
        // driver from another operator would be nonsense operationally and
        // would also breach the scoping rule the whole system now rests on.
        const busOperatorId = operatorIdByName.get(bus.operatorName)!;
        const crewDrivers = driversByOperator.get(busOperatorId) ?? [];
        const crewConductors = conductorsByOperator.get(busOperatorId) ?? [];

        tripRows.push({
          id: tripId,
          routeId: routeRow.id as string,
          busId: bus.id,
          driverId: crewDrivers.length ? pick(crewDrivers) : null,
          conductorId: crewConductors.length ? pick(crewConductors) : null,
          departureAt,
          arrivalAt,
          fare,
          status: past ? ("ARRIVED" as const) : ("SCHEDULED" as const),
          // Departures already in the past have a reported reality; future ones
          // do not yet.
          actualDepartureAt: past ? new Date(departureAt.getTime() + randInt(-2, 25) * 60_000) : null,
          actualArrivalAt: past ? new Date(arrivalAt.getTime() + randInt(-5, 40) * 60_000) : null,
        });

        trips.push({
          id: tripId,
          fare,
          capacity: bus.capacity,
          seatsPerRow: bus.seatsPerRow,
          departureAt,
          past,
          tier: frequency as "high" | "medium" | "low",
        });
      }
    }
  }

  // ---------------------------------------------------------------- bookings
  console.log("Generating bookings…");

  const bookingRows: Prisma.BookingCreateManyInput[] = [];
  const seatRows: Prisma.BookingSeatCreateManyInput[] = [];
  const paymentRows: Prisma.PaymentCreateManyInput[] = [];
  const ticketRows: Prisma.TicketCreateManyInput[] = [];

  // Unique human-readable verification codes for the seeded tickets, matching
  // the app's format. Deduped in memory because createMany would otherwise trip
  // the unique index on the rare collision.
  const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const usedCodes = new Set<string>();
  const uniqueVerificationCode = (year: number) => {
    for (;;) {
      let body = "";
      for (let i = 0; i < 6; i++) {
        body += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      const code = `SC-${year}-${body}`;
      if (!usedCodes.has(code)) {
        usedCodes.add(code);
        return code;
      }
    }
  };

  for (const trip of trips) {
    const daysOut = (trip.departureAt.getTime() - Date.now()) / 86_400_000;

    // Past departures settle at a realistic load; future ones fill up as they
    // approach, so "3 seats left" appears on imminent trips and plenty of
    // choice remains on distant ones.
    // Busy corridors fill up realistically. Quiet ones carry a light load —
    // enough that a seat map looks lived-in and "seats left" means something,
    // without multiplying two thousand corridors into millions of seat rows
    // that would slow every query for no demonstrable benefit.
    // Bookings cluster near departure. The curve is squared rather than linear
    // because that is how seats actually sell — a coach three weeks out is
    // nearly empty, one leaving tomorrow is nearly full. It also keeps the
    // dataset honest: a month of dense bookings on every one of two thousand
    // corridors would be neither realistic nor fast.
    const proximity = Math.max(0, 1 - daysOut / FUTURE_DAYS) ** 2;

    // Load scales with how busy the corridor genuinely is. Treating every
    // mid-tier route as a trunk route produced two hundred thousand bookings
    // and a 287 MB database — most of them on corridors that in reality carry
    // a handful of passengers a day.
    const profile = {
      high: { ceiling: 0.85, peak: 0.45, spread: 0.55, past: 0.35, pastSpread: 0.3 },
      medium: { ceiling: 0.45, peak: 0.2, spread: 0.25, past: 0.18, pastSpread: 0.15 },
      low: { ceiling: 0.2, peak: 0.1, spread: 0.15, past: 0.08, pastSpread: 0.08 },
    }[trip.tier];

    const loadFactor = trip.past
      ? profile.past + Math.random() * profile.pastSpread
      : Math.max(
          0.02,
          Math.min(profile.ceiling, proximity * (profile.peak + Math.random() * profile.spread)),
        );

    const seatsToFill = Math.floor(trip.capacity * loadFactor);
    if (seatsToFill === 0) continue;

    // Shuffle the seat pool once and deal from it — unique seats without the
    // retry loop that made the naive version quadratic.
    const pool = Array.from({ length: trip.capacity }, (_, i) => seatLabel(i, trip.seatsPerRow));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }

    let dealt = 0;
    while (dealt < seatsToFill) {
      const partySeats = pool.slice(dealt, dealt + Math.min(randInt(1, 3), seatsToFill - dealt));
      if (!partySeats.length) break;
      dealt += partySeats.length;

      const userId = pick(passengerIds);
      const totalAmount = trip.fare * partySeats.length;

      // Booked at some point before departure — and, crucially, never in the
      // future. A ticket for a departure three weeks out was still *bought* at
      // some point up to now, not later. Dating it from the departure alone
      // pushed every seeded booking for a future trip past the present moment,
      // which then buried any real booking made during a demo underneath
      // thousands of rows dated next month: the newest-first lists, the recent
      // activity feed and the analytics window were all dominated by sales that
      // had not, in the story the data tells, happened yet.
      const latest = Math.min(trip.departureAt.getTime(), Date.now());
      const createdAt = new Date(
        latest - randInt(0, 14) * 86_400_000 - randInt(1, 23) * 3_600_000,
      );

      const cancelled = Math.random() < 0.05;
      const status: Prisma.BookingCreateManyInput["status"] = cancelled
        ? "CANCELLED"
        : trip.past
          ? "COMPLETED"
          : "CONFIRMED";

      const bookingId = id();

      bookingRows.push({
        id: bookingId,
        reference: reference(),
        userId,
        tripId: trip.id,
        status,
        totalAmount,
        holdsUntil: new Date(createdAt.getTime() + 15 * 60_000),
        createdAt,
        cancelledAt: cancelled ? new Date(createdAt.getTime() + 3_600_000) : null,
        cancelReason: cancelled ? "Change of travel plans" : null,
        refundAmount: cancelled ? Math.floor(totalAmount * 0.75) : null,
      });

      for (const seatNumber of partySeats) {
        seatRows.push({
          id: id(),
          bookingId,
          tripId: trip.id,
          seatNumber,
          passengerName: `${pick(FIRST)} ${pick(LAST)}`,
          passengerPhone: `2547${String(randInt(10000000, 99999999))}`,
        });
      }

      paymentRows.push({
        id: id(),
        bookingId,
        method: !cancelled && Math.random() < 0.85 ? "MPESA" : "CARD",
        status: cancelled ? "REFUNDED" : "SUCCESS",
        amount: totalAmount,
        phone: `2547${String(randInt(10000000, 99999999))}`,
        receiptNumber: `S${randomBytes(6).toString("hex").toUpperCase()}`,
        createdAt,
        completedAt: new Date(createdAt.getTime() + 45_000),
      });

      if (!cancelled) {
        ticketRows.push({
          id: id(),
          bookingId,
          qrToken: randomBytes(24).toString("base64url"),
          verificationCode: uniqueVerificationCode(createdAt.getFullYear()),
          issuedAt: createdAt,
          // Past trips are already boarded; seed them as verified too, so the
          // verification dashboards and history have something to show.
          verifiedAt: trip.past ? trip.departureAt : null,
          checkedInAt: trip.past ? trip.departureAt : null,
        });
      }
    }
  }

  // Cancelled bookings release their seats, so only live seats occupy the bus.
  const cancelledIds = new Set(
    bookingRows.filter((b) => b.status === "CANCELLED").map((b) => b.id as string),
  );
  const liveSeatRows = seatRows.filter((s) => !cancelledIds.has(s.bookingId));

  const seatsPerTrip = new Map<string, number>();
  for (const s of liveSeatRows) {
    seatsPerTrip.set(s.tripId, (seatsPerTrip.get(s.tripId) ?? 0) + 1);
  }
  for (const t of tripRows) {
    t.seatsBooked = seatsPerTrip.get(t.id as string) ?? 0;
  }

  console.log("Writing to database…");
  await bulk("departures", tripRows, (c) => db.trip.createMany({ data: c }));
  await bulk("bookings", bookingRows, (c) => db.booking.createMany({ data: c }));
  await bulk("seats", liveSeatRows, (c) => db.bookingSeat.createMany({ data: c }));
  await bulk("payments", paymentRows, (c) => db.payment.createMany({ data: c }));
  await bulk("tickets", ticketRows, (c) => db.ticket.createMany({ data: c }));

  // ------------------------------------------------------- fare history, misc
  console.log("Seeding settings, fare history, notifications and audit trail…");

  // A handful of past fare adjustments, so the history screen is not empty.
  const fareHistoryRows: Prisma.FareHistoryCreateManyInput[] = routeRows
    .slice(0, 12)
    .map((r, i) => {
      const newFare = r.baseFare as number;
      const oldFare = Math.round((newFare * (i % 2 === 0 ? 0.9 : 1.08)) / 50) * 50;
      return {
        id: id(),
        routeId: r.id as string,
        oldFare,
        newFare,
        reason: i % 2 === 0 ? "Fuel price adjustment" : "Competitive repricing",
        changedBy: admin.id,
        createdAt: new Date(Date.now() - randInt(5, 90) * 86_400_000),
      };
    });
  await db.fareHistory.createMany({ data: fareHistoryRows });

  await db.setting.createMany({
    data: [
      { key: "company.name", value: "SafiriConnect Coach Services" },
      { key: "company.email", value: "support@safiriconnect.co.ke" },
      { key: "company.phone", value: "+254 700 000 000" },
      { key: "company.address", value: "Accra Road, Nairobi CBD, Kenya" },
      { key: "booking.holdMinutes", value: "15" },
      { key: "booking.cutoffMinutes", value: "30" },
      { key: "fare.currency", value: "KES" },
    ],
  });

  await db.notification.createMany({
    data: [
      { userId: demoPassenger.id, title: "Welcome to SafiriConnect", body: "Your account is ready. Search a route and book your first trip.", link: "/search" },
      { userId: demoPassenger.id, title: "Travel tip", body: "Arrive at the terminus 30 minutes before departure for boarding.", link: "/bookings" },
      { userId: admin.id, title: "Fleet notice", body: "KDE 501A has been marked as under maintenance.", link: "/admin/buses" },
    ],
  });

  await db.auditLog.createMany({
    data: [
      { userId: admin.id, action: "SEED", entity: "System", metadata: JSON.stringify({ note: "Demonstration dataset loaded" }) },
      { userId: admin.id, action: "FARE_UPDATE", entity: "Route", entityId: routeRows[0]!.id as string, metadata: JSON.stringify({ reason: "Fuel price adjustment" }) },
    ],
  });

  // SQLite marks deleted pages free but does not return them to the operating
  // system, so re-seeding repeatedly grows the file without bound. VACUUM
  // rewrites the database compactly — worth the few seconds it costs, since a
  // 260 MB file for a 40 MB dataset slows every query that follows.
  console.log("Compacting database…");
  await db.$executeRawUnsafe("VACUUM");

  const kenyan = locationRows.filter((l) => l.country === "KE").length;
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`
Seed complete in ${seconds}s.

  ${locationRows.length} locations (${kenyan} in Kenya across 47 counties, ${locationRows.length - kenyan} international)
  ${networkStats.total.toLocaleString()} routes from ${networkStats.origins} origins (${networkStats.curated} hand-priced, ${networkStats.generated.toLocaleString()} derived, ${networkStats.international} cross-border)
  ${operatorRows.length} operators · ${busRows.length} buses · ${tripRows.length.toLocaleString()} departures · ${bookingRows.length.toLocaleString()} bookings

Sign in with:
  Admin      admin@safiriconnect.co.ke      / Password123
  Staff      staff@safiriconnect.co.ke      / Password123
  Passenger  passenger@example.com          / Password123
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
