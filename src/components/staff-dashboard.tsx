"use client";

import { Link } from "@/components/tab-link";
import { useCallback, useEffect, useState } from "react";
import {
  Ticket,
  Wallet,
  Users,
  ScanLine,
  CalendarClock,
  ArrowRight,
  Search,
  BadgeCheck,
  UserCheck,
  Ban,
  Clock,
  Armchair,
} from "lucide-react";
import { api, KES } from "@/lib/client";
import { formatTime, formatDateTime, formatDayLabel } from "@/lib/time";
import { useLive, LiveDot } from "@/components/live";
import { StatusBadge, cx } from "@/components/ui";

/**
 * The booking clerk's home.
 *
 * A clerk is not an analyst: they want their shift at a glance — sold, taken,
 * still-to-board — and one tap to the two things they do all day, sell a ticket
 * and scan one. The company's revenue trend is deliberately absent; a clerk has
 * no business seeing it, and asking for it was what left this screen loading
 * forever. Everything here is scoped to their own company by the server.
 */

type StaffSummary = {
  today: {
    bookings: number;
    seats: number;
    revenue: number;
    verified: number;
    boarded: number;
    waiting: number;
    invalidAttempts: number;
  };
  upcomingDepartures: {
    id: string;
    departureAt: string;
    status: string;
    route: string;
    seatsBooked: number;
    capacity: number;
    bus: string;
  }[];
  recentBookings: {
    id: string;
    reference: string;
    passenger: string;
    route: string;
    seats: number;
    amount: number;
    status: string;
    channel: string;
    createdAt: string;
  }[];
};

export function StaffDashboard() {
  const [data, setData] = useState<StaffSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback((showSpinner = false) => {
    if (showSpinner) setLoading(true);
    api<StaffSummary>("/api/staff/summary")
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(true), [load]);

  // A sale at the next till, or a scan at the gate, changes these figures.
  useLive(
    ["booking.confirmed", "booking.cancelled", "booking.expired", "ticket.scanned", "trip.cancelled"],
    () => load(false),
    { pollMs: 60_000 },
  );

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-28 rounded-card" />
          ))}
        </div>
        <div className="skeleton h-72 rounded-card" />
      </div>
    );
  }

  const t = data.today;

  const kpis = [
    { label: "Tickets sold today", value: t.bookings.toLocaleString(), icon: Ticket, hint: `${t.seats} seat${t.seats === 1 ? "" : "s"}` },
    { label: "Taken today", value: KES(t.revenue), icon: Wallet, hint: "confirmed payments" },
    { label: "Verified today", value: t.verified.toLocaleString(), icon: BadgeCheck, hint: "tickets confirmed valid" },
    { label: "Boarded today", value: t.boarded.toLocaleString(), icon: UserCheck, hint: "passengers on board" },
    { label: "Waiting for verification", value: t.waiting.toLocaleString(), icon: Clock, hint: "on today's departures" },
    { label: "Invalid attempts", value: t.invalidAttempts.toLocaleString(), icon: Ban, hint: "rejected at the desk" },
  ];

  return (
    <div className="space-y-6">
      {/* Header + quick actions */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Booking counter</h1>
          <p className="mt-1 flex items-center gap-3 text-sm text-muted">
            Your shift at a glance.
            <LiveDot />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/search" className="btn-primary">
            <Search className="h-4 w-4" /> Sell a ticket
          </Link>
          <Link href="/admin/checkin" className="btn-secondary">
            <ScanLine className="h-4 w-4" /> Verify tickets
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="card p-5">
            <div className="flex items-start justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{k.label}</p>
              <k.icon className="h-4 w-4 text-brand" />
            </div>
            <p className="mt-2 text-2xl font-extrabold tracking-tight text-ink">{k.value}</p>
            <p className="mt-1.5 text-xs text-muted">{k.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Departures still to leave today */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="flex items-center gap-2 font-bold text-ink">
              <CalendarClock className="h-4 w-4 text-brand" /> Departing today
            </h2>
            <Link href="/admin/trips" className="btn-ghost text-sm text-brand">
              All departures <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {data.upcomingDepartures.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">
              No further departures scheduled today.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {data.upcomingDepartures.map((d) => {
                const full = d.capacity > 0 && d.seatsBooked >= d.capacity;
                return (
                  <li key={d.id} className="flex items-center gap-4 px-5 py-3">
                    <div className="w-14 text-center">
                      <p className="text-lg font-extrabold tracking-tight text-ink">
                        {formatTime(d.departureAt)}
                      </p>
                      <p className="text-[10px] text-muted">{formatDayLabel(d.departureAt)}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{d.route}</p>
                      <p className="text-[11px] text-muted">{d.bus}</p>
                    </div>
                    <span
                      className={cx(
                        "flex items-center gap-1 text-xs font-semibold",
                        full ? "text-danger" : "text-muted",
                      )}
                    >
                      <Armchair className="h-3.5 w-3.5" />
                      {d.seatsBooked}/{d.capacity}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Recent sales */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="flex items-center gap-2 font-bold text-ink">
              <Users className="h-4 w-4 text-brand" /> Recent bookings
            </h2>
            <Link href="/admin/bookings" className="btn-ghost text-sm text-brand">
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {data.recentBookings.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">No bookings yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.recentBookings.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/bookings/${b.id}`}
                        className="truncate font-medium text-ink hover:text-brand"
                      >
                        {b.passenger}
                      </Link>
                      {b.channel === "COUNTER" && (
                        <span className="badge bg-elevated text-[10px] text-muted">counter</span>
                      )}
                    </div>
                    <p className="truncate text-[11px] text-muted">
                      {b.route} · {formatDateTime(b.createdAt)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-ink">{KES(b.amount)}</p>
                    <StatusBadge status={b.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
