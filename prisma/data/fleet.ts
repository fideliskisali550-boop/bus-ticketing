/**
 * The fleet. Mixed service classes, because the fare engine derives VIP and
 * Executive prices from the route's economy base fare — so the vehicle a trip
 * is assigned to is what determines the price a passenger pays.
 */

export type SeedBus = {
  registration: string;
  model: string;
  capacity: number;
  vehicleClass: "ECONOMY" | "VIP" | "EXECUTIVE";
  wifi: boolean;
  ports: boolean;
  toilet: boolean;
};

export const BUSES: SeedBus[] = [
  // Executive — the flagship coaches on the long international corridors.
  { registration: "KDA 101A", model: "Scania Irizar i6", capacity: 41, vehicleClass: "EXECUTIVE", wifi: true, ports: true, toilet: true },
  { registration: "KDA 102B", model: "Scania Marcopolo", capacity: 43, vehicleClass: "EXECUTIVE", wifi: true, ports: true, toilet: true },
  { registration: "KDA 103C", model: "Yutong ZK6128", capacity: 45, vehicleClass: "EXECUTIVE", wifi: true, ports: true, toilet: true },

  // VIP — reclining seats, still high-spec, on the main trunk routes.
  { registration: "KDB 201A", model: "Yutong ZK6122", capacity: 49, vehicleClass: "VIP", wifi: true, ports: true, toilet: true },
  { registration: "KDB 202B", model: "Higer KLQ6119", capacity: 49, vehicleClass: "VIP", wifi: true, ports: true, toilet: false },
  { registration: "KDB 203C", model: "Zhongtong LCK6127", capacity: 51, vehicleClass: "VIP", wifi: true, ports: true, toilet: true },
  { registration: "KDB 204D", model: "Scania Higer A30", capacity: 49, vehicleClass: "VIP", wifi: true, ports: true, toilet: false },
  { registration: "KDB 205E", model: "Yutong ZK6899", capacity: 45, vehicleClass: "VIP", wifi: true, ports: false, toilet: false },

  // Economy — the workhorses on regional and short-haul services.
  { registration: "KDC 301A", model: "Isuzu FRR Deluxe", capacity: 51, vehicleClass: "ECONOMY", wifi: false, ports: true, toilet: false },
  { registration: "KDC 302B", model: "Isuzu FRR Deluxe", capacity: 51, vehicleClass: "ECONOMY", wifi: false, ports: true, toilet: false },
  { registration: "KDC 303C", model: "Isuzu NQR Coach", capacity: 33, vehicleClass: "ECONOMY", wifi: false, ports: false, toilet: false },
  { registration: "KDC 304D", model: "Isuzu NQR Coach", capacity: 33, vehicleClass: "ECONOMY", wifi: false, ports: false, toilet: false },
  { registration: "KDC 305E", model: "Yutong ZK6729", capacity: 41, vehicleClass: "ECONOMY", wifi: false, ports: true, toilet: false },
  { registration: "KDC 306F", model: "Higer KLQ6109", capacity: 45, vehicleClass: "ECONOMY", wifi: true, ports: false, toilet: false },
  { registration: "KDC 307G", model: "Isuzu FRR Deluxe", capacity: 49, vehicleClass: "ECONOMY", wifi: false, ports: false, toilet: false },
  { registration: "KDC 308H", model: "Mitsubishi Rosa", capacity: 26, vehicleClass: "ECONOMY", wifi: false, ports: false, toilet: false },
  { registration: "KDC 309J", model: "Toyota Coaster", capacity: 24, vehicleClass: "ECONOMY", wifi: false, ports: false, toilet: false },
  { registration: "KDD 401A", model: "Yutong ZK6122", capacity: 49, vehicleClass: "ECONOMY", wifi: true, ports: true, toilet: false },
  { registration: "KDD 402B", model: "Higer KLQ6119", capacity: 47, vehicleClass: "ECONOMY", wifi: false, ports: true, toilet: false },

  // One vehicle in the workshop, so the fleet screen shows a real-world state.
  { registration: "KDE 501A", model: "Isuzu FRR Deluxe", capacity: 51, vehicleClass: "ECONOMY", wifi: false, ports: false, toilet: false },
];

/**
 * Minimum journey distance at which each service class is offered.
 *
 * Premium tiers exist to make *long* journeys bearable — reclining seats and an
 * onboard toilet are worth paying for over eight hours and pointless over two.
 * No Kenyan operator runs an executive coach on the 157 km Nakuru–Nairobi hop,
 * and pricing one as though they did produces a fare that is arithmetically
 * consistent and obviously wrong to anyone who knows the route.
 */
export const MIN_DISTANCE_KM: Record<"ECONOMY" | "VIP" | "EXECUTIVE", number> = {
  ECONOMY: 0,
  VIP: 250,
  EXECUTIVE: 450,
};

/**
 * Candidate classes for a corridor, given how busy it is and how far it runs.
 * Economy always appears, so every route keeps an affordable option.
 */
export function classesFor(
  frequency: string,
  distanceKm: number,
): ("ECONOMY" | "VIP" | "EXECUTIVE")[] {
  const pool: ("ECONOMY" | "VIP" | "EXECUTIVE")[] = ["ECONOMY", "ECONOMY"];

  // Quiet corridors run a single economy service; there is not the demand to
  // justify a second tier.
  if (frequency === "low") return ["ECONOMY"];

  if (distanceKm >= MIN_DISTANCE_KM.VIP) pool.push("VIP");
  if (distanceKm >= MIN_DISTANCE_KM.EXECUTIVE && frequency === "high") pool.push("EXECUTIVE");

  return pool;
}
