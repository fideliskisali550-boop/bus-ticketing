import { db } from "@/lib/db";
import { handler, ok, requireUser } from "@/lib/api";

export async function GET(req: Request) {
  return handler(async () => {
    const user = await requireUser();
    const unreadOnly = new URL(req.url).searchParams.get("unread") === "true";

    const [notifications, unread] = await Promise.all([
      db.notification.findMany({
        where: { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      db.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);

    return ok({ notifications, unread });
  });
}

/** Marks one notification read, or all of them when no id is supplied. */
export async function PATCH(req: Request) {
  return handler(async () => {
    const user = await requireUser();
    const { id } = (await req.json().catch(() => ({}))) as { id?: string };

    await db.notification.updateMany({
      // Scoped to the caller so a guessed id cannot mark someone else's read.
      where: { userId: user.id, readAt: null, ...(id ? { id } : {}) },
      data: { readAt: new Date() },
    });

    return ok({ success: true });
  });
}
