"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X, ChevronLeft, ChevronRight, Inbox, Loader2 } from "lucide-react";

/** Small, dependency-free primitives shared across the app. */

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

/* -------------------------------------------------------------------------- */

const STATUS_STYLES: Record<string, string> = {
  CONFIRMED: "bg-ok/12 text-ok",
  COMPLETED: "bg-ok/12 text-ok",
  CHECKED_IN: "bg-brand/12 text-brand",
  PENDING: "bg-warn/15 text-warn",
  INITIATED: "bg-warn/15 text-warn",
  SUCCESS: "bg-ok/12 text-ok",
  SCHEDULED: "bg-brand/12 text-brand",
  BOARDING: "bg-accent/15 text-accent",
  DEPARTED: "bg-muted/15 text-muted",
  ARRIVED: "bg-muted/15 text-muted",
  ACTIVE: "bg-ok/12 text-ok",
  MAINTENANCE: "bg-warn/15 text-warn",
  RETIRED: "bg-muted/15 text-muted",
  CANCELLED: "bg-danger/12 text-danger",
  EXPIRED: "bg-danger/12 text-danger",
  FAILED: "bg-danger/12 text-danger",
  REFUNDED: "bg-accent/15 text-accent",
  ADMIN: "bg-brand/12 text-brand",
  STAFF: "bg-accent/15 text-accent",
  PASSENGER: "bg-muted/15 text-muted",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cx("badge", STATUS_STYLES[status] ?? "bg-muted/15 text-muted")}>
      {status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <Loader2 className={cx("animate-spin", className)} aria-hidden />;
}

/**
 * `icon` takes a rendered element, not a component function. A component
 * function cannot cross the server/client boundary — React can serialise
 * elements but not the functions that produce them — and this is rendered from
 * server components as well as client ones.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="rounded-full bg-brand-soft p-4 text-brand">
        {icon ?? <Inbox className="h-6 w-6" aria-hidden />}
      </div>
      <div>
        <p className="font-semibold text-ink">{title}</p>
        {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-line" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-4">
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className="skeleton h-4"
              style={{ width: `${[22, 18, 26, 14, 12, 16][c % 6]}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Accessible modal: traps nothing fancy, but restores focus, closes on Escape
 * and on backdrop click, and locks body scroll while open.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  // Held in a ref so the setup effect below can depend on `open` alone. Callers
  // almost always pass `onClose` as an inline arrow, so a new identity arrives
  // on every parent render — and this dialog's parent re-renders on every
  // keystroke in a field inside it. If the effect depended on `onClose` it
  // would re-run on each character and yank focus back to the first control,
  // which is the close button: type one letter, land on the X.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement as HTMLElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);

    // Focus the first thing a person would actually type into, not whatever
    // happens to come first in the DOM — the close button sits in the header
    // and would otherwise steal it. Fall back to the panel itself so screen
    // readers still announce the dialog when it holds no field.
    const focusTarget =
      panel.current?.querySelector<HTMLElement>("input, select, textarea") ??
      panel.current;
    focusTarget?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      restoreTo.current?.focus();
    };
    // Runs only when the dialog opens or closes — never on a parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const widths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl" };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          "relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-surface shadow-lift animate-fade-up sm:rounded-card",
          widths[size],
        )}
      >
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-line bg-surface/95 px-5 py-4 backdrop-blur">
          <div>
            <h2 className="text-base font-bold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <button onClick={onClose} className="btn-ghost -mr-2 p-2" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function Pagination({
  page,
  pages,
  total,
  perPage,
  onChange,
}: {
  page: number;
  pages: number;
  total: number;
  perPage: number;
  onChange: (page: number) => void;
}) {
  if (pages <= 1) return null;

  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  // Show a sliding window of five pages so the control stays the same width
  // whether there are three pages or three hundred.
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const window = Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
      <p className="text-xs text-muted">
        Showing <span className="font-semibold text-ink">{from}</span>–
        <span className="font-semibold text-ink">{to}</span> of{" "}
        <span className="font-semibold text-ink">{total.toLocaleString()}</span>
      </p>
      <div className="flex items-center gap-1">
        <button
          className="btn-ghost p-2"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {window.map((p) => (
          <button
            key={p}
            onClick={() => onChange(p)}
            aria-current={p === page ? "page" : undefined}
            className={cx(
              "min-w-9 rounded-lg px-3 py-1.5 text-sm font-semibold transition",
              p === page ? "bg-brand text-white" : "text-muted hover:bg-elevated hover:text-ink",
            )}
          >
            {p}
          </button>
        ))}
        <button
          className="btn-ghost p-2"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Debounced text input — avoids firing a request on every keystroke. */
export function useDebounced<T>(value: T, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/* -------------------------------------------------------------------------- */

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {error ? (
        <p className="mt-1 text-xs font-medium text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Tabs for a record editor.
 *
 * A route carries more than fits comfortably in one column — endpoints,
 * timings, the stop list, pricing — and stacking it all in a single scrolling
 * form buries the part somebody opened the dialog to change. Splitting it by
 * subject means the stop list gets the room it needs without pushing the fare
 * field off the bottom of the screen.
 *
 * Controlled on purpose: the parent owns which tab is showing, so validation
 * can jump to the tab holding a failed field rather than leaving the user to
 * hunt for the error.
 */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className = "",
}: {
  tabs: { id: T; label: string; badge?: number }[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cx("flex gap-1 overflow-x-auto border-b border-line", className)}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={cx(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold transition",
              selected
                ? "border-brand text-brand"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span
                className={cx(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                  selected ? "bg-brand-soft text-brand" : "bg-elevated text-muted",
                )}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
