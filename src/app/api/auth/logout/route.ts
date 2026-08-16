import { handler, ok } from "@/lib/api";
import { destroySession, getCurrentUser, SESSION_HEADER } from "@/lib/auth";
import { audit } from "@/lib/audit";

/**
 * Signs out the calling tab's account only. Other tabs signed into other
 * accounts are left alone — sending `?all=true` signs out everything.
 */
export async function POST(req: Request) {
  return handler(async () => {
    const all = new URL(req.url).searchParams.get("all") === "true";
    const sessionId = req.headers.get(SESSION_HEADER) ?? undefined;

    const user = await getCurrentUser(sessionId);

    await destroySession(all ? undefined : sessionId);

    if (user) {
      await audit({
        userId: user.id,
        action: all ? "LOGOUT_ALL" : "LOGOUT",
        entity: "User",
        entityId: user.id,
        req,
      });
    }

    return ok({ success: true });
  });
}
