"use client";

import { useEffect, useState } from "react";
import { formatDateTime, formatDateTimeFull } from "@/lib/time";
import { toast } from "sonner";
import { Plus, Pencil, CalendarClock, Ban, Users2 } from "lucide-react";
import { api, post, patch, KES, ApiClientError } from "@/lib/client";
import {
  Modal,
  EmptyState,
  TableSkeleton,
  Field,
  Spinner,
  StatusBadge,
  Pagination,
  cx,
} from "@/components/ui";

type Trip = {
  id: string;
  departureAt: string;
  arrivalAt: string;
  fare: number;
  status: string;
  seatsAvailable: number;
  capacity: number;
  route: { id: string; origin: string; destination: string; durationMin: number };
  bus: { registration: string; model: string };
};

type Route = { id: string; origin: string; destination: string; durationMin: number };
type Bus = { id: string; registration: string; model: string; status: string };

const STATUSES = ["ALL", "SCHEDULED", "BOARDING", "DEPARTED", "ARRIVED", "CANCELLED"];

export function AdminTrips() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, perPage: 15, pages: 1 });
  const [routes, setRoutes] = useState<Route[]>([]);
  const [buses, setBuses] = useState<Bus[]>([]);
  const [loading, setLoading] = useState(true);

  const [status, setStatus] = useState("SCHEDULED");
  const [date, setDate] = useState("");
  const [page, setPage] = useState(1);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Trip | null>(null);
  const [cancelling, setCancelling] = useState<Trip | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    routeId: "",
    busId: "",
    departureDate: "",
    departureTime: "07:00",
    fare: "",
    status: "SCHEDULED",
  });

  async function load() {
    setLoading(true);
    try {
      const q = new URLSearchParams({
        scope: "all",
        status,
        page: String(page),
        perPage: "15",
      });
      if (date) q.set("date", date);

      const data = await api<{
        trips: Trip[];
        total: number;
        page: number;
        perPage: number;
        pages: number;
      }>(`/api/trips?${q}`);

      setTrips(data.trips);
      setMeta({
        total: data.total,
        page: data.page,
        perPage: data.perPage,
        pages: data.pages,
      });
    } catch {
      toast.error("Could not load departures.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, date, page]);

  useEffect(() => setPage(1), [status, date]);

  useEffect(() => {
    api<{ routes: Route[] }>("/api/routes").then((d) => setRoutes(d.routes)).catch(() => undefined);
    api<{ buses: Bus[] }>("/api/buses?status=ACTIVE")
      .then((d) => setBuses(d.buses))
      .catch(() => undefined);
  }, []);

  function openCreate() {
    const tomorrow = new Date(Date.now() + 86_400_000);
    setForm({
      routeId: routes[0]?.id ?? "",
      busId: buses[0]?.id ?? "",
      departureDate: tomorrow.toISOString().slice(0, 10),
      departureTime: "07:00",
      fare: "",
      status: "SCHEDULED",
    });
    setErrors({});
    setCreating(true);
  }

  function openEdit(trip: Trip) {
    const d = new Date(trip.departureAt);
    setForm({
      routeId: trip.route.id,
      busId: "",
      departureDate: toLocalDate(d),
      departureTime: toLocalTime(d),
      fare: String(trip.fare),
      status: trip.status,
    });
    setErrors({});
    setEditing(trip);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});

    const departureAt = new Date(`${form.departureDate}T${form.departureTime}`);
    const route = routes.find((r) => r.id === form.routeId);
    // Arrival is derived from the route's scheduled duration rather than asked
    // for separately — one less field to get wrong, and it stays consistent.
    const arrivalAt = new Date(
      departureAt.getTime() + (route?.durationMin ?? 240) * 60_000,
    );

    try {
      if (editing) {
        await patch(`/api/trips/${editing.id}`, {
          departureAt,
          arrivalAt,
          fare: Number(form.fare),
          status: form.status,
        });
        toast.success("Departure updated");
      } else {
        await post("/api/trips", {
          routeId: form.routeId,
          busId: form.busId,
          departureAt,
          arrivalAt,
          fare: Number(form.fare),
          status: form.status,
        });
        toast.success("Departure scheduled");
      }
      setCreating(false);
      setEditing(null);
      load();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrors(
          Object.fromEntries(
            Object.entries(error.details ?? {}).map(([k, v]) => [k, v[0] ?? ""]),
          ),
        );
        toast.error(error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancelTrip(trip: Trip) {
    setBusy(true);
    try {
      await patch(`/api/trips/${trip.id}`, { status: "CANCELLED" });
      toast.success("Departure cancelled. Affected passengers have been notified and refunded.");
      setCancelling(null);
      load();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not cancel.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Departures</h1>
          <p className="mt-1 text-sm text-muted">
            Schedule services, adjust fares and manage cancellations.
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="h-4 w-4" /> Schedule departure
        </button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          type="date"
          className="input w-auto"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Filter by date"
        />
        {date && (
          <button onClick={() => setDate("")} className="btn-ghost text-xs">
            Clear date
          </button>
        )}

        <div className="ml-auto flex flex-wrap gap-1.5">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cx(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                status === s ? "bg-brand text-white" : "bg-elevated text-muted hover:text-ink",
              )}
            >
              {s === "ALL" ? "All" : s.toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="card mt-4 overflow-hidden">
        {loading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : trips.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="h-6 w-6" aria-hidden />}
            title="No departures match"
            description="Try a different status or date, or schedule a new service."
            action={
              <button onClick={openCreate} className="btn-primary mt-2">
                Schedule departure
              </button>
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-b border-line bg-elevated text-left">
                  <tr>
                    {["Route", "Departs", "Bus", "Occupancy", "Fare", "Status", ""].map(
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
                  {trips.map((t) => {
                    const sold = t.capacity - t.seatsAvailable;
                    const pct = Math.round((sold / t.capacity) * 100);

                    return (
                      <tr key={t.id} className="hover:bg-elevated">
                        <td className="px-4 py-3 font-bold text-ink">
                          {t.route.origin} → {t.route.destination}
                        </td>

                        <td className="whitespace-nowrap px-4 py-3 text-muted">
                          {formatDateTime(new Date(t.departureAt))}
                        </td>

                        <td className="px-4 py-3">
                          <p className="font-mono text-xs font-semibold text-ink">
                            {t.bus.registration}
                          </p>
                          <p className="text-[11px] text-muted">{t.bus.model}</p>
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div
                              className="h-1.5 w-16 overflow-hidden rounded-full bg-line"
                              role="img"
                              aria-label={`${pct}% full`}
                            >
                              <div
                                className={cx(
                                  "h-full rounded-full",
                                  pct >= 90 ? "bg-danger" : pct >= 60 ? "bg-warn" : "bg-ok",
                                )}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="whitespace-nowrap text-xs text-muted">
                              {sold}/{t.capacity}
                            </span>
                          </div>
                        </td>

                        <td className="px-4 py-3 font-semibold text-ink">{KES(t.fare)}</td>

                        <td className="px-4 py-3">
                          <StatusBadge status={t.status} />
                        </td>

                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => openEdit(t)}
                              className="btn-ghost p-2"
                              aria-label="Edit departure"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            {t.status !== "CANCELLED" && t.status !== "ARRIVED" && (
                              <button
                                onClick={() => setCancelling(t)}
                                className="btn-ghost p-2 text-danger hover:bg-danger/10"
                                aria-label="Cancel departure"
                              >
                                <Ban className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pagination
              page={meta.page}
              pages={meta.pages}
              total={meta.total}
              perPage={meta.perPage}
              onChange={setPage}
            />
          </>
        )}
      </div>

      <Modal
        open={creating || Boolean(editing)}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? "Edit departure" : "Schedule a departure"}
        description="Arrival time is calculated from the route's scheduled duration."
      >
        <form onSubmit={save} className="space-y-4">
          {!editing && (
            <>
              <Field label="Route" error={errors.routeId}>
                <select
                  className="input"
                  value={form.routeId}
                  onChange={(e) => setForm((f) => ({ ...f, routeId: e.target.value }))}
                  required
                >
                  <option value="">Choose a route…</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.origin} → {r.destination}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Bus"
                error={errors.busId}
                hint="Only active vehicles can be scheduled."
              >
                <select
                  className="input"
                  value={form.busId}
                  onChange={(e) => setForm((f) => ({ ...f, busId: e.target.value }))}
                  required
                >
                  <option value="">Choose a bus…</option>
                  {buses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.registration} — {b.model}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Departure date" error={errors.departureAt}>
              <input
                type="date"
                className="input"
                value={form.departureDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, departureDate: e.target.value }))
                }
                required
              />
            </Field>

            <Field label="Departure time">
              <input
                type="time"
                className="input"
                value={form.departureTime}
                onChange={(e) =>
                  setForm((f) => ({ ...f, departureTime: e.target.value }))
                }
                required
              />
            </Field>

            <Field label="Fare (KES)" error={errors.fare}>
              <input
                type="number"
                className="input"
                min={50}
                step={50}
                value={form.fare}
                onChange={(e) => setForm((f) => ({ ...f, fare: e.target.value }))}
                placeholder="1500"
                required
              />
            </Field>

            <Field label="Status">
              <select
                className="input"
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              >
                <option value="SCHEDULED">Scheduled</option>
                <option value="BOARDING">Boarding</option>
                <option value="DEPARTED">Departed</option>
                <option value="ARRIVED">Arrived</option>
              </select>
            </Field>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
              className="btn-secondary flex-1"
            >
              Cancel
            </button>
            <button disabled={busy} className="btn-primary flex-1">
              {busy && <Spinner />} {editing ? "Save changes" : "Schedule"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        title="Cancel this departure?"
        size="sm"
      >
        {cancelling && (
          <>
            <div className="rounded-lg bg-danger/10 p-4">
              <p className="font-bold text-ink">
                {cancelling.route.origin} → {cancelling.route.destination}
              </p>
              <p className="mt-1 text-sm text-muted">
                {formatDateTimeFull(new Date(cancelling.departureAt))}
              </p>
              <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-danger">
                <Users2 className="h-4 w-4" />
                {cancelling.capacity - cancelling.seatsAvailable} passenger
                {cancelling.capacity - cancelling.seatsAvailable === 1 ? "" : "s"} affected
              </p>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-muted">
              Every booking on this departure will be cancelled and refunded in full,
              and each passenger will be notified by email and SMS. This cannot be
              undone.
            </p>

            <div className="mt-5 flex gap-2">
              <button onClick={() => setCancelling(null)} className="btn-secondary flex-1">
                Keep departure
              </button>
              <button
                onClick={() => cancelTrip(cancelling)}
                disabled={busy}
                className="btn-danger flex-1"
              >
                {busy && <Spinner />} Cancel & refund
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

/** Local-time helpers — toISOString would shift the value by the UTC offset. */
const pad = (n: number) => String(n).padStart(2, "0");
const toLocalDate = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toLocalTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
