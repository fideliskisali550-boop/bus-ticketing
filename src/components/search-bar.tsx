"use client";

import { useTabRouter } from "@/components/tab-link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeftRight, Search, MapPin, CalendarDays, Users } from "lucide-react";
import { api } from "@/lib/client";
import { AvailabilityCalendar } from "@/components/availability-calendar";

/**
 * The primary search control, shared by the landing page and the results page.
 * Origin and destination are datalist-backed rather than free text so that a
 * typo does not silently return zero results.
 */
export function SearchBar({ compact = false }: { compact?: boolean }) {
  const router = useTabRouter();
  const params = useSearchParams();

  const [origin, setOrigin] = useState(params.get("origin") ?? "");
  const [destination, setDestination] = useState(params.get("destination") ?? "");
  /**
   * Deliberately empty unless the URL asks for a date.
   *
   * This previously defaulted to today, which silently constrained every search
   * to a single day. Once the day's departures on a corridor had left, the
   * passenger saw "no results" with no visible filter to explain it — and
   * clearing the filters appeared to fix a search that was never broken.
   * Empty means "any upcoming departure", which is what someone searching for
   * a bus actually wants.
   */
  const [date, setDate] = useState(params.get("date") ?? "");
  const [seats, setSeats] = useState(params.get("minSeats") ?? "1");
  const [cities, setCities] = useState<string[]>([]);
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Keep the controls in step when the URL changes underneath us — e.g. when a
  // filter chip on the results page is removed.
  useEffect(() => {
    setOrigin(params.get("origin") ?? "");
    setDestination(params.get("destination") ?? "");
    setDate(params.get("date") ?? "");
    setSeats(params.get("minSeats") ?? "1");
  }, [params]);

  useEffect(() => {
    // The full place catalogue, not just route endpoints, so a passenger can
    // type any town or terminal and be understood.
    api<{ locations: { name: string }[] }>("/api/locations?bookableOnly=true")
      .then((d) => setCities(d.locations.map((l) => l.name)))
      .catch(() => setCities([]));
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = new URLSearchParams();
    if (origin) q.set("origin", origin);
    if (destination) q.set("destination", destination);
    if (date) q.set("date", date);
    if (seats !== "1") q.set("minSeats", seats);
    router.push(`/search?${q}`);
  }

  function swap() {
    setOrigin(destination);
    setDestination(origin);
  }

  return (
    <form
      onSubmit={submit}
      className={compact ? "card p-3" : "card p-3 shadow-lift sm:p-4"}
    >
      <datalist id="cities">
        {cities.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_auto_auto]">
        <LabelledInput
          icon={MapPin}
          label="From"
          value={origin}
          onChange={setOrigin}
          placeholder="Nairobi"
          list="cities"
        />

        <button
          type="button"
          onClick={swap}
          className="btn-ghost hidden self-end p-2.5 md:block"
          aria-label="Swap origin and destination"
        >
          <ArrowLeftRight className="h-4 w-4" />
        </button>

        <LabelledInput
          icon={MapPin}
          label="To"
          value={destination}
          onChange={setDestination}
          placeholder="Mombasa"
          list="cities"
        />

        {/* The date field opens an availability calendar rather than a bare
            picker, so a passenger can see which days actually have buses
            instead of discovering it one failed search at a time. */}
        <div className="relative">
          <label className="label flex items-center gap-1.5">
            <CalendarDays className="h-3 w-3" /> Travel date
          </label>
          <button
            type="button"
            onClick={() => setCalendarOpen((v) => !v)}
            className="input flex items-center justify-between text-left"
            aria-expanded={calendarOpen}
          >
            <span className={date ? "text-ink" : "text-muted/70"}>
              {date
                ? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC",
                  })
                : "Any date"}
            </span>
            <CalendarDays className="h-4 w-4 shrink-0 text-muted" />
          </button>

          {calendarOpen && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setCalendarOpen(false)}
                aria-hidden
              />
              <div className="absolute right-0 z-40 mt-2 w-[20rem] max-w-[85vw]">
                <AvailabilityCalendar
                  origin={origin || undefined}
                  destination={destination || undefined}
                  selected={date || undefined}
                  onSelect={(d) => {
                    setDate(d);
                    setCalendarOpen(false);
                  }}
                />
                {date && (
                  <button
                    type="button"
                    onClick={() => {
                      setDate("");
                      setCalendarOpen(false);
                    }}
                    className="btn-ghost mt-1 w-full text-xs"
                  >
                    Clear date
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="min-w-24">
          <label className="label flex items-center gap-1.5">
            <Users className="h-3 w-3" /> Seats
          </label>
          <select
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            className="input"
            aria-label="Number of seats"
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="btn-primary self-end px-6 py-2.5">
          <Search className="h-4 w-4" />
          <span className="md:hidden lg:inline">Search</span>
        </button>
      </div>
    </form>
  );
}

function LabelledInput({
  icon: Icon,
  label,
  value,
  onChange,
  ...rest
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
  onChange: (v: string) => void;
  // `value` and `onChange` are re-typed above, so they must not also arrive
  // through the spread with React's native (event-based) signatures.
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <div>
      <label className="label flex items-center gap-1.5">
        <Icon className="h-3 w-3" /> {label}
      </label>
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input"
        aria-label={label}
      />
    </div>
  );
}

/** Local (not UTC) date in yyyy-MM-dd, so "today" matches the user's clock. */
function today() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
