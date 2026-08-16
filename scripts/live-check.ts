export {};

/**
 * Proves dashboards learn about changes without being reloaded.
 *
 * Opens a stream as a company admin, has a passenger book and pay on that
 * company's bus, and waits for the events to arrive. Also opens a stream as a
 * *different* company's admin and asserts nothing reaches it, because a live
 * channel that ignores operator scoping would leak the one thing scoping was
 * built to protect.
 *
 *   npx tsx scripts/live-check.ts [baseUrl]
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

/**
 * Collects domain event names off an SSE connection.
 *
 * `fetch` is used rather than an EventSource because Node has no built-in one
 * and the framing here is simple enough to read directly.
 */
function listen(signin: Signin, collected: string[]) {
  const controller = new AbortController();

  const run = async () => {
    const res = await fetch(`${BASE}/api/stream?sid=${signin.sessionId}`, {
      headers: auth(signin),
      signal: controller.signal,
    });
    if (!res.body) throw new Error("no stream body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Frames are separated by a blank line.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        if (!frame.includes("event: domain")) continue;
        const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
        if (!dataLine) continue;
        try {
          collected.push(JSON.parse(dataLine.slice(6)).type);
        } catch {
          /* ignore a partial frame */
        }
      }
    }
  };

  run().catch(() => {
    /* aborting the request is how this ends */
  });

  return () => controller.abort();
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const own: string[] = [];
  const other: string[] = [];

  // A departure belonging to the demo company.
  const trip = await db.trip.findFirst({
    where: {
      status: "SCHEDULED",
      departureAt: { gt: new Date(Date.now() + 4 * 86_400_000) },
      bus: { operator: { staff: { some: { email: "company@safiriconnect.co.ke" } } } },
    },
    orderBy: { departureAt: "asc" },
    include: { bus: { select: { operatorId: true } }, route: true },
  });
  if (!trip) throw new Error("No departure found for the demo company.");

  const rival = await db.user.findFirst({
    where: { role: "COMPANY_ADMIN", operatorId: { not: trip.bus.operatorId } },
    select: { email: true },
  });
  if (!rival) throw new Error("Need a company admin at another operator.");

  console.log(`${trip.route.origin} → ${trip.route.destination}\n`);

  const owner = await login("company@safiriconnect.co.ke");
  const outsider = await login(rival.email);
  const passenger = await login("passenger@example.com");

  const stopOwn = listen(owner, own);
  const stopOther = listen(outsider, other);

  // Give both connections a moment to register with the server.
  await wait(1500);

  /* ---- cause something to happen ---------------------------------------- */
  const taken = new Set(
    (await db.bookingSeat.findMany({ where: { tripId: trip.id }, select: { seatNumber: true } })).map(
      (s) => s.seatNumber,
    ),
  );
  const seat = ["6A", "6B", "7A", "7B", "8A", "8B"].find((s) => !taken.has(s));
  if (!seat) throw new Error("No free seat.");

  const created = await fetch(`${BASE}/api/bookings`, {
    method: "POST",
    headers: auth(passenger),
    body: JSON.stringify({
      tripId: trip.id,
      seats: [{ seatNumber: seat, passengerName: "Live Check", passengerPhone: "254700000333" }],
    }),
  });
  const booking = (await created.json()).booking;
  if (!booking) throw new Error("booking failed");

  await wait(1500);

  console.log("live delivery");
  check("the owning company was told about the booking", own.includes("booking.created"),
    own.join(", ") || "nothing received");

  /* ---- pay, which is the event dashboards care about most --------------- */
  const init = await fetch(`${BASE}/api/payments/initiate`, {
    method: "POST",
    headers: auth(passenger),
    body: JSON.stringify({ bookingId: booking.id, phone: "254700000333" }),
  });
  const { checkoutRequestId } = await init.json();

  let status = "PENDING";
  for (let i = 0; i < 20 && status === "PENDING"; i++) {
    await wait(1000);
    const poll = await fetch(`${BASE}/api/payments/status?checkoutRequestId=${checkoutRequestId}`, {
      headers: auth(passenger),
    });
    status = (await poll.json()).status;
  }

  await wait(1500);

  check("payment settled", status === "SUCCESS", status);
  check("the owning company was told about the confirmation",
    own.includes("booking.confirmed"), own.join(", "));

  console.log("\nscoping of the stream");
  check("a rival company received nothing", other.length === 0,
    other.length ? other.join(", ") : "silent");

  stopOwn();
  stopOther();

  console.log(failures ? `\nFAILED with ${failures} problem(s)` : "\nDashboards update live.");
  await db.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
