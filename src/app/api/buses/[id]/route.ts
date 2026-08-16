import { db } from "@/lib/db";
import { handler, ok, parseBody, requireCapability, badRequest } from "@/lib/api";
import { busSchema } from "@/lib/validation";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  return handler(async () => {
    const user = await requireCapability("MANAGE_FLEET");
    const { id } = await params;
    const data = await parseBody(req, busSchema.partial());

    // Shrinking a bus below the seats already sold would invalidate live
    // tickets, so capacity can only be reduced when nothing is booked.
    if (data.capacity !== undefined) {
      const busiest = await db.trip.findFirst({
        where: { busId: id, departureAt: { gte: new Date() } },
        orderBy: { seatsBooked: "desc" },
        select: { seatsBooked: true },
      });
      if (busiest && data.capacity < busiest.seatsBooked) {
        throw badRequest(
          `An upcoming trip already has ${busiest.seatsBooked} seats sold. Capacity cannot be set below that.`,
        );
      }
    }

    const bus = await db.bus.update({ where: { id }, data });
    await audit({ userId: user.id, action: "BUS_UPDATE", entity: "Bus", entityId: id, metadata: data, req });
    return ok({ bus });
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return handler(async () => {
    const user = await requireCapability("MANAGE_FLEET");
    const { id } = await params;

    const scheduled = await db.trip.count({
      where: { busId: id, departureAt: { gte: new Date() }, status: { not: "CANCELLED" } },
    });
    if (scheduled > 0) {
      throw badRequest(
        `This bus has ${scheduled} upcoming trip${scheduled === 1 ? "" : "s"}. Reassign them before removing it.`,
      );
    }

    // Historic trips keep the bus row alive for reporting, so retire rather
    // than delete once the vehicle has ever carried passengers.
    const everUsed = await db.trip.count({ where: { busId: id } });
    if (everUsed > 0) {
      await db.bus.update({ where: { id }, data: { status: "RETIRED" } });
      await audit({ userId: user.id, action: "BUS_RETIRE", entity: "Bus", entityId: id, req });
      return ok({ success: true, retired: true });
    }

    await db.bus.delete({ where: { id } });
    await audit({ userId: user.id, action: "BUS_DELETE", entity: "Bus", entityId: id, req });
    return ok({ success: true, retired: false });
  });
}
