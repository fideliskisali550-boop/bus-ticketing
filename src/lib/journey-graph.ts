import "server-only";
import { db } from "./db";

/**
 * The route network as a graph.
 *
 * Every town is a node and every route an edge. This exists because searching
 * only for a direct origin-to-destination route is not route discovery — it is
 * a lookup. A passenger asking for Chuka to Bomet does not care that no single
 * bus makes that run; they care that the journey is possible via Nairobi and
 * Nakuru, which it plainly is.
 *
 * The graph is small — under a hundred towns and a couple of thousand edges —
 * so it is held in memory and rebuilt occasionally rather than re-queried per
 * search. Pathfinding then costs no database round trips at all.
 */

export type Edge = {
  routeId: string;
  from: string;
  to: string;
  durationMin: number;
  distanceKm: number;
  baseFare: number;
  isInternational: boolean;
};

export type RouteGraph = {
  /** Outgoing edges by town. */
  adjacency: Map<string, Edge[]>;
  nodes: Set<string>;
  /** Towns with the most connections — the realistic places to change buses. */
  hubs: string[];
  builtAt: number;
};

let cache: RouteGraph | null = null;

/**
 * Rebuilt every few minutes. Routes change when an operator adds a corridor,
 * which is a rare administrative act, not a per-request concern.
 */
const TTL_MS = 5 * 60_000;

export async function getRouteGraph(): Promise<RouteGraph> {
  if (cache && Date.now() - cache.builtAt < TTL_MS) return cache;

  const routes = await db.route.findMany({
    where: { isActive: true },
    select: {
      id: true,
      origin: true,
      destination: true,
      durationMin: true,
      distanceKm: true,
      baseFare: true,
      isInternational: true,
    },
  });

  const adjacency = new Map<string, Edge[]>();
  const nodes = new Set<string>();

  for (const r of routes) {
    nodes.add(r.origin);
    nodes.add(r.destination);

    const edge: Edge = {
      routeId: r.id,
      from: r.origin,
      to: r.destination,
      durationMin: r.durationMin,
      distanceKm: r.distanceKm,
      baseFare: r.baseFare,
      isInternational: r.isInternational,
    };

    if (!adjacency.has(r.origin)) adjacency.set(r.origin, []);
    adjacency.get(r.origin)!.push(edge);
  }

  // Interchange towns, busiest first. Real passengers change at Nairobi or
  // Nakuru, not at a village that happens to sit between two routes, so
  // alternative itineraries are generated through these.
  const hubs = [...adjacency.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 12)
    .map(([name]) => name);

  cache = { adjacency, nodes, hubs, builtAt: Date.now() };
  return cache;
}

/** Call after any change to routes so the next search sees it. */
export function invalidateRouteGraph() {
  cache = null;
}

export type Path = {
  /** Towns in order, origin first. */
  stops: string[];
  edges: Edge[];
  /** Sum of scheduled running times, excluding waiting between buses. */
  ridingMin: number;
  distanceKm: number;
  /** Sum of the legs' base fares — the floor for what the journey can cost. */
  baseFare: number;
};

/**
 * Shortest path by riding time, using Dijkstra over the static graph.
 *
 * Weighting by duration rather than by hop count matters: the fewest-changes
 * route is often far slower than one extra change down a trunk corridor, and
 * a passenger asked to choose would take the faster one.
 */
function shortestPath(
  graph: RouteGraph,
  from: string,
  to: string,
  banned: Set<string> = new Set(),
): Path | null {
  if (from === to) return null;

  const best = new Map<string, number>([[from, 0]]);
  const previous = new Map<string, Edge>();

  // A binary heap would be asymptotically better, but with fewer than a
  // hundred nodes the linear scan is faster in practice than maintaining one.
  const unvisited = new Set<string>([from]);
  const settled = new Set<string>();

  while (unvisited.size) {
    let current: string | null = null;
    let currentCost = Infinity;
    for (const node of unvisited) {
      const cost = best.get(node) ?? Infinity;
      if (cost < currentCost) {
        current = node;
        currentCost = cost;
      }
    }
    if (current === null) break;

    unvisited.delete(current);
    settled.add(current);
    if (current === to) break;

    for (const edge of graph.adjacency.get(current) ?? []) {
      if (settled.has(edge.to)) continue;
      if (banned.has(edge.to) && edge.to !== to) continue;

      // A change of bus costs real time; charging for it stops the search
      // preferring a chain of short hops over one long ride.
      const CHANGE_PENALTY_MIN = 45;
      const cost = currentCost + edge.durationMin + (current === from ? 0 : CHANGE_PENALTY_MIN);

      if (cost < (best.get(edge.to) ?? Infinity)) {
        best.set(edge.to, cost);
        previous.set(edge.to, edge);
        unvisited.add(edge.to);
      }
    }
  }

  if (!previous.has(to) && from !== to) return null;

  const edges: Edge[] = [];
  let cursor = to;
  while (cursor !== from) {
    const edge = previous.get(cursor);
    if (!edge) return null;
    edges.unshift(edge);
    cursor = edge.from;
    if (edges.length > 8) return null; // runaway guard
  }

  return {
    stops: [from, ...edges.map((e) => e.to)],
    edges,
    ridingMin: edges.reduce((s, e) => s + e.durationMin, 0),
    distanceKm: edges.reduce((s, e) => s + e.distanceKm, 0),
    baseFare: edges.reduce((s, e) => s + e.baseFare, 0),
  };
}

/**
 * Several plausible ways to make the journey, best first.
 *
 * The fastest path comes from Dijkstra. Alternatives are found by routing
 * deliberately through each major interchange, which mirrors how a booking
 * clerk would answer the question — "you could go via Nairobi, or via Nakuru"
 * — and produces genuinely different options rather than trivial variations.
 */
export function findPaths(
  graph: RouteGraph,
  from: string,
  to: string,
  { maxTransfers = 3, limit = 4 }: { maxTransfers?: number; limit?: number } = {},
): Path[] {
  if (!graph.nodes.has(from) || !graph.nodes.has(to)) return [];

  const found: Path[] = [];
  const seen = new Set<string>();

  const consider = (path: Path | null) => {
    if (!path) return;
    if (path.edges.length - 1 > maxTransfers) return;
    const key = path.stops.join(">");
    if (seen.has(key)) return;
    seen.add(key);
    found.push(path);
  };

  consider(shortestPath(graph, from, to));

  // Route via each hub, stitching the two halves together.
  for (const hub of graph.hubs) {
    if (found.length >= limit * 3) break;
    if (hub === from || hub === to) continue;

    const first = shortestPath(graph, from, hub);
    if (!first) continue;
    const second = shortestPath(graph, hub, to);
    if (!second) continue;

    // A hub appearing twice would mean doubling back on itself.
    const stops = [...first.stops, ...second.stops.slice(1)];
    if (new Set(stops).size !== stops.length) continue;

    consider({
      stops,
      edges: [...first.edges, ...second.edges],
      ridingMin: first.ridingMin + second.ridingMin,
      distanceKm: first.distanceKm + second.distanceKm,
      baseFare: first.baseFare + second.baseFare,
    });
  }

  return found
    .sort((a, b) => {
      // Fewer changes wins when the times are close; nobody trades an hour of
      // their life to avoid one transfer, but they will trade ten minutes.
      const transferDelta = a.edges.length - b.edges.length;
      const timeDelta = a.ridingMin - b.ridingMin;
      if (Math.abs(timeDelta) < 60 && transferDelta !== 0) return transferDelta;
      return timeDelta;
    })
    .slice(0, limit);
}
