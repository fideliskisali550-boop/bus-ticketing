export {};

/**
 * Proves that signing out of one account does not drop the tab into another.
 *
 * The reported bug: signed in as booking staff in one tab and administrator in
 * another (both held in the same cookie envelope), signing out of the booking
 * staff account left the tab showing the administrator — because a tab with no
 * session id fell back to the most recent account still in the envelope.
 *
 * The whole point of the multi-account design is that these two accounts share
 * one cookie, so this test uses one cookie jar throughout, exactly as a browser
 * would.
 *
 *   npx tsx scripts/logout-check.ts [baseUrl]
 */

const BASE = process.argv[2] ?? "http://localhost:3000";
const SIGNED_OUT = "signed-out";

let failures = 0;
function check(label: string, pass: boolean, detail = "") {
  if (!pass) failures++;
  console.log(`  ${pass ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

/** One shared cookie jar, like a single browser holding the envelope. */
let cookie = "";
function absorb(res: Response) {
  const set = res.headers.getSetCookie?.() ?? [];
  for (const c of set) {
    const [pair] = c.split(";");
    const name = pair!.split("=")[0]!;
    // Replace any existing value for this cookie name with the newest.
    const kept = cookie
      .split("; ")
      .filter((x) => x && x.split("=")[0] !== name);
    cookie = [...kept, pair].join("; ");
  }
}

async function call(path: string, sid: string | null, init?: RequestInit) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  if (sid) headers["x-session-id"] = sid;
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  absorb(res);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function login(email: string): Promise<string> {
  const res = await call("/api/auth/login", null, {
    method: "POST",
    body: JSON.stringify({ email, password: "Password123" }),
  });
  if (res.status !== 200) throw new Error(`login ${email}: ${JSON.stringify(res.body)}`);
  return res.body.sessionId as string;
}

/** Who does /api/auth/me report for a given tab session id? */
async function whoAmI(sid: string | null): Promise<string | null> {
  const res = await call(`/api/auth/me`, sid);
  return res.body.user?.role ?? null;
}

async function main() {
  // Both accounts sign in on the same cookie — the envelope now holds two.
  const adminSid = await login("admin@safiriconnect.co.ke");
  const staffSid = await login("staff@safiriconnect.co.ke");
  console.log(`envelope holds admin (${adminSid}) and staff (${staffSid})\n`);

  console.log("before signing out");
  check("the admin tab is the administrator", (await whoAmI(adminSid)) === "SUPER_ADMIN");
  check("the staff tab is booking staff", (await whoAmI(staffSid)) === "BOOKING_STAFF");

  console.log("\nsign out of the staff tab");
  const out = await call("/api/auth/logout", staffSid, { method: "POST" });
  check("logout accepted", out.status === 200);

  console.log("\nafter signing out");
  // The tab now carries the signed-out sentinel, exactly as the browser sets it.
  check(
    "the signed-out tab is nobody, not the administrator",
    (await whoAmI(SIGNED_OUT)) === null,
    `me → ${await whoAmI(SIGNED_OUT)}`,
  );
  check(
    "the destroyed staff session no longer resolves",
    (await whoAmI(staffSid)) === null,
  );
  check(
    "the other tab is still the administrator",
    (await whoAmI(adminSid)) === "SUPER_ADMIN",
    `admin tab → ${await whoAmI(adminSid)}`,
  );

  // A request naming no session is the "brand-new tab" case. It must resolve to
  // nobody rather than to whoever signed in last: that fallback is what let a
  // freshly opened tab come up already logged in as another tab's account.
  console.log("\na tab that names no session");
  check(
    "an unattributed request inherits nothing",
    (await whoAmI(null)) === null,
    `me → ${await whoAmI(null)}`,
  );

  console.log(
    failures
      ? `\nFAILED with ${failures} problem(s)`
      : "\nSigning out leaves the tab signed out, and other tabs untouched.",
  );
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
