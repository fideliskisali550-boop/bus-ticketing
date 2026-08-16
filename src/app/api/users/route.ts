import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { handler, ok, parseBody, requireCapability, conflict, badRequest, forbidden } from "@/lib/api";
import { adminUserSchema } from "@/lib/validation";
import { hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { operatorScope, isOperator } from "@/lib/scope";

/** Directory listing. Staff may read it; only admins may write to it. */
export async function GET(req: Request) {
  return handler(async () => {
    const viewer = await requireCapability("MANAGE_STAFF");
    const q = new URL(req.url).searchParams;

    const search = q.get("search")?.trim();
    const role = q.get("role");
    const page = Math.max(1, Number(q.get("page") ?? "1"));
    const perPage = Math.min(100, Math.max(1, Number(q.get("perPage") ?? "20")));

    // A company admin manages their own staff and nobody else's. Passengers
    // belong to the platform, so a company never sees the passenger directory.
    const scope = operatorScope(viewer);

    const where: Prisma.UserWhereInput = {
      ...(scope ? { operatorId: scope } : {}),
      ...(role && role !== "ALL" ? { role: role as "SUPER_ADMIN" } : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search } },
              { email: { contains: search.toLowerCase() } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        // Explicit select rather than exclusion: a future column added to the
        // model cannot leak here by accident.
        select: {
          id: true, fullName: true, email: true, phone: true, role: true,
          isActive: true, emailVerified: true, lastLoginAt: true, createdAt: true,
          operatorId: true,
          operator: { select: { name: true, code: true } },
          _count: { select: { bookings: true } },
        },
      }),
      db.user.count({ where }),
    ]);

    return ok({ users, total, page, perPage, pages: Math.ceil(total / perPage) });
  });
}

export async function POST(req: Request) {
  return handler(async () => {
    const admin = await requireCapability("MANAGE_STAFF");
    const data = await parseBody(req, adminUserSchema);

    const existing = await db.user.findFirst({
      where: { OR: [{ email: data.email }, { phone: data.phone }] },
    });
    if (existing) throw conflict("A user with that email or phone number already exists.");

    // The company an account belongs to is decided by who is creating it, not
    // by the request body — otherwise a company admin could mint a user inside
    // a competitor. Operator roles get the creator's company; platform roles
    // and passengers get none, which `assertScopeInvariant` then enforces.
    const scope = operatorScope(admin);
    const operatorId = isOperator(data.role)
      ? (scope ?? data.operatorId ?? null)
      : null;

    if (isOperator(data.role) && !operatorId) {
      throw badRequest("Choose the transport company this member of staff works for.");
    }
    if (scope && !isOperator(data.role)) {
      throw forbidden("A company account cannot create platform users.");
    }

    const user = await db.user.create({
      data: {
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        role: data.role,
        operatorId,
        invitedById: admin.id,
        invitedAt: new Date(),
        passwordHash: await hashPassword(data.password),
        emailVerified: true,
      },
      select: { id: true, fullName: true, email: true, phone: true, role: true, isActive: true, createdAt: true },
    });

    await audit({
      userId: admin.id, action: "USER_CREATE", entity: "User", entityId: user.id,
      metadata: { email: data.email, role: data.role }, req,
    });

    return ok({ user }, 201);
  });
}
