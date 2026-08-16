export {};

/**
 * Drives one booking end to end over HTTP and checks that every role who should
 * have heard about it did.
 *
 * This is the test the old code could never have passed: before the event bus,
 * a booking could be created, paid, ticketed and issued a QR code while the
 * only notification in the entire system went to the passenger.
 *
 *   npx tsx scripts/workflow-check.ts [baseUrl]
 */

import { PrismaClient } from "@prisma/client";

const BASE = process.argv[2] ?? "http://localhost:3000";
const db = new PrismaClient();
const PASSWORD = "Password123";

let failures = 0;

function check(label: string, pass: boolean, detail = "") {
  if (!pass) failures++;
  console.log(`  ${pass ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

type Signin = { sessionId: string; cookie: string };

/**
 * Signs in and keeps both halves of the session: the cookie envelope the
 * browser would hold, and the per-tab session id that selects an account
 * within it. Server components resolve the cookie, so a header alone is not
 * enough to act as a signed-in user.
 */
async function login(email: string): Promise<Signin> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${email}: ${JSON.stringify(body)}`);

  const cookie = (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");

  return { sessionId: body.sessionId as string, cookie };
}

const auth = (s: Signin) => ({
  "content-type": "application/json",
  "x-session-id": s.sessionId,
  cookie: s.cookie,
});

/** Notifications created for a user since a cutoff, newest first. */
async function since(email: string, cutoff: Date) {
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`no such user ${email}`);
  return db.notification.findMany({
    where: { userId: user.id, createdAt: { gte: cutoff } },
    orderBy: { createdAt: "desc" },
    select: { title: true, body: true },
  });
}

const titled = (rows: { title: string }[], fragment: string) =>
  rows.some((r) => r.title.toLowerCase().includes(fragment.toLowerCase()));

/** The company admin of whoever runs this departure. */
async function operatorAdminFor(tripId: string) {
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    select: { bus: { select: { operatorId: true } } },
  });
  const admin = await db.user.findFirst({
    where: { role: "COMPANY_ADMIN", operatorId: trip?.bus.operatorId },
    select: { email: true },
  });
  return admin?.email ?? null;
}

/** A company admin at a different operator, who must hear nothing. */
async function rivalAdminFor(tripId: string) {
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    select: { bus: { select: { operatorId: true } } },
  });
  const admin = await db.user.findFirst({
    where: { role: "COMPANY_ADMIN", operatorId: { not: trip?.bus.operatorId } },
    select: { email: true },
  });
  return admin?.email ?? null;
}

