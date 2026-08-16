/**
 * Route-network generation.
 *
 * The hand-written list in `routes.ts` covers the corridors worth pricing by
 * hand, but it only ever reached eleven origins — so a passenger could pick two
 * perfectly sensible towns from the autocomplete (Nakuru and Mombasa, say) and
 * be told nothing runs, because that particular pair had never been typed out.
 * No hand-maintained list scales to a real network: forty-seven counties is
 * over two thousand ordered pairs.
 *
 * So the rest of the network is derived from geography. Distances come from the
 * coordinates already seeded for every town, and fares from the distance
 * estimator. Curated corridors always win — the generator never overwrites a
 * real market fare with an estimate.
 */

import { COUNTIES, INTERNATIONAL } from "./locations";
import { ROUTES, type SeedRoute } from "./routes";
import { estimateBaseFare } from "../../src/lib/fares";

/**
 * Great-circle distance in kilometres. Roads are not straight, so the result is
 * scaled by a factor drawn from comparing known road distances against their
 * straight-line equivalents on Kenyan trunk routes (Nairobi–Mombasa is 485 km
 * by road against 440 km direct; Nairobi–Kisumu 350 against 265).
 */
const ROAD_FACTOR = 1.22;

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Average long-distance coach speed including stops, in km/h. */
const AVERAGE_SPEED_KMH = 55;
/** Border formalities add roughly this much to a cross-border journey. */
const BORDER_DELAY_MIN = 75;

type Place = {
  name: string;
  lat: number;
  lng: number;
  country: string;
  /** Bigger places anchor more of the network. */
  tier: 1 | 2 | 3;
};

/**
 * The places worth running scheduled services between. Every county capital
 * appears; the largest cities are tier 1 and act as hubs.
 */
const TIER_1 = new Set([
  "Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret",
]);

const TIER_2 = new Set([
  "Nyeri", "Meru", "Kisii", "Kakamega", "Kitale", "Machakos", "Thika",
  "Malindi", "Garissa", "Kericho", "Embu", "Bungoma", "Busia", "Migori",
  "Homa Bay", "Nanyuki", "Isiolo", "Voi", "Kilifi", "Narok", "Naivasha",
]);

/**
 * Towns that carry real long-distance traffic but are not county headquarters,
 * so they would otherwise be missing from a capitals-only list. Thika and
 * Naivasha are on the busiest corridors in the country; leaving them out is how
 * a search for Thika–Nakuru comes back empty.
 */
const EXTRA_TOWNS: { name: string; lat: number; lng: number; tier: 2 | 3 }[] = [
  { name: "Thika", lat: -1.0333, lng: 37.0693, tier: 2 },
  { name: "Naivasha", lat: -0.7167, lng: 36.4333, tier: 2 },
  { name: "Malindi", lat: -3.2192, lng: 40.1169, tier: 2 },
  { name: "Nyahururu", lat: 0.0333, lng: 36.3667, tier: 3 },
  { name: "Karatina", lat: -0.4833, lng: 37.1333, tier: 3 },
  { name: "Athi River", lat: -1.4564, lng: 36.9781, tier: 3 },
  { name: "Ruiru", lat: -1.1489, lng: 36.9586, tier: 3 },
  { name: "Mumias", lat: 0.3364, lng: 34.4881, tier: 3 },
  { name: "Webuye", lat: 0.6122, lng: 34.7708, tier: 3 },
  { name: "Kapsabet", lat: 0.2039, lng: 35.1053, tier: 3 },
  { name: "Mtito Andei", lat: -2.6889, lng: 38.1667, tier: 3 },
  { name: "Kitengela", lat: -1.4747, lng: 36.9578, tier: 3 },
  { name: "Ukunda", lat: -4.2933, lng: 39.5714, tier: 3 },
  { name: "Mariakani", lat: -3.8631, lng: 39.4711, tier: 3 },
  { name: "Molo", lat: -0.2489, lng: 35.7331, tier: 3 },
  { name: "Sotik", lat: -0.6811, lng: 35.1178, tier: 3 },
  { name: "Oyugis", lat: -0.5069, lng: 34.7300, tier: 3 },
  { name: "Maua", lat: 0.2333, lng: 37.9333, tier: 3 },
  { name: "Nkubu", lat: -0.0619, lng: 37.6603, tier: 3 },
  { name: "Emali", lat: -2.0833, lng: 37.45, tier: 3 },
];

/**
 * Which Kenyan towns run coaches to which countries.
 *
 * Cross-border services follow specific corridors: the Uganda traffic leaves
 * from the western towns, Tanzania from Nairobi and the coast, South Sudan up
 * through Turkana. A single flat list of "gateways" produced services like
 * Lodwar–Zanzibar, which is both a 26-hour drive and an island.
 */
