/**
 * Connectivity audit of the route network.
 *
 * Before building a journey planner it is worth knowing whether the graph is
 * actually connected: a pathfinder cannot invent an edge that does not exist,
 * and an isolated town would fail no matter how good the search is.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const routes = await db.route.findMany({
    where: { isActive: true },
    select: { origin: true, destination: true, durationMin: true },
  });

  const adjacency = new Map<string, Set<string>>();
  for (const r of routes) {
    if (!adjacency.has(r.origin)) adjacency.set(r.origin, new Set());
    adjacency.get(r.origin)!.add(r.destination);
  }

  const nodes = new Set<string>();
  for (const r of routes) {
    nodes.add(r.origin);
    nodes.add(r.destination);
  }

  console.log(`nodes: ${nodes.size}, directed edges: ${routes.length}`);

  /** Breadth-first search: shortest number of legs between two towns. */
  function hops(from: string, to: string) {
    if (from === to) return { legs: 0, path: [from] };
    const seen = new Set([from]);
    let frontier: { node: string; path: string[] }[] = [{ node: from, path: [from] }];

    for (let depth = 1; depth <= 6; depth++) {
      const next: typeof frontier = [];
      for (const { node, path } of frontier) {
        for (const neighbour of adjacency.get(node) ?? []) {
          if (seen.has(neighbour)) continue;
          const nextPath = [...path, neighbour];
          if (neighbour === to) return { legs: depth, path: nextPath };
          seen.add(neighbour);
          next.push({ node: neighbour, path: nextPath });
        }
      }
      frontier = next;
      if (!frontier.length) break;
    }
    return null;
  }

  console.log("\nThe searches that must work:");
  const cases: [string, string][] = [
    ["Chuka", "Bomet"],
    ["Chuka", "Kisumu"],
    ["Bomet", "Zanzibar"],
    ["Meru", "Kampala"],
    ["Eldoret", "Kigali"],
    ["Nakuru", "Bujumbura"],
  ];

  for (const [from, to] of cases) {
    const direct = adjacency.get(from)?.has(to) ?? false;
    const found = hops(from, to);
    console.log(
      `  ${(from + " -> " + to).padEnd(24)} direct=${direct ? "yes" : "no "}  ` +
        (found ? `legs=${found.legs}  ${found.path.join(" -> ")}` : "NO PATH IN GRAPH"),
    );
  }

  // Towns that nothing leaves from are unreachable as an origin.
  const noOutbound = [...nodes].filter((n) => !adjacency.has(n));
  console.log(`\ntowns with no outbound service: ${noOutbound.length}`);
  if (noOutbound.length) console.log("  ", noOutbound.slice(0, 20).join(", "));

  // How much of the network can be reached from a hub?
  const reachable = new Set(["Nairobi"]);
  let frontier = ["Nairobi"];
  while (frontier.length) {
    const next: string[] = [];
    for (const n of frontier) {
      for (const m of adjacency.get(n) ?? []) {
        if (!reachable.has(m)) {
          reachable.add(m);
          next.push(m);
        }
      }
    }
    frontier = next;
  }
  console.log(`reachable from Nairobi: ${reachable.size} of ${nodes.size}`);

  const unreachable = [...nodes].filter((n) => !reachable.has(n));
  if (unreachable.length) console.log("  unreachable:", unreachable.join(", "));
}

main().finally(() => db.$disconnect());
