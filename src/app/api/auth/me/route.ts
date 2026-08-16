import { db } from "@/lib/db";
import { handler, ok } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";

/**
 * The account this tab is acting as. Returns null rather than 401 when nobody
 * is signed in, because the header renders for signed-out visitors too and an
 * error would be noise rather than information.
 */
type MeResponse = {
  user:
    | (Record<string, unknown> & { id: string; sessionId: string })
    | null;
};

export async function GET() {
  return handler<MeResponse>(async () => {
    const session = await getCurrentUser();
    if (!session) return ok<MeResponse>({ user: null });

    const user = await db.user.findUnique({
      where: { id: session.id },
      select: {
        id: true, email: true, phone: true, fullName: true, role: true,
        nationalId: true, emailVerified: true, lastLoginAt: true, createdAt: true,
        _count: { select: { bookings: true } },
      },
    });

    if (!user) return ok<MeResponse>({ user: null });

    // The session id travels back so the tab can pin itself to this account.
    return ok<MeResponse>({ user: { ...user, sessionId: session.sessionId } });
  });
}
