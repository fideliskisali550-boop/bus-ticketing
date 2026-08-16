import { Link } from "@/components/tab-link";
import { formatDateTime } from "@/lib/time";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import {
  Ticket,
  Wallet,
  MapPinned,
  ArrowRight,
  CalendarClock,
  Search,
} from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { KES } from "@/lib/policy";
import { StatusBadge, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login?next=/dashboard");

  const now = new Date();

  const [upcoming, recent, spendAgg, tripCount, routeCount] = await Promise.all([
    db.booking.findMany({
      where: {
        userId: session.id,
        status: { in: ["CONFIRMED", "PENDING", "CHECKED_IN"] },
        trip: { departureAt: { gte: now } },
      },
      orderBy: { trip: { departureAt: "asc" } },
      take: 3,
      include: {
        seats: { select: { seatNumber: true } },
        trip: { include: { route: true, bus: { select: { registration: true } } } },
      },
    }),
    db.booking.findMany({
      where: { userId: session.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: {
        seats: { select: { seatNumber: true } },
        trip: { include: { route: { select: { origin: true, destination: true } } } },
      },
    }),
    db.payment.aggregate({
      _sum: { amount: true },
      where: { status: "SUCCESS", booking: { userId: session.id } },
    }),
    db.booking.count({
      where: { userId: session.id, status: { in: ["COMPLETED", "CHECKED_IN"] } },
    }),
    db.booking.findMany({
      where: { userId: session.id },
      select: { trip: { select: { routeId: true } } },
      distinct: ["tripId"],
    }),
  ]);

  const distinctRoutes = new Set(routeCount.map((b) => b.trip.routeId)).size;
  const firstName = session.fullName.split(" ")[0];

  const stats = [
    {
      label: "Trips completed",
      value: tripCount.toLocaleString(),
      icon: Ticket,
    },
    {
      label: "Total spent",
      value: KES(spendAgg._sum.amount ?? 0),
      icon: Wallet,
    },
    {
      label: "Routes travelled",
      value: distinctRoutes.toLocaleString(),
      icon: MapPinned,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
            Habari, {firstName}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Here is what is coming up on your travel schedule.
          </p>
        </div>
        <Link href="/search" className="btn-primary">
          <Search className="h-4 w-4" /> Book a trip
        </Link>
      </div>

      {/* Stats */}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="card p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                {s.label}
              </p>
              <s.icon className="h-4 w-4 text-brand" />
            </div>
            <p className="mt-2 text-2xl font-extrabold tracking-tight text-ink">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Upcoming */}
      <section className="mt-10">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-lg font-bold text-ink">Upcoming journeys</h2>
          <Link href="/bookings" className="btn-ghost text-sm text-brand">
            All bookings <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {upcoming.length === 0 ? (
          <div className="card mt-4">
            <EmptyState
              icon={<CalendarClock className="h-6 w-6" aria-hidden />}
              title="No upcoming trips"
              description="When you book a journey it will appear here with your boarding details."
              action={
                <Link href="/search" className="btn-primary mt-2">
                  Find a bus
                </Link>
              }
            />
          </div>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            {upcoming.map((b) => {
              const departs = b.trip.departureAt;
              const daysAway = Math.ceil(
                (departs.getTime() - now.getTime()) / 86_400_000,
              );

              return (
                <Link
                  key={b.id}
                  href={`/bookings/${b.id}`}
                  className="card group p-5 transition hover:-translate-y-0.5 hover:shadow-lift"
                >
                  <div className="flex items-start justify-between gap-3">
                    <StatusBadge status={b.status} />
                    <span className="text-xs font-semibold text-muted">
                      {daysAway <= 0
                        ? "Today"
                        : daysAway === 1
                          ? "Tomorrow"
                          : `in ${daysAway} days`}
                    </span>
                  </div>

                  <p className="mt-3 text-lg font-extrabold tracking-tight text-ink">
                    {b.trip.route.origin} → {b.trip.route.destination}
                  </p>

                  <p className="mt-1 text-sm text-muted">
                    {formatDateTime(departs)}
                  </p>

                  <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs">
                    <span className="text-muted">
                      Seat{b.seats.length === 1 ? "" : "s"}{" "}
                      <span className="font-bold text-ink">
                        {b.seats.map((s) => s.seatNumber).join(", ")}
                      </span>
                    </span>
                    <span className="font-mono text-muted">{b.reference}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent activity */}
      {recent.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-bold text-ink">Recent activity</h2>
          <div className="card mt-4 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-elevated text-left">
                <tr>
                  <Th>Reference</Th>
                  <Th>Route</Th>
                  <Th className="hidden sm:table-cell">Seats</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="text-right">Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {recent.map((b) => (
                  <tr key={b.id} className="hover:bg-elevated">
                    <td className="px-4 py-3">
                      <Link
                        href={`/bookings/${b.id}`}
                        className="font-mono text-xs font-semibold text-brand hover:underline"
                      >
                        {b.reference}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium text-ink">
                      {b.trip.route.origin} → {b.trip.route.destination}
                    </td>
                    <td className="hidden px-4 py-3 text-muted sm:table-cell">
                      {b.seats.map((s) => s.seatNumber).join(", ")}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-ink">
                      {KES(b.totalAmount)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <StatusBadge status={b.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted ${className}`}
    >
      {children}
    </th>
  );
}
