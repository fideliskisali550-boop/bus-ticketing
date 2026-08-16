export {};

/**
 * Drives one departure through its entire commercial life, across six roles.
 *
 * Book → pay → ticket → board → depart → arrive → complete, then cancel a
 * second booking and follow the money out through the refund queue. Each step
 * is performed by the role that would really perform it, over HTTP, so the
 * scoping and capability rules are exercised rather than bypassed.
 *
 *   npx tsx scripts/lifecycle-check.ts [baseUrl]
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

async function login(email: string): Promise<Signin> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${email}: ${JSON.stringify(body)}`);
  return {
    sessionId: body.sessionId,
    cookie: (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; "),
  };
}

const auth = (s: Signin) => ({
  "content-type": "application/json",
  "x-session-id": s.sessionId,
  cookie: s.cookie,
});

async function call(path: string, s: Signin, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: auth(s) });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** Books, pays and returns the confirmed booking. */
async function bookAndPay(passenger: Signin, tripId: string, seatNumber: string, name: string) {
  const created = await call("/api/bookings", passenger, {
    method: "POST",
    body: JSON.stringify({
      tripId,
      seats: [{ seatNumber, passengerName: name, passengerPhone: "254700000222" }],
    }),
  });
  if (created.status !== 201) throw new Error(`booking: ${JSON.stringify(created.body)}`);
  const booking = created.body.booking;

  const init = await call("/api/payments/initiate", passenger, {
    method: "POST",
    body: JSON.stringify({ bookingId: booking.id, phone: "254700000222" }),
  });
  if (init.status !== 200) throw new Error(`payment: ${JSON.stringify(init.body)}`);

  let status = "PENDING";
  for (let i = 0; i < 20 && status === "PENDING"; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const poll = await call(
      `/api/payments/status?checkoutRequestId=${init.body.checkoutRequestId}`,
      passenger,
    );
    status = poll.body.status;
  }
  return { booking, paymentStatus: status };
}

