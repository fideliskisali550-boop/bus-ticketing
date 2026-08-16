"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Clock,
  Repeat,
  Moon,
  Bus as BusIcon,
  Route as RouteIcon,
} from "lucide-react";
import { Link } from "@/components/tab-link";
import { api, KES } from "@/lib/client";
import { formatTime, formatDateShort } from "@/lib/time";
import { cx, Spinner, EmptyState } from "@/components/ui";

/**
 * Connecting journeys, for when no single bus makes the run.
 *
 * A passenger asking for Chuka to Bomet is not asking whether one company
 * happens to operate that exact pair — they are asking how to get there. This
 * shows the answer as an itinerary: which buses, in what order, how long the
 * wait between them, and what the whole thing costs.
 */

type Leg = {
  tripId: string;
  from: string;
  to: string;
  departureAt: string;
  arrivalAt: string;
  fare: number;
  seatsAvailable: number;
  operator: { name: string; code: string; colour: string; rating: number } | null;
  bus: { registration: string; model: string; vehicleClass: string };
};

type Journey = {
  id: string;
  legs: Leg[];
  origin: string;
  destination: string;
  departureAt: string;
  arrivalAt: string;
  totalMinutes: number;
  ridingMinutes: number;
  waitingMinutes: number;
  transfers: number;
  totalFare: number;
  seatsAvailable: number;
  isDirect: boolean;
};

type Plan = {
  journeys: Journey[];
  directCount: number;
  connectingCount: number;
  reason: string | null;
  pathExists: boolean;
  knownOrigin: boolean;
  knownDestination: boolean;
  tookMs: number;
};

const duration = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

