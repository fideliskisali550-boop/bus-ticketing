/**
 * Measures how long each API endpoint actually takes, so performance claims can
 * be checked rather than asserted.
 *
 *   npm run perf                  # against http://localhost:3000
 *   BASE=http://localhost:3200 npm run perf
 *
 * Run it against a production build (`npm run demo`) for meaningful numbers.
 * In development Next.js compiles each route the first time it is requested,
 * so a cold dev figure measures the compiler, not the application.
 */

export {};

const BASE = process.env.BASE ?? "http://localhost:3000";
const RUNS = 5;

type Probe = { name: string; path: string; as?: "admin" | "passenger" | "anon" };

const PROBES: Probe[] = [
  { name: "Home page", path: "/", as: "anon" },
  { name: "Search (no filters)", path: "/api/trips?perPage=12", as: "anon" },
  { name: "Search (corridor)", path: "/api/trips?origin=Nairobi&destination=Mombasa", as: "anon" },
  { name: "Search (dated, empty)", path: "/api/trips?origin=Nairobi&destination=Mombasa&date=2027-01-01", as: "anon" },
  { name: "Locations (autocomplete)", path: "/api/locations?bookableOnly=true", as: "anon" },
  { name: "Routes", path: "/api/routes", as: "anon" },
  { name: "Analytics 7d", path: "/api/analytics?days=7", as: "admin" },
  { name: "Analytics 30d", path: "/api/analytics?days=30", as: "admin" },
  { name: "Analytics 90d", path: "/api/analytics?days=90", as: "admin" },
  { name: "Bookings (mine)", path: "/api/bookings?perPage=10", as: "passenger" },
  { name: "Bookings (all)", path: "/api/bookings?scope=all&perPage=10", as: "admin" },
  { name: "Departures (admin)", path: "/api/trips?scope=all&perPage=15", as: "admin" },
  { name: "Audit trail", path: "/api/audit?perPage=25", as: "admin" },
  { name: "Users", path: "/api/users?perPage=20", as: "admin" },
];

const CREDENTIALS = {
  admin: { email: "admin@safiriconnect.co.ke", password: "Password123" },
  passenger: { email: "passenger@example.com", password: "Password123" },
};

/** Cookies persist across calls, mimicking one browser holding several sessions. */
let cookieJar = "";

function absorbCookies(res: Response) {
  const set = res.headers.get("set-cookie");
  if (set) cookieJar = set.split(";")[0]!;
}

async function signIn(as: "admin" | "passenger") {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookieJar ? { cookie: cookieJar } : {}) },
    body: JSON.stringify(CREDENTIALS[as]),
  });
  absorbCookies(res);
  const body = (await res.json()) as { sessionId?: string };
  return body.sessionId ?? "";
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;

async function main() {
  console.log(`Measuring ${BASE} — ${RUNS} runs per endpoint\n`);

  const sessions = {
    admin: await signIn("admin"),
    passenger: await signIn("passenger"),
    anon: "",
  };

  console.log(
    "Endpoint                        cold      median    p95       verdict",
  );
  console.log("─".repeat(78));

  let slow = 0;

  for (const probe of PROBES) {
    const headers: Record<string, string> = { cookie: cookieJar };
    const sid = sessions[probe.as ?? "anon"];
    if (sid) headers["X-Session-Id"] = sid;

    const timings: number[] = [];

    for (let i = 0; i < RUNS; i++) {
      const started = performance.now();
      const res = await fetch(`${BASE}${probe.path}`, { headers });
      await res.arrayBuffer();
      timings.push(performance.now() - started);
    }

    const cold = timings[0]!;
    const rest = timings.slice(1).sort((a, b) => a - b);
    const median = rest.length ? percentile(rest, 50) : cold;
    const p95 = rest.length ? percentile(rest, 95) : cold;

    // 300ms is roughly where an interaction stops feeling immediate.
    const ok = median < 300;
    if (!ok) slow++;

    console.log(
      `${probe.name.padEnd(30)} ${`${cold.toFixed(0)}ms`.padEnd(9)} ` +
        `${`${median.toFixed(0)}ms`.padEnd(9)} ${`${p95.toFixed(0)}ms`.padEnd(9)} ` +
        `${ok ? "ok" : "SLOW"}`,
    );
  }

  console.log(
    slow === 0
      ? "\nEvery endpoint responds in under 300ms at the median."
      : `\n${slow} endpoint(s) above the 300ms target.`,
  );
}

main().catch((error) => {
  console.error(
    `\nCould not reach ${BASE}. Start the server first:\n  npm run demo\n\n`,
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
