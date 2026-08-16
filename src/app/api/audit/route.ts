import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { handler, ok, requireAdmin } from "@/lib/api";

/** Read-only view of the audit trail. Admin only — it contains every action. */
export async function GET(req: Request) {
  return handler(async () => {
    await requireAdmin();
    const q = new URL(req.url).searchParams;

    const action = q.get("action");
    const entity = q.get("entity");
    const search = q.get("search")?.trim();
    const page = Math.max(1, Number(q.get("page") ?? "1"));
    const perPage = Math.min(100, Math.max(1, Number(q.get("perPage") ?? "25")));

    const where: Prisma.AuditLogWhereInput = {
      ...(action && action !== "ALL" ? { action } : {}),
      ...(entity && entity !== "ALL" ? { entity } : {}),
      ...(search
        ? {
            OR: [
              { entityId: { contains: search } },
              { metadata: { contains: search } },
              { user: { fullName: { contains: search } } },
              { user: { email: { contains: search.toLowerCase() } } },
            ],
          }
        : {}),
    };

    const [logs, total, actions] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        include: { user: { select: { fullName: true, email: true, role: true } } },
      }),
      db.auditLog.count({ where }),
      db.auditLog.groupBy({ by: ["action"], _count: { _all: true } }),
    ]);

    return ok({
      logs,
      total,
      page,
      perPage,
      pages: Math.ceil(total / perPage),
      actions: actions.map((a) => a.action).sort(),
    });
  });
}
