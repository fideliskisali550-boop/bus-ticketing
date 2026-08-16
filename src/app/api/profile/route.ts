import { db } from "@/lib/db";
import { handler, ok, parseBody, requireUser, conflict } from "@/lib/api";
import { updateProfileSchema } from "@/lib/validation";
import { audit } from "@/lib/audit";

export async function PATCH(req: Request) {
  return handler(async () => {
    const session = await requireUser();
    const data = await parseBody(req, updateProfileSchema);

    // Phone is unique across users because it identifies the M-Pesa payer.
    if (data.phone) {
      const clash = await db.user.findFirst({
        where: { phone: data.phone, NOT: { id: session.id } },
        select: { id: true },
      });
      if (clash) throw conflict("That phone number is already in use.");
    }

    const user = await db.user.update({
      where: { id: session.id },
      data: {
        ...(data.fullName ? { fullName: data.fullName } : {}),
        ...(data.phone ? { phone: data.phone } : {}),
        ...(data.nationalId !== undefined ? { nationalId: data.nationalId || null } : {}),
      },
      select: { id: true, fullName: true, phone: true, nationalId: true },
    });

    await audit({ userId: session.id, action: "PROFILE_UPDATE", entity: "User", entityId: session.id, metadata: data, req });
    return ok({ user });
  });
}
