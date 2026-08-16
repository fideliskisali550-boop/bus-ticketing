import { db } from "@/lib/db";
import { handler, ok, parseBody, requireUser, badRequest } from "@/lib/api";
import { changePasswordSchema } from "@/lib/validation";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST(req: Request) {
  return handler(async () => {
    const session = await requireUser();
    const { currentPassword, newPassword } = await parseBody(req, changePasswordSchema);

    const user = await db.user.findUniqueOrThrow({ where: { id: session.id } });

    // Requiring the current password stops an attacker with a hijacked session
    // from locking the real owner out of their account.
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw badRequest("Your current password is incorrect.");
    }

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });

    // Changing a password revokes every other session, which is the whole point
    // of doing it after a suspected compromise.
    await db.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await audit({ userId: user.id, action: "PASSWORD_CHANGE", entity: "User", entityId: user.id, req });
    return ok({ success: true });
  });
}
