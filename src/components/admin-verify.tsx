"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { formatDateTime, formatDateTimeFull, formatTime } from "@/lib/time";
import { toast } from "sonner";
import {
  ScanLine,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCw,
  Armchair,
  Camera,
  X,
  BadgeCheck,
  UserCheck,
  Ban,
  Undo2,
  Search,
  User as UserIcon,
} from "lucide-react";
import { api, post, ApiClientError, KES } from "@/lib/client";
import { useSession } from "@/components/session-provider";
import { Spinner, cx } from "@/components/ui";

/* ------------------------------------------------------------------ types -- */

type Detail = {
  ticketId: string;
  verificationCode: string | null;
  reference: string;
  passenger: string;
  phone: string;
  nationalId: string | null;
  avatarUrl: string | null;
  seats: { seat: string; name: string; idNo: string | null }[];
  origin: string;
  destination: string;
  route: string;
  bus: string;
  busModel: string;
  departureAt: string;
  bookingStatus: string;
  travelStatus: string;
  bookingDate: string;
  amountPaid: number;
  totalAmount: number;
  paymentStatus: string;
  verifiedAt: string | null;
  verifiedBy: string | null;
  boardedAt: string | null;
  boardedBy: string | null;
  isVerified: boolean;
  isBoarded: boolean;
};

type Match = {
  ticketId: string;
  verificationCode: string | null;
  reference: string;
  passenger: string;
  route: string;
  departureAt: string;
  bookingStatus: string;
  verified: boolean;
  boarded: boolean;
};

type Action = "verify" | "board" | "reject" | "cancel";

type LogEntry = { id: number; kind: "verified" | "boarded" | "rejected"; label: string; detail: string; at: Date };

const initialsOf = (name: string) =>
  name.split(" ").slice(0, 2).map((p) => p[0]).join("").toUpperCase();

/* ------------------------------------------------------------- component --- */