export function JourneyResults({
  origin,
  destination,
  date,
  minSeats,
}: {
  origin: string;
  destination: string;
  date?: string | null;
  minSeats?: string | null;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const q = new URLSearchParams({ origin, destination });
    if (date) q.set("date", date);
    if (minSeats) q.set("minSeats", minSeats);

    api<Plan>(`/api/journeys?${q}`)
      .then((d) => {
        if (!cancelled) setPlan(d);
      })
      .catch(() => {
        if (!cancelled) setPlan(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [origin, destination, date, minSeats]);

  if (loading) {
    return (
      <div className="card mt-6 grid place-items-center py-12">
        <Spinner className="h-5 w-5 text-brand" />
        <p className="mt-3 text-sm text-muted">Looking for connecting journeys…</p>
      </div>
    );
  }

  if (!plan || plan.journeys.length === 0) {
    return (
      <div className="card mt-6">
        <EmptyState
          icon={<RouteIcon className="h-6 w-6" aria-hidden />}
          title={
            plan && !plan.pathExists
              ? `No route connects ${origin} and ${destination}`
              : "No journeys found in the next month"
          }
          description={
            plan && !plan.pathExists
              ? "These towns are not linked by any service on the network, directly or with changes."
              : "The network connects these towns, but nothing is scheduled in the search window."
          }
        />
      </div>
    );
  }

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">
          {plan.directCount > 0
            ? "Journeys with changes"
            : `Get to ${destination} with a change`}
        </h2>
        <p className="text-xs text-muted">
          {plan.journeys.length} option{plan.journeys.length === 1 ? "" : "s"} · found in{" "}
          {plan.tookMs}ms
        </p>
      </div>

      {plan.directCount === 0 && (
        <p className="mt-1 text-sm text-muted">
          No single bus makes this run, so these combine services. Each leg is a
          separate ticket booked in turn.
        </p>
      )}

      <div className="mt-4 space-y-4">
        {plan.journeys.slice(0, 6).map((journey) => (
          <JourneyCard key={journey.id} journey={journey} />
        ))}
      </div>
    </section>
  );
}

function JourneyCard({ journey }: { journey: Journey }) {
  const [expanded, setExpanded] = useState(false);

  // A wait this long means a night at the interchange, which the passenger
  // needs to know before booking rather than after.
  const overnight = journey.waitingMinutes >= 6 * 60;

  return (
    <article className="card overflow-hidden">
      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center">
        <div className="flex flex-1 items-center gap-4">
          <div className="text-center">
            <p className="text-2xl font-extrabold tracking-tight text-ink">
              {formatTime(journey.departureAt)}
            </p>
            <p className="mt-0.5 text-xs font-semibold text-muted">{journey.origin}</p>
            <p className="text-[10px] text-muted/70">{formatDateShort(journey.departureAt)}</p>
          </div>

          <div className="flex flex-1 flex-col items-center gap-1">
            <p className="flex items-center gap-1 text-[11px] font-medium text-muted">
              <Clock className="h-3 w-3" /> {duration(journey.totalMinutes)}
            </p>

            {/* One dot per town, so the shape of the journey is legible at a
                glance without opening the detail. */}
            <div className="flex w-full items-center gap-1">
              <span className="h-2 w-2 shrink-0 rounded-full bg-brand" />
              {journey.legs.slice(0, -1).map((leg) => (
                <span key={leg.tripId} className="flex flex-1 items-center gap-1">
                  <span className="h-px flex-1 bg-line" />
                  <span
                    className="h-2 w-2 shrink-0 rounded-full bg-warn"
                    title={`Change at ${leg.to}`}
                  />
                </span>
              ))}
              <span className="h-px flex-1 bg-line" />
              <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
            </div>

            <p className="text-[11px] text-muted">
              {journey.transfers === 0
                ? "Direct"
                : `${journey.transfers} change${journey.transfers === 1 ? "" : "s"} · via ${journey.legs
                    .slice(0, -1)
                    .map((l) => l.to)
                    .join(", ")}`}
            </p>
          </div>

          <div className="text-center">
            <p className="text-2xl font-extrabold tracking-tight text-ink">
              {formatTime(journey.arrivalAt)}
            </p>
            <p className="mt-0.5 text-xs font-semibold text-muted">
              {journey.destination}
            </p>
            <p className="text-[10px] text-muted/70">{formatDateShort(journey.arrivalAt)}</p>
          </div>
        </div>

        <div className="flex items-end justify-between gap-4 border-t border-line pt-4 lg:w-56 lg:justify-end lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div className="lg:text-right">
            <p className="text-2xl font-extrabold text-brand">{KES(journey.totalFare)}</p>
            <p className="text-xs text-muted">all legs</p>
            <p className="mt-1 text-xs font-semibold text-muted">
              {journey.seatsAvailable} seat{journey.seatsAvailable === 1 ? "" : "s"} left
            </p>
          </div>

          <button
            onClick={() => setExpanded((v) => !v)}
            className="btn-secondary shrink-0"
            aria-expanded={expanded}
          >
            {expanded ? "Hide" : "See legs"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-5 py-2.5 text-xs text-muted">
        <span className="flex items-center gap-1">
          <Repeat className="h-3 w-3" /> {duration(journey.ridingMinutes)} on the road
        </span>
        {journey.waitingMinutes > 0 && (
          <span className={cx("flex items-center gap-1", overnight && "font-semibold text-warn")}>
            {overnight ? <Moon className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
            {duration(journey.waitingMinutes)} waiting
            {overnight && " — includes an overnight stop"}
          </span>
        )}
        <span className="ml-auto flex flex-wrap gap-1">
          {[...new Set(journey.legs.map((l) => l.operator?.name).filter(Boolean))].map(
            (name) => (
              <span key={name} className="badge bg-elevated text-muted">
                {name}
              </span>
            ),
          )}
        </span>
      </div>

      {expanded && (
        <ol className="divide-y divide-line border-t border-line bg-elevated/40">
          {journey.legs.map((leg, i) => {
            const nextLeg = journey.legs[i + 1];
            const waitMin = nextLeg
              ? Math.round(
                  (new Date(nextLeg.departureAt).getTime() -
                    new Date(leg.arrivalAt).getTime()) /
                    60_000,
                )
              : 0;

            return (
              <li key={leg.tripId} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand">
                    {i + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-ink">
                      {leg.from} → {leg.to}
                    </p>
                    <p className="text-xs text-muted">
                      {formatTime(leg.departureAt)} – {formatTime(leg.arrivalAt)} ·{" "}
                      {leg.operator?.name ?? "Operator"} · {leg.bus.model}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="font-semibold text-ink">{KES(leg.fare)}</p>
                    <p className="text-[11px] text-muted">{leg.seatsAvailable} seats</p>
                  </div>

                  <Link href={`/trips/${leg.tripId}`} className="btn-secondary shrink-0 text-xs">
                    <BusIcon className="h-3.5 w-3.5" /> Book leg
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>

                {nextLeg && (
                  <p
                    className={cx(
                      "mt-3 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs",
                      waitMin >= 6 * 60
                        ? "bg-warn/10 text-warn"
                        : "bg-elevated text-muted",
                    )}
                  >
                    {waitMin >= 6 * 60 ? (
                      <Moon className="h-3 w-3" />
                    ) : (
                      <Clock className="h-3 w-3" />
                    )}
                    Wait {duration(waitMin)} at {leg.to}
                    {waitMin >= 6 * 60 && " — you will need somewhere to stay"}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </article>
  );
}
