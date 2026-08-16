"use client";

import { useTabRouter } from "@/components/tab-link";
import { useLive } from "@/components/live";

import { formatDateLong, formatTime } from "@/lib/time";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Armchair,
  ArrowRight,
  Wifi,
  Zap,
  Snowflake,
  Bath,
  Clock,
  MapPin,
  RotateCw,
  UserRound,
} from "lucide-react";
import { api, post, KES, ApiClientError } from "@/lib/client";
import { cx, Field, Spinner } from "@/components/ui";

type SeatCell = { seat: string; kind: "seat" | "aisle" };

type TripDetail = {
  id: string;
  departureAt: string;
  arrivalAt: string;
  fare: number;
  capacity: number;
  seatsAvailable: number;
  bookable: boolean;
  driverName: string | null;
  route: {
    origin: string;
    destination: string;
    distanceKm: number;
    durationMin: number;
    stops: string[];
  };
  bus: {
    registration: string;
    model: string;
    hasWifi: boolean;
    hasChargingPorts: boolean;
    hasToilet: boolean;
    hasAirCon: boolean;
  };
};

type Payload = { trip: TripDetail; seatMap: SeatCell[][]; takenSeats: string[] };

type Passenger = { seatNumber: string; passengerName: string; passengerPhone: string };

const MAX_SEATS = 6;

