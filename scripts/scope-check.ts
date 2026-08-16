export {};

/**
 * Proves one transport company cannot read another's business.
 *
 * This is the test for the defect that made operator scoping necessary: before
 * `User.operatorId` existed, a booking clerk at one company could list and edit
 * every other company's buses, and the analytics endpoint handed whole-platform
 * revenue to any staff account that asked for it.
 *
 * Every check runs over HTTP against the real handlers, because scoping that
 * holds in a unit test and leaks through a route handler is not scoping.
 *
 *   npx tsx scripts/scope-check.ts [baseUrl]
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

type Signin = { sessionId: string; cookie: string; role: string; operatorId: string | null };

async function login(email: string): Promise<Signin> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${email}: ${JSON.stringify(body)}`);
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const user = await db.user.findUnique({
    where: { email },
    select: { operatorId: true, role: true },
  });
  return {
    sessionId: body.sessionId,
    cookie,
    role: user!.role,
    operatorId: user!.operatorId,
  };
}

const auth = (s: Signin) => ({
  "content-type": "application/json",
  "x-session-id": s.sessionId,
  cookie: s.cookie,
});

async function get(path: string, s: Signin) {
  const res = await fetch(`${BASE}${path}`, { headers: auth(s) });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  // Two different companies, and a member of staff from each.
  const operators = await db.operator.findMany({ take: 2, orderBy: { name: "asc" } });
  const [alpha, beta] = operators;
  if (!alpha || !beta) throw new Error("Need at least two operators seeded.");

  const alphaStaff = await db.user.findFirst({
    where: { operatorId: alpha.id, role: "COMPANY_ADMIN" },
    select: { email: true },
  });
  const betaStaff = await db.user.findFirst({
    where: { operatorId: beta.id, role: "COMPANY_ADMIN" },
    select: { email: true },
  });
  if (!alphaStaff || !betaStaff) throw new Error("Need a company admin at each operator.");

  console.log(`${alpha.name} vs ${beta.name}\n`);

  const a = await login(alphaStaff.email);
  const b = await login(betaStaff.email);
  const superAdmin = await login("admin@safiriconnect.co.ke");
  const passenger = await login("passenger@example.com");

  /* ---- fleet ------------------------------------------------------------ */
  console.log("fleet");
  const aBuses = await get("/api/buses", a);
  const bBuses = await get("/api/buses", b);

  const aOperatorIds = new Set(aBuses.body.buses?.map((x: any) => x.operatorId));
  const bOperatorIds = new Set(bBuses.body.buses?.map((x: any) => x.operatorId));

  check(
    `${alpha.name} sees only its own buses`,
    aOperatorIds.size === 1 && aOperatorIds.has(alpha.id),
    `${aBuses.body.buses?.length} buses, ${aOperatorIds.size} operator(s)`,
  );
  check(
    `${beta.name} sees only its own buses`,
    bOperatorIds.size === 1 && bOperatorIds.has(beta.id),
    `${bBuses.body.buses?.length} buses`,
  );
  check(
    "the two fleets do not overlap",
    !aBuses.body.buses?.some((x: any) => bBuses.body.buses?.some((y: any) => y.id === x.id)),
  );

  const platformBuses = await get("/api/buses", superAdmin);
  check(
    "platform admin sees every fleet",
    platformBuses.body.buses?.length > aBuses.body.buses?.length,
    `${platformBuses.body.buses?.length} buses total`,
  );

  /* ---- bookings --------------------------------------------------------- */
  console.log("\nbookings");
  const aBookings = await get("/api/bookings?scope=all&perPage=100", a);
  const bBookings = await get("/api/bookings?scope=all&perPage=100", b);

  const aRefs = new Set((aBookings.body.bookings ?? []).map((x: any) => x.reference));
  const overlap = (bBookings.body.bookings ?? []).filter((x: any) => aRefs.has(x.reference));

  check("each company gets its own booking list", aRefs.size > 0 && overlap.length === 0,
    `${aRefs.size} vs ${bBookings.body.bookings?.length}, ${overlap.length} shared`);

  /* ---- departures ------------------------------------------------------- */
  console.log("\ndepartures");
  const aTrips = await get("/api/trips?scope=all&perPage=50", a);
  const bTrips = await get("/api/trips?scope=all&perPage=50", b);
  const aTripIds = new Set((aTrips.body.trips ?? []).map((t: any) => t.id));
  const tripOverlap = (bTrips.body.trips ?? []).filter((t: any) => aTripIds.has(t.id));
  check("timetables do not overlap", aTripIds.size > 0 && tripOverlap.length === 0,
    `${aTripIds.size} vs ${bTrips.body.trips?.length}`);

  /* ---- revenue ---------------------------------------------------------- */
  console.log("\nrevenue");
  const aRev = await get("/api/analytics?days=30", a);
  const bRev = await get("/api/analytics?days=30", b);
  const pRev = await get("/api/analytics?days=30", superAdmin);

  const rev = (r: any) => r.body?.kpis?.revenue ?? null;
  check("each company sees a different revenue figure", rev(aRev) !== rev(bRev),
    `${rev(aRev)} vs ${rev(bRev)}`);
  check("platform total exceeds any one company",
    rev(pRev) !== null && rev(aRev) !== null && rev(pRev) > rev(aRev),
    `platform ${rev(pRev)} vs ${alpha.name} ${rev(aRev)}`);

  /* ---- role boundaries -------------------------------------------------- */
  console.log("\nrole boundaries");
  const financeEmail = (
    await db.user.findFirst({
      where: { operatorId: alpha.id, role: "FINANCE_OFFICER" },
      select: { email: true },
    })
  )?.email;
  const driverEmail = (
    await db.user.findFirst({
      where: { operatorId: alpha.id, role: "DRIVER" },
      select: { email: true },
    })
  )?.email;

  if (financeEmail) {
    const finance = await login(financeEmail);
    const fleetAttempt = await fetch(`${BASE}/api/buses`, {
      method: "POST",
      headers: auth(finance),
      body: JSON.stringify({ registration: "KZZ 999Z", model: "Test", capacity: 40 }),
    });
    check("finance officer cannot add a bus", fleetAttempt.status === 403,
      `HTTP ${fleetAttempt.status}`);
    check("finance officer can read revenue", (await get("/api/analytics?days=7", finance)).status === 200);
  }

  if (driverEmail) {
    const driver = await login(driverEmail);
    check("driver cannot list the fleet", (await get("/api/buses", driver)).status === 403);
    check("driver cannot read revenue", (await get("/api/analytics?days=7", driver)).status === 403);
    check("driver cannot manage staff", (await get("/api/users", driver)).status === 403);
  }

  check("passenger cannot read revenue", (await get("/api/analytics?days=7", passenger)).status === 403);
  check("passenger cannot list the fleet", (await get("/api/buses", passenger)).status === 403);
  check("passenger cannot read the audit trail", (await get("/api/audit", passenger)).status === 403);
  check(
    "passenger asking for every booking gets only their own",
    (await get("/api/bookings?scope=all", passenger)).body.bookings?.every(
      (x: any) => x.user?.email === "passenger@example.com" || !x.user,
    ) !== false,
  );

  /* ---- staff directory -------------------------------------------------- */
  console.log("\nstaff directory");
  const aUsers = await get("/api/users?perPage=100", a);
  const operatorsSeen = new Set(
    (aUsers.body.users ?? []).map((u: any) => u.operatorId).filter(Boolean),
  );
  check("company admin sees only their own staff",
    operatorsSeen.size <= 1 && (operatorsSeen.size === 0 || operatorsSeen.has(alpha.id)),
    `${aUsers.body.users?.length} users, ${operatorsSeen.size} operator(s)`);
  check("company admin does not see passengers",
    !(aUsers.body.users ?? []).some((u: any) => u.role === "PASSENGER"));

  console.log(
    failures ? `\nFAILED with ${failures} leak(s)` : "\nNo cross-company access.",
  );
  await db.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
