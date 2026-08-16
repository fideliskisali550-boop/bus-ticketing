"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bus as BusIcon,
  Clock,
  MapPin,
  Users,
  CheckCircle2,
  PlayCircle,
  Flag,
  ScanLine,
  UserCheck,
  UserX,
} from "lucide-react";
import { api, KES } from "@/lib/client";
import { formatTime, formatDayLabel } from "@/lib/time";
import { cx, Spinner, EmptyState } from "@/components/ui";
import { useLive, LiveDot } from "@/components/live";
import { toast } from "sonner";

/**
 * What a driver or conductor works from.
 *
 * Deliberately narrow. A conductor needs the manifest for the bus in front of
 * them and nothing else; a driver needs the count and two buttons. Neither has
 * any business seeing the company's revenue, and neither wants to navigate an
 * operations console at the door of a bus with forty people waiting.
 */

type Trip = {
  id: string;
  corridor: string;
  departureAt: string;
  arrivalAt: string;
  status: string;
  seatsBooked: number;
  assignedAs: "DRIVER" | "CONDUCTOR";
  actualDepartureAt: string | null;
  actualArrivalAt: string | null;
  bus: { registration: string; model: string; capacity: number };
};

type ManifestSeat = {
  seatNumber: string;
  passengerName: string;
  passengerPhone: string;
  bookingReference: string;
  boardedAt: string | null;
  noShow: boolean;
};

type Manifest = {
  tripId: string;
  corridor: string;
  departureAt: string;
  status: string;
  bus: { registration: string; model: string; capacity: number };
  expected: number;
  boarded: number;
  noShow: number;
  seats: ManifestSeat[];
};

