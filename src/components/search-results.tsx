"use client";

import { Link, useTabRouter } from "@/components/tab-link";
import { formatDateLong, formatDateShort, formatTime } from "@/lib/time";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Bus as BusIcon,
  Wifi,
  Zap,
  Snowflake,
  Bath,
  Clock,
  ArrowRight,
  SlidersHorizontal,
  SearchX,
  X,
  CalendarDays,
  Globe2,
  Building2,
  Star,
  ArrowLeft,
} from "lucide-react";
import { api, KES } from "@/lib/client";
import { Pagination, cx } from "@/components/ui";
import { AvailabilityCalendar } from "@/components/availability-calendar";
import { JourneyResults } from "@/components/journey-results";

type Trip = {
  id: string;
  departureAt: string;
  arrivalAt: string;
  fare: number;
  seatsAvailable: number;
  capacity: number;
  route: {
    origin: string;
    destination: string;
    distanceKm: number;
    durationMin: number;
    stops: string[];
    isInternational: boolean;
  };
  bus: {
    registration: string;
    model: string;
    vehicleClass: string;
    hasWifi: boolean;
    hasChargingPorts: boolean;
    hasToilet: boolean;
    hasAirCon: boolean;
  };
  operator: { name: string; code: string; colour: string; rating: number } | null;
};

type Operator = { id: string; name: string; code: string; colour: string; rating: number };

