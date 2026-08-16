import { db } from "@/lib/db";
import { assertSameOperator, isOperator, operatorScope } from "@/lib/scope";
import { handler, ok, parseBody, requireCapability, badRequest, notFound } from "@/lib/api";
import { updateUserSchema } from "@/lib/validation";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  return handler(async () => {
    const admin = await requireCapability("MANAGE_STAFF");
    const { id } = await params;
    const data = await parseBody(req, updateUserSchema);

    const target = await db.user.findUnique({ where: { id } });
    if (!target) throw notFound("That user could not be found.");

    // A company admin manages their own staff and nobody else's.
    assertSameOperator(admin, target.operatorId);

    // Self-demotion and self-deactivation are blocked: an administrator who
    // does either by accident locks everyone out of the back office.
    if (id === admin.id) {
      if (data.role && data.role !== admin.role) {
        throw badRequest("You cannot change your own role.");
      }
      if (data.isActive === false) {
        throw badRequest("You cannot deactivate your own account.");
      }
    }

    // Never let the last platform administrator disappear.
    const losingSuperAdmin =
      target.role === "SUPER_ADMIN" &&
      ((data.role !== undefined && data.role !== "SUPER_ADMIN") || data.isActive === false);

    if (losingSuperAdmin) {
      const remaining = await db.user.count({
        where: { role: "SUPER_ADMIN", isActive: true },
      });
      if (remaining <= 1) {
        throw badRequest("The system must retain at least one active administrator.");
      }
    }

    // Moving between planes would break the scope invariant, so a role change
    // carries the company with it: an operator role keeps the admin's company,
    // a platform role or passenger loses any company it had.
    const nextRole = data.role ?? target.role;
    const operatorId = isOperator(nextRole)
      ? (target.operatorId ?? operatorScope(admin))
      : null;

    if (isOperator(nextRole) && !operatorId) {
      throw badRequest("Choose the transport company this member of staff works for.");
    }

    const user = await db.user.update({
      where: { id },
      data: { ...data, operatorId },
      select: { id: true, fullName: true, email: true, role: true, isActive: true },
    });

    // Revoking access must end sessions already in flight, or a deactivated
    // user keeps working until their refresh token expires.
    if (data.isActive === false) {
      await db.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await audit({ userId: admin.id, action: "USER_UPDATE", entity: "User", entityId: id, metadata: data, req });
    return ok({ user });
  });
}
