import { db } from "@/lib/db";
import { handler, ok, parseBody, limit, clientIp, ApiError } from "@/lib/api";
import { loginSchema } from "@/lib/validation";
import {
  verifyPassword,
  createSession,
  MAX_FAILED_LOGINS,
  LOCKOUT_MINUTES,
} from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST(req: Request) {
  return handler(async () => {
    // Two layers: per-IP throttling here, per-account lockout below. The first
    // slows a botnet spraying many accounts; the second stops a focused attack
    // on one account from a rotating address pool.
    limit(`login:${clientIp(req)}`, 10, 15 * 60_000);

    const { email, password } = await parseBody(req, loginSchema);

    const user = await db.user.findUnique({ where: { email } });

    // One message for "no such user" and "wrong password" so the endpoint
    // cannot be used to enumerate which addresses hold accounts.
    const invalid = new ApiError(401, "Incorrect email or password.");

    if (!user) {
      // Hash a throwaway value anyway: returning instantly for unknown users
      // and slowly for known ones is a timing oracle that leaks the same thing
      // the shared message is hiding.
      await verifyPassword(password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
      throw invalid;
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new ApiError(
        423,
        `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      );
    }

    if (!user.isActive) {
      throw new ApiError(403, "This account has been deactivated. Contact support.");
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      const failed = user.failedLogins + 1;
      await db.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed,
          lockedUntil:
            failed >= MAX_FAILED_LOGINS
              ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
              : null,
        },
      });
      await audit({ userId: user.id, action: "LOGIN_FAILED", entity: "User", entityId: user.id, req });
      throw invalid;
    }

    await db.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const session = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    };

    // The tab stores this id and sends it back on every request, so signing in
    // here does not change which account the other tabs are using.
    const sessionId = await createSession(session, {
      userAgent: req.headers.get("user-agent") ?? undefined,
      ipAddress: clientIp(req),
    });

    await audit({ userId: user.id, action: "LOGIN", entity: "User", entityId: user.id, req });

    return ok({ user: session, sessionId });
  });
}
