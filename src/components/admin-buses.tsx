"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Bus as BusIcon,
  Search,
  Wifi,
  Zap,
  Snowflake,
  Bath,
} from "lucide-react";
import { api, post, patch, del, ApiClientError } from "@/lib/client";
import {
  Modal,
  EmptyState,
  TableSkeleton,
  Field,
  Spinner,
  StatusBadge,
  useDebounced,
  cx,
} from "@/components/ui";

type Bus = {
  id: string;
  registration: string;
  model: string;
  capacity: number;
  seatsPerRow: number;
  aisleAfter: number;
  hasWifi: boolean;
  hasChargingPorts: boolean;
  hasToilet: boolean;
  hasAirCon: boolean;
  status: string;
  _count: { trips: number };
};

const BLANK = {
  registration: "",
  model: "",
  capacity: "49",
  seatsPerRow: "4",
  aisleAfter: "2",
  hasWifi: false,
  hasChargingPorts: false,
  hasToilet: false,
  hasAirCon: true,
  status: "ACTIVE",
};

const AMENITIES = [
  { key: "hasWifi", label: "Wi-Fi", icon: Wifi },
  { key: "hasChargingPorts", label: "Charging ports", icon: Zap },
  { key: "hasAirCon", label: "Air conditioning", icon: Snowflake },
  { key: "hasToilet", label: "Onboard toilet", icon: Bath },
] as const;