const INTERNATIONAL_CORRIDORS: Record<string, string[]> = {
  Nairobi: ["TZ", "UG", "RW", "BI", "SS"],
  Mombasa: ["TZ"],
  Kisumu: ["UG", "RW"],
  Eldoret: ["UG", "SS"],
  Busia: ["UG"],
  Kitale: ["UG", "SS"],
  Kisii: ["TZ"],
  Lodwar: ["SS"],
  Migori: ["TZ"],
};

const INTERNATIONAL_GATEWAYS = new Set(Object.keys(INTERNATIONAL_CORRIDORS));

/**
 * Islands. No coach drives to Zanzibar — but Kenyan operators genuinely sell
 * through-tickets to it, coach to Dar es Salaam then the ferry across. So
 * rather than excluding the island (which left it unreachable in the graph and
 * any search for it a dead end), it is connected to its mainland port only.
 * The journey planner then routes to it through Dar like any other change.
 */
const ISLAND_PORTS: Record<string, string> = {
  Zanzibar: "Dar es Salaam",
};

export function buildPlaces(): Place[] {
  const places: Place[] = [];
  const seen = new Set<string>();

  const add = (p: Place) => {
    if (seen.has(p.name)) return;
    seen.add(p.name);
    places.push(p);
  };

  for (const c of COUNTIES) {
    add({
      name: c.capital,
      lat: c.lat,
      lng: c.lng,
      country: "KE",
      tier: TIER_1.has(c.capital) ? 1 : TIER_2.has(c.capital) ? 2 : 3,
    });
  }

  for (const t of EXTRA_TOWNS) {
    add({ name: t.name, lat: t.lat, lng: t.lng, country: "KE", tier: t.tier });
  }

  for (const i of INTERNATIONAL) {
    if (i.latitude == null || i.longitude == null) continue;
    add({
      name: i.name,
      lat: i.latitude,
      lng: i.longitude,
      country: i.country ?? "KE",
      // Capital cities abroad behave like hubs; other towns like tier 2.
      tier: ["Kampala", "Dar es Salaam", "Kigali", "Arusha"].includes(i.name) ? 1 : 2,
    });
  }

  return places;
}

export { INTERNATIONAL_GATEWAYS };

/** Journeys shorter than this are matatu work, not scheduled coach services. */
const MIN_KM = 45;
/** Beyond this a single coach journey stops being plausible. */
const MAX_KM = 1800;

/**
 * Decides whether a scheduled service between two places is credible.
 *
 * Hubs connect to nearly everything. Smaller towns connect to hubs and to their
 * regional neighbours, which is what a real timetable looks like — there is no
 * direct Wajir–Kilifi coach, and inventing one would be worse than admitting
 * the journey needs a change.
 */
function shouldConnect(a: Place, b: Place, km: number, nearestHubs: Map<string, Set<string>>) {
  if (km < MIN_KM || km > MAX_KM) return false;

  // An island connects to its ferry port and to nowhere else.
  const aPort = ISLAND_PORTS[a.name];
  const bPort = ISLAND_PORTS[b.name];
  if (aPort || bPort) {
    return aPort === b.name || bPort === a.name;
  }

  if (a.country !== b.country) {
    // This is a Kenyan operator. It sells Nairobi–Kampala, not Moshi–Jinja:
    // one end must be in Kenya, at a town that actually runs coaches to that
    // particular country.
    const kenyanEnd = a.country === "KE" ? a : b.country === "KE" ? b : null;
    if (!kenyanEnd) return false;

    const foreignEnd = kenyanEnd === a ? b : a;
    const served = INTERNATIONAL_CORRIDORS[kenyanEnd.name];
    if (!served?.includes(foreignEnd.country)) return false;

    return foreignEnd.tier <= 2;
  }

  // Hubs interconnect: the trunk network.
  if (a.tier === 1 && b.tier === 1) return true;

  // A hub reaches every regional centre.
  if ((a.tier === 1 && b.tier === 2) || (a.tier === 2 && b.tier === 1)) return true;

  // Neighbouring regional centres, where the journey is short enough that
  // going via a hub would be an absurd detour.
  if (a.tier === 2 && b.tier === 2) return km <= 250;

  /*
   * Smaller towns connect to their nearest interchanges and to nothing else.
   *
   * This is the correction that made connecting journeys work. Wiring every
   * town to everything within 300 km produced almost two thousand corridors,
   * which sounds like better coverage and is the opposite: spread over a fixed
   * fleet, each one could only run every other day, so a passenger arriving at
   * a change point routinely faced a forty-hour wait for the onward bus and the
   * planner could not assemble a journey at all.
   *
   * Hub-and-spoke concentrates the same services onto far fewer corridors, so
   * every one of them runs daily and connections actually connect. The graph
   * stays fully connected — the planner supplies the missing pairs by changing
   * buses, which is what it is for.
   */
  const spoke = a.tier === 3 ? a : b.tier === 3 ? b : null;
  if (spoke) {
    const anchor = spoke === a ? b : a;
    return nearestHubs.get(spoke.name)?.has(anchor.name) ?? false;
  }

  return false;
}

