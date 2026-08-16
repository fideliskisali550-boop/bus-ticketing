# SafiriConnect — Online Bus Ticketing System

A web-based ticketing platform for Kenyan long-distance bus operators. Passengers
search departures, choose a specific seat, and pay by M-Pesa; operators get live
occupancy, revenue reporting, passenger manifests and gate check-in.

Built from the SRS in `Project.docx` (Fidelis Atonga, DBIT/N/0896/05/25).

---

## ⚠ Payments are simulated — no money can move

This build **cannot charge anyone, including the developer.** That is a property
of the code, not a setting to be trusted:

- The codebase contains **no external URL**, and **no HTTP client library is
  installed** (no axios, no node-fetch). Every `fetch()` call is a relative path
  to this app's own API.
- **No payment credentials exist** anywhere — no consumer key, no secret, no
  passkey, no till or paybill number.
- The Content-Security-Policy sets `connect-src 'self'`, so the browser is
  blocked from reaching any outside host even if code attempted it.
- `LiveMpesa` in `src/lib/mpesa.ts` contains **no networking code whatsoever** —
  it is a stub that throws. Setting `MPESA_LIVE=true` produces an error, not a
  charge.

The simulator is plain in-process JavaScript: a `Map` and a timer. It resolves
after 3–6 seconds and fails ~10% of the time so the failure path can be shown
during a presentation. Its activity is a local `console.log` prefixed
`[mpesa:sim]`, which is how you can confirm at a glance that nothing left the
machine.