export function AdminBuses() {
  const [buses, setBuses] = useState<Bus[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [editing, setEditing] = useState<Bus | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<Bus | null>(null);

  const debounced = useDebounced(search);

  async function load(isCancelled: () => boolean = () => false) {
    if (!isCancelled()) setLoading(true);
    try {
      const q = new URLSearchParams({ status: statusFilter });
      if (debounced) q.set("search", debounced);
      const data = await api<{ buses: Bus[] }>(`/api/buses?${q}`);
      if (!isCancelled()) setBuses(data.buses);
    } catch {
      toast.error("Could not load the fleet.");
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
  }, [debounced, statusFilter]);

  function openCreate() {
    setForm(BLANK);
    setErrors({});
    setCreating(true);
  }

  function openEdit(bus: Bus) {
    setForm({
      registration: bus.registration,
      model: bus.model,
      capacity: String(bus.capacity),
      seatsPerRow: String(bus.seatsPerRow),
      aisleAfter: String(bus.aisleAfter),
      hasWifi: bus.hasWifi,
      hasChargingPorts: bus.hasChargingPorts,
      hasToilet: bus.hasToilet,
      hasAirCon: bus.hasAirCon,
      status: bus.status,
    });
    setErrors({});
    setEditing(bus);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});

    const payload = {
      ...form,
      capacity: Number(form.capacity),
      seatsPerRow: Number(form.seatsPerRow),
      aisleAfter: Number(form.aisleAfter),
    };

    try {
      if (editing) {
        await patch(`/api/buses/${editing.id}`, payload);
        toast.success("Bus updated");
      } else {
        await post("/api/buses", payload);
        toast.success("Bus added to the fleet");
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

  async function remove(bus: Bus) {
    setBusy(true);
    try {
      const res = await del<{ retired: boolean }>(`/api/buses/${bus.id}`);
      toast.success(
        res.retired
          ? "Bus retired — it has trip history, so the record was kept for reporting."
          : "Bus removed",
      );
      setConfirmDelete(null);
      load();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not remove.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Fleet</h1>
          <p className="mt-1 text-sm text-muted">
            Vehicles, capacity and onboard amenities.
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="h-4 w-4" /> Add bus
        </button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            className="input pl-9"
            placeholder="Search plate or model…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search fleet"
          />
        </div>

        <div className="flex gap-1.5">
          {["ALL", "ACTIVE", "MAINTENANCE", "RETIRED"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cx(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                statusFilter === s
                  ? "bg-brand text-white"
                  : "bg-elevated text-muted hover:text-ink",
              )}
            >
              {s === "ALL" ? "All" : s.toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="card mt-4">
          <TableSkeleton rows={5} cols={4} />
        </div>
      ) : buses.length === 0 ? (
        <div className="card mt-4">
          <EmptyState
            icon={<BusIcon className="h-6 w-6" aria-hidden />}
            title="No buses found"
            description="Add a vehicle to start scheduling departures against it."
            action={
              <button onClick={openCreate} className="btn-primary mt-2">
                Add a bus
              </button>
            }
          />
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {buses.map((bus) => (
            <div key={bus.id} className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-lg font-extrabold tracking-tight text-ink">
                    {bus.registration}
                  </p>
                  <p className="truncate text-sm text-muted">{bus.model}</p>
                </div>
                <StatusBadge status={bus.status} />
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted">
                    Capacity
                  </dt>
                  <dd className="font-bold text-ink">{bus.capacity} seats</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted">
                    Departures
                  </dt>
                  <dd className="font-bold text-ink">{bus._count.trips}</dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {AMENITIES.filter((a) => bus[a.key]).map((a) => (
                  <span key={a.key} className="badge bg-brand-soft text-brand">
                    <a.icon className="h-3 w-3" /> {a.label}
                  </span>
                ))}
              </div>

              <div className="mt-4 flex gap-2 border-t border-line pt-4">
                <button onClick={() => openEdit(bus)} className="btn-secondary flex-1 text-xs">
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                <button
                  onClick={() => setConfirmDelete(bus)}
                  className="btn-ghost px-3 text-danger hover:bg-danger/10"
                  aria-label={`Remove ${bus.registration}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={creating || Boolean(editing)}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? `Edit ${editing.registration}` : "Add a bus"}
        description="Capacity and seats per row determine the seat map passengers see."
      >
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Registration"
              error={errors.registration}
              hint="Kenyan plate format, e.g. KDA 123B."
            >
              <input
                className="input font-mono uppercase"
                value={form.registration}
                onChange={(e) =>
                  setForm((f) => ({ ...f, registration: e.target.value.toUpperCase() }))
                }
                placeholder="KDA 123B"
                required
              />
            </Field>

            <Field label="Model" error={errors.model}>
              <input
                className="input"
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                placeholder="Scania Marcopolo"
                required
              />
            </Field>

            <Field label="Capacity" error={errors.capacity}>
              <input
                className="input"
                type="number"
                min={10}
                max={80}
                value={form.capacity}
                onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
                required
              />
            </Field>

            <Field label="Seats per row" error={errors.seatsPerRow}>
              <select
                className="input"
                value={form.seatsPerRow}
                onChange={(e) => setForm((f) => ({ ...f, seatsPerRow: e.target.value }))}
              >
                <option value="2">2 (1 + 1)</option>
                <option value="3">3 (2 + 1)</option>
                <option value="4">4 (2 + 2)</option>
                <option value="5">5 (3 + 2)</option>
              </select>
            </Field>

            <Field label="Aisle after column" error={errors.aisleAfter}>
              <input
                className="input"
                type="number"
                min={1}
                max={5}
                value={form.aisleAfter}
                onChange={(e) => setForm((f) => ({ ...f, aisleAfter: e.target.value }))}
              />
            </Field>

            <Field label="Status" error={errors.status}>
              <select
                className="input"
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              >
                <option value="ACTIVE">Active</option>
                <option value="MAINTENANCE">Under maintenance</option>
                <option value="RETIRED">Retired</option>
              </select>
            </Field>
          </div>

          <div>
            <p className="label">Amenities</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {AMENITIES.map((a) => (
                <label
                  key={a.key}
                  className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-ink"
                >
                  <input
                    type="checkbox"
                    checked={form[a.key]}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, [a.key]: e.target.checked }))
                    }
                    className="h-4 w-4 rounded border-line accent-[hsl(var(--brand))]"
                  />
                  <a.icon className="h-4 w-4 text-muted" />
                  {a.label}
                </label>
              ))}
            </div>
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
              {busy && <Spinner />} {editing ? "Save changes" : "Add bus"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Remove this bus?"
        size="sm"
      >
        <p className="text-sm leading-relaxed text-muted">
          {confirmDelete && confirmDelete._count.trips > 0
            ? `${confirmDelete.registration} has run ${confirmDelete._count.trips} departures. It will be marked retired so the reporting history stays intact.`
            : "This vehicle has never been scheduled and will be permanently removed."}
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