export function AdminVerify() {
  const { user } = useSession();
  const isAdmin = user?.role === "SUPER_ADMIN" || user?.role === "COMPANY_ADMIN";

  const [mode, setMode] = useState<"code" | "name">("code");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [acting, setActing] = useState<Action | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);

  // Camera scanning (optional QR convenience).
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const scanningRef = useRef(false);

  function record(kind: LogEntry["kind"], label: string, detailText: string) {
    setLog((prev) => [
      { id: nextId.current++, kind, label, detail: detailText, at: new Date() },
      ...prev.slice(0, 19),
    ]);
  }

  /* ---- lookup ---- */

  const lookup = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    setBusy(true);
    setMatches(null);
    try {
      const res = await api<{ ticket: Detail }>(`/api/verify?q=${encodeURIComponent(q)}`);
      setDetail(res.ticket);
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "Could not look that up.";
      toast.error(message);
      setDetail(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const searchByName = useCallback(async (raw: string) => {
    const name = raw.trim();
    if (name.length < 2) {
      toast.error("Type at least two letters of a name.");
      return;
    }
    setBusy(true);
    setDetail(null);
    try {
      const res = await api<{ matches: Match[] }>(`/api/verify?name=${encodeURIComponent(name)}`);
      setMatches(res.matches);
      if (res.matches.length === 0) toast.message("No passengers match that name.");
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "Could not search.";
      toast.error(message);
      setMatches(null);
    } finally {
      setBusy(false);
    }
  }, []);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "name") void searchByName(query);
    else void lookup(query);
  }

  /* ---- actions ---- */

  async function act(action: Action, override = false) {
    if (!detail) return;
    setActing(action);
    try {
      const res = await post<{ ticket: Detail; warning?: string; rejected?: boolean; cancelled?: boolean }>(
        "/api/verify",
        { ticketId: detail.ticketId, action, override },
      );
      setDetail(res.ticket);

      if (action === "verify") {
        toast.success(`${res.ticket.reference} verified.`);
        record("verified", res.ticket.reference, res.ticket.passenger);
      } else if (action === "board") {
        toast.success(`${res.ticket.passenger} boarded.`, { description: res.warning });
        record("boarded", res.ticket.reference, res.ticket.passenger);
      } else if (action === "reject") {
        toast.warning(`${res.ticket.reference} rejected.`);
        record("rejected", res.ticket.reference, res.ticket.passenger);
      } else {
        toast.success(`Verification for ${res.ticket.reference} cancelled.`);
      }
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "That did not work.";
      // A duplicate verify/board comes back as a 409; offer the admin override.
      if (error instanceof ApiClientError && error.status === 409 && isAdmin) {
        toast.error(message, {
          action: { label: "Override", onClick: () => void act(action, true) },
        });
      } else {
        toast.error(message);
      }
    } finally {
      setActing(null);
    }
  }

  /* ---- camera ---- */

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  async function startCamera() {
    setCameraError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraError("This browser can't open the camera here. Type the code instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setScanning(true);
    } catch {
      setCameraError("Couldn't open the camera — permission declined or none available. Type the code instead.");
    }
  }

  useEffect(() => {
    if (!scanning) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play().catch(() => undefined);
    scanningRef.current = true;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const tick = () => {
      if (!scanningRef.current) return;
      if (ctx && video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        if (found?.data) {
          stopCamera();
          setMode("code");
          setQuery(found.data);
          void lookup(found.data);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      scanningRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [scanning, stopCamera, lookup]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  /* ------------------------------------------------------------- render --- */

  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Ticket verification</h1>
      <p className="mt-1 text-sm text-muted">
        Look up a ticket by its verification code, booking reference or passenger name — or scan the QR.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="space-y-6">
          {/* Search card */}
          <div className="card p-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="inline-flex rounded-lg bg-elevated p-0.5 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => { setMode("code"); setMatches(null); }}
                  className={cx("rounded-md px-3 py-1.5 transition", mode === "code" ? "bg-surface text-ink shadow-card" : "text-muted")}
                >
                  Code / reference
                </button>
                <button
                  type="button"
                  onClick={() => { setMode("name"); setDetail(null); }}
                  className={cx("rounded-md px-3 py-1.5 transition", mode === "name" ? "bg-surface text-ink shadow-card" : "text-muted")}
                >
                  Passenger name
                </button>
              </div>
              {scanning ? (
                <button type="button" onClick={stopCamera} className="btn-ghost text-xs">
                  <X className="h-4 w-4" /> Stop camera
                </button>
              ) : (
                <button type="button" onClick={startCamera} className="btn-secondary text-xs">
                  <Camera className="h-4 w-4" /> Scan QR
                </button>
              )}
            </div>

            {scanning && (
              <div className="relative mb-3 overflow-hidden rounded-lg bg-black">
                <video ref={videoRef} className="mx-auto max-h-72 w-full object-contain" muted playsInline />
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <div className="h-40 w-40 rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                </div>
              </div>
            )}
            {cameraError && <p className="mb-3 text-xs font-medium text-danger">{cameraError}</p>}

            <form onSubmit={onSubmit}>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  {mode === "code" ? (
                    <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-brand" />
                  ) : (
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-brand" />
                  )}
                  <input
                    ref={inputRef}
                    className={cx("input py-3 pl-11", mode === "code" && "font-mono")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={mode === "code" ? "e.g. SC-2026-8F4K92 or SC-XXXXXX" : "Passenger name…"}
                    autoFocus
                    autoComplete="off"
                  />
                </div>
                <button disabled={busy || !query.trim()} className="btn-primary px-6">
                  {busy ? <Spinner /> : null} {mode === "code" ? "Look up" : "Search"}
                </button>
              </div>
              <p className="mt-3 text-xs text-muted">
                The verification code is on the passenger's receipt and ticket. QR scanning is optional.
              </p>
            </form>
          </div>

          {/* Name-search results */}
          {matches && matches.length > 0 && (
            <div className="card overflow-hidden">
              <p className="border-b border-line px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
                {matches.length} match{matches.length === 1 ? "" : "es"}
              </p>
              <ul className="divide-y divide-line">
                {matches.map((m) => (
                  <li key={m.ticketId}>
                    <button
                      onClick={() => { setQuery(m.verificationCode ?? m.reference); setMode("code"); void lookup(m.verificationCode ?? m.reference); }}
                      className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-elevated"
                    >
                      <UserIcon className="h-4 w-4 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">{m.passenger}</span>
                        <span className="block truncate text-[11px] text-muted">
                          {m.route} · {formatDateTime(new Date(m.departureAt))}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-muted">{m.verificationCode}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Detail + actions */}
          {detail && <DetailCard detail={detail} isAdmin={isAdmin} acting={acting} onAct={act} />}
        </div>

        {/* Session log */}
        <aside className="card lg:sticky lg:top-20">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-sm font-bold text-ink">This session</h2>
            {log.length > 0 && (
              <button onClick={() => setLog([])} className="btn-ghost text-xs" aria-label="Clear log">
                <RotateCw className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>
          {log.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">Actions will appear here.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {log.map((e) => (
                <li key={e.id} className="flex items-start gap-3 px-5 py-3">
                  {e.kind === "boarded" ? (
                    <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
                  ) : e.kind === "verified" ? (
                    <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                  ) : (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs font-bold text-ink">{e.label}</p>
                    <p className="truncate text-xs text-muted">{e.detail}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted">{formatTime(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
          {log.length > 0 && (
            <div className="border-t border-line px-5 py-3 text-xs text-muted">
              <span className="font-bold text-brand">{log.filter((l) => l.kind === "verified").length}</span> verified ·{" "}
              <span className="font-bold text-ok">{log.filter((l) => l.kind === "boarded").length}</span> boarded ·{" "}
              <span className="font-bold text-danger">{log.filter((l) => l.kind === "rejected").length}</span> rejected
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- detail --- */

function DetailCard({
  detail,
  isAdmin,
  acting,
  onAct,
}: {
  detail: Detail;
  isAdmin: boolean;
  acting: Action | null;
  onAct: (action: Action, override?: boolean) => void;
}) {
  const paid = detail.paymentStatus === "PAID";
  const state = detail.isBoarded ? "boarded" : detail.isVerified ? "verified" : "pending";

  return (
    <div
      className={cx(
        "card overflow-hidden animate-fade-up",
        state === "boarded" ? "border-ok/40" : state === "verified" ? "border-brand/40" : "border-line",
      )}
    >
      {/* Status header */}
      <div
        className={cx(
          "flex items-center gap-3 px-6 py-4",
          state === "boarded" ? "bg-ok/10" : state === "verified" ? "bg-brand/10" : "bg-elevated",
        )}
      >
        {state === "boarded" ? (
          <UserCheck className="h-6 w-6 shrink-0 text-ok" />
        ) : state === "verified" ? (
          <BadgeCheck className="h-6 w-6 shrink-0 text-brand" />
        ) : (
          <Clock className="h-6 w-6 shrink-0 text-muted" />
        )}
        <div>
          <p className={cx("font-bold", state === "boarded" ? "text-ok" : state === "verified" ? "text-brand" : "text-ink")}>
            {state === "boarded" ? "Boarded" : state === "verified" ? "Verified — ready to board" : "Not yet verified"}
          </p>
          <p className="text-xs text-muted">
            {detail.isBoarded && detail.boardedAt
              ? `Boarded ${formatTime(new Date(detail.boardedAt))}${detail.boardedBy ? ` by ${detail.boardedBy}` : ""}`
              : detail.isVerified && detail.verifiedAt
                ? `Verified ${formatTime(new Date(detail.verifiedAt))}${detail.verifiedBy ? ` by ${detail.verifiedBy}` : ""}`
                : "Confirm the passenger, then verify or board."}
          </p>
        </div>
        <span className="ml-auto text-right">
          <span className="block font-mono text-sm font-bold text-ink">{detail.verificationCode}</span>
          <span className="block font-mono text-[11px] text-muted">{detail.reference}</span>
        </span>
      </div>

      <div className="p-6">
        {/* Passenger */}
        <div className="flex items-center gap-3">
          {detail.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={detail.avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand-soft text-base font-bold text-brand">
              {initialsOf(detail.passenger)}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-lg font-extrabold tracking-tight text-ink">{detail.passenger}</p>
            <p className="text-sm text-muted">
              {detail.phone}
              {detail.nationalId ? ` · ID ${detail.nationalId}` : ""}
            </p>
          </div>
        </div>

        {/* Payment */}
        <div className={cx("mt-5 flex items-center justify-between rounded-lg px-4 py-3", paid ? "bg-ok/10" : "bg-danger/10")}>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted">Amount paid</p>
            <p className="text-lg font-extrabold text-ink">
              {KES(detail.amountPaid)}
              {detail.amountPaid !== detail.totalAmount && (
                <span className="ml-1 text-xs font-medium text-muted">of {KES(detail.totalAmount)}</span>
              )}
            </p>
          </div>
          <span className={cx("badge", paid ? "bg-ok/15 text-ok" : "bg-danger/15 text-danger")}>{detail.paymentStatus}</span>
        </div>

        {/* Journey */}
        <dl className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
          <Cell label="From">{detail.origin}</Cell>
          <Cell label="To">{detail.destination}</Cell>
          <Cell label="Bus">
            {detail.bus} <span className="font-normal text-muted">{detail.busModel}</span>
          </Cell>
          <Cell label="Departs">{formatDateTimeFull(new Date(detail.departureAt))}</Cell>
          <Cell label="Booking status">
            <span className="badge bg-elevated text-muted">{detail.bookingStatus.replace(/_/g, " ").toLowerCase()}</span>
          </Cell>
          <Cell label="Travel status">
            <span className="badge bg-elevated text-muted">{detail.travelStatus.toLowerCase()}</span>
          </Cell>
          <Cell label="Booked on">{formatDateTime(new Date(detail.bookingDate))}</Cell>
          <Cell label="Seats">
            <span className="flex flex-wrap gap-1">
              {detail.seats.map((s) => (
                <span key={s.seat} className="badge bg-brand text-white">{s.seat}</span>
              ))}
            </span>
          </Cell>
        </dl>

        {/* Manifest */}
        <div className="mt-5 border-t border-line pt-5">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            <Armchair className="h-3 w-3" /> Passengers ({detail.seats.length})
          </p>
          <ul className="space-y-1.5">
            {detail.seats.map((s) => (
              <li key={s.seat} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{s.name}</span>
                  {s.idNo && <span className="block text-[11px] text-muted">ID {s.idNo}</span>}
                </span>
                <span className="badge shrink-0 bg-brand text-white">{s.seat}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-5">
          <button
            onClick={() => onAct("verify")}
            disabled={acting !== null || (detail.isVerified && !isAdmin)}
            className="btn-secondary"
          >
            {acting === "verify" ? <Spinner /> : <BadgeCheck className="h-4 w-4" />}
            {detail.isVerified ? "Verified" : "Verify ticket"}
          </button>

          <button
            onClick={() => onAct("board")}
            disabled={acting !== null || (detail.isBoarded && !isAdmin) || detail.bookingStatus === "CANCELLED"}
            className="btn-primary"
          >
            {acting === "board" ? <Spinner /> : <UserCheck className="h-4 w-4" />}
            {detail.isBoarded ? "Boarded" : "Mark boarded"}
          </button>

          <button onClick={() => onAct("reject")} disabled={acting !== null} className="btn-ghost text-danger">
            {acting === "reject" ? <Spinner /> : <Ban className="h-4 w-4" />}
            Reject
          </button>

          {isAdmin && (detail.isVerified || detail.isBoarded) && (
            <button onClick={() => onAct("cancel")} disabled={acting !== null} className="btn-ghost ml-auto">
              {acting === "cancel" ? <Spinner /> : <Undo2 className="h-4 w-4" />}
              Cancel verification
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold text-ink">{children}</dd>
    </div>
  );
}
