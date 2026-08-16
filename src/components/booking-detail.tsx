"use client";

import { useTabRouter, useSessionHref } from "@/components/tab-link";

import { formatDate, formatDateTimeFull, formatTime } from "@/lib/time";
import { useState } from "react";
import { toast } from "sonner";
import {
  Download,
  XCircle,
  QrCode,
  Clock,
  MapPin,
  Bus,
  User,
  CreditCard,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { post, KES, ApiClientError } from "@/lib/client";
import { Modal, StatusBadge, Spinner, Field } from "@/components/ui";

type Booking = {
  id: string;
  reference: string;
  verificationCode: string | null;
  status: string;
  totalAmount: number;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  refundAmount: number | null;
  refundPreview: { amount: number; percent: number; tier: string } | null;
  seats: {
    seatNumber: string;
    passengerName: string;
    passengerPhone: string;
  }[];
  payments: {
    method: string;
    status: string;
    amount: number;
    receiptNumber: string | null;
    completedAt: string | null;
  }[];
  ticket: { checkedInAt: string | null } | null;
  user: { fullName: string; email: string; phone: string };
  trip: {
    departureAt: string;
    arrivalAt: string;
    fare: number;
    status: string;
    route: {
      origin: string;
      destination: string;
      distanceKm: number;
      stops: string[];
    };
    bus: { registration: string; model: string };
    driver: { fullName: string } | null;
  };
};

export function BookingDetail({
  booking,
  qrDataUrl,
}: {
  booking: Booking;
  qrDataUrl: string | null;
}) {
  const router = useTabRouter();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ticketHref = useSessionHref(`/api/tickets/${booking.id}/pdf`);

  const departed = new Date(booking.trip.departureAt) < new Date();
  const canCancel =
    !departed && ["PENDING", "CONFIRMED"].includes(booking.status);
  const canPay = booking.status === "PENDING" && !departed;

  async function cancel() {
    setBusy(true);
    try {
      const res = await post<{ refund: { amount: number } }>(
        `/api/bookings/${booking.id}/cancel`,
        { reason },
      );
      toast.success(
        res.refund.amount > 0
          ? `Cancelled. A refund of ${KES(res.refund.amount)} is on its way.`
          : "Booking cancelled.",
      );
      setCancelOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not cancel.",
      );
    } finally {
      setBusy(false);
    }
  }

  const payment = booking.payments[0];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
      {/* Ticket */}
      <div className="space-y-6">
        <div className="card overflow-hidden">
          {/* Ticket header — the perforated-stub look reads instantly as a
              travel document rather than a generic data card. */}
          <div className="relative bg-brand px-6 py-5 text-white">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-widest text-white/60">
                  Verification code
                </p>
                <p className="mt-1 font-mono text-2xl font-extrabold tracking-tight">
                  {booking.verificationCode ?? booking.reference}
                </p>
                <p className="mt-1 text-xs text-white/70">
                  Booking ref{" "}
                  <span className="font-mono font-semibold text-white/90">{booking.reference}</span>
                </p>
              </div>
              <StatusBadge status={booking.status} />
            </div>
          </div>

          <div className="relative border-b border-dashed border-line">
            {/* Notches on either side of the perforation. */}
            <span className="absolute -left-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-bg" />
            <span className="absolute -right-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-bg" />
          </div>

          <div className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-6">
              <div>
                <p className="text-3xl font-extrabold tracking-tight text-ink">
                  {booking.trip.route.origin}
                </p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  Departs{" "}
                  {formatTime(new Date(booking.trip.departureAt))}
                </p>
              </div>

              <ArrowRight className="h-5 w-5 shrink-0 text-muted" />

              <div className="text-right">
                <p className="text-3xl font-extrabold tracking-tight text-ink">
                  {booking.trip.route.destination}
                </p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  Arrives{" "}
                  {formatTime(new Date(booking.trip.arrivalAt))}
                </p>
              </div>
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-5 sm:grid-cols-4">
              <Cell
                icon={Clock}
                label="Travel date"
                value={formatDate(new Date(booking.trip.departureAt))}
              />
              <Cell icon={Bus} label="Bus" value={booking.trip.bus.registration} />
              <Cell
                icon={MapPin}
                label="Distance"
                value={`${booking.trip.route.distanceKm} km`}
              />
              <Cell
                icon={User}
                label="Driver"
                value={booking.trip.driver?.fullName ?? "To be assigned"}
              />
            </dl>

            {booking.trip.route.stops.length > 0 && (
              <p className="mt-5 border-t border-line pt-4 text-xs text-muted">
                <span className="font-semibold text-ink">Stops:</span>{" "}
                {booking.trip.route.stops.join(" · ")}
              </p>
            )}
          </div>
        </div>

        {/* Passengers. A cancelled booking has had its seat rows deleted so the
            seats could go back on sale, which would otherwise render as an
            empty "Passengers (0)" table that reads as a bug rather than as a
            released booking. */}
        <div className="card overflow-hidden">
          <h2 className="border-b border-line px-5 py-4 font-bold text-ink">
            Passengers ({booking.seats.length})
          </h2>
          {booking.seats.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">
              {booking.status === "CANCELLED"
                ? "The seats on this booking were released when it was cancelled."
                : "No seats on this booking."}
            </p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {booking.seats.map((s) => (
                  <tr key={s.seatNumber}>
                    <td className="w-16 px-5 py-3">
                      <span className="badge bg-brand text-white">{s.seatNumber}</span>
                    </td>
                    <td className="px-2 py-3 font-medium text-ink">{s.passengerName}</td>
                    <td className="px-5 py-3 text-right text-muted">{s.passengerPhone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Payment */}
        {payment && (
          <div className="card p-5">
            <h2 className="flex items-center gap-2 font-bold text-ink">
              <CreditCard className="h-4 w-4 text-brand" /> Payment
            </h2>
            <dl className="mt-4 grid gap-3 sm:grid-cols-4">
              <Cell label="Method" value={payment.method} />
              <Cell label="Status" value={payment.status} />
              <Cell label="Receipt" value={payment.receiptNumber ?? "—"} mono />
              <Cell label="Amount" value={KES(payment.amount)} />
            </dl>
          </div>
        )}

        {booking.status === "CANCELLED" && (
          <div className="card border-danger/30 bg-danger/5 p-5">
            <h2 className="flex items-center gap-2 font-bold text-danger">
              <AlertTriangle className="h-4 w-4" /> Cancelled
            </h2>
            <p className="mt-2 text-sm text-ink">
              {booking.cancelReason ?? "This booking was cancelled."}
            </p>
            {booking.refundAmount != null && booking.refundAmount > 0 && (
              <p className="mt-1 text-sm text-muted">
                Refund of{" "}
                <span className="font-bold text-ink">{KES(booking.refundAmount)}</span>{" "}
                will reach your M-Pesa within 3 working days.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Actions rail */}
      <aside className="space-y-4 lg:sticky lg:top-20">
        {qrDataUrl && booking.status !== "CANCELLED" && (
          <div className="card p-5 text-center">
            <h2 className="flex items-center justify-center gap-2 text-sm font-bold text-ink">
              <QrCode className="h-4 w-4 text-brand" /> Boarding code
            </h2>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt={`Boarding QR code for booking ${booking.reference}`}
              className="mx-auto mt-4 h-44 w-44 rounded-lg bg-white p-2"
            />
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Show this to the conductor at boarding. Arrive 30 minutes early.
            </p>
            {booking.ticket?.checkedInAt && (
              <p className="mt-3 badge mx-auto bg-ok/12 text-ok">
                Checked in{" "}
                {formatTime(new Date(booking.ticket.checkedInAt))}
              </p>
            )}
          </div>
        )}

        <div className="card p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Total paid</span>
            <span className="text-2xl font-extrabold text-brand">
              {KES(booking.totalAmount)}
            </span>
          </div>

          <div className="mt-5 space-y-2">
            {canPay && (
              <a href={`/checkout/${booking.id}`} className="btn-primary w-full py-2.5">
                Complete payment
              </a>
            )}

            {booking.status !== "CANCELLED" && booking.ticket && (
              <a
                href={ticketHref}
                className="btn-secondary w-full py-2.5"
              >
                <Download className="h-4 w-4" /> Download ticket
              </a>
            )}

            {canCancel && (
              <button
                onClick={() => setCancelOpen(true)}
                className="btn-ghost w-full py-2.5 text-danger hover:bg-danger/10"
              >
                <XCircle className="h-4 w-4" /> Cancel booking
              </button>
            )}
          </div>

          {canCancel && booking.refundPreview && (
            <p className="mt-4 rounded-lg bg-elevated p-3 text-xs leading-relaxed text-muted">
              Cancelling now refunds{" "}
              <span className="font-bold text-ink">
                {KES(booking.refundPreview.amount)}
              </span>{" "}
              ({booking.refundPreview.percent}%) — {booking.refundPreview.tier}.
            </p>
          )}
        </div>

        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink">Booked by</h2>
          <p className="mt-2 text-sm font-medium text-ink">{booking.user.fullName}</p>
          <p className="text-xs text-muted">{booking.user.email}</p>
          <p className="text-xs text-muted">{booking.user.phone}</p>
          <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
            Booked{" "}
            {formatDateTimeFull(new Date(booking.createdAt))}
          </p>
        </div>
      </aside>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this booking?"
        description="This releases your seats and cannot be undone."
        size="sm"
      >
        {booking.refundPreview && (
          <div className="rounded-lg bg-elevated p-4">
            <p className="text-sm text-muted">You will be refunded</p>
            <p className="mt-1 text-2xl font-extrabold text-ink">
              {KES(booking.refundPreview.amount)}
            </p>
            <p className="mt-1 text-xs text-muted">
              {booking.refundPreview.percent}% — {booking.refundPreview.tier}
            </p>
          </div>
        )}

        <div className="mt-4">
          <Field label="Reason (optional)">
            <textarea
              className="input min-h-20 resize-y"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Tell us why you are cancelling"
              maxLength={300}
            />
          </Field>
        </div>

        <div className="mt-5 flex gap-2">
          <button onClick={() => setCancelOpen(false)} className="btn-secondary flex-1">
            Keep booking
          </button>
          <button onClick={cancel} disabled={busy} className="btn-danger flex-1">
            {busy && <Spinner />} Cancel booking
          </button>
        </div>
      </Modal>
    </div>
  );
}

function Cell({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon?: typeof Clock;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {Icon && <Icon className="h-3 w-3" />} {label}
      </dt>
      <dd
        className={`mt-1 truncate text-sm font-bold text-ink ${mono ? "font-mono" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
