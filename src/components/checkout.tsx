"use client";

import { useTabRouter, useSessionHref } from "@/components/tab-link";

import { formatDateTime } from "@/lib/time";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Smartphone,
  CreditCard,
  Banknote,
  ShieldCheck,
  Timer,
  CheckCircle2,
  XCircle,
  ArrowRight,
} from "lucide-react";
import { api, post, KES, ApiClientError } from "@/lib/client";
import { cx, Field, Spinner } from "@/components/ui";

type Booking = {
  id: string;
  reference: string;
  status: string;
  totalAmount: number;
  holdsUntil: string;
  seats: { seatNumber: string; passengerName: string }[];
  trip: {
    departureAt: string;
    fare: number;
    route: { origin: string; destination: string };
    bus: { registration: string; model: string };
  };
};

type Stage = "form" | "awaiting" | "success" | "failed";

const METHODS = [
  { id: "MPESA", label: "M-Pesa", icon: Smartphone, hint: "Pay from your phone" },
  { id: "CARD", label: "Card", icon: CreditCard, hint: "Visa or Mastercard" },
  { id: "CASH", label: "At the office", icon: Banknote, hint: "Pay before departure" },
] as const;

export function Checkout({
  booking,
  defaultPhone,
}: {
  booking: Booking;
  defaultPhone: string;
}) {
  const router = useTabRouter();
  const ticketHref = useSessionHref(`/api/tickets/${booking.id}/pdf`);

  const [stage, setStage] = useState<Stage>(
    booking.status === "CONFIRMED" ? "success" : "form",
  );
  const [method, setMethod] = useState<string>("MPESA");
  const [phone, setPhone] = useState(defaultPhone);
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState("");
  const [failure, setFailure] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(() => remaining(booking.holdsUntil));

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Countdown on the seat hold. Once it hits zero the seats are gone, so the
  // page stops offering to take money for them.
  useEffect(() => {
    if (stage === "success") return;
    const t = setInterval(() => {
      const left = remaining(booking.holdsUntil);
      setSecondsLeft(left);
      if (left <= 0) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [booking.holdsUntil, stage]);

  useEffect(() => () => void (pollRef.current && clearInterval(pollRef.current)), []);

  const expired = secondsLeft <= 0 && stage !== "success";

  async function pay() {
    setStage("awaiting");
    setFailure("");

    try {
      const res = await post<{ checkoutRequestId: string; message: string }>(
        "/api/payments/initiate",
        { bookingId: booking.id, method, phone: method === "MPESA" ? phone : undefined },
      );

      setMessage(res.message);

      // Poll until the gateway resolves. A real Daraja callback would also
      // settle this server-side; polling makes the UI work either way.
      const started = Date.now();
      pollRef.current = setInterval(async () => {
        // Give up after 90 seconds rather than spinning forever.
        if (Date.now() - started > 90_000) {
          clearInterval(pollRef.current!);
          setFailure("The payment request timed out. Please try again.");
          setStage("failed");
          return;
        }

        try {
          const status = await api<{
            status: string;
            receiptNumber?: string;
            failureReason?: string;
          }>(`/api/payments/status?checkoutRequestId=${res.checkoutRequestId}`);

          if (status.status === "SUCCESS") {
            clearInterval(pollRef.current!);
            setReceipt(status.receiptNumber ?? "");
            setStage("success");
            toast.success("Payment received");
            router.refresh();
          } else if (status.status === "FAILED") {
            clearInterval(pollRef.current!);
            setFailure(status.failureReason ?? "The payment was not completed.");
            setStage("failed");
          }
        } catch {
          // Transient network blips are ignored; the timeout above is the
          // backstop so this cannot poll indefinitely.
        }
      }, 2000);
    } catch (error) {
      setStage("failed");
      setFailure(
        error instanceof ApiClientError
          ? error.message
          : "Could not start the payment. Please try again.",
      );
    }
  }

  if (stage === "success") {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center animate-fade-up">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-ok/10 text-ok">
          <CheckCircle2 className="h-8 w-8" />
        </span>
        <h2 className="mt-5 text-2xl font-extrabold tracking-tight text-ink">
          You are booked
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Booking <span className="font-mono font-bold text-ink">{booking.reference}</span> is
          confirmed. Your ticket and boarding QR code are ready.
        </p>
        {receipt && (
          <p className="mt-3 text-xs text-muted">
            M-Pesa receipt <span className="font-mono font-semibold text-ink">{receipt}</span>
          </p>
        )}

        <div className="mt-7 flex flex-col gap-2 sm:flex-row">
          <a
            href={ticketHref}
            className="btn-secondary flex-1 py-2.5"
          >
            Download ticket
          </a>
          <button
            onClick={() => router.push(`/bookings/${booking.id}`)}
            className="btn-primary flex-1 py-2.5"
          >
            View booking <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
      <div className="card p-6">
        {expired ? (
          <div className="text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-danger/10 text-danger">
              <Timer className="h-7 w-7" />
            </span>
            <h2 className="mt-4 text-xl font-bold text-ink">Your seat hold has expired</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              The seats have been returned to the pool so other passengers can book
              them. Please start again.
            </p>
            <button
              onClick={() => router.push("/search")}
              className="btn-primary mt-6"
            >
              Search again
            </button>
          </div>
        ) : stage === "awaiting" ? (
          <div className="py-6 text-center">
            <span className="mx-auto grid h-16 w-16 animate-pulse place-items-center rounded-2xl bg-brand-soft text-brand">
              <Smartphone className="h-8 w-8" />
            </span>
            <h2 className="mt-5 text-xl font-bold text-ink">Check your phone</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
              {message || "A payment prompt has been sent to your phone."}
            </p>
            <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted">
              <Spinner /> Waiting for confirmation…
            </div>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-bold text-ink">How would you like to pay?</h2>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMethod(m.id)}
                  className={cx(
                    "rounded-card border p-4 text-left transition",
                    method === m.id
                      ? "border-brand bg-brand-soft ring-2 ring-brand/20"
                      : "border-line bg-surface hover:border-brand/40",
                  )}
                >
                  <m.icon
                    className={cx(
                      "h-5 w-5",
                      method === m.id ? "text-brand" : "text-muted",
                    )}
                  />
                  <p className="mt-2 text-sm font-bold text-ink">{m.label}</p>
                  <p className="text-xs text-muted">{m.hint}</p>
                </button>
              ))}
            </div>

            {method === "MPESA" && (
              <div className="mt-5">
                <Field
                  label="M-Pesa number"
                  hint="You will receive a prompt on this number to enter your PIN."
                >
                  <input
                    className="input"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0712 345 678"
                  />
                </Field>
              </div>
            )}

            {method === "CASH" && (
              <p className="mt-5 rounded-lg bg-warn/10 p-4 text-sm leading-relaxed text-ink">
                Your seats will be held until 30 minutes before departure. Pay at any
                SafiriConnect booking office to confirm — unpaid bookings are released.
              </p>
            )}

            {stage === "failed" && (
              <div className="mt-5 flex items-start gap-3 rounded-lg bg-danger/10 p-4">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                <div>
                  <p className="text-sm font-semibold text-danger">Payment not completed</p>
                  <p className="mt-0.5 text-sm text-ink">{failure}</p>
                </div>
              </div>
            )}

            <button onClick={pay} className="btn-primary mt-6 w-full py-3 text-base">
              Pay {KES(booking.totalAmount)}
            </button>

            <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted">
              <ShieldCheck className="h-3.5 w-3.5" />
              Payments are processed securely. We never store your PIN.
            </p>
          </>
        )}
      </div>

      {/* Order summary */}
      <aside className="card p-5 lg:sticky lg:top-20">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-ink">Your trip</h3>
          {!expired && stage !== "awaiting" && (
            <span
              className={cx(
                "badge",
                secondsLeft < 120 ? "bg-danger/12 text-danger" : "bg-warn/15 text-warn",
              )}
            >
              <Timer className="h-3 w-3" /> {formatCountdown(secondsLeft)}
            </span>
          )}
        </div>

        <p className="mt-3 text-lg font-extrabold tracking-tight text-ink">
          {booking.trip.route.origin} → {booking.trip.route.destination}
        </p>
        <p className="mt-1 text-sm text-muted">
          {formatDateTime(new Date(booking.trip.departureAt))}
        </p>
        <p className="mt-1 text-xs text-muted">
          {booking.trip.bus.model} · {booking.trip.bus.registration}
        </p>

        <div className="mt-4 space-y-2 border-t border-line pt-4">
          {booking.seats.map((s) => (
            <div key={s.seatNumber} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <span className="badge bg-brand-soft text-brand">{s.seatNumber}</span>
                <span className="truncate text-muted">{s.passengerName}</span>
              </span>
              <span className="font-semibold text-ink">{KES(booking.trip.fare)}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
          <span className="font-bold text-ink">Total</span>
          <span className="text-2xl font-extrabold text-brand">
            {KES(booking.totalAmount)}
          </span>
        </div>

        <p className="mt-3 font-mono text-xs text-muted">Ref {booking.reference}</p>
      </aside>
    </div>
  );
}

const remaining = (until: string) =>
  Math.max(0, Math.floor((new Date(until).getTime() - Date.now()) / 1000));

function formatCountdown(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