**When you are ready to take real payments**, see
[Going live with M-Pesa](#going-live-with-m-pesa) at the end of this document.
Until then, nothing needs to change and no account needs to be opened.

---

## Quick start

```bash
npm install
cp .env.example .env   # Windows: copy .env.example .env
npm run setup          # generate Prisma client, create the database, load demo data
npm run dev            # http://localhost:3000
```

`npm run setup` is idempotent — re-run it any time to get a clean demo dataset.

**Setting this up on a new machine, or handing it to someone else?** Follow
**[SETUP.md](SETUP.md)** instead — a step-by-step guide that assumes nothing is
installed, including how to install Node.js and what to do when things go wrong.

### Demonstration accounts

All use the password `Password123`.

| Role | Email | Sees |
|---|---|---|
| Super admin | `admin@safiriconnect.co.ke` | the whole platform, every operator |
| Support | `support@safiriconnect.co.ke` | any passenger's booking, no configuration |
| Company admin | `company@safiriconnect.co.ke` | one company: fleet, timetable, staff, revenue |
| Finance officer | `finance@safiriconnect.co.ke` | one company's money; cannot touch bookings |
| Booking staff | `staff@safiriconnect.co.ke` | one company's counter and gate |
| Conductor | `conductor@safiriconnect.co.ke` | only the trips they are rostered on |
| Driver | `driver@safiriconnect.co.ke` | their own departures — counts, never names |
| Passenger | `passenger@example.com` | their own bookings |

Every one of the fifteen seeded companies also has its own set of staff at
`admin@<code>.co.ke`, `ops@`, `finance@`, `desk@`, `driver1@`, `conductor1@` —
useful for demonstrating that one company genuinely cannot see another's.

The sign-in page lists the main accounts in development and hides them in
production builds.

Open two browser tabs and sign in as different roles: sessions are per tab, so
an administrator in one window and a conductor in another is a supported way to
work.

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run setup` | Generate client, push schema, seed |
| `npm run db:reset` | Wipe and reseed |
| `npm run db:studio` | Browse the database in Prisma Studio |
| `npm run demo` | **Build and serve for a presentation** — far faster than dev |
| `npm run perf` | Measure API response times against a running server |
| `npm test` | Unit tests for the business rules |
| `npm run check` | Type-check and test in one go |
| `npm run typecheck` | Type-check without emitting |
| `npx tsx scripts/scope-check.ts` | Proves no company can read another's data |
| `npx tsx scripts/lifecycle-check.ts` | Drives a departure through its whole life, across six roles |
| `npx tsx scripts/workflow-check.ts` | Proves every role hears what it should, and nothing it should not |
| `npx tsx scripts/live-check.ts` | Proves dashboards update without a reload |
| `npx tsx scripts/calendar-sync-check.ts` | Proves the calendar and the search agree |

> **Demonstrating to examiners? Use `npm run demo`, not `npm run dev`.**
> Development mode compiles each page the first time it is opened, which makes
> clicking around feel sluggish. A built application has none of that cost —
> every endpoint responds in well under a tenth of a second.

---

## What the SRS specified, and what it did not

Chapter One of the source document sets out the objectives — automate booking,
secure the data, integrate digital payments, validate reliability — but it stops
short of a functional specification. It contains no entity model, no use cases,
no business rules, and no acceptance criteria.

The following were therefore designed rather than transcribed. Each is a
deliberate assumption, documented so it can be challenged:

| Gap in the SRS | Decision taken | Why |
|---|---|---|
| No seat-hold model | Seats held 15 minutes as a `PENDING` booking, then released | Without a hold, a passenger loses their seat mid-payment; without an expiry, abandoned carts sterilise the bus |
| No refund policy | Sliding scale: 100% >48h, 75% 24–48h, 50% 6–24h, 0% <6h | Mirrors Kenyan operator practice; the closer to departure, the less chance to resell |
| No booking cutoff | Closes 30 minutes before departure | The manifest has to be printed and the gate staffed |
| Double-booking prevention unspecified | Database unique constraint on `(tripId, seatNumber)` | A check-then-write leaves a race window; a constraint does not |
| No cancellation-by-operator flow | Full refund regardless of timing, plus email/SMS to every affected passenger | The passenger is not at fault when the operator cancels |
| No role model | Nine roles across two planes — see [Roles and operator scoping](#roles-and-operator-scoping) | The SRS assumed one company; the platform hosts fifteen, and they must not see each other |
| No check-in mechanism | Opaque QR token per ticket, distinct from the booking reference | A reference glimpsed on someone's screen must not board a bus |
| No seat limit | Maximum 6 seats per booking | Deters seat hoarding while still serving families |
| Payment "simulated" (§1.8) | Adapter implementing the Daraja STK-push contract | Going live becomes one class, not a schema migration |
| No audit requirement | Append-only `AuditLog` on every state change | §1.2 names revenue fraud as a driver; an audit trail is the answer |

---

## Multiple accounts at once

Signing into a second account does not sign you out of the first. Several
accounts stay live in one browser, and **each tab acts as whichever one it
selected** — an admin dashboard in one window and a passenger booking flow in
another, side by side.

Use the account menu (top right) → *Sign in to another account*, then switch
between them from the same menu. The switch affects only the current tab.

### How it works, and why not the obvious way

Cookies are scoped to an origin, not to a tab, so one session cookie makes every
tab the same user. The tempting fix is to move tokens into `sessionStorage`,
which *is* per-tab — but anything JavaScript can read, injected JavaScript can
steal, which is the whole reason httpOnly cookies exist.

So the credentials stay in an httpOnly cookie that now holds an *envelope* of
several sessions keyed by a short id. Each tab keeps only its chosen **session
id** in `sessionStorage` and sends it as an `X-Session-Id` header. That id is
not a credential: on its own it grants nothing, because the matching token never
leaves the cookie.

Two consequences worth knowing:

- **Sessions resolve against the database on every request** rather than from a
  self-contained JWT. That costs one indexed lookup and buys immediate
  revocation — deactivating a user or signing out a session takes effect at
  once, instead of remaining valid until a stateless token expires.
- **Role gates for pages live on the client**, in `RequireRole` and
  `AdminShell`, because server rendering cannot see which account a tab picked.
  This decides what is *shown*. What is *permitted* is enforced independently by
  every API route via `requireRole`, which is the real security boundary — a
  passenger tab receives 403 from the admin endpoints even while an admin
  session is signed in on the same browser.

---

## Fares

Fares are market rates, not generated numbers.

Each route carries a `baseFare` — the real economy walk-up price on that
corridor. A trip's fare is derived from it by the fare engine
(`src/lib/fares.ts`): base × service class × any pricing rules in force.

| Corridor | Economy | With VIP / Executive |
|---|---|---|
| Nakuru → Nairobi | KES 500 | economy only (too short for premium) |
| Nairobi → Nyeri | KES 500 | economy only |
| Eldoret → Nairobi | KES 1,200 | up to 1,800 |
| Kisumu → Nairobi | KES 1,400 | up to 2,100 |
| Nairobi → Mombasa | KES 1,700 | up to 3,250 |
| Nairobi → Arusha | KES 1,800 | up to 2,650 |
| Nairobi → Kampala | KES 2,800 | up to 5,400 |
| Nairobi → Kigali | KES 5,000 | up to 7,450 |

`npm run db:seed && npx tsx scripts/check-fares.ts` prints the live figures and
checks them against these real-world ranges.

Design decisions worth defending:

- **Distance does not set the price.** Kenyan fares are set by competition on
  each corridor, so a pure distance × rate model produces numbers that look
  tidy and are obviously wrong to anyone who has taken the bus. Distance is used
  only to *estimate* an opening fare for a brand-new route.
- **Premium classes are gated by distance.** VIP appears from 250 km, Executive
  from 450 km. No operator runs an executive coach on the 157 km Nakuru hop, and
  pricing one as though they did is how a KES 500 journey ends up advertised at
  KES 900.
- **Absurd fares are refused, not published.** Scheduling a departure more than
  three times (or under a quarter of) its corridor's base fare is rejected with
  an explanation. That is the guard against the KES 8,000-on-a-KES-500-route
  class of data-entry slip.
- **Fare changes are recorded.** Every change writes a `FareHistory` row with
  the old price, new price, reason and who made it. Trips already scheduled keep
  the fare they were sold at — repricing a journey someone has paid for would be
  indefensible.

Pricing rules (weekend loading, festive-season surcharge, promotional discounts)
live in the `FareRule` table so they can be tuned without a redeploy.

---

## Journey planning

Searching for a bus and searching for a *journey* are different questions, and
the system answers both.

`/api/trips` finds services running directly between two towns. `/api/journeys`
finds a way to travel between them at all — assembling an itinerary out of
connecting services when no single bus makes the run.

This exists because the direct-only version failed exactly as you would expect:
a search for Chuka to Bomet returned "no departures", when the journey is
obviously possible by changing at Nakuru. That is a lookup, not route discovery.

### How it works

1. **The network is a graph** (`src/lib/journey-graph.ts`). Towns are nodes,
   routes are edges. It is small — 82 towns, ~740 edges — so it is held in
   memory and rebuilt every few minutes rather than re-queried per search.
   Pathfinding then costs no database round trips at all.

2. **Dijkstra over riding time**, not hop count. The fewest-changes route is
   often far slower than one extra change down a trunk corridor, and a
   passenger given the choice takes the faster one. A 45-minute penalty per
   change stops the search preferring a chain of short hops to one long ride.

3. **Alternatives via the major interchanges.** Beyond the fastest path, the
   planner routes deliberately through each hub — which is how a booking clerk
   answers the question ("you could go via Nairobi, or via Nakuru") and produces
   genuinely different options rather than trivial variations.

4. **Materialisation** (`src/lib/journey-planner.ts`) turns a path into
   something bookable: each leg matched to a real departure leaving at least 45
   minutes after the previous one lands. Every candidate leg for every candidate
   path is loaded in a single indexed query.

5. **Backtracking.** It tries several departures per leg rather than only the
   first. Taking the earliest bus every time sounds optimal and is not: the
   first bus out of Chuka may reach Nairobi just after the day's last Kisumu
   service has gone, where a later one connects the same evening.

### Two design corrections worth recording

**Fewer routes, not more.** The first attempt wired every town to everything
within 300 km — nearly two thousand corridors. That sounds like better coverage
and is the opposite: spread over a fixed fleet each one could only run every
other day, so a passenger arriving at a change point faced a forty-hour wait and
no itinerary could be assembled at all. Hub-and-spoke concentrates the same
services onto ~740 corridors, every one running daily, and the planner supplies
the missing pairs by changing buses. Coverage went up while route count went
down by a third.

**Every town needs a real hub.** Ranking a town's connections purely by distance
gave Chuka a set of small neighbours, so the only way out was through a town
with one bus a day — and the planner duly produced a Chuka–Bomet itinerary via
Nanyuki with eighteen hours of waiting when the obvious route is through
Nairobi. Every town is now wired to its nearest major hub unconditionally,
which is also what actually happens: a local bus runs to the nearest city and
the long-distance network takes over there.

### Verification

| Search | Result |
|---|---|
| Chuka → Bomet | 2 changes via Meru, Nakuru · 25h55m · KES 1,400 |
| Chuka → Kisumu | 1 change via Nairobi · 12h45m · KES 2,000 |
| Bomet → Zanzibar | 2 changes via Kisii, Dar es Salaam · KES 5,000 |
| Meru → Kampala | 1 change via Eldoret · 14h53m · KES 3,250 |
| Eldoret → Kigali | 1 change via Kisumu · 17h13m · KES 5,600 |
| Nakuru → Bujumbura | 1 change via Nairobi · 37h00m · KES 6,500 |

All six resolve in **under 120 ms**. Long waits are stated plainly — "includes
an overnight stop" — rather than buried, because a passenger needs to know
before booking, not after.

Zanzibar is reachable because it is modelled honestly: no coach drives there,
but operators sell through-tickets via the Dar es Salaam ferry, so it is
connected to its mainland port and the planner routes through it like any other
change.

### One availability engine

The calendar and the search results are the same computation, `getAvailability`
in `src/lib/availability.ts`, which is built on the planner above.

That sharing exists because they were once separate and disagreed. The calendar
had its own SQL aggregate matching `Route.origin` and `Route.destination`
directly, so it could only see corridors served end to end by a single route. On
Bomet → Chuka, where no such route exists, the page contradicted itself: eight
itineraries listed under a calendar that greyed out every day they departed on.
Neither component was buggy in isolation. Availability had simply been written
twice, in two different definitions of the word.

It now has one definition — **a day is available when a journey can be started
on it and completed**, whether that takes one bus or four. Days reachable only
by changing are marked ⇄, so the calendar never overstates what is on offer.

A month costs one graph traversal and one indexed read; the thirty days are then
resolved in memory rather than planned individually against the database.

Two checks guard the property, both in `scripts/`:

| Script | Asserts |
|---|---|
| `calendar-sync-check.ts` | Across six corridors, every sampled day agrees between `/api/availability` and `/api/journeys` |
| `calendar-live-check.ts` | Scheduling a departure turns a day on; selling it out turns it red; cancelling it turns it off — with no code change |

---

## Roles and operator scoping

SafiriConnect is a **marketplace, not a bus company**. Fifteen operators trade on
one platform, which means two separate planes of authority — and the first
version of this system did not express that at all. `User` had no company, so a
booking clerk at Easy Coach could list and edit Modern Coast's buses, and the
analytics endpoint handed whole-platform revenue to any staff account that asked
for it.

| Plane | Roles | `operatorId` |
|---|---|---|
| Platform | `SUPER_ADMIN`, `PLATFORM_SUPPORT`, `PASSENGER` | null |
| Operator | `COMPANY_ADMIN`, `ROUTE_MANAGER`, `FINANCE_OFFICER`, `BOOKING_STAFF`, `CONDUCTOR`, `DRIVER` | required |

Three ideas do the work, all in `src/lib/scope.ts`:

**Ownership runs through the vehicle.** A trip belongs to whoever owns the bus
running it. Routes are shared infrastructure — six companies run
Nairobi–Mombasa — so scoping on the route would be wrong.

**Guards name capabilities, not roles.** `requireStaff` meant "STAFF or ADMIN",
which was fine with three roles and quietly wrong with nine: a finance officer
is staff, and must not be able to edit a timetable. Handlers now ask
`requireCapability("MANAGE_FLEET")`, so adding a role is an edit to one table
rather than an audit of thirty handlers.

**Crew see only what they are rostered on.** A conductor gets the manifest for
their own bus; a driver gets the passenger *count* and never the names, because
a driver has no operational need for them and the minimisation is cheaper to
enforce in the query than to remember in every template.

`scripts/scope-check.ts` proves it over HTTP — fleets, bookings, timetables,
revenue and the staff directory all isolated, with each role's boundaries
tested individually.

---

## Events, notifications and live dashboards

Every route handler used to decide for itself what to record and whom to tell.
Audit grew good that way — twenty-eight call sites — but notifications did not:
**four call sites in the whole application, every one addressed to a single
passenger.** A booking could be created, paid, ticketed and issued a QR code
without one operational user learning of it.

Handlers now emit one event and say nothing about consequences
(`src/lib/events.ts`). Three subscribers decide:

| Subscriber | Does |
|---|---|
| audit | writes the immutable trail, for every event without exception |
| notification | routes by role, scoped to the operator, volume-controlled |
| stream | pushes a live invalidation to open dashboards over SSE |

### Why notifications have delivery classes

Telling every clerk about every booking does not scale. An operator selling five
hundred seats a day would send each of them five hundred messages, and a bell
that cries wolf is a bell nobody reads. So each event carries a class per role:

| Class | Delivery |
|---|---|
| **Push** | in-app plus email/SMS — it changes where someone will be or what they pay |
| **In-app** | the bell; act within hours |
| **Digest** | collapsed into a periodic summary |
| **Dashboard** | no message at all; a live figure says it better |

Two rules matter more than the table. **Urgency is a function of
time-to-departure, not of event type** — a cancellation three weeks out is a
number, the same cancellation ninety minutes before boarding is something the
conductor must be told. And **nobody is notified of their own action**, with one
deliberate exception: a passenger's own receipts. Suppressing those because the
passenger caused them silently removed every confirmation the system sends,
which is exactly the bug `workflow-check.ts` caught.

### Live updates

`/api/stream` holds one Server-Sent Events connection per open dashboard. SSE
rather than WebSockets because the traffic is one-directional, it needs no
second process and no new dependency, and clients reconnect on their own.

What travels is only the event *name* and the operator it concerns — never the
payload. Clients re-fetch the queries that care. Pushing data down the stream
would mean re-implementing every dashboard's authorisation a second time with no
server to check it: a stale number is a bug, a leaked one is a breach.

Every dashboard keeps a polling floor as well. A dashboard that has silently
lost its stream and shows a frozen figure is worse than one that never claimed
to be live, and the client cannot tell "nothing happened" from "I am no longer
being told".

---

## The operational day

`TripStatus` carried `DEPARTED` and `ARRIVED` from the first schema and
**nothing ever set them**, so every arrival time the platform displayed was a
timetable guess and punctuality reporting was impossible. The driver is the only
person who knows, and now reports it.

```
sell → hold → pay → ticket → boarding opens → conductor scans
     → driver departs (unscanned seats become no-shows)
     → driver arrives (boarded bookings complete)
```

Boarding is recorded **per seat**, not per booking: a family books four seats and
three turn up, and the manifest has to be able to say which.

`scripts/lifecycle-check.ts` drives that whole sequence across six roles over
HTTP, including the refusals — a clerk cannot report a trip arrived, a driver
cannot open the refund queue, a conductor from another company cannot read the
manifest.

---

## Money

A refund used to be a number written to `Booking.refundAmount` and left there.
No payment row was ever created and nothing was ever settled, so cancelled value
silently stayed in revenue: the reports said the company had earned money it had
agreed to give back.

A refund is now a transaction with a life — requested, reviewed, settled — and
settlement writes a **negative `Payment` of kind `REFUND`** rather than flipping
the original charge. Flipping it erased the fact that money was ever collected,
so a month's takings shrank retrospectively and never reconciled against M-Pesa.

Refunds under KES 5,000 settle themselves, because making an officer approve a
KES 400 return is how approval queues become rubber stamps. Larger ones wait for
a finance officer — who deliberately **cannot modify the booking** that
justified one. Somebody able to do both could write off a fare and then edit
away the evidence.

---

## Recurring schedules

Operators do not schedule departures one at a time; they run the 07:00 to
Mombasa every weekday. A `ScheduleTemplate` stores the pattern and generation
projects it into real departures on a rolling 30-day horizon.

Generation is idempotent — safe to run repeatedly, from a button or a timer,
because a departure already produced for a day is recognised and left alone.
It also refuses to put a bus in two places at once: a generated departure that
would overlap something the vehicle is already committed to is dropped rather
than double-booking the fleet.

---

## Operators, places and routes

Fifteen real Kenyan bus companies sell tickets on the platform — Tahmeed Coach,
Easy Coach, Modern Coast, Mash Poa, Coast Bus, Guardian Angel, Dreamline
Express, Chania Genesis, 2NK Sacco, North Rift Shuttle, Transline Classic,
Simba Coach, Crown Bus, Greenline Safaris and Mombasa Raha. Each runs its own
vehicles, so a corridor shows several companies at different prices and the
passenger chooses — which is what a booking platform is for, as opposed to a
single fleet.

Operators are matched to corridors they credibly serve. Matching on *either*
endpoint does not work, because almost every company lists Nairobi: a one-ended
test put all fifteen on Nairobi–Mombasa, western-Kenya specialists included.
Requiring strength at *both* ends leaves the coast operators on the coast road,
Easy Coach and Transline on the western routes, and 2NK Sacco and Chania Genesis
alone on Nairobi–Nyeri.

### The route network is generated, not hand-listed

254 locations: all 47 counties and their principal towns, named bus terminals,
border posts, and 16 East African destinations.

**1,952 routes from 81 origins** — 65 hand-priced with real market fares, the
rest derived from the seeded coordinates.

The hand-written list alone reached only eleven origins, so a passenger could
pick two perfectly sensible towns from the autocomplete — Nakuru and Mombasa,
say — and be told nothing runs, because that pair had never been typed out. No
hand-maintained list scales to a real network: 47 counties is over two thousand
ordered pairs.

So the rest is derived geographically (`prisma/data/network.ts`): great-circle
distance scaled by a road factor of 1.22, calibrated against known trunk routes,
with fares from the distance estimator. Curated corridors always win — the
generator never overwrites a real market fare with an estimate.

Plausibility is enforced rather than assumed:

- **Hubs connect widely; small towns connect regionally.** There is no direct
  Wajir–Kilifi coach, and inventing one would be worse than admitting the
  journey needs a change.
- **Cross-border services follow real corridors.** Each Kenyan gateway serves
  named countries — Uganda traffic from the western towns, Tanzania from Nairobi
  and the coast, South Sudan through Turkana. A flat "gateway" list produced 908
  international routes including Lodwar–Zanzibar, which is both a 26-hour drive
  and an island. Corridor rules cut that to 116 credible services.
- **Islands are excluded from road timetables.**

Search autocomplete is driven by route endpoints rather than the whole
catalogue, so it can never suggest a town that nothing actually serves.

---

## Times are always East Africa Time

A bus leaves Nairobi at 21:00 EAT whether the person looking at the screen is in
Mombasa, London or California. Timestamps are stored in UTC, and every
passenger-facing time is rendered in `Africa/Nairobi` through `src/lib/time.ts`
— never in the viewer's local zone.

This is not theoretical. Formatting in the browser's timezone is the default for
`toLocaleString`, and the resulting bug is invisible while developing on a
Kenyan machine: it only appears when the project is opened on a laptop set to
anything else, where every departure reads hours out. `src/lib/time.test.ts`
asserts against fixed UTC instants, so it fails if the formatting ever drifts
back to host-local — wherever the tests happen to run.

---

## Performance

Measured against a production build with the full demo dataset (4,775
departures, 36,000 bookings, 65,000 seats):

| Endpoint | Median |
|---|---|
| Home page | 57 ms |
| Search | 16 ms |
| Locations (autocomplete) | 9 ms |
| Analytics, 30 days | 12 ms |
| Analytics, 90 days | 10 ms |
| Bookings (all, staff) | 41 ms |
| Audit trail | 11 ms |

Run `npm run perf` against a running server to reproduce these.

Two things mattered far more than the rest:

1. **Analytics is computed by the database.** An earlier version pulled the
   window's payments into memory to bucket them by day, and grouped bookings by
   trip before re-querying those trips by id — an `IN` clause running to
   thousands of entries. That took up to 17 seconds. In SQL it takes 10 ms.
2. **Development mode compiles each route on first visit.** That is what makes
   clicking around a `npm run dev` server feel slow, and it does not exist in a
   built application. **For a presentation, run `npm run demo`.**

Also applied: short-lived caching on the analytics endpoint, cache headers on
the slow-changing place and route catalogues, and stale-response guards on every
filtered list so a slow earlier request cannot overwrite a newer one — the bug
that makes a search box appear to show the wrong results while typing.

---

## Architecture

```
Browser
  │  React 19 · server components for data, client components for interaction
  ▼
Next.js 15 (App Router)
  ├── middleware.ts ......... security headers, coarse route guarding
  ├── app/(pages) ........... server-rendered screens
  ├── app/api/* ............. REST endpoints, each guarded server-side
  └── lib/
        api.ts .............. error envelope, RBAC guards, rate limiting
        auth.ts ............. JWT + refresh sessions, bcrypt
        bookings.ts ......... seat allocation, hold expiry, ticket issue
        policy.ts ........... fares, refunds, seat maps  (pure, unit-tested)
        mpesa.ts ............ payment gateway adapter
        audit.ts / notify.ts  audit trail, notifications
  ▼
Prisma ORM
  ▼
SQLite (development) · PostgreSQL (production — change one line)
```

### Why this stack

A split React SPA plus a separate NestJS API, Postgres and Docker is the
conventional answer, and it reads well on an architecture diagram. It also has
four processes that must all be running before anything can be demonstrated.
This system runs on `npm install && npm run dev` on any machine with Node — which
matters more when the software has to work in front of an examiner.

Nothing is given up in exchange. Route handlers are ordinary REST endpoints and
could be lifted into a separate service unchanged. Prisma's provider is a
one-line switch to PostgreSQL, and no SQLite-specific construct is used anywhere
in the schema.

### Layering

Route handlers do three things and no more: authorise, validate, delegate.
Business logic lives in `lib/`, and the rules that carry money — fares, refunds,
seat geometry — are pure functions in `policy.ts` with no database or framework
dependency, which is what makes them directly testable.

---

## Security

| Concern | Measure |
|---|---|
| Password storage | bcrypt, cost 12 |
| Session | JWT access token (15 min) in an httpOnly cookie, plus a hashed, revocable refresh token |
| Session revocation | Refresh tokens stored as SHA-256 hashes; logout, password change and deactivation revoke them server-side |
| Brute force | Per-IP rate limiting plus per-account lockout after 5 failures |
| User enumeration | Identical error for unknown user and wrong password, with a dummy hash computed to equalise response time |
| SQL injection | Prisma parameterises every query; no string-built SQL exists in the codebase |
| XSS | React escapes by default; no `dangerouslySetInnerHTML`; CSP restricts script sources |
| CSRF | `SameSite=Lax` cookies; state changes are POST/PATCH only |
| Clickjacking | `X-Frame-Options: DENY` and `frame-ancestors 'none'` |
| Authorisation | Re-checked server-side on every endpoint, including object-level ownership — middleware is a convenience, never the boundary |
| Privilege escalation | Role is never read from the request body; self-registration is hard-coded to `PASSENGER` |
| Lockout of last admin | The system refuses to demote or deactivate the final active administrator |
| Audit | Append-only log with sensitive fields redacted before writing |
| Input validation | Zod schema on every request body, with per-field error messages |

### Known limitations

- **Rate limiting is in-process.** Correct on a single instance; a multi-instance
  deployment needs Redis behind the same `limit()` interface.
- **Email and SMS are logged, not sent.** `lib/notify.ts` has the two transport
  functions to replace.
- **Payments are simulated**, per SRS §1.8. `lib/mpesa.ts` implements the Daraja
  contract against an in-process simulator that succeeds, fails and delays like
  the real thing.
- **No email verification flow.** The field exists on the model; the flow does not.

---

## Data model

Twelve entities. Every relation is a real foreign key with an index on the
columns actually queried.

```
User ──< Booking >── Trip ──> Route
 │          │          │
 │          │          └────> Bus
 │          ├──< BookingSeat        unique (tripId, seatNumber)  ← anti-double-booking
 │          ├──< Payment
 │          └──── Ticket            unique qrToken
 ├──< Session          revocable refresh tokens
 ├──< Notification
 └──< AuditLog                                            Setting  (key/value)
```

The constraint worth pointing at is `BookingSeat @@unique([tripId, seatNumber])`.
It is why two passengers tapping the same seat in the same millisecond cannot
both succeed: both reach the insert, the database admits one, and the other
receives a `P2002` that the application turns into a friendly 409. The guarantee
is held by the database, not by application timing.

`Trip.seatsBooked` is a denormalised counter maintained inside the same
transaction as the seat rows, so availability can be listed without aggregating
bookings on every search.

---

## API

All endpoints return JSON. Errors use `{ error: string, details?: object }`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Create a passenger account |
| POST | `/api/auth/login` | Public | Sign in |
| POST | `/api/auth/logout` | User | Sign out and revoke the session |
| GET | `/api/auth/me` | User | Current profile |
| POST | `/api/auth/password` | User | Change password, revoking other sessions |
| PATCH | `/api/profile` | User | Update personal details |
| GET | `/api/trips` | Public | Search departures (`scope=all` for staff) |
| GET | `/api/trips/:id` | Public | Trip detail, seat map, taken seats |
| POST | `/api/trips` | Staff | Schedule a departure |
| PATCH | `/api/trips/:id` | Staff | Amend or cancel a departure |
| DELETE | `/api/trips/:id` | Staff | Delete a departure with no bookings |
| GET | `/api/routes` | Public | List routes |
| POST/PATCH/DELETE | `/api/routes[/:id]` | Staff | Manage routes |
| GET/POST | `/api/buses` | Staff | List and add vehicles |
| PATCH/DELETE | `/api/buses/:id` | Staff | Amend or retire a vehicle |
| GET | `/api/bookings` | User | Own bookings (`scope=all` for staff) |
| POST | `/api/bookings` | User | Reserve seats, opening a 15-minute hold |
| GET | `/api/bookings/:id` | Owner/Staff | Booking detail with refund preview |
| POST | `/api/bookings/:id/cancel` | Owner/Staff | Cancel and calculate the refund |
| POST | `/api/payments/initiate` | User | Trigger the M-Pesa STK push |
| GET | `/api/payments/status` | User | Poll; settles the booking on success |
| GET | `/api/tickets/:id/pdf` | Owner/Staff | Boarding pass as PDF with QR |
| POST | `/api/checkin` | Staff | Verify a ticket at the gate |
| GET | `/api/analytics` | Staff | Dashboard aggregates |
| GET | `/api/export/bookings` | Staff | Sales workbook (.xlsx) |
| GET/POST | `/api/users` | Staff/Admin | Directory; admin may create |
| PATCH | `/api/users/:id` | Admin | Change role or deactivate |
| GET | `/api/notifications` | User | In-app notifications |
| GET | `/api/audit` | Admin | Audit trail |

### Booking sequence

```
POST /api/bookings          → PENDING, seats held 15 min, 409 if a seat was taken
POST /api/payments/initiate → STK push, returns checkoutRequestId
GET  /api/payments/status   → polled; on SUCCESS: booking CONFIRMED, ticket issued
GET  /api/tickets/:id/pdf   → boarding pass
POST /api/checkin           → CHECKED_IN at the gate
```

The settlement transition is guarded on `status: "PENDING"`, so a duplicate
gateway callback updates zero rows instead of double-confirming.

---

## User manual

### Passenger

1. **Search** — enter origin, destination and date. Results show live seat counts.
2. **Choose seats** — the map is the real layout of that bus. Taken seats are
   struck through. Enter a name and phone per seat; the first is pre-filled.
3. **Pay** — choose M-Pesa and confirm on the prompt. A countdown shows the
   remaining hold. Payment failures can be retried within the window.
4. **Travel** — the ticket carries a QR code; download the PDF or show the screen.
5. **Cancel** — the refund is shown before you commit, per the sliding scale.

### Booking staff

- **Departures** — schedule services; a bus already committed elsewhere is
  rejected with the conflicting trip named. Cancelling refunds and notifies
  every passenger.
- **Routes / Fleet** — anything with history is retired rather than deleted, so
  reporting stays intact.
- **Check-in** — scan or type the ticket code. A hardware scanner behaves as a
  keyboard, so no integration is needed. Re-scans report the earlier check-in
  rather than erroring.
- **Bookings** — search across all passengers; export to Excel.

### Administrator

Everything above, plus **Users** (roles, deactivation) and the **Audit trail**
(every state change, with actor, IP and redacted payload).

---

## Deployment

### PostgreSQL

```prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

```bash
DATABASE_URL="postgresql://user:pass@host:5432/safiriconnect"
npx prisma migrate deploy
```

No model changes are required — the schema uses no SQLite-specific types.

### Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Connection string |
| `JWT_SECRET` | **Must be changed.** 32+ random characters |
| `NEXT_PUBLIC_APP_URL` | Public origin |
| `MPESA_LIVE` | `true` switches to the live adapter |
| `MPESA_SIM_FAILURE_RATE` | Simulated failure rate, default `0.1` |

### Going live with M-Pesa

Implement `LiveMpesa` in `src/lib/mpesa.ts` against Safaricom Daraja — the
interface is already defined and the database already stores
`checkoutRequestId` and `receiptNumber` in Daraja's shape. Add the Daraja
credentials, set `MPESA_LIVE=true`, and point the callback URL at
`/api/payments/status`. Nothing else changes.

### Before production

- [ ] Replace `JWT_SECRET`
- [ ] Move to PostgreSQL
- [ ] Move rate limiting to Redis
- [ ] Wire real email/SMS transports in `lib/notify.ts`
- [ ] Serve over HTTPS (the `secure` cookie flag activates automatically)

---

## Testing

`npm test` covers the business rules — refund tier boundaries, the booking
cutoff, seat-map geometry, phone normalisation and reference generation. These
are the pure functions that decide money and seats, which is why they are the
ones tested directly.

Verified manually end to end: registration, login, search, seat selection,
concurrent seat conflict (409), M-Pesa success and failure, ticket PDF, gate
check-in including duplicate and wrong-day scans, cancellation refunds, role
enforcement across all three roles, and the Excel export.

---

## Project structure

```
prisma/
  schema.prisma          data model
  seed.ts                demonstration dataset
src/
  app/
    api/                 REST endpoints
    admin/               back office
    (passenger pages)    search, trips, checkout, bookings, dashboard, profile
    layout.tsx           shell, theming, toasts
  components/            UI, all client-side interaction
  lib/                   auth, db, api conventions, policy, payments, audit
  middleware.ts          security headers and route guarding
dev.cmd                  optional launcher — starts the dev server on port 3200
                         with this folder as the working directory
```

`dev.cmd` exists only so the dev server can be started from another directory
(tooling, IDE run configurations) without Tailwind and PostCSS failing to
resolve their configs. `npm run dev` remains the normal way in.
