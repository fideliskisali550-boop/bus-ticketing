"use client";

import { useCallback, useEffect, useState } from "react";
import { useSessionHref } from "@/components/tab-link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Wallet,
  Ticket,
  Users,
  BadgeCheck,
  Flag,
  Bus,
  XCircle,
  Armchair,
  Coins,
  TrendingUp,
  TrendingDown,
  FileText,
  FileSpreadsheet,
  FileDown,
} from "lucide-react";
import { api, KES } from "@/lib/client";
import { Tabs, cx } from "@/components/ui";

type ReportPeriod = "day" | "week" | "month" | "year";

type Report = {
  period: ReportPeriod;
  label: string;
  range: { from: string; to: string };
  operator: string;
  generatedAt: string;
  generatedBy: string;
  summary: {
    revenue: number;
    bookings: number;
    passengers: number;
    ticketsVerified: number;
    completedTrips: number;
    activeBuses: number;
    cancellations: number;
    occupancy: number;
    averageFare: number;
  };
  deltas: { revenue: number | null; bookings: number | null };
  series: { label: string; revenue: number; bookings: number }[];
  routePerformance: { route: string; revenue: number; bookings: number; seats: number }[];
  paymentMethods: { method: string; count: number; amount: number }[];
  statusBreakdown: { status: string; count: number }[];
};

const PERIOD_TABS: { id: ReportPeriod; label: string }[] = [
  { id: "day", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "year", label: "This year" },
];

export function ReportsView() {
  const [period, setPeriod] = useState<ReportPeriod>("month");
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api<Report>(`/api/reports?period=${period}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [period]);

  useEffect(() => load(), [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Reports</h1>
          <p className="mt-1 text-sm text-muted">
            {data ? `${data.operator} · ${data.label}` : "Operational performance by period."}
          </p>
        </div>
        <ExportButtons period={period} disabled={loading || !data} />
      </div>

      <Tabs tabs={PERIOD_TABS} active={period} onChange={setPeriod} />

      {loading || !data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton h-24 rounded-card" />
            ))}
          </div>
          <div className="skeleton h-72 rounded-card" />
        </div>
      ) : (
        <ReportBody data={data} />
      )}
    </div>
  );
}

function ExportButtons({ period, disabled }: { period: ReportPeriod; disabled: boolean }) {
  const csv = useSessionHref(`/api/reports/export?period=${period}&format=csv`);
  const xlsx = useSessionHref(`/api/reports/export?period=${period}&format=xlsx`);
  const pdf = useSessionHref(`/api/reports/export?period=${period}&format=pdf`);

  const cls = cx("btn-secondary", disabled && "pointer-events-none opacity-50");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={pdf} className={cls} download>
        <FileText className="h-4 w-4" /> PDF
      </a>
      <a href={xlsx} className={cls} download>
        <FileSpreadsheet className="h-4 w-4" /> Excel
      </a>
      <a href={csv} className={cls} download>
        <FileDown className="h-4 w-4" /> CSV
      </a>
    </div>
  );
}

function ReportBody({ data }: { data: Report }) {
  const s = data.summary;

  const kpis: { label: string; value: string; icon: typeof Wallet; delta?: number | null; invert?: boolean }[] = [
    { label: "Revenue", value: KES(s.revenue), icon: Wallet, delta: data.deltas.revenue },
    { label: "Bookings", value: s.bookings.toLocaleString(), icon: Ticket, delta: data.deltas.bookings },
    { label: "Passengers", value: s.passengers.toLocaleString(), icon: Users },
    { label: "Tickets verified", value: s.ticketsVerified.toLocaleString(), icon: BadgeCheck },
    { label: "Completed trips", value: s.completedTrips.toLocaleString(), icon: Flag },
    { label: "Active buses", value: s.activeBuses.toLocaleString(), icon: Bus },
    { label: "Cancellations", value: s.cancellations.toLocaleString(), icon: XCircle, invert: true },
    { label: "Fleet occupancy", value: `${s.occupancy}%`, icon: Armchair },
  ];

  return (
    <div className="space-y-6">
      {/* KPI grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="card p-5">
            <div className="flex items-start justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{k.label}</p>
              <k.icon className="h-4 w-4 text-brand" />
            </div>
            <p className="mt-2 text-2xl font-extrabold tracking-tight text-ink">{k.value}</p>
            {k.delta != null && (
              <span
                className={cx(
                  "mt-1.5 flex items-center gap-0.5 text-xs font-bold",
                  (k.invert ? -k.delta : k.delta) >= 0 ? "text-ok" : "text-danger",
                )}
              >
                {k.delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {Math.abs(k.delta)}% vs previous
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Trend */}
      <div className="card p-5">
        <h2 className="font-bold text-ink">Revenue &amp; bookings</h2>
        <p className="text-xs text-muted">Across {data.label}.</p>
        <div className="mt-5 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.series} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="repRevenue" x1="0" y1="0" x2="0" y2="1">
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
                interval={Math.max(0, Math.floor(data.series.length / 10) - 1)}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted))" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
              />
              <Tooltip content={<ChartTooltip currency />} />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="hsl(var(--brand))"
                strokeWidth={2}
                fill="url(#repRevenue)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Route performance */}
        <div className="card p-5">
          <h2 className="font-bold text-ink">Route performance</h2>
          <p className="text-xs text-muted">Top corridors by revenue.</p>
          {data.routePerformance.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">No sales in this period.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left">
                  <tr className="border-b border-line">
                    <Th>Route</Th>
                    <Th className="text-right">Revenue</Th>
                    <Th className="text-right">Bookings</Th>
                    <Th className="text-right">Seats</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.routePerformance.map((r) => (
                    <tr key={r.route} className="hover:bg-elevated">
                      <td className="py-2.5 pr-2 font-medium text-ink">{r.route}</td>
                      <td className="py-2.5 text-right font-semibold text-ink">{KES(r.revenue)}</td>
                      <td className="py-2.5 text-right text-muted">{r.bookings}</td>
                      <td className="py-2.5 text-right text-muted">{r.seats}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Payment methods */}
        <div className="card p-5">
          <h2 className="font-bold text-ink">Payment methods</h2>
          <p className="text-xs text-muted">How takings were collected.</p>
          {data.paymentMethods.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">No payments in this period.</p>
          ) : (
            <div className="mt-5 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.paymentMethods}
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
                    dataKey="method"
                    width={70}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted))" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<ChartTooltip currency />} cursor={{ fill: "hsl(var(--elevated))" }} />
                  <Bar dataKey="amount" fill="hsl(var(--brand))" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Footer meta */}
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
        <Coins className="h-3.5 w-3.5" />
        Average fare {KES(s.averageFare)} per seat · generated{" "}
        {new Date(data.generatedAt).toLocaleString("en-GB", { timeZone: "Africa/Nairobi" })} by{" "}
        {data.generatedBy}
      </p>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cx("py-2 pr-2 text-xs font-semibold uppercase tracking-wide text-muted", className)}>
      {children}
    </th>
  );
}

/** Themed tooltip, matching the operations overview. */
function ChartTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: { value?: number }[];
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
