"use client";

import { useEffect, useState } from "react";
import { RouteStopsEditor } from "@/components/route-stops-editor";
import type { RouteStop } from "@/lib/stops";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Route as RouteIcon, Search, X } from "lucide-react";
import { api, post, patch, del, ApiClientError } from "@/lib/client";
import {
  Modal,
  EmptyState,
  TableSkeleton,
  Field,
  Tabs,
  Spinner,
  useDebounced,
} from "@/components/ui";

type Route = {
  id: string;
  origin: string;
  destination: string;
  distanceKm: number;
  durationMin: number;
  stops: string[];
  /** The detailed form the editor works in; names alone stay for display. */
  stopDetails?: RouteStop[];
  isActive: boolean;
  _count: { trips: number };
};

const BLANK = {
  origin: "",
  destination: "",
  distanceKm: "",
  durationMin: "",
  stops: [] as RouteStop[],
  isActive: true,
};

export function AdminRoutes() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Route | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [tab, setTab] = useState<"route" | "stops">("route");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<Route | null>(null);

  const debounced = useDebounced(search);

  async function load(isCancelled: () => boolean = () => false) {
    if (!isCancelled()) setLoading(true);
    try {
      const q = new URLSearchParams({ includeInactive: "true", withCounts: "true", perPage: "50" });
      if (debounced) q.set("search", debounced);
      const data = await api<{ routes: Route[] }>(`/api/routes?${q}`);
      if (!isCancelled()) setRoutes(data.routes);
    } catch {
      toast.error("Could not load routes.");
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    // Guards against a slow earlier request overwriting a newer one. Typing
    // quickly in the search box fires several requests, and without this the
    // one that happens to return last wins — showing results for a query the
    // user has already moved on from.
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  function openCreate() {
    setForm(BLANK);
    setTab("route");
    setErrors({});
    setCreating(true);
  }

  function openEdit(route: Route) {
    setForm({
      origin: route.origin,
      destination: route.destination,
      distanceKm: String(route.distanceKm),
      durationMin: String(route.durationMin),
      // Prefer the detailed stops; fall back to bare names for any row the
      // API served before the richer shape existed.
      stops:
        route.stopDetails ??
        route.stops.map((name) => ({ name, offsetMin: null, pickup: true, dropoff: true })),
      isActive: route.isActive,
    });
    setTab("route");
    setErrors({});
    setEditing(route);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});

    const payload = {
      origin: form.origin,
      destination: form.destination,
      distanceKm: Number(form.distanceKm),
      durationMin: Number(form.durationMin),
      stops: form.stops,
      isActive: form.isActive,
    };

    try {
      if (editing) {
        await patch(`/api/routes/${editing.id}`, payload);
        toast.success("Route updated");
      } else {
        await post("/api/routes", payload);
        toast.success("Route created");
      }
      setEditing(null);
      setCreating(false);
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

  async function remove(route: Route) {
    setBusy(true);
    try {
      const res = await del<{ deactivated: boolean }>(`/api/routes/${route.id}`);
      toast.success(
        res.deactivated
          ? "Route retired — it has trip history, so it was deactivated rather than deleted."
          : "Route deleted",
      );
      setConfirmDelete(null);
      load();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not delete.");
    } finally {
      setBusy(false);
    }
  }

  const dialogOpen = creating || Boolean(editing);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Routes</h1>
          <p className="mt-1 text-sm text-muted">
            The corridors your fleet serves, with distances and intermediate stops.
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="h-4 w-4" /> New route
        </button>
      </div>

      <div className="relative mt-6 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          className="input pl-9"
          placeholder="Search by town…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search routes"
        />
      </div>

      <div className="card mt-4 overflow-hidden">
        {loading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : routes.length === 0 ? (
          <EmptyState
            icon={<RouteIcon className="h-6 w-6" aria-hidden />}
            title="No routes yet"
            description="Add the corridors your buses serve to start scheduling departures."
            action={
              <button onClick={openCreate} className="btn-primary mt-2">
                Add your first route
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-line bg-elevated text-left">
                <tr>
                  {["Route", "Distance", "Duration", "Stops", "Departures", ""].map((h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {routes.map((r) => (
                  <tr key={r.id} className="hover:bg-elevated">
                    <td className="px-4 py-3">
                      <p className="font-bold text-ink">
                        {r.origin} → {r.destination}
                      </p>
                      {!r.isActive && (
                        <span className="badge mt-1 bg-muted/15 text-muted">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">{r.distanceKm} km</td>
                    <td className="px-4 py-3 text-muted">
                      {Math.floor(r.durationMin / 60)}h {r.durationMin % 60}m
                    </td>
                    <td className="max-w-64 truncate px-4 py-3 text-muted">
                      {r.stops.length ? r.stops.join(" · ") : "Direct"}
                    </td>
                    <td className="px-4 py-3 font-semibold text-ink">{r._count.trips}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => openEdit(r)}
                          className="btn-ghost p-2"
                          aria-label={`Edit ${r.origin} to ${r.destination}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(r)}
                          className="btn-ghost p-2 text-danger hover:bg-danger/10"
                          aria-label={`Delete ${r.origin} to ${r.destination}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={dialogOpen}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? "Edit route" : "New route"}
        description="Distance and duration drive fare analytics and arrival estimates."
      >
        <form onSubmit={save} className="space-y-4">
          {/* Split by subject. The stop list needs vertical room, and stacking
              it under the endpoint fields pushed the save button off-screen on
              a laptop. */}
          <Tabs
            tabs={[
              { id: "route" as const, label: "Route" },
              { id: "stops" as const, label: "Stops", badge: form.stops.length },
            ]}
            active={tab}
            onChange={setTab}
          />

          {tab === "route" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Origin" error={errors.origin}>
                <input
                  className="input"
                  value={form.origin}
                  onChange={(e) => setForm((f) => ({ ...f, origin: e.target.value }))}
                  placeholder="Nairobi"
                  required
                />
              </Field>
              <Field label="Destination" error={errors.destination}>
                <input
                  className="input"
                  value={form.destination}
                  onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value }))}
                  placeholder="Mombasa"
                  required
                />
              </Field>
              <Field label="Distance (km)" error={errors.distanceKm}>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={form.distanceKm}
                  onChange={(e) => setForm((f) => ({ ...f, distanceKm: e.target.value }))}
                  required
                />
              </Field>
              <Field label="Duration (minutes)" error={errors.durationMin}>
                <input
                  className="input"
                  type="number"
                  min={10}
                  value={form.durationMin}
                  onChange={(e) => setForm((f) => ({ ...f, durationMin: e.target.value }))}
                  required
                />
              </Field>
            </div>
          ) : (
            <RouteStopsEditor
              stops={form.stops}
              onChange={(stops) => setForm((f) => ({ ...f, stops }))}
              origin={form.origin}
              destination={form.destination}
              durationMin={Number(form.durationMin) || 0}
            />
          )}

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              className="h-4 w-4 rounded border-line accent-[hsl(var(--brand))]"
            />
            Available for booking
          </label>

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
              {busy && <Spinner />} {editing ? "Save changes" : "Create route"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete this route?"
        size="sm"
      >
        <p className="text-sm leading-relaxed text-muted">
          {confirmDelete && confirmDelete._count.trips > 0
            ? `${confirmDelete.origin} – ${confirmDelete.destination} has ${confirmDelete._count.trips} departures on record. It will be deactivated rather than deleted, so the booking history stays intact.`
            : "This route has no departures and will be permanently removed."}
        </p>
        <div className="mt-5 flex gap-2">
          <button onClick={() => setConfirmDelete(null)} className="btn-secondary flex-1">
            Cancel
          </button>
          <button
            onClick={() => confirmDelete && remove(confirmDelete)}
            disabled={busy}
            className="btn-danger flex-1"
          >
            {busy && <Spinner />} Confirm
          </button>
        </div>
      </Modal>
    </>
  );
}
