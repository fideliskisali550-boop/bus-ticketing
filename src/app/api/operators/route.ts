import { db } from "@/lib/db";
import { handler, ok } from "@/lib/api";

/**
 * The bus companies selling tickets on the platform. Public and cacheable —
 * the roster changes when a company joins or leaves, not per request.
 */
export async function GET() {
  return handler(async () => {
    const operators = await db.operator.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        colour: true,
        rating: true,
        tagline: true,
        _count: { select: { buses: true } },
      },
    });

    return ok({ operators }, 200, {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    });
  });
}