async function main() {
  const cutoff = new Date();

  // A departure far enough out that seats are certainly free.
  const trip = await db.trip.findFirst({
    where: { status: "SCHEDULED", departureAt: { gt: new Date(Date.now() + 2 * 86_400_000) } },
    orderBy: { departureAt: "asc" },
    include: { bus: true, route: true },
  });
  if (!trip) throw new Error("No bookable trip found.");

  console.log(`${trip.route.origin} → ${trip.route.destination}, ${trip.departureAt.toISOString()}\n`);

  const passenger = await login("passenger@example.com");

  // Pick a seat nobody holds.
  const taken = new Set(
    (await db.bookingSeat.findMany({ where: { tripId: trip.id }, select: { seatNumber: true } })).map(
      (s) => s.seatNumber,
    ),
  );
  const seatNumber = ["1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B", "5A"].find(
    (s) => !taken.has(s),
  );
  if (!seatNumber) throw new Error("No free seat on the chosen trip.");

  /* ---- booking.created ------------------------------------------------- */
  console.log("booking.created");
  const bookingRes = await fetch(`${BASE}/api/bookings`, {
    method: "POST",
    headers: auth(passenger),
    body: JSON.stringify({
      tripId: trip.id,
      seats: [
        {
          seatNumber,
          passengerName: "Workflow Check",
          passengerPhone: "254700000111",
        },
      ],
    }),
  });
  const bookingBody = await bookingRes.json();
  if (!bookingRes.ok) throw new Error(`booking: ${JSON.stringify(bookingBody)}`);
  const booking = bookingBody.booking;
  console.log(`  reference ${booking.reference}`);

  check("passenger told the hold is ticking", titled(await since("passenger@example.com", cutoff), "seats held"));
  // Staff are deliberately NOT messaged here. An operator selling five hundred
  // seats a day would send each clerk five hundred notifications, so a pending
  // booking is a live dashboard counter instead. The stream carrying it is
  // verified by live-check.ts.
  check(
    "booking staff are not spammed with pending sales",
    !titled(await since("staff@safiriconnect.co.ke", cutoff), "awaiting payment"),
  );

  /* ---- booking.confirmed ----------------------------------------------- */
  console.log("\nbooking.confirmed");
  const initRes = await fetch(`${BASE}/api/payments/initiate`, {
    method: "POST",
    headers: auth(passenger),
    body: JSON.stringify({ bookingId: booking.id, phone: "254700000111" }),
  });
  const init = await initRes.json();
  if (!initRes.ok) throw new Error(`payment: ${JSON.stringify(init)}`);

  // The simulated STK push settles after a short delay, exactly as Daraja does.
  let status = "PENDING";
  for (let i = 0; i < 20 && status === "PENDING"; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const res = await fetch(
      `${BASE}/api/payments/status?checkoutRequestId=${init.checkoutRequestId}`,
      { headers: auth(passenger) },
    );
    status = (await res.json()).status;
  }
  console.log(`  payment ${status}`);

  if (status === "SUCCESS") {
    check("passenger got the ticket", titled(await since("passenger@example.com", cutoff), "ticket is ready"));

    // The confirmation reaches the company that ran the bus — as a digest, not
    // an interruption — and reaches nobody at any other company.
    const owner = await operatorAdminFor(trip.id);
    check(
      "the operating company was told",
      owner ? titled(await since(owner, cutoff), "booking confirmed") : false,
      owner ?? "no company admin found",
    );

    const rival = await rivalAdminFor(trip.id);
    check(
      "a rival company was not told",
      rival ? !titled(await since(rival, cutoff), "booking confirmed") : true,
    );

    const ticket = await db.ticket.findFirst({ where: { bookingId: booking.id } });
    check("ticket issued with a QR token", Boolean(ticket?.qrToken));
  } else {
    check("payment settled", false, `stuck at ${status}`);
  }

  /* ---- audit ------------------------------------------------------------ */
  console.log("\naudit trail");
  const logs = await db.auditLog.findMany({
    where: { entityId: booking.id, createdAt: { gte: cutoff } },
    select: { action: true },
  });
  const actions = logs.map((l) => l.action);
  check("BOOKING_CREATED recorded", actions.includes("BOOKING_CREATED"), actions.join(", "));
  check("BOOKING_CONFIRMED recorded", actions.includes("BOOKING_CONFIRMED"));

  /* ---- booking.cancelled ------------------------------------------------ */
  console.log("\nbooking.cancelled");
  const cancelCutoff = new Date();
  const cancelRes = await fetch(`${BASE}/api/bookings/${booking.id}/cancel`, {
    method: "POST",
    headers: auth(passenger),
    body: JSON.stringify({ reason: "Workflow verification" }),
  });
  if (!cancelRes.ok) {
    check("cancellation accepted", false, JSON.stringify(await cancelRes.json()));
  } else {
    check("passenger told", titled(await since("passenger@example.com", cancelCutoff), "cancelled"));

    // A cancellation weeks out is a dashboard number; only one within two hours
    // of departure interrupts the gate and the crew. This booking is far out,
    // so silence at the counter is the correct behaviour.
    check(
      "staff are not interrupted for a distant cancellation",
      !titled(await since("staff@safiriconnect.co.ke", cancelCutoff), "boarding soon"),
    );

    const refund = await db.refund.findFirst({
      where: { bookingId: booking.id },
      orderBy: { requestedAt: "desc" },
    });
    check("the money is accounted for", Boolean(refund), refund ? refund.status : "no refund row");
  }

  console.log(
    failures ? `\nFAILED with ${failures} unmet expectation(s)` : "\nEvery role was notified.",
  );
  await db.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
