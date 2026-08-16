"use client";

import { useCallback, useEffect, useState } from "react";
import { Banknote, Check, X, Clock, CheckCircle2 } from "lucide-react";
import { api, KES } from "@/lib/client";
import { formatDateTime } from "@/lib/time";
import { cx, Spinner, EmptyState } from "@/components/ui";
import { useLive, LiveDot } from "@/components/live";
import { toast } from "sonner";

/**
 * The finance queue.
 *
 * Refunds used to be a number written to the booking and forgotten — no money
 * ever moved and nothing was ever reviewed, so cancelled value stayed in
 * revenue for good. This is where a refund is now actually decided.
 */

type Refund = {
  id: string;
  amount: number;
  percent: number;
  reason: string | null;
  status: "REQUESTED" | "APPROVED" | "REJECTED" | "SETTLED";
  requestedAt: string;
  reviewedAt: string | null;
  settledAt: string | null;
  reviewNote: string | null;
  booking: {
    id: string;
    reference: string;
    totalAmount: number;
    user: { fullName: string; phone: string };
    trip: { departureAt: string; route: { origin: string; destination: string } };
  };
};

type Response = {
  refunds: Refund[];
  total: number;
  pending: { count: number; value: number };
};

const STATUS: Record<Refund["status"], { label: string; tone: string }> = {
  REQUESTED: { label: "Awaiting review", tone: "bg-warn/15 text-warn" },
  APPROVED: { label: "Approved", tone: "bg-brand/12 text-brand" },
  REJECTED: { label: "Rejected", tone: "bg-danger/12 text-danger" },
  SETTLED: { label: "Paid", tone: "bg-ok/15 text-ok" },
};

const FILTERS = ["REQUESTED", "SETTLED", "REJECTED", "ALL"] as const;

export function RefundsQueue() {
  const [data, setData] = useState<Response | null>(null);
  const [status, setStatus] = useState<string>("REQUESTED");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    (showSpinner = false) => {
      if (showSpinner) setLoading(true);
      api<Response>(`/api/refunds?status=${status}&perPage=50`)
        .then(setData)
        .catch(() => setData(null))
        .finally(() => setLoading(false));
    },
    [status],
  );

  useEffect(() => {
    load(true);
  }, [load]);

  useLive(["booking.cancelled", "refund.requested", "refund.settled", "trip.cancelled"], () =>
    load(false),
  );

  async function review(refundId: string, approve: boolean) {
    setBusyId(refundId);
    try {
      await api(`/api/refunds`, {
        method: "POST",
        body: JSON.stringify({ refundId, approve }),
      });
      toast.success(approve ? "Refund approved and released." : "Refund rejected.");
      load(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Refunds</h1>
          <p className="mt-1 flex items-center gap-3 text-sm text-muted">
            {data ? (
              <>
                {data.pending.count} awaiting review · {KES(data.pending.value)} outstanding
              </>
            ) : (
              "Loading…"
            )}
            <LiveDot />
          </p>
        </div>

        <div className="flex gap-1 rounded-lg bg-elevated p-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatus(f)}
              className={cx(
                "rounded-md px-3 py-1.5 text-xs font-semibold transition",
                status === f ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
              )}
            >
              {f === "ALL" ? "All" : STATUS[f as Refund["status"]].label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid place-items-center py-20">
          <Spinner className="h-6 w-6 text-brand" />
        </div>
      ) : !data?.refunds.length ? (
        <div className="card">
          <EmptyState
            icon={<CheckCircle2 className="h-6 w-6" aria-hidden />}
            title="Nothing to review"
            description="No refunds match this filter."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {data.refunds.map((refund) => (
            <article key={refund.id} className="card flex flex-col gap-4 p-5 lg:flex-row lg:items-center">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-bold text-ink">
                  {refund.booking.reference}
                  <span className={cx("badge", STATUS[refund.status].tone)}>
                    {STATUS[refund.status].label}
                  </span>
                </p>
                <p className="mt-1 text-sm text-muted">
                  {refund.booking.user.fullName} ·{" "}
                  {refund.booking.trip.route.origin} – {refund.booking.trip.route.destination}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-muted">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" /> requested {formatDateTime(refund.requestedAt)}
                  </span>
                  {refund.reason && <span>· {refund.reason}</span>}
                </p>
              </div>

              <div className="flex items-center justify-between gap-4 border-t border-line pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                <div className="lg:text-right">
                  <p className="text-xl font-extrabold text-brand">{KES(refund.amount)}</p>
                  <p className="text-[11px] text-muted">
                    {refund.percent}% of {KES(refund.booking.totalAmount)}
                  </p>
                </div>

                {refund.status === "REQUESTED" && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => review(refund.id, false)}
                      disabled={busyId === refund.id}
                      className="btn-secondary"
                    >
                      <X className="h-4 w-4" /> Reject
                    </button>
                    <button
                      onClick={() => review(refund.id, true)}
                      disabled={busyId === refund.id}
                      className="btn-primary"
                    >
                      <Check className="h-4 w-4" /> Approve
                    </button>
                  </div>
                )}

                {refund.status === "SETTLED" && refund.settledAt && (
                  <p className="flex items-center gap-1 text-[11px] font-semibold text-ok">
                    <Banknote className="h-3.5 w-3.5" /> paid {formatDateTime(refund.settledAt)}
                  </p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
