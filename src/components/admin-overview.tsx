"use client";

import { Link, useSessionHref } from "@/components/tab-link";
import { useLive, LiveDot } from "@/components/live";
import { useCallback, useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Wallet,
  Ticket,
  Users,
  TrendingUp,
  TrendingDown,
  Armchair,
  CalendarClock,
  Bus,
  ArrowRight,
  Download,
  BadgeCheck,
  UserCheck,
  Clock,
  Ban,
} from "lucide-react";
import { api, KES } from "@/lib/client";
import { StatusBadge, cx } from "@/components/ui";

type Analytics = {
  window: { days: number };
  verification: {
    verified: number;
    boarded: number;
    waiting: number;
    invalidAttempts: number;
  };
  kpis: {
    revenue: number;
    /** null when there is no comparable prior period to measure against. */
    revenueDelta: number | null;
    bookings: number;
    bookingsDelta: number | null;
    passengers: number;
    cancellationRate: number;
    occupancy: number;
    averageBookingValue: number;
    averageFare: number;
    upcomingTrips: number;
    activeBuses: number;
    totalRoutes: number;
    totalUsers: number;
    newUsers: number;
  };
  series: { date: string; label: string; revenue: number; bookings: number }[];
  topRoutes: { route: string; revenue: number; bookings: number }[];
  statusBreakdown: { status: string; count: number }[];
  paymentMethods: { method: string; count: number; amount: number }[];
  recentBookings: {
    id: string;
    reference: string;
    passenger: string;
    route: string;
    seats: number;
    amount: number;
    status: string;
    createdAt: string;
  }[];
};

/** Chart colours are read from the theme tokens so they follow dark mode. */
const CHART_COLORS = [
  "hsl(var(--brand))",
  "hsl(var(--accent))",
  "hsl(var(--ok))",
  "hsl(var(--warn))",
  "hsl(var(--danger))",
  "hsl(var(--muted))",
];

