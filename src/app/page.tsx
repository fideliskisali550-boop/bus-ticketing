import { Link } from "@/components/tab-link";
import { stopNames } from "@/lib/stops";
import {
  Search,
  ShieldCheck,
  Smartphone,
  Armchair,
  Clock,
  ArrowRight,
  MapPin,
  Ticket,
  BarChart3,
} from "lucide-react";
import { db } from "@/lib/db";
import { KES } from "@/lib/policy";
import { SearchBar } from "@/components/search-bar";
import { HeroScene } from "@/components/hero-scene";

/** Landing page. Rendered on the server so the popular-routes strip is real
 *  data rather than hard-coded marketing copy. */
export default async function HomePage() {
  const [routes, tripCount, passengerCount, routeCount] = await Promise.all([
    db.route.findMany({
      where: { isActive: true },
      take: 6,
      orderBy: { distanceKm: "desc" },
      include: {
        trips: {
          where: { departureAt: { gte: new Date() }, status: "SCHEDULED" },
          orderBy: { fare: "asc" },
          take: 1,
          select: { fare: true },
        },
      },
    }),
    db.trip.count({ where: { departureAt: { gte: new Date() }, status: "SCHEDULED" } }),
    db.user.count({ where: { role: "PASSENGER" } }),
    db.route.count({ where: { isActive: true } }),
  ]);

  return (
    <>
      {/* Hero. The artwork is a full-bleed backdrop and the booking card sits
          on top of it, which is the arrangement that makes a travel site read
          as a place to buy a ticket rather than a page about buses. */}
      <section className="relative overflow-hidden border-b border-line">
        <HeroScene className="absolute inset-x-0 bottom-0 h-full w-full" />
        {/* Keeps the headline legible wherever the artwork happens to be busy. */}
        <div
          className="absolute inset-0 bg-gradient-to-b from-bg/90 via-bg/25 to-bg/70"
          aria-hidden
        />

        <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-16 sm:px-6 sm:pb-20 sm:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <span className="badge border border-brand/20 bg-surface/80 text-brand backdrop-blur">
              <MapPin className="h-3 w-3" /> {routeCount.toLocaleString()} corridors across
              Kenya and East Africa
            </span>

            <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] tracking-tight text-ink sm:text-6xl">
              Book your seat.
              <br />
              <span className="text-brand">Skip the queue.</span>
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
              Check real-time schedules, pick the exact seat you want and pay with
              M-Pesa — from your phone, in under two minutes.
            </p>
          </div>

          <div className="mx-auto mt-10 max-w-4xl rounded-card border border-line bg-surface/95 p-2 shadow-lift backdrop-blur-sm sm:p-3">
            <SearchBar />
          </div>

          <dl className="mx-auto mt-10 grid max-w-2xl grid-cols-3 gap-4 text-center">
            {[
              { label: "Departures scheduled", value: tripCount.toLocaleString() },
              { label: "Passengers registered", value: passengerCount.toLocaleString() },
              { label: "Booking confirmed in", value: "< 2 min" },
            ].map((s) => (
              <div key={s.label}>
                <dt className="sr-only">{s.label}</dt>
                <dd className="text-2xl font-extrabold text-ink sm:text-3xl">{s.value}</dd>
                <p className="mt-1 text-xs text-muted sm:text-sm">{s.label}</p>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Why book here. Four claims, each one true of this build rather than
          generic marketing — the wording is checked against what the system
          actually does, including the fact that payment is simulated. */}
      <section className="border-b border-line bg-elevated/40">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {[
            {
              icon: Ticket,
              title: "No queues, no cash desk",
              body: "Buy from your phone at any hour. Your seat is held for 15 minutes while you pay.",
            },
            {
              icon: Armchair,
              title: "Choose your exact seat",
              body: "A live seat map for every departure, so nobody sells the same seat twice.",
            },
            {
              icon: Search,
              title: "One ticket, several buses",
              body: "No direct service? We build the journey out of connecting departures.",
            },
            {
              icon: ShieldCheck,
              title: "Secure M-Pesa payment",
              body: "Pay by STK push. Cancel within policy and the refund is tracked to settlement.",
            },
          ].map((f) => (
            <div key={f.title} className="flex gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                <f.icon className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-bold text-ink">{f.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Popular routes */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
              Popular routes
            </h2>
            <p className="mt-1 text-sm text-muted">Fares shown are the lowest currently available.</p>
          </div>
          <Link href="/search" className="btn-ghost shrink-0 text-brand">
            All routes <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {routes.map((route) => {
            const stops = stopNames(route.stops);
            const from = route.trips[0]?.fare;

            return (
              <Link
                key={route.id}
                href={`/search?origin=${encodeURIComponent(route.origin)}&destination=${encodeURIComponent(route.destination)}`}
                className="card group p-5 transition hover:-translate-y-0.5 hover:shadow-lift"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-bold text-ink">
                      {route.origin} → {route.destination}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                      <Clock className="h-3 w-3" />
                      {Math.floor(route.durationMin / 60)}h {route.durationMin % 60}m ·{" "}
                      {route.distanceKm} km
                    </p>
                  </div>
                  {from !== undefined && (
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] uppercase tracking-wide text-muted">From</p>
                      <p className="text-lg font-extrabold text-brand">{KES(from)}</p>
                    </div>
                  )}
                </div>

                {stops.length > 0 && (
                  <p className="mt-4 truncate border-t border-line pt-3 text-xs text-muted">
                    via {stops.join(" · ")}
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <h2 className="text-center text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
            Three steps to your seat
          </h2>

          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {[
              {
                icon: Search,
                title: "Search your route",
                body: "Pick your origin, destination and travel date. Every departure shows live seat availability.",
              },
              {
                icon: Armchair,
                title: "Choose your seat",
                body: "See the actual layout of the bus and select the seat you want. Held for 15 minutes while you pay.",
              },
              {
                icon: Smartphone,
                title: "Pay with M-Pesa",
                body: "Confirm on the STK prompt. Your ticket with its boarding QR code is issued immediately.",
              },
            ].map((step, i) => (
              <li key={step.title} className="relative">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                    <step.icon className="h-5 w-5" />
                  </span>
                  <span className="text-4xl font-extrabold text-line">{i + 1}</span>
                </div>
                <h3 className="mt-4 font-bold text-ink">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Value props */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            {
              icon: ShieldCheck,
              title: "No more double bookings",
              body: "Seats are locked at the database the instant you select them, so two passengers can never be sold the same seat.",
            },
            {
              icon: Ticket,
              title: "Your ticket, always with you",
              body: "Download the PDF or show the QR code on your phone. Lost paper tickets stop being a problem.",
            },
            {
              icon: BarChart3,
              title: "Built for operators too",
              body: "Live occupancy, revenue reporting and passenger manifests — the paperwork keeps itself.",
            },
          ].map((f) => (
            <div key={f.title} className="card p-6">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-bold text-ink">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-line bg-brand">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-6 px-4 py-14 text-center sm:px-6">
          <h2 className="max-w-xl text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            Your next journey is a few taps away
          </h2>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/search"
              className="btn bg-white px-6 py-2.5 text-brand hover:bg-white/90"
            >
              Find a bus <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/register"
              className="btn border border-white/30 px-6 py-2.5 text-white hover:bg-white/10"
            >
              Create an account
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <p className="text-center text-xs text-muted">
            SafiriConnect — Online Bus Ticketing System. Built for long-distance
            operators in Kenya.
          </p>
        </div>
      </footer>
    </>
  );
}
