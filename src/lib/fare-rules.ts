import "server-only";
import { db } from "./db";
import type { FareRule } from "./fares";

/**
 * Loads the pricing rules currently in force.
 *
 * Rules change rarely — an operator sets a festive surcharge once and leaves it
 * — but they are needed on every fare calculation, so the set is cached briefly
 * in process. A few seconds of staleness on a promotional multiplier is a fair
 * trade for not querying the table on every scheduled departure.
 */

let cache: { rules: FareRule[]; expiresAt: number } | null = null;
const TTL_MS = 30_000;

export async function activeFareRules(routeId?: string): Promise<FareRule[]> {
  if (!cache || cache.expiresAt < Date.now()) {
    const rows = await db.fareRule.findMany({
      where: { isActive: true },
      orderBy: { priority: "desc" },
    });

    cache = {
      expiresAt: Date.now() + TTL_MS,
      rules: rows.map((r) => ({
        name: r.name,
        kind: r.kind,
        multiplier: r.multiplier,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        daysOfWeek: JSON.parse(r.daysOfWeek) as number[],
        routeId: r.routeId,
        isActive: r.isActive,
        priority: r.priority,
      })),
    };
  }

  // Network-wide rules, plus any scoped to this particular route.
  return cache.rules.filter((r) => !r.routeId || r.routeId === routeId);
}

/** Call after any write to FareRule so the next read reflects the change. */
export function invalidateFareRules() {
  cache = null;
}