export function SeatPicker({
  tripId,
  signedIn,
  defaultName,
  defaultPhone,
}: {
  tripId: string;
  signedIn: boolean;
  defaultName: string;
  defaultPhone: string;
}) {
  const router = useTabRouter();

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [passengers, setPassengers] = useState<Record<string, Passenger>>({});
  const [submitting, setSubmitting] = useState(false);

  async function load(quiet = false) {
    if (!quiet) setLoading(true);
    try {
      const payload = await api<Payload>(`/api/trips/${tripId}`);
      setData(payload);

      // Drop any selection that someone else has taken while we were choosing.
      setSelected((prev) => {
        const lost = prev.filter((s) => payload.takenSeats.includes(s));
        if (lost.length) {
          toast.warning(
            `Seat ${lost.join(", ")} was just taken. Please choose another.`,
          );
        }
        return prev.filter((s) => !payload.takenSeats.includes(s));
      });
    } catch {
      toast.error("Could not load this trip.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  // Somebody else taking a seat on this departure is exactly the case a seat
  // map must not miss. The poll stays as a floor: a stale seat map sends the
  // passenger into a booking that is bound to fail.
  useLive(
    ["booking.created", "booking.confirmed", "booking.cancelled", "booking.expired"],
    () => load(true),
    { pollMs: 20_000 },
  );

  function toggleSeat(seat: string) {
    if (!data || data.takenSeats.includes(seat)) return;

    setSelected((prev) => {
      if (prev.includes(seat)) {
        setPassengers((p) => {
          const next = { ...p };
          delete next[seat];
          return next;
        });
        return prev.filter((s) => s !== seat);
      }

      if (prev.length >= MAX_SEATS) {
        toast.error(`You can book at most ${MAX_SEATS} seats at a time.`);
        return prev;
      }

      // Pre-fill the first passenger with the account holder's details — the
      // common case is booking for yourself.
      setPassengers((p) => ({
        ...p,
        [seat]: {
          seatNumber: seat,
          passengerName: prev.length === 0 ? defaultName : "",
          passengerPhone: prev.length === 0 ? defaultPhone : "",
        },
      }));

      return [...prev, seat];
    });
  }

  async function submit() {
    if (!signedIn) {
      router.push(`/login?next=/trips/${tripId}`);
      return;
    }
    if (selected.length === 0) return;

    const seats = selected.map((s) => passengers[s]!);
    const incomplete = seats.find((s) => !s.passengerName.trim() || !s.passengerPhone.trim());
    if (incomplete) {
      toast.error(`Enter the passenger name and phone for seat ${incomplete.seatNumber}.`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await post<{ booking: { id: string } }>("/api/bookings", {
        tripId,
        seats,
      });
      router.push(`/checkout/${res.booking.id}`);
    } catch (error) {
      if (error instanceof ApiClientError) {
        toast.error(error.message);
        // A 409 means someone beat us to a seat; refresh so the map shows it.
        if (error.status === 409) load(true);
      } else {
        toast.error("Could not reserve those seats. Please try again.");
      }
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="skeleton h-[540px] rounded-card" />
        <div className="skeleton h-80 rounded-card" />
      </div>
    );
  }

  if (!data) return null;

  const { trip, seatMap, takenSeats } = data;
  const total = trip.fare * selected.length;

  const amenities = [
    trip.bus.hasWifi && { icon: Wifi, label: "Wi-Fi" },
    trip.bus.hasChargingPorts && { icon: Zap, label: "Charging ports" },
    trip.bus.hasAirCon && { icon: Snowflake, label: "Air conditioning" },
    trip.bus.hasToilet && { icon: Bath, label: "Onboard toilet" },
  ].filter(Boolean) as { icon: typeof Wifi; label: string }[];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px] lg:items-start">
      {/* Seat map */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-bold text-ink">Choose your seats</h2>
            <p className="text-xs text-muted">
              {trip.seatsAvailable} of {trip.capacity} seats available
            </p>
          </div>
          <button onClick={() => load()} className="btn-ghost text-xs">
            <RotateCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        <div className="px-5 py-6">
          <Legend />

          <div className="mt-6 overflow-x-auto">
            <div className="mx-auto w-fit rounded-2xl border-2 border-line bg-elevated p-4 sm:p-6">
              {/* Driver row orients the passenger — front of the bus is up. */}
              <div className="mb-5 flex items-center justify-between border-b border-dashed border-line pb-4">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <UserRound className="h-3.5 w-3.5" /> Driver
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Front
                </span>
              </div>

              <div className="space-y-2">
                {seatMap.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-right text-[10px] font-semibold text-muted">
                      {i + 1}
                    </span>
                    {row.map((cell, j) =>
                      cell.kind === "aisle" ? (
                        <span key={`a${j}`} className="w-5 sm:w-7" aria-hidden />
                      ) : (
                        <Seat
                          key={cell.seat}
                          seat={cell.seat}
                          taken={takenSeats.includes(cell.seat)}
                          selected={selected.includes(cell.seat)}
                          onClick={() => toggleSeat(cell.seat)}
                        />
                      ),
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Summary rail */}
      <aside className="space-y-4 lg:sticky lg:top-20">
        <div className="card p-5">
          <p className="text-lg font-extrabold tracking-tight text-ink">
            {trip.route.origin} → {trip.route.destination}
          </p>
          <p className="mt-1 text-sm text-muted">
            {formatDateLong(new Date(trip.departureAt))}
          </p>

          <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
            <Row
              icon={Clock}
              label="Departs"
              value={formatTime(new Date(trip.departureAt))}
            />
            <Row
              icon={MapPin}
              label="Arrives"
              value={formatTime(new Date(trip.arrivalAt))}
            />
            <Row icon={Armchair} label="Bus" value={`${trip.bus.model} · ${trip.bus.registration}`} />
          </dl>

          {amenities.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
              {amenities.map((a) => (
                <span key={a.label} className="badge bg-brand-soft text-brand">
                  <a.icon className="h-3 w-3" /> {a.label}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h3 className="font-bold text-ink">
            Your selection
            {selected.length > 0 && (
              <span className="ml-2 text-sm font-semibold text-muted">
                {selected.length} seat{selected.length === 1 ? "" : "s"}
              </span>
            )}
          </h3>

          {selected.length === 0 ? (
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Tap a seat on the map to select it. You can book up to {MAX_SEATS} seats
              in one go.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {selected.map((seat, i) => (
                <div key={seat} className="rounded-lg border border-line p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="badge bg-brand text-white">Seat {seat}</span>
                    <button
                      onClick={() => toggleSeat(seat)}
                      className="text-xs font-semibold text-danger hover:underline"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="space-y-2">
                    <Field label={`Passenger ${i + 1} name`}>
                      <input
                        className="input"
                        value={passengers[seat]?.passengerName ?? ""}
                        onChange={(e) =>
                          setPassengers((p) => ({
                            ...p,
                            [seat]: { ...p[seat]!, passengerName: e.target.value },
                          }))
                        }
                        placeholder="Full name"
                      />
                    </Field>
                    <Field label="Phone number">
                      <input
                        className="input"
                        value={passengers[seat]?.passengerPhone ?? ""}
                        onChange={(e) =>
                          setPassengers((p) => ({
                            ...p,
                            [seat]: { ...p[seat]!, passengerPhone: e.target.value },
                          }))
                        }
                        placeholder="0712 345 678"
                      />
                    </Field>
                  </div>
                </div>
              ))}

              <dl className="space-y-1.5 border-t border-line pt-4 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">
                    {KES(trip.fare)} × {selected.length}
                  </dt>
                  <dd className="font-semibold text-ink">{KES(total)}</dd>
                </div>
                <div className="flex justify-between border-t border-line pt-2">
                  <dt className="font-bold text-ink">Total</dt>
                  <dd className="text-xl font-extrabold text-brand">{KES(total)}</dd>
                </div>
              </dl>
            </div>
          )}

          <button
            onClick={submit}
            disabled={selected.length === 0 || submitting || !trip.bookable}
            className="btn-primary mt-5 w-full py-2.5"
          >
            {submitting ? <Spinner /> : null}
            {!trip.bookable
              ? "Booking closed"
              : signedIn
                ? "Continue to payment"
                : "Sign in to book"}
            {!submitting && trip.bookable && <ArrowRight className="h-4 w-4" />}
          </button>

          <p className="mt-3 text-center text-xs leading-relaxed text-muted">
            Seats are held for 15 minutes while you complete payment.
          </p>
        </div>
      </aside>
    </div>
  );
}

function Seat({
  seat,
  taken,
  selected,
  onClick,
}: {
  seat: string;
  taken: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={taken}
      aria-label={`Seat ${seat}${taken ? ", unavailable" : selected ? ", selected" : ", available"}`}
      aria-pressed={selected}
      className={cx(
        "grid h-9 w-9 shrink-0 place-items-center rounded-lg border text-[11px] font-bold transition sm:h-11 sm:w-11 sm:text-xs",
        taken
          ? "cursor-not-allowed border-line bg-line/60 text-muted/50 line-through"
          : selected
            ? "border-brand bg-brand text-white shadow-sm scale-105"
            : "border-line bg-surface text-ink hover:-translate-y-0.5 hover:border-brand hover:text-brand",
      )}
    >
      {seat}
    </button>
  );
}

function Legend() {
  const items = [
    { className: "border-line bg-surface", label: "Available" },
    { className: "border-brand bg-brand", label: "Selected" },
    { className: "border-line bg-line/60", label: "Taken" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-4">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-2 text-xs text-muted">
          <span className={cx("h-4 w-4 rounded border", i.className)} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-muted">
        <Icon className="h-3.5 w-3.5" /> {label}
      </dt>
      <dd className="truncate text-right font-semibold text-ink">{value}</dd>
    </div>
  );
}
