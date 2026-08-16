import { db } from "@/lib/db";
import { handler, ok, parseBody, requireCapability, conflict } from "@/lib/api";
import { busSchema } from "@/lib/validation";
import { audit } from "@/lib/audit";
import { busScope, operatorScope } from "@/lib/scope";

export async function GET(req: Request) {
  return handler(async () => {
    const viewer = await requireCapability("MANAGE_FLEET");
    const q = new URL(req.url).searchParams;
    const search = q.get("search")?.trim();
    const status = q.get("status");

    const buses = await db.bus.findMany({
      where: {
        // A company sees its own vehicles and no others.
        ...busScope(viewer),
        ...(status && status !== "ALL" ? { status: status as "ACTIVE" } : {}),
        ...(search
          ? { OR: [{ registration: { contains: search.toUpperCase() } }, { model: { contains: search } }] }
          : {}),
      },
      orderBy: { registration: "asc" },
      include: { _count: { select: { trips: true } } },
    });

    return ok({ buses });
  });
}

export async function POST(req: Request) {
  return handler(async () => {
    const user = await requireCapability("MANAGE_FLEET");
    const data = await parseBody(req, busSchema);

    const existing = await db.bus.findUnique({ where: { registration: data.registration } });
    if (existing) throw conflict(`${data.registration} is already on the fleet.`);

    // A bus added by company staff belongs to that company, whatever the body
    // says; only the platform may place a vehicle with a named operator.
    const scope = operatorScope(user);
    const bus = await db.bus.create({
      data: { ...data, operatorId: scope },
    });
    await audit({ userId: user.id, action: "BUS_CREATE", entity: "Bus", entityId: bus.id, metadata: data, req });
    return ok({ bus }, 201);
  });
}
