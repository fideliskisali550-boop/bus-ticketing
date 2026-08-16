import { db } from "@/lib/db";
import { handler, ok, parseBody, conflict, limit, clientIp } from "@/lib/api";
import { registerSchema } from "@/lib/validation";
import { hashPassword, createSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { emit } from "@/lib/events";

export async function POST(req: Request) {
  return handler(async () => {
    limit(`register:${clientIp(req)}`, 5, 60 * 60_000);

    const data = await parseBody(req, registerSchema);

    const existing = await db.user.findFirst({
      where: { OR: [{ email: data.email }, { phone: data.phone }] },
      select: { email: true },
    });

    if (existing) {
      // Naming which field collided is a deliberate trade-off: it leaks that an
      // address is registered, but without it users cannot tell why signup
      // failed. Acceptable for a consumer booking site, unlike for a bank.
      throw conflict(
        existing.email === data.email
          ? "An account with that email already exists."
          : "An account with that phone number already exists.",
      );
    }

    // Self-registration always yields PASSENGER. Privilege is granted only by an
    // administrator through /api/users, never by anything the client can send.
    const user = await db.user.create({
      data: {
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        nationalId: data.nationalId || null,
        passwordHash: await hashPassword(data.password),
        role: "PASSENGER",
      },
      select: { id: true, email: true, fullName: true, role: true },
    });

    const sessionId = await createSession(user, {
      userAgent: req.headers.get("user-agent") ?? undefined,
      ipAddress: clientIp(req),
    });

    await emit(
      { type: "user.registered", userId: user.id, fullName: user.fullName },
      { actorId: user.id, req },
    );

    return ok({ user, sessionId }, 201);
  });
}