async function main() {
  /* ---- pick a departure this company's crew are rostered on ------------- */
  const trip = await db.trip.findFirst({
    where: {
      status: "SCHEDULED",
      departureAt: { gt: new Date(Date.now() + 3 * 86_400_000) },
      driverId: { not: null },
      conductorId: { not: null },
      bus: { operator: { staff: { some: { email: "staff@safiriconnect.co.ke" } } } },
    },
    orderBy: { departureAt: "asc" },
    include: {
      route: true,
      bus: { select: { capacity: true, operatorId: true } },
      driver: { select: { email: true } },
      conductor: { select: { email: true } },
    },
  });
  if (!trip) throw new Error("No suitable crewed departure found.");

  console.log(
    `${trip.route.origin} → ${trip.route.destination}, ${trip.departureAt.toISOString()}\n`,
  );

  const passenger = await login("passenger@example.com");
  const clerk = await login("staff@safiriconnect.co.ke");
  const driver = await login(trip.driver!.email);
  const conductor = await login(trip.conductor!.email);
  const finance = await login("finance@safiriconnect.co.ke");

  const taken = new Set(
    (await db.bookingSeat.findMany({ where: { tripId: trip.id }, select: { seatNumber: true } })).map(
      (s) => s.seatNumber,
    ),
  );
  const free = ["1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B", "5A", "5B"].filter(
    (s) => !taken.has(s),
  );
  if (free.length < 2) throw new Error("Not enough free seats on the chosen departure.");

  /* ---- sell ------------------------------------------------------------- */
  console.log("sale");
  const first = await bookAndPay(passenger, trip.id, free[0]!, "Lifecycle One");
  check("payment settled", first.paymentStatus === "SUCCESS", first.paymentStatus);

  const ticket = await db.ticket.findFirst({ where: { bookingId: first.booking.id } });
  check("ticket issued with a QR token", Boolean(ticket?.qrToken));

  const second = await bookAndPay(passenger, trip.id, free[1]!, "Lifecycle Two");
  check("second seat sold", second.paymentStatus === "SUCCESS", second.paymentStatus);

  /* ---- manifest --------------------------------------------------------- */
  console.log("\nmanifest");
  const manifest = await call(`/api/manifest/${trip.id}`, conductor);
  check("conductor can read the manifest", manifest.status === 200);
  check(
    "both passengers appear",
    manifest.body.seats?.some((s: any) => s.passengerName === "Lifecycle One") &&
      manifest.body.seats?.some((s: any) => s.passengerName === "Lifecycle Two"),
    `${manifest.body.expected} expected`,
  );

  const driverView = await call(`/api/manifest/${trip.id}`, driver);
  check("driver sees the count", driverView.body.expected > 0, `${driverView.body.expected}`);
  check(
    "driver is NOT given passenger names",
    Array.isArray(driverView.body.seats) && driverView.body.seats.length === 0,
  );

  const otherCompany = await db.user.findFirst({
    where: { role: "CONDUCTOR", operatorId: { not: trip.bus.operatorId } },
    select: { email: true },
  });
  if (otherCompany) {
    const outsider = await login(otherCompany.email);
    const denied = await call(`/api/manifest/${trip.id}`, outsider);
    check("a conductor from another company is refused", denied.status === 403,
      `HTTP ${denied.status}`);
  }

  /* ---- boarding --------------------------------------------------------- */
  console.log("\nboarding");
  // Check-in refuses a pass for a departure that is not imminent — a correct
  // rule, and one that has to be worked around to test boarding at all. Rather
  // than weaken the rule, the departure is brought forward, which is the same
  // thing as waiting three days.
  const boardingAt = new Date(Date.now() + 20 * 60_000);
  await db.trip.update({
    where: { id: trip.id },
    data: {
      departureAt: boardingAt,
      arrivalAt: new Date(boardingAt.getTime() + trip.route.durationMin * 60_000),
    },
  });

  const opened = await call(`/api/trips/${trip.id}/operate`, driver, {
    method: "POST",
    body: JSON.stringify({ action: "BOARDING" }),
  });
  check("driver opens boarding", opened.status === 200, opened.body.status);

  // Only the first passenger turns up.
  const scan = await call("/api/checkin", conductor, {
    method: "POST",
    body: JSON.stringify({ qrToken: ticket!.qrToken }),
  });
  check("conductor scans the ticket", scan.status === 200, JSON.stringify(scan.body).slice(0, 160));

  const afterScan = await call(`/api/manifest/${trip.id}`, conductor);
  check("manifest shows one boarded", afterScan.body.boarded === 1, `${afterScan.body.boarded}`);

  /* ---- departure -------------------------------------------------------- */
  console.log("\ndeparture");
  const departed = await call(`/api/trips/${trip.id}/operate`, driver, {
    method: "POST",
    body: JSON.stringify({ action: "DEPARTED" }),
  });
  check("driver reports departure", departed.status === 200, departed.body.status);
  check("the unscanned seat is marked no-show", departed.body.noShows >= 1,
    `${departed.body.noShows} no-show(s)`);

  const arrived = await call(`/api/trips/${trip.id}/operate`, driver, {
    method: "POST",
    body: JSON.stringify({ action: "ARRIVED" }),
  });
  check("driver reports arrival", arrived.status === 200, arrived.body.status);
  check("boarded bookings are completed", arrived.body.completed >= 1,
    `${arrived.body.completed}`);

  const finalTrip = await db.trip.findUnique({
    where: { id: trip.id },
    select: { status: true, actualDepartureAt: true, actualArrivalAt: true },
  });
  check("real departure and arrival times recorded",
    Boolean(finalTrip?.actualDepartureAt && finalTrip?.actualArrivalAt),
    finalTrip?.status);

  /* ---- clerk cannot operate a bus --------------------------------------- */
  console.log("\nrole boundaries");
  const clerkAttempt = await call(`/api/trips/${trip.id}/operate`, clerk, {
    method: "POST",
    body: JSON.stringify({ action: "ARRIVED" }),
  });
  check("a booking clerk cannot report a trip arrived", clerkAttempt.status === 403,
    `HTTP ${clerkAttempt.status}`);

  const driverRefund = await call("/api/refunds", driver);
  check("a driver cannot open the refund queue", driverRefund.status === 403);

  /* ---- refund ----------------------------------------------------------- */
  console.log("\nrefund");
  // A different departure, far enough out to be cancellable under policy.
  const cancellable = await db.booking.findFirst({
    where: {
      userId: (await db.user.findUnique({ where: { email: "passenger@example.com" } }))!.id,
      status: "CONFIRMED",
      trip: { departureAt: { gt: new Date(Date.now() + 5 * 86_400_000) } },
    },
    select: { id: true, reference: true, totalAmount: true },
  });

  if (!cancellable) {
    check("a cancellable booking exists", false, "none found");
  } else {
    const cancelled = await call(`/api/bookings/${cancellable.id}/cancel`, passenger, {
      method: "POST",
      body: JSON.stringify({ reason: "Lifecycle verification" }),
    });
    check("cancellation accepted", cancelled.status === 200);

    const refund = await db.refund.findFirst({
      where: { bookingId: cancellable.id },
      orderBy: { requestedAt: "desc" },
    });
    check("a refund record was opened", Boolean(refund),
      refund ? `${refund.status} ${refund.amount}` : "none");

    if (refund) {
      if (refund.status === "REQUESTED") {
        const approved = await call("/api/refunds", finance, {
          method: "POST",
          body: JSON.stringify({ refundId: refund.id, approve: true }),
        });
        check("finance officer approves it", approved.status === 200);
      }

      const settled = await db.refund.findUnique({ where: { id: refund.id } });
      check("refund reaches SETTLED", settled?.status === "SETTLED", settled?.status);

      // The money movement is what the old code never recorded.
      const movement = await db.payment.findFirst({
        where: { bookingId: cancellable.id, kind: "REFUND" },
      });
      check("a negative payment records the money going back",
        Boolean(movement) && movement!.amount < 0,
        movement ? String(movement.amount) : "none");

      const charge = await db.payment.findFirst({
        where: { bookingId: cancellable.id, kind: "CHARGE" },
      });
      check("the original charge is left intact",
        charge?.status === "SUCCESS",
        `charge is ${charge?.status}`);
    }
  }

  console.log(failures ? `\nFAILED with ${failures} problem(s)` : "\nFull lifecycle works.");
  await db.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
