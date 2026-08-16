"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { api, KES } from "@/lib/client";
import { cx, Spinner } from "@/components/ui";
import { todayInKenya } from "@/lib/time";

/**
 * A month view showing which days can actually be booked.
 *
 * A plain date input makes the passenger guess: choose a day, discover nothing
 * runs, choose another. Colouring the days removes the guessing — availability
 * is visible before a date is picked rather than after.
 */

type Day = {
  date: string;
  status: "available" | "limited" | "soldout" | "none";
  /** Bookable itineraries starting this day — direct or with changes. */
  journeys: number;
  direct: number;
  seatsLeft: number;
  cheapestFare: number | null;
  requiresTransfer: boolean;
};

type Availability = {
  calendar: Day[];
  summary: {
    bookableDays: number;
    firstAvailable: string | null;
    cheapest: number | null;
    pathExists: boolean;
  };
};

const LEGEND: { status: Day["status"]; label: string; dot: string }[] = [
  { status: "available", label: "Seats available", dot: "bg-ok" },
  { status: "limited", label: "Few seats left", dot: "bg-warn" },
  { status: "soldout", label: "Fully booked", dot: "bg-danger" },
  { status: "none", label: "No way through", dot: "bg-line" },
];

const CELL: Record<Day["status"], string> = {
  available: "bg-ok/12 text-ok hover:bg-ok/20 border-ok/30",
  limited: "bg-warn/15 text-warn hover:bg-warn/25 border-warn/30",
  soldout: "bg-danger/10 text-danger/70 border-danger/20 cursor-not-allowed",
  none: "text-muted/40 border-transparent cursor-not-allowed",
};

/** Adds days to a yyyy-MM-dd string without drifting through a timezone. */
function addDays(ymd: string, days: number) {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

const monthStart = (ymd: string) => `${ymd.slice(0, 7)}-01`;

function monthLabel(ymd: string) {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function AvailabilityCalendar({
  origin,
  destination,
  selected,
  onSelect,
}: {
  origin?: string;
  destination?: string;
  selected?: string;
  onSelect: (date: string) => void;
}) {
  const today = todayInKenya();
  const [month, setMonth] = useState(() => monthStart(selected || today));
  const [data, setData] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(true);

  // Availability is a property of a corridor, not of a date. With only one
  // endpoint chosen there is nothing to colour, so the calendar stays a plain
  // date picker rather than inventing a status.
  const corridor = Boolean(origin && destination);

  useEffect(() => {
    let cancelled = false;

    if (!corridor) {
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    // Cover the whole month regardless of length, plus a couple of days so the
    // trailing week is never half-unknown.
    const q = new URLSearchParams({
      from: month,
      days: "35",
      origin: origin!,
      destination: destination!,
    });

    api<Availability>(`/api/availability?${q}`)
      .then((d) => {
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
  }, [month, origin, destination, corridor]);

  const byDate = useMemo(
    () => new Map((data?.calendar ?? []).map((d) => [d.date, d])),
    [data],
  );

  // Grid starts on Monday, which is how Kenyan calendars are printed.
  const leadingBlanks = useMemo(() => {
    const weekday = new Date(`${month}T12:00:00Z`).getUTCDay();
    return (weekday + 6) % 7;
  }, [month]);

  const daysInMonth = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  }, [month]);

  const canGoBack = month > monthStart(today);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setMonth(monthStart(addDays(month, -1)))}
          disabled={!canGoBack}
          className="btn-ghost p-2 disabled:opacity-30"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <p className="flex items-center gap-2 text-sm font-bold text-ink">
          <CalendarDays className="h-4 w-4 text-brand" />
          {monthLabel(month)}
        </p>

        <button
          onClick={() => setMonth(monthStart(addDays(`${month.slice(0, 7)}-28`, 7)))}
          className="btn-ghost p-2"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d} className="py-1 text-[10px] font-bold uppercase tracking-wide text-muted">
            {d}
          </span>
        ))}
      </div>

      {loading ? (
        <div className="grid place-items-center py-12">
          <Spinner className="h-5 w-5 text-brand" />
        </div>
      ) : (
        <div className="mt-1 grid grid-cols-7 gap-1">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <span key={`blank-${i}`} />
          ))}

          {Array.from({ length: daysInMonth }, (_, i) => {
            const date = `${month.slice(0, 7)}-${String(i + 1).padStart(2, "0")}`;
            const day = byDate.get(date);
            const status = day?.status ?? "none";
            const past = date < today;
            const bookable = corridor
              ? !past && (status === "available" || status === "limited")
              : !past;

            return (
              <button
                key={date}
                onClick={() => bookable && onSelect(date)}
                disabled={!bookable}
                title={
                  past
                    ? "In the past"
                    : !corridor
                      ? "Choose both towns to see availability"
                      : status === "none"
                        ? "No way to travel this day, even with changes"
                        : status === "soldout"
                          ? "Buses run, but every seat is sold"
                          : `${day!.journeys} journey${day!.journeys === 1 ? "" : "s"}${
                              day!.requiresTransfer ? " (with a change)" : ""
                            }, ${day!.seatsLeft} seats left${
                              day!.cheapestFare ? `, from ${KES(day!.cheapestFare)}` : ""
                            }`
                }
                className={cx(
                  "relative rounded-lg border py-2 text-xs font-semibold transition",
                  past
                    ? "text-muted/25 cursor-not-allowed border-transparent"
                    : corridor
                      ? CELL[status]
                      : "border-line text-ink hover:bg-elevated",
                  selected === date && "ring-2 ring-brand ring-offset-1 ring-offset-surface",
                )}
              >
                {i + 1}
                {day?.cheapestFare && bookable && (
                  <span className="mt-0.5 block text-[9px] font-medium opacity-80">
                    {(day.cheapestFare / 1000).toFixed(1)}k
                  </span>
                )}
                {/* A day reachable only by changing buses is still a day the
                    passenger can travel, but they deserve to know before they
                    pick it. */}
                {day?.requiresTransfer && bookable && (
                  <span
                    className="absolute right-1 top-1 text-[8px] font-bold opacity-70"
                    aria-hidden
                  >
                    ⇄
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {corridor ? (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line pt-3">
          {LEGEND.map((l) => (
            <span key={l.status} className="flex items-center gap-1.5 text-[11px] text-muted">
              <span className={cx("h-2.5 w-2.5 rounded-full", l.dot)} />
              {l.label}
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-[11px] text-muted">
            <span aria-hidden>⇄</span> Needs a change
          </span>
        </div>
      ) : (
        <p className="mt-4 border-t border-line pt-3 text-[11px] text-muted">
          Choose both towns to see which days can be travelled.
        </p>
      )}

      {data?.summary.firstAvailable && (
        <p className="mt-3 text-xs text-muted">
          Next available:{" "}
          <button
            onClick={() => onSelect(data.summary.firstAvailable!)}
            className="font-bold text-brand hover:underline"
          >
            {new Date(`${data.summary.firstAvailable}T12:00:00Z`).toLocaleDateString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
              timeZone: "UTC",
            })}
          </button>
          {data.summary.cheapest && <> · from {KES(data.summary.cheapest)}</>}
        </p>
      )}
    </div>
  );
}