type Response = {
  trips: Trip[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
  suggestions: Trip[];
  earlier: Trip[];
  similarRoutes: { origin: string; destination: string; departures: number }[];
  suggestionReason: string | null;
};

const CLASS_STYLE: Record<string, string> = {
  ECONOMY: "bg-muted/15 text-muted",
  VIP: "bg-accent/15 text-accent",
  EXECUTIVE: "bg-brand/12 text-brand",
};

const CLASS_LABEL: Record<string, string> = {
  ECONOMY: "Economy",
  VIP: "VIP",
  EXECUTIVE: "Executive",
};

export function SearchResults() {
  const params = useSearchParams();
  const router = useTabRouter();

  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState("departure");
  const [operators, setOperators] = useState<Operator[]>([]);

  useEffect(() => {
    let cancelled = false;
    api<{ operators: Operator[] }>("/api/operators")
      .then((d) => {
        if (!cancelled) setOperators(d.operators);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const q = new URLSearchParams(params.toString());
    q.set("sort", sort);

    api<Response>(`/api/trips?${q}`)
      .then((d) => {
        // A slow response for a query the user has already moved on from must
        // not overwrite the results of the query they are now looking at.
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [params, sort]);

  /** Rewrites the query string, dropping the key entirely when cleared. */
  const setParam = useCallback(
    (key: string, value?: string) => {
      const q = new URLSearchParams(params.toString());
      if (value) q.set(key, value);
      else q.delete(key);
      // Any filter change invalidates the current page.
      q.delete("page");
      router.push(`/search?${q}`);
    },
    [params, router],
  );

  const filters = [
    params.get("origin") && { key: "origin", label: `From ${params.get("origin")}` },
    params.get("destination") && { key: "destination", label: `To ${params.get("destination")}` },
    params.get("date") && {
      key: "date",
      label:formatDateShort(new Date(params.get("date")!)),
    },
    params.get("minSeats") &&
      params.get("minSeats") !== "1" && {
        key: "minSeats",
        label: `${params.get("minSeats")} seats`,
      },
    params.get("operator") && { key: "operator", label: params.get("operator")! },
  ].filter(Boolean) as { key: string; label: string }[];

  if (loading) {
    return (
      <div className="mt-6 space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-36 rounded-card" />
        ))}
      </div>
    );
  }

  const hasResults = Boolean(data && data.trips.length > 0);

  return (
    <>
      {/* Active filters, always visible and individually removable, so a search
          is never constrained by something the passenger cannot see. */}
      {filters.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Filters
          </span>
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setParam(f.key)}
              className="badge bg-brand-soft text-brand transition hover:bg-brand hover:text-white"
              aria-label={`Remove filter: ${f.label}`}
            >
              {f.label}
              <X className="h-3 w-3" />
            </button>
          ))}
          <Link href="/search" className="text-xs font-semibold text-muted hover:text-ink hover:underline">
            Clear all
          </Link>
        </div>
      )}

      {hasResults ? (
        <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              <span className="font-bold text-ink">{data!.total}</span> departure
              {data!.total === 1 ? "" : "s"} found
            </p>

            <label className="flex items-center gap-2 text-sm">
              <Building2 className="h-4 w-4 text-muted" />
              <span className="sr-only">Bus company</span>
              <select
                value={params.get("operator") ?? "ALL"}
                onChange={(e) =>
                  setParam("operator", e.target.value === "ALL" ? undefined : e.target.value)
                }
                className="input w-auto py-1.5"
              >
                <option value="ALL">All companies</option>
                {operators.map((o) => (
                  <option key={o.id} value={o.name}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm">
              <SlidersHorizontal className="h-4 w-4 text-muted" />
              <span className="sr-only">Sort by</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="input w-auto py-1.5"
              >
                <option value="departure">Earliest departure</option>
                <option value="fare-asc">Cheapest first</option>
                <option value="fare-desc">Most expensive first</option>
              </select>
            </label>
          </div>

          <div className="mt-4 space-y-4">
            {data!.trips.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>

          <div className="card mt-6">
            <Pagination
              page={data!.page}
              pages={data!.pages}
              total={data!.total}
              perPage={data!.perPage}
              onChange={(p) => setParam("page", String(p))}
            />
          </div>
        </>
      ) : (
        <NoResults
          date={params.get("date")}
          origin={params.get("origin")}
          destination={params.get("destination")}
          suggestions={data?.suggestions ?? []}
          earlier={data?.earlier ?? []}
          similarRoutes={data?.similarRoutes ?? []}
          onClearDate={() => setParam("date")}
          onPickDate={(d) => setParam("date", d)}
        />
      )}
    </>
  );
}

/**
 * An empty result is a moment to help, not to stop.
 *
 * A passenger who is told only "no departures" has to guess which constraint to
 * relax and try dates one at a time. So this answers the questions they were
 * about to ask instead: which days *can* be booked (the calendar), what runs
 * next, what ran just before, and — if the corridor has no service at all —
 * where else they could travel from here.
 */
function NoResults({
  date,
  origin,
  destination,
  suggestions,
  earlier,
  similarRoutes,
  onClearDate,
  onPickDate,
}: {
  date: string | null;
  origin: string | null;
  destination: string | null;
  suggestions: Trip[];
  earlier: Trip[];
  similarRoutes: { origin: string; destination: string; departures: number }[];
  onClearDate: () => void;
  onPickDate: (date: string) => void;
}) {
  const prettyDate = date
    ? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;

  const hasAlternatives = suggestions.length > 0 || earlier.length > 0;

  return (
    <>
      <div className="card mt-5 p-6">
        <div className="flex flex-col gap-2 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-warn/10 text-warn">
            <SearchX className="h-6 w-6" aria-hidden />
          </span>
          {/* Careful with this wording. The only thing established at this
              point is that no single bus runs the whole way — the journey
              planner below routinely finds itineraries with a change, and a
              heading that says "no results" while eight of them sit underneath
              it makes the page argue with itself. */}
          <h2 className="mt-2 text-lg font-bold text-ink">
            {prettyDate
              ? `No direct bus on ${prettyDate}`
              : "No direct bus on this route"}
          </h2>
          <p className="text-sm text-muted">
            {hasAlternatives
              ? "Here is when this route next runs — pick a highlighted day below, or choose one of the departures."
              : "Days you can travel are highlighted below, including journeys that need a change."}
          </p>
        </div>

        {/* The calendar turns "which day works?" from trial and error into
            something visible at a glance. */}
        {origin && destination && (
          <div className="mx-auto mt-6 max-w-md">
            <AvailabilityCalendar
              origin={origin}
              destination={destination}
              selected={date ?? undefined}
              onSelect={onPickDate}
            />
          </div>
        )}

        {date && (
          <div className="mt-5 text-center">
            <button onClick={onClearDate} className="btn-secondary">
              <CalendarDays className="h-4 w-4" /> Show every upcoming date
            </button>
          </div>
        )}
      </div>

      {suggestions.length > 0 && (
        <section className="mt-6">
          <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
            <ArrowRight className="h-4 w-4 text-ok" />
            Next available departures
          </h2>
          <div className="mt-3 space-y-4">
            {suggestions.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
        </section>
      )}

      {earlier.length > 0 && (
        <section className="mt-8">
          <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
            <ArrowLeft className="h-4 w-4 text-accent" />
            Or travel earlier
          </h2>
          <div className="mt-3 space-y-4">
            {earlier.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
        </section>
      )}

      {/* No direct bus does not mean no way to get there. The planner assembles
          a journey out of connecting services, which is the answer the
          passenger was actually looking for. */}
      {origin && destination && (
        <JourneyResults origin={origin} destination={destination} date={date} />
      )}

      {similarRoutes.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-bold text-ink">Other routes from {origin}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {similarRoutes.map((r) => (
              <Link
                key={`${r.origin}-${r.destination}`}
                href={`/search?origin=${encodeURIComponent(r.origin)}&destination=${encodeURIComponent(r.destination)}`}
                className="card p-4 transition hover:-translate-y-0.5 hover:shadow-lift"
              >
                <p className="font-bold text-ink">
                  {r.origin} → {r.destination}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {r.departures} upcoming departure{r.departures === 1 ? "" : "s"}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function TripCard({ trip }: { trip: Trip }) {
  const depart = new Date(trip.departureAt);
  const arrive = new Date(trip.arrivalAt);

  const time = (d: Date) =>
formatTime(d);

  const hours = Math.floor(trip.route.durationMin / 60);
  const mins = trip.route.durationMin % 60;

  // Scarcity messaging is driven by real remaining capacity, not a fixed
  // threshold — "3 left" on a 53-seater means something different than on a 24.
  const pctLeft = (trip.seatsAvailable / trip.capacity) * 100;
  const scarce = trip.seatsAvailable <= 5;
  const filling = !scarce && pctLeft < 30;

  const amenities = [
    trip.bus.hasWifi && { icon: Wifi, label: "Wi-Fi" },
    trip.bus.hasChargingPorts && { icon: Zap, label: "Charging" },
    trip.bus.hasAirCon && { icon: Snowflake, label: "Air conditioned" },
    trip.bus.hasToilet && { icon: Bath, label: "Toilet" },
  ].filter(Boolean) as { icon: typeof Wifi; label: string }[];

  // Arrival on a later calendar day is easy to miss on an overnight service.
  const overnight = arrive.getDate() !== depart.getDate();

  return (
    <article className="card p-5 transition hover:shadow-lift">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
        <div className="flex flex-1 items-center gap-4">
          <div className="text-center">
            <p className="text-2xl font-extrabold tracking-tight text-ink">{time(depart)}</p>
            <p className="mt-0.5 text-xs font-semibold text-muted">{trip.route.origin}</p>
          </div>

          <div className="flex flex-1 flex-col items-center gap-1">
            <p className="flex items-center gap-1 text-[11px] font-medium text-muted">
              <Clock className="h-3 w-3" />
              {hours}h {mins > 0 && `${mins}m`}
            </p>
            <div className="flex w-full items-center gap-1">
              <span className="h-2 w-2 shrink-0 rounded-full bg-brand" />
              <span className="h-px flex-1 bg-line" />
              <BusIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
              <span className="h-px flex-1 bg-line" />
              <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
            </div>
            <p className="text-[11px] text-muted">{trip.route.distanceKm} km</p>
          </div>

          <div className="text-center">
            <p className="text-2xl font-extrabold tracking-tight text-ink">
              {time(arrive)}
              {overnight && (
                <span className="align-super text-xs font-bold text-accent">+1</span>
              )}
            </p>
            <p className="mt-0.5 text-xs font-semibold text-muted">
              {trip.route.destination}
            </p>
          </div>
        </div>

        <div className="flex items-end justify-between gap-4 border-t border-line pt-4 lg:w-64 lg:justify-end lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div className="lg:text-right">
            <p className="text-2xl font-extrabold text-brand">{KES(trip.fare)}</p>
            <p className="text-xs text-muted">per seat</p>
            <p
              className={cx(
                "mt-1 text-xs font-semibold",
                scarce ? "text-danger" : filling ? "text-warn" : "text-muted",
              )}
            >
              {trip.seatsAvailable} seat{trip.seatsAvailable === 1 ? "" : "s"} left
            </p>
          </div>

          <Link href={`/trips/${trip.id}`} className="btn-primary shrink-0">
            Select seats <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-xs text-muted">
        {trip.operator && (
          <span
            className="badge font-bold text-white"
            style={{ backgroundColor: trip.operator.colour }}
            title={`${trip.operator.name} — rated ${trip.operator.rating.toFixed(1)} out of 5`}
          >
            {trip.operator.name}
          </span>
        )}

        {trip.operator && (
          <span className="flex items-center gap-1">
            <Star className="h-3 w-3 fill-current text-accent" />
            {trip.operator.rating.toFixed(1)}
          </span>
        )}

        <span className={cx("badge", CLASS_STYLE[trip.bus.vehicleClass] ?? CLASS_STYLE.ECONOMY)}>
          {CLASS_LABEL[trip.bus.vehicleClass] ?? trip.bus.vehicleClass}
        </span>

        {trip.route.isInternational && (
          <span className="badge bg-accent/15 text-accent">
            <Globe2 className="h-3 w-3" /> Cross-border
          </span>
        )}

        <span className="font-semibold text-ink">
          {trip.bus.model} · {trip.bus.registration}
        </span>

        {amenities.map((a) => (
          <span key={a.label} className="flex items-center gap-1">
            <a.icon className="h-3 w-3" /> {a.label}
          </span>
        ))}

        {trip.route.stops.length > 0 && (
          <span className="truncate">via {trip.route.stops.join(" · ")}</span>
        )}

        <span className="ml-auto whitespace-nowrap">
          {formatDateShort(depart)}
        </span>
      </div>
    </article>
  );
}
