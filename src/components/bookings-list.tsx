"use client";

import { Link, useSessionHref } from "@/components/tab-link";
import { useLive } from "@/components/live";
import { formatDate, formatDateTime } from "@/lib/time";
import { useCallback, useEffect, useState } from "react";
import { Search, TicketX, Download } from "lucide-react";
import { api, KES } from "@/lib/client";
import {
  StatusBadge,
  EmptyState,
  Pagination,
  TableSkeleton,
  useDebounced,
  cx,
} from "@/components/ui";

type Booking = {
  id: string;
  reference: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  seats: { seatNumber: string; passengerName: string }[];
  ticket: { id: string; checkedInAt: string | null; verificationCode: string | null } | null;
  user?: { fullName: string; email: string; phone: string };
  trip: {
    departureAt: string;
    route: { origin: string; destination: string };
    bus: { registration: string };
  };
};

type Response = {
  bookings: Booking[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
};

const FILTERS = ["ALL", "PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELLED"];

/**
 * Shared booking table. `scope="all"` switches it into the staff view, which
 * adds a passenger column — the server enforces that only staff may ask for it.
 */
export function BookingsList({ scope = "mine" }: { scope?: "mine" | "all" }) {
  const exportHref = useSessionHref("/api/export/bookings");
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounced(search);

  const load = useCallback((showSpinner = true) => {
    // Guards against a slow earlier request overwriting a newer one. Typing
    // quickly fires several requests, and without this the one that happens to
    // return last wins — showing results for a query already moved on from.
    if (showSpinner) setLoading(true);
    const q = new URLSearchParams({
      status,
      page: String(page),
      perPage: "10",
      ...(scope === "all" ? { scope: "all" } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    });

    let cancelled = false;

    api<Response>(`/api/bookings?${q}`)
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
  }, [status, debouncedSearch, page, scope]);

  useEffect(() => {
    const cancel = load(true);
    return cancel;
  }, [load]);

  // A booking taken at another counter, or a hold that lapses, changes this
  // list. Refreshed without a spinner so the table does not blink under a
  // clerk's cursor.
  useLive(
    ["booking.created", "booking.confirmed", "booking.cancelled", "booking.expired"],
    () => load(false),
    { pollMs: 45_000 },
  );

  // A new filter or search invalidates the current page number.
  useEffect(() => setPage(1), [status, debouncedSearch]);

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            className="input pl-9"
            placeholder={
              scope === "all"
                ? "Search reference, passenger or email…"
                : "Search by reference or passenger…"
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search bookings"
          />
        </div>

        {scope === "all" && (
          <a href={exportHref} className="btn-secondary shrink-0">
            <Download className="h-4 w-4" /> Export
          </a>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setStatus(f)}
            className={cx(
              "rounded-full px-3 py-1.5 text-xs font-semibold transition",
              status === f
                ? "bg-brand text-white"
                : "bg-elevated text-muted hover:text-ink",
            )}
          >
            {f === "ALL" ? "All" : f.replace(/_/g, " ").toLowerCase()}
          </button>
        ))}
      </div>

      <div className="card mt-4 overflow-hidden">
        {loading ? (
          <TableSkeleton rows={6} cols={scope === "all" ? 6 : 5} />
        ) : !data || data.bookings.length === 0 ? (
          <EmptyState
            icon={<TicketX className="h-6 w-6" aria-hidden />}
            title="No bookings found"
            description={
              search || status !== "ALL"
                ? "Try clearing the search or choosing a different status."
                : "Bookings will appear here once they are made."
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-line bg-elevated text-left">
                  <tr>
                    <Th>Reference</Th>
                    {scope === "all" && <Th>Passenger</Th>}
                    <Th>Route</Th>
                    <Th>Departure</Th>
                    <Th>Seats</Th>
                    <Th className="text-right">Amount</Th>
                    <Th className="text-right">Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.bookings.map((b) => (
                    <tr key={b.id} className="transition hover:bg-elevated">
                      <td className="px-4 py-3">
                        <Link
                          href={`/bookings/${b.id}`}
                          className="font-mono text-xs font-semibold text-brand hover:underline"
                        >
                          {b.ticket?.verificationCode ?? b.reference}
                        </Link>
                        <p className="mt-0.5 text-[11px] text-muted">
                          {b.ticket?.verificationCode ? `${b.reference} · ` : ""}
                          {formatDate(new Date(b.createdAt))}
                        </p>
                      </td>

                      {scope === "all" && (
                        <td className="px-4 py-3">
                          <p className="font-medium text-ink">{b.user?.fullName}</p>
                          <p className="text-[11px] text-muted">{b.user?.phone}</p>
                        </td>
                      )}

                      <td className="px-4 py-3 font-medium text-ink">
                        {b.trip.route.origin} → {b.trip.route.destination}
                        <p className="text-[11px] font-normal text-muted">
                          {b.trip.bus.registration}
                        </p>
                      </td>

                      <td className="px-4 py-3 text-muted">
                        {formatDateTime(new Date(b.trip.departureAt))}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {b.seats.map((s) => (
                            <span
                              key={s.seatNumber}
                              className="badge bg-brand-soft text-brand"
                            >
                              {s.seatNumber}
                            </span>
                          ))}
                        </div>
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

            <Pagination
              page={data.page}
              pages={data.pages}
              total={data.total}
              perPage={data.perPage}
              onChange={setPage}
            />
          </>
        )}
      </div>
    </>
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
      className={`whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted ${className}`}
    >
      {children}
    </th>
  );
}
