import { handler, ok, badRequest } from "@/lib/api";
import { planJourneys } from "@/lib/journey-planner";
import { getRouteGraph } from "@/lib/journey-graph";

/**
 * Journey search across the route network.
 *
 * Unlike /api/trips, which answers "what runs directly between these two
 * towns", this answers the question a passenger actually asks: "how do I get
 * from here to there". If no single bus makes the run it assembles one from
 * connecting services.
 */
export async function GET(req: Request) {
  return handler(async () => {
    const q = new URL(req.url).searchParams;

    const origin = q.get("origin")?.trim();
    const destination = q.get("destination")?.trim();

    if (!origin || !destination) {
      throw badRequest("Provide both `origin` and `destination`.");
    }
    if (origin.toLowerCase() === destination.toLowerCase()) {
      throw badRequest("Origin and destination are the same place.");
    }

    const date = q.get("date");
    const minSeats = Math.min(6, Math.max(1, Number(q.get("minSeats") ?? "1")));
    const maxTransfers = Math.min(4, Math.max(0, Number(q.get("maxTransfers") ?? "3")));

    const started = Date.now();

    const plan = await planJourneys({
      origin,
      destination,
      date,
      minSeats,
      maxTransfers,
    });

    // When nothing is bookable, say which of the two situations it is: the
    // towns are not connected at all, or they are but no departure fits. Those
    // call for different advice, and collapsing them into "no results" is what
    // made the search look broken.
    let reason: string | null = null;
    if (plan.journeys.length === 0) {
      reason = plan.pathExists ? "no-departures-in-window" : "not-connected";
    } else if (plan.direct.length === 0) {
      reason = "connections-only";
    }

    const graph = await getRouteGraph();

    return ok({
      journeys: plan.journeys.slice(0, 12),
      directCount: plan.direct.length,
      connectingCount: plan.connecting.length,
      reason,
      pathExists: plan.pathExists,
      searchedFrom: plan.searchedFrom,
      searchedTo: plan.searchedTo,
      knownOrigin: graph.nodes.has(origin),
      knownDestination: graph.nodes.has(destination),
      tookMs: Date.now() - started,
    });
  });
}
