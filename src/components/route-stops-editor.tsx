"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, MapPin, Plus, Trash2, Flag } from "lucide-react";
import { cx } from "@/components/ui";
import type { RouteStop } from "@/lib/stops";

/**
 * The ordered stop list for a route.
 *
 * A corridor is not two endpoints; it is a sequence of stages, each with a time
 * the bus is due and a rule about who may get on or off there. Set-down-only
 * stops are ordinary on Kenyan long-distance routes — the bus will drop you at
 * Mtito Andei but will not sell you a seat from there — and a timetable that
 * cannot say so will sell somebody a ticket they cannot use.
 *
 * Order is the thing being edited, so the control is a list with explicit
 * move-up and move-down buttons rather than drag-and-drop: dragging is fiddly
 * on a laptop trackpad, impossible to reach by keyboard without extra work, and
 * this list is rarely longer than a dozen rows.
 */
export function RouteStopsEditor({
  stops,
  onChange,
  origin,
  destination,
  durationMin,
}: {
  stops: RouteStop[];
  onChange: (stops: RouteStop[]) => void;
  origin: string;
  destination: string;
  durationMin: number;
}) {
  const [name, setName] = useState("");

  const add = () => {
    const value = name.trim();
    if (!value) return;
    // A repeated stage almost always means a mistyped duplicate rather than a
    // route that genuinely calls twice.
    if (stops.some((s) => s.name.toLowerCase() === value.toLowerCase())) return;
    onChange([...stops, { name: value, offsetMin: null, pickup: true, dropoff: true }]);
    setName("");
  };

  const update = (index: number, patch: Partial<RouteStop>) =>
    onChange(stops.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= stops.length) return;
    const next = [...stops];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  const remove = (index: number) => onChange(stops.filter((_, i) => i !== index));

  return (
    <div className="space-y-3">
      {/* Origin and destination are shown as fixed anchors so the middle of the
          list reads as a journey rather than as a bare set of names. */}
      <Anchor icon={<MapPin className="h-3.5 w-3.5" />} label={origin || "Origin"} caption="Departs" />

      {stops.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-muted">
          No intermediate stops — this runs direct.
        </p>
      ) : (
        <ol className="space-y-2">
          {stops.map((stop, i) => (
            <li key={`${stop.name}-${i}`} className="rounded-lg border border-line bg-elevated/40 p-3">
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-soft text-[11px] font-bold text-brand">
                  {i + 1}
                </span>

                <input
                  className="input h-9 flex-1 py-1"
                  value={stop.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  aria-label={`Stop ${i + 1} name`}
                />

                <div className="flex shrink-0">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    className="btn-ghost p-1.5 disabled:opacity-25"
                    aria-label={`Move ${stop.name} earlier`}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === stops.length - 1}
                    className="btn-ghost p-1.5 disabled:opacity-25"
                    aria-label={`Move ${stop.name} later`}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="btn-ghost p-1.5 text-danger hover:bg-danger/10"
                    aria-label={`Remove ${stop.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 pl-8">
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <span>Due after</span>
                  <input
                    type="number"
                    min={0}
                    max={durationMin || undefined}
                    // Empty means "not timed yet" rather than "due at minute
                    // zero", so the field maps null to an empty string.
                    value={stop.offsetMin ?? ""}
                    onChange={(e) =>
                      update(i, {
                        offsetMin: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    className="input h-8 w-20 py-1 text-xs"
                    placeholder="—"
                    aria-label={`Minutes from departure to ${stop.name}`}
                  />
                  <span>min</span>
                </label>

                <Toggle
                  label="Picks up"
                  checked={stop.pickup}
                  onChange={(v) => update(i, { pickup: v })}
                />
                <Toggle
                  label="Sets down"
                  checked={stop.dropoff}
                  onChange={(v) => update(i, { dropoff: v })}
                />

                {!stop.pickup && !stop.dropoff && (
                  <span className="text-[11px] font-semibold text-warn">
                    Passes through without stopping
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      <Anchor
        icon={<Flag className="h-3.5 w-3.5" />}
        label={destination || "Destination"}
        caption="Arrives"
      />

      <div className="flex gap-2 pt-1">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Otherwise Enter submits the surrounding form instead of adding.
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add a stop, e.g. Voi"
          aria-label="New stop name"
        />
        <button type="button" onClick={add} className="btn-secondary shrink-0">
          <Plus className="h-4 w-4" /> Add stop
        </button>
      </div>
    </div>
  );
}

function Anchor({
  icon,
  label,
  caption,
}: {
  icon: React.ReactNode;
  label: string;
  caption: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-brand-soft/60 px-3 py-2">
      <span className="text-brand">{icon}</span>
      <span className="text-sm font-bold text-ink">{label}</span>
      <span className="ml-auto text-[11px] uppercase tracking-wide text-muted">{caption}</span>
    </div>
  );
}

/** A compact switch; the native checkbox stays for keyboard and screen readers. */
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cx(
          "relative h-4 w-7 rounded-full transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-1",
          checked ? "bg-brand" : "bg-line",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all",
            checked ? "left-3.5" : "left-0.5",
          )}
        />
      </span>
      {label}
    </label>
  );
}