export function AdminOverview() {
  const exportHref = useSessionHref("/api/export/bookings");
  const [data, setData] = useState<Analytics | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    (showSpinner = false) => {
      if (showSpinner) setLoading(true);
      api<Analytics>(`/api/analytics?days=${days}`)
        .then(setData)
        .catch(() => setData(null))
        .finally(() => setLoading(false));
    },
    [days],
  );

  useEffect(() => {
    load(true);
  }, [load]);

  // Anything that moves money or seats moves these figures. The refresh is
  // silent — no spinner — because a dashboard that flickers every time somebody
  // books a seat is harder to read than one that simply stays right.
  useLive(
    [
      "booking.confirmed",
      "booking.cancelled",
      "booking.expired",
      "payment.failed",
      "refund.settled",
      "trip.cancelled",
      "ticket.scanned",
    ],
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
        <div className="skeleton h-80 rounded-card" />
      </div>
    );
  }

  const k = data.kpis;
  const v = data.verification;

  // Typed explicitly: without it TypeScript narrows the array to the shape of
  // the first element and rejects `delta`/`invert` on the later ones.
  const kpiCards: {
    label: string;
    value: string;
    delta?: number | null;
    icon: typeof Wallet;
    hint: string;
    invert?: boolean;
  }[] = [
    {
      label: "Revenue",
      value: KES(k.revenue),
      delta: k.revenueDelta,
      icon: Wallet,
      hint: `${KES(k.averageFare)} average fare per seat`,
    },
    {
      label: "Bookings",
      value: k.bookings.toLocaleString(),
      delta: k.bookingsDelta,
      icon: Ticket,
      hint: `${k.passengers.toLocaleString()} seats · ${KES(k.averageBookingValue)} per booking`,
    },
    {
      label: "Fleet occupancy",
      value: `${k.occupancy}%`,
      icon: Armchair,
      hint: `across departed trips`,
    },
    {
      label: "Cancellation rate",
      value: `${k.cancellationRate}%`,
      icon: Users,
      hint: `${k.newUsers} new customers`,
      invert: true,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">
            Operations overview
          </h1>
          <p className="mt-1 flex items-center gap-3 text-sm text-muted">
            Performance across the last {data.window.days} days.
            <LiveDot />
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="input w-auto py-1.5"
            aria-label="Reporting period"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <a href={exportHref} className="btn-secondary">
            <Download className="h-4 w-4" /> Export
          </a>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((card) => (
          <div key={card.label} className="card p-5">
            <div className="flex items-start justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                {card.label}
              </p>
              <card.icon className="h-4 w-4 text-brand" />
            </div>

            <p className="mt-2 text-2xl font-extrabold tracking-tight text-ink">
              {card.value}
            </p>

            <div className="mt-1.5 flex items-center gap-2">
              {card.delta != null && (
                <span
                  className={cx(
                    "flex items-center gap-0.5 text-xs font-bold",
                    // For cancellations, up is bad — flip the colour, not the arrow.
                    (card.invert ? -card.delta : card.delta) >= 0
                      ? "text-ok"
                      : "text-danger",
                  )}
                >
                  {card.delta >= 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {Math.abs(card.delta)}%
                </span>
              )}
              <span className="truncate text-xs text-muted">{card.hint}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Secondary stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Upcoming departures", value: k.upcomingTrips, icon: CalendarClock, href: "/admin/trips" },
          { label: "Active buses", value: k.activeBuses, icon: Bus, href: "/admin/buses" },
          { label: "Registered users", value: k.totalUsers, icon: Users, href: "/admin/users" },
        ].map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="card flex items-center gap-4 p-4 transition hover:shadow-lift"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
              <s.icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xl font-extrabold text-ink">
                {s.value.toLocaleString()}
              </p>
              <p className="truncate text-xs text-muted">{s.label}</p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted" />
          </Link>
        ))}
      </div>

      {/* Verification desk — today */}
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-ink">Ticket verification · today</h2>
            <p className="text-xs text-muted">Activity at the boarding desk.</p>
          </div>
          <Link href="/admin/checkin" className="btn-ghost text-sm text-brand">
            Open desk <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Verified today", value: v.verified, icon: BadgeCheck, tone: "text-brand" },
            { label: "Boarded today", value: v.boarded, icon: UserCheck, tone: "text-ok" },
            { label: "Waiting for verification", value: v.waiting, icon: Clock, tone: "text-warn" },
            { label: "Invalid attempts", value: v.invalidAttempts, icon: Ban, tone: "text-danger" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-line bg-elevated/40 p-4">
              <div className="flex items-start justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{s.label}</p>
                <s.icon className={cx("h-4 w-4", s.tone)} />
              </div>
              <p className="mt-2 text-2xl font-extrabold tracking-tight text-ink">
                {s.value.toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Revenue trend */}
      <div className="card p-5">
        <h2 className="font-bold text-ink">Revenue trend</h2>
        <p className="text-xs text-muted">Daily takings from confirmed payments.</p>

        <div className="mt-5 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.series} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--brand))" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="hsl(var(--brand))" stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid stroke="hsl(var(--line))" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(var(--muted))" }}
                tickLine={false}
                axisLine={false}
                // Thin the labels so a 90-day window does not turn the axis
                // into an unreadable smear.
                interval={Math.max(0, Math.floor(data.series.length / 8) - 1)}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted))" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) =>
                  v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                }
              />
              <Tooltip content={<ChartTooltip currency />} />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="hsl(var(--brand))"
                strokeWidth={2}
                fill="url(#revenueFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top routes */}
        <div className="card p-5">
          <h2 className="font-bold text-ink">Revenue by route</h2>
          <p className="text-xs text-muted">Your best-performing corridors.</p>

          <div className="mt-5 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.topRoutes}
                layout="vertical"
                margin={{ top: 0, right: 12, left: 0, bottom: 0 }}
              >
                <CartesianGrid stroke="hsl(var(--line))" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted))" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                />
                <YAxis
                  type="category"
                  dataKey="route"
                  width={130}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted))" }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip content={<ChartTooltip currency />} cursor={{ fill: "hsl(var(--elevated))" }} />
                <Bar dataKey="revenue" fill="hsl(var(--brand))" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Booking status mix */}
        <div className="card p-5">
          <h2 className="font-bold text-ink">Booking outcomes</h2>
          <p className="text-xs text-muted">How bookings in this period resolved.</p>

          <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row">
            <div className="h-56 w-full sm:w-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.statusBreakdown}
                    dataKey="count"
                    nameKey="status"
                    innerRadius={52}
                    outerRadius={82}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {data.statusBreakdown.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <ul className="w-full flex-1 space-y-2">
              {data.statusBreakdown.map((s, i) => (
                <li key={s.status} className="flex items-center gap-2 text-sm">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                  />
                  <span className="flex-1 capitalize text-muted">
                    {s.status.replace(/_/g, " ").toLowerCase()}
                  </span>
                  <span className="font-bold text-ink">{s.count.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Recent bookings */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-bold text-ink">Latest bookings</h2>
          <Link href="/admin/bookings" className="btn-ghost text-sm text-brand">
            View all <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-elevated text-left">
              <tr>
                {["Reference", "Passenger", "Route", "Seats", "Amount", "Status"].map(
                  (h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.recentBookings.map((b) => (
                <tr key={b.id} className="hover:bg-elevated">
                  <td className="px-4 py-3">
                    <Link
                      href={`/bookings/${b.id}`}
                      className="font-mono text-xs font-semibold text-brand hover:underline"
                    >
                      {b.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium text-ink">{b.passenger}</td>
                  <td className="px-4 py-3 text-muted">{b.route}</td>
                  <td className="px-4 py-3 text-muted">{b.seats}</td>
                  <td className="px-4 py-3 font-semibold text-ink">{KES(b.amount)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={b.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Themed tooltip — Recharts' default is a white box that breaks in dark mode. */
function ChartTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; payload?: Record<string, unknown> }[];
  label?: string;
  currency?: boolean;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-lift">
      {label && <p className="text-xs font-semibold text-muted">{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} className="text-sm font-bold text-ink">
          {currency ? KES(entry.value ?? 0) : (entry.value ?? 0).toLocaleString()}
        </p>
      ))}
    </div>
  );
}