export function CrewBoard() {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [openTripId, setOpenTripId] = useState<string | null>(null);

  const load = useCallback((showSpinner = false) => {
    if (showSpinner) setLoading(true);
    api<{ trips: Trip[] }>("/api/crew?days=3")
      .then((d) => setTrips(d.trips))
      .catch(() => setTrips(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  // A late booking on a departure that is about to load changes the count the
  // conductor is working to.
  useLive(
    ["booking.confirmed", "booking.cancelled", "trip.cancelled", "trip.crewed", "ticket.scanned"],
    () => load(false),
    { pollMs: 60_000 },
  );

  if (loading) {
    return (
      <div className="grid place-items-center py-20">
        <Spinner className="h-6 w-6 text-brand" />
      </div>
    );
  }

  if (!trips?.length) {
    return (
      <div className="card">
        <EmptyState
          icon={<BusIcon className="h-6 w-6" aria-hidden />}
          title="Nothing rostered"
          description="You are not assigned to any departure in the next three days."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          {trips.length} departure{trips.length === 1 ? "" : "s"} rostered
        </p>
        <LiveDot />
      </div>

      {trips.map((trip) => (
        <TripCard
          key={trip.id}
          trip={trip}
          open={openTripId === trip.id}
          onToggle={() => setOpenTripId(openTripId === trip.id ? null : trip.id)}
          onChanged={() => load(false)}
        />
      ))}
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  SCHEDULED: "bg-elevated text-muted",
  BOARDING: "bg-warn/15 text-warn",
  DEPARTED: "bg-brand/12 text-brand",
  ARRIVED: "bg-ok/15 text-ok",
  CANCELLED: "bg-danger/12 text-danger",
};

function TripCard({
  trip,
  open,
  onToggle,
  onChanged,
}: {
  trip: Trip;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const isDriver = trip.assignedAs === "DRIVER";

  async function operate(action: "BOARDING" | "DEPARTED" | "ARRIVED") {
    setBusy(true);
    try {
      const result = await api<{ status: string; delayMin?: number; noShows?: number }>(
        `/api/trips/${trip.id}/operate`,
        { method: "POST", body: JSON.stringify({ action }) },
      );

      if (action === "DEPARTED") {
        const late = (result.delayMin ?? 0) > 0 ? `${result.delayMin} min late` : "on time";
        toast.success(`Departure recorded — ${late}`, {
          description: result.noShows ? `${result.noShows} seat(s) marked no-show.` : undefined,
        });
      } else if (action === "ARRIVED") {
        toast.success("Arrival recorded. The trip is complete.");
      } else {
        toast.success("Boarding open.");
      }
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card overflow-hidden">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="text-center sm:w-24">
          <p className="text-2xl font-extrabold tracking-tight text-ink">
            {formatTime(trip.departureAt)}
          </p>
          <p className="text-[11px] text-muted">{formatDayLabel(trip.departureAt)}</p>
        </div>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-bold text-ink">
            <MapPin className="h-4 w-4 shrink-0 text-brand" />
            {trip.corridor}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="flex items-center gap-1">
              <BusIcon className="h-3.5 w-3.5" /> {trip.bus.registration} · {trip.bus.model}
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" /> {trip.seatsBooked}/{trip.bus.capacity}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> arrives {formatTime(trip.arrivalAt)}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={cx("badge", STATUS_TONE[trip.status] ?? "bg-elevated text-muted")}>
            {trip.status.toLowerCase()}
          </span>
          <span className="badge bg-elevated text-muted">{trip.assignedAs.toLowerCase()}</span>

          {/* The driver owns departure and arrival; the conductor owns the
              door. Offering each only their own actions keeps the screen
              usable one-handed at a bus stage. */}
          {isDriver ? (
            <>
              {trip.status === "SCHEDULED" && (
                <button onClick={() => operate("BOARDING")} disabled={busy} className="btn-secondary">
                  <UserCheck className="h-4 w-4" /> Open boarding
                </button>
              )}
              {(trip.status === "SCHEDULED" || trip.status === "BOARDING") && (
                <button onClick={() => operate("DEPARTED")} disabled={busy} className="btn-primary">
                  <PlayCircle className="h-4 w-4" /> Depart
                </button>
              )}
              {trip.status === "DEPARTED" && (
                <button onClick={() => operate("ARRIVED")} disabled={busy} className="btn-primary">
                  <Flag className="h-4 w-4" /> Arrive
                </button>
              )}
            </>
          ) : (
            <button onClick={onToggle} className="btn-secondary" aria-expanded={open}>
              <ScanLine className="h-4 w-4" /> {open ? "Hide" : "Manifest"}
            </button>
          )}
        </div>
      </div>

      {open && <ManifestPanel tripId={trip.id} />}
    </article>
  );
}

function ManifestPanel({ tripId }: { tripId: string }) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api<Manifest>(`/api/manifest/${tripId}`)
      .then(setManifest)
      .catch(() => setManifest(null))
      .finally(() => setLoading(false));
  }, [tripId]);

  useEffect(load, [load]);
  useLive(["ticket.scanned", "booking.cancelled", "booking.confirmed"], load, { pollMs: 30_000 });

  if (loading) {
    return (
      <div className="grid place-items-center border-t border-line py-8">
        <Spinner className="h-5 w-5 text-brand" />
      </div>
    );
  }

  if (!manifest) return null;

  return (
    <div className="border-t border-line bg-elevated/40">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 text-xs">
        <span className="font-semibold text-ink">
          {manifest.boarded} of {manifest.expected} boarded
        </span>
        {manifest.noShow > 0 && (
          <span className="flex items-center gap-1 font-semibold text-danger">
            <UserX className="h-3.5 w-3.5" /> {manifest.noShow} no-show
          </span>
        )}
        <span className="ml-auto text-muted">{manifest.bus.registration}</span>
      </div>

      {manifest.seats.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted">No passengers booked yet.</p>
      ) : (
        <ol className="divide-y divide-line">
          {manifest.seats.map((seat) => (
            <li key={seat.seatNumber} className="flex items-center gap-3 px-5 py-2.5">
              <span className="grid h-8 w-9 shrink-0 place-items-center rounded-lg bg-surface text-xs font-bold text-ink">
                {seat.seatNumber}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{seat.passengerName}</p>
                <p className="text-[11px] text-muted">
                  {seat.bookingReference} · {seat.passengerPhone}
                </p>
              </div>
              {seat.boardedAt ? (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-ok">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {formatTime(seat.boardedAt)}
                </span>
              ) : seat.noShow ? (
                <span className="text-[11px] font-semibold text-danger">no-show</span>
              ) : (
                <span className="text-[11px] text-muted">waiting</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
