import { db } from "@/lib/db";
import { handler, ok, parseBody, requireCapability } from "@/lib/api";
import { reviewRefund } from "@/lib/refunds";
import { operatorScope } from "@/lib/scope";
import { z } from "zod";

/**
 * The finance queue.
 *
 * Deliberately separate from the booking endpoints: a finance officer approves
 * money movements but cannot alter the booking that justified one. Somebody
 * able to do both could write off a fare and then edit away the evidence.
 */

export async function GET(req: Request) {
  return handler(async () => {
    const user = await requireCapability("VIEW_FINANCE", req);
    const q = new URL(req.url).searchParams;
    const status = q.get("status");
    const page = Math.max(1, Number(q.get("page") ?? "1"));
    const perPage = Math.min(100, Math.max(1, Number(q.get("perPage") ?? "20")));

    const scope = operatorScope(user);

    const where = {
      ...(status && status !== "ALL"
        ? { status: status as "REQUESTED" }
        : {}),
      ...(scope ? { booking: { trip: { bus: { operatorId: scope } } } } : {}),
    };

    const [refunds, total, pending] = await Promise.all([
      db.refund.findMany({
        where,
        orderBy: { requestedAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          amount: true,
          percent: true,
          reason: true,
          status: true,
          requestedAt: true,
          reviewedAt: true,
          settledAt: true,
          reviewNote: true,
          booking: {
            select: {
              id: true,
              reference: true,
              totalAmount: true,
              user: { select: { fullName: true, phone: true } },
              trip: {
                select: {
                  departureAt: true,
                  route: { select: { origin: true, destination: true } },
                },
              },
            },
          },
        },
      }),
      db.refund.count({ where }),
      db.refund.aggregate({
        where: { ...where, status: "REQUESTED" },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return ok({
      refunds,
      total,
      page,
      perPage,
      pages: Math.ceil(total / perPage),
      pending: { count: pending._count, value: pending._sum.amount ?? 0 },
    });
  });
}

const reviewSchema = z.object({
  refundId: z.string().min(1),
  approve: z.boolean(),
  note: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  return handler(async () => {
    const user = await requireCapability("APPROVE_REFUNDS", req);
    const { refundId, approve, note } = await parseBody(req, reviewSchema);

    const refund = await reviewRefund({ refundId, approve, note, reviewer: user, req });
    return ok({ refund });
  });
}
