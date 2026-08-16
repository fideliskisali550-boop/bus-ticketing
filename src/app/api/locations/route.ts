import { db } from "@/lib/db";
import { handler, ok } from "@/lib/api";

/**
 * The place catalogue, for search autocomplete and route administration.
 *
 * Public and cacheable: the list of Kenyan towns changes about as often as the
 * constitution, so it is served with a long cache header rather than queried
 * afresh on every keystroke.
 */
export async function GET(req: Request) {
  return handler(async () => {
    const q = new URL(req.url).searchParams;

    const search = q.get("search")?.trim();
    const type = q.get("type");
    const country = q.get("country");
    const county = q.get("county");
    /** Only places that are actually an endpoint of some active route. */
    const bookableOnly = q.get("bookableOnly") === "true";

    if (bookableOnly) {
      // Endpoints come from the routes themselves, so autocomplete can never
      // suggest a town nothing actually serves — which would be a guaranteed
      // "no results" for anyone who picked it.
      const routes = await db.route.findMany({
        where: { isActive: true },
        select: { origin: true, destination: true },
      });

      const names = [...new Set(routes.flatMap((r) => [r.origin, r.destination]))].sort();

      return ok(
        { locations: names.map((name) => ({ name })) },
        200,
        // Endpoints shift only when an operator adds a route.
        { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" },
      );
    }

    const locations = await db.location.findMany({
      where: {
        isActive: true,
        ...(type && type !== "ALL" ? { type: type as "TOWN" } : {}),
        ...(country && country !== "ALL" ? { country } : {}),
        ...(county ? { county } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search } },
                { county: { contains: search } },
                // Aliases are a JSON array; a substring match over the raw text
                // is enough to catch "Dar" for "Dar es Salaam".
                { aliases: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: [{ country: "asc" }, { type: "asc" }, { name: "asc" }],
      take: 200,
      select: {
        id: true,
        name: true,
        type: true,
        county: true,
        country: true,
      },
    });

    return ok({ locations }, 200, {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    });
  });
}