/**
 * The interchanges each small town is wired to.
 *
 * Every town gets its nearest regional centres *and*, unconditionally, its
 * nearest major hub. That last part matters more than it looks: ranking purely
 * by distance gave Chuka a set of small neighbours like Nanyuki and Embu, so
 * the only way out was through a town with one bus a day — and the planner
 * duly produced a Chuka–Bomet itinerary via Nanyuki with eighteen hours of
 * waiting, when the obvious route is through Nairobi.
 *
 * Connecting every town to a real hub is also what actually happens: a village
 * bus runs to the nearest city, and the long-distance network takes over there.
 */
function computeNearestHubs(places: Place[], regional = 2): Map<string, Set<string>> {
  const kenyan = places.filter((p) => p.country === "KE");
  const majorHubs = kenyan.filter((p) => p.tier === 1);
  const regionalCentres = kenyan.filter((p) => p.tier === 2);

  const distanceTo = (town: Place) => (h: Place) =>
    haversineKm({ lat: town.lat, lng: town.lng }, { lat: h.lat, lng: h.lng });

  const result = new Map<string, Set<string>>();

  for (const town of places) {
    if (town.tier !== 3 || town.country !== "KE") continue;

    const anchors = new Set<string>();

    // The two nearest regional centres — the local connection.
    regionalCentres
      .filter((h) => h.name !== town.name)
      .sort((x, y) => distanceTo(town)(x) - distanceTo(town)(y))
      .slice(0, regional)
      .forEach((h) => anchors.add(h.name));

    // Plus the nearest major hub, always, so there is a way onto the trunk
    // network without threading through a chain of villages.
    const nearestMajor = majorHubs
      .filter((h) => h.name !== town.name)
      .sort((x, y) => distanceTo(town)(x) - distanceTo(town)(y))[0];
    if (nearestMajor) anchors.add(nearestMajor.name);

    // Nairobi reaches everywhere; a town more than a few hours from any other
    // hub is still better served by the capital than by nothing.
    const nairobi = majorHubs.find((h) => h.name === "Nairobi");
    if (nairobi && distanceTo(town)(nairobi) <= 400) anchors.add("Nairobi");

    result.set(town.name, anchors);
  }

  return result;
}

export type GeneratedRoute = SeedRoute & { generated: true };

/**
 * Produces the full network: the curated corridors, plus a generated route for
 * every other credible pair. Both directions are emitted, because a timetable
 * that only runs one way is not a timetable.
 */
export function buildNetwork(): SeedRoute[] {
  const curated = new Map(ROUTES.map((r) => [`${r.origin}>${r.destination}`, r]));
  const out: SeedRoute[] = [...ROUTES];

  const places = buildPlaces();
  const nearestHubs = computeNearestHubs(places);

  for (const a of places) {
    for (const b of places) {
      if (a.name === b.name) continue;

      const key = `${a.name}>${b.name}`;
      if (curated.has(key)) continue; // a real market fare already exists

      const straight = haversineKm({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
      const km = Math.round(straight * ROAD_FACTOR);

      if (!shouldConnect(a, b, km, nearestHubs)) continue;

      const isInternational = a.country !== b.country;

      const durationMin =
        Math.round((km / AVERAGE_SPEED_KMH) * 60) + (isInternational ? BORDER_DELAY_MIN : 0);

      // Quieter corridors run less often. Frequency drives both the timetable
      // and how much booking history the seed generates for them.
      // Every generated corridor runs daily. Frequency now reflects how busy a
      // corridor is, not whether it runs at all — a route that appears only
      // every other day cannot support a connection.
      const frequency: SeedRoute["frequency"] =
        a.tier === 1 && b.tier === 1 ? "high" : a.tier <= 2 && b.tier <= 2 ? "medium" : "low";

      out.push({
        origin: a.name,
        destination: b.name,
        distanceKm: km,
        durationMin,
        baseFare: estimateBaseFare(km, isInternational),
        // Intermediate stops are only known for the curated corridors; leaving
        // this empty is honest rather than inventing a plausible-looking list.
        stops: [],
        isInternational,
        frequency,
      });
    }
  }

  return out;
}

/** Summary for the seed log, so the coverage achieved is visible. */
export function describeNetwork(routes: SeedRoute[]) {
  const origins = new Set(routes.map((r) => r.origin));
  const international = routes.filter((r) => r.isInternational).length;
  return {
    total: routes.length,
    curated: ROUTES.length,
    generated: routes.length - ROUTES.length,
    origins: origins.size,
    international,
  };
}
