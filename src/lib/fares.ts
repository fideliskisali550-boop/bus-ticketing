/**
 * Fare engine.
 *
 * The governing principle is that a fare is never invented. Every price shown
 * to a passenger derives from a route's `baseFare` — a real market rate seeded
 * from what operators actually charge on that corridor — adjusted by the
 * service class of the vehicle and any pricing rules the operator has
 * configured. Distance only enters the picture when estimating a fare for a
 * brand-new route that has no market rate yet.
 *
 * This matters because Kenyan long-distance fares are set by competition on
 * each corridor, not by a formula. Nakuru–Nairobi is ~KES 500 for 157 km while
 * a similar distance elsewhere may cost half again as much. Any pure
 * distance × rate model produces prices that look plausible to a spreadsheet
 * and obviously wrong to anyone who has actually taken the bus.
 */

export type VehicleClass = "ECONOMY" | "VIP" | "EXECUTIVE";

/**
 * Service-tier multipliers, in line with what Kenyan coach operators charge
 * for the same seat on the same corridor.
 */
export const CLASS_MULTIPLIER: Record<VehicleClass, number> = {
  ECONOMY: 1.0,
  VIP: 1.35,
  EXECUTIVE: 1.75,
};

export const CLASS_LABEL: Record<VehicleClass, string> = {
  ECONOMY: "Economy",
  VIP: "VIP",
  EXECUTIVE: "Executive",
};

/**
 * Distance bands used only to *estimate* a base fare when an operator adds a
 * route without supplying one. The rate tapers with distance because the fixed
 * costs of a journey are spread over more kilometres.
 *
 * Calibrated against known real fares:
 *   Nakuru–Nairobi     157 km → ~500   (3.2/km)
 *   Eldoret–Nairobi    310 km → ~1,100 (3.5/km)
 *   Kisumu–Nairobi     350 km → ~1,300 (3.7/km, but band gives ~1,200)
 *   Nairobi–Mombasa    485 km → ~1,700 (3.5/km)
 *   Mombasa–Kisumu     820 km → ~2,500 (3.0/km)
 */
const DISTANCE_BANDS = [
  { upToKm: 100, ratePerKm: 4.4 },
  { upToKm: 300, ratePerKm: 3.2 },
  { upToKm: 600, ratePerKm: 3.5 },
  { upToKm: Infinity, ratePerKm: 3.0 },
] as const;

/** Below this, a journey is not worth running at the per-km rate. */
const MINIMUM_FARE = 100;

/**
 * Cross-border journeys carry costs a domestic route does not: border
 * formalities, longer layovers, and operators that run higher-spec coaches on
 * these corridors. Applied as a multiplier plus a flat component, because the
 * fixed border overhead does not scale with distance.
 */
const INTERNATIONAL_MULTIPLIER = 1.25;
const INTERNATIONAL_SURCHARGE = 400;

/** Fares are quoted in round shillings; nobody prints a ticket for KES 1,247. */
export const roundFare = (amount: number) => Math.round(amount / 50) * 50;

/**
 * Estimates a market fare from distance. Used to pre-fill the fare field when
 * an operator creates a route, and as a fallback for any route seeded without
 * an explicit rate — never to override a real one.
 */
export function estimateBaseFare(distanceKm: number, isInternational = false) {
  const band = DISTANCE_BANDS.find((b) => distanceKm <= b.upToKm) ?? DISTANCE_BANDS.at(-1)!;

  let fare = distanceKm * band.ratePerKm;
  if (isInternational) fare = fare * INTERNATIONAL_MULTIPLIER + INTERNATIONAL_SURCHARGE;

  return Math.max(MINIMUM_FARE, roundFare(fare));
}

export type FareRule = {
  name: string;
  kind: "WEEKEND" | "PEAK_SEASON" | "PUBLIC_HOLIDAY" | "PROMOTION" | "OFF_PEAK";
  multiplier: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
  daysOfWeek?: number[];
  routeId?: string | null;
  isActive?: boolean;
  priority?: number;
};

export type FareBreakdown = {
  baseFare: number;
  vehicleClass: VehicleClass;
  classMultiplier: number;
  /** Rules that actually applied, for display and for the audit trail. */
  applied: { name: string; multiplier: number }[];
  total: number;
};

/** Does this rule apply to this route on this date? */
function ruleApplies(rule: FareRule, departureAt: Date, routeId?: string) {
  if (rule.isActive === false) return false;
  if (rule.routeId && rule.routeId !== routeId) return false;
  if (rule.startsAt && departureAt < rule.startsAt) return false;
  if (rule.endsAt && departureAt > rule.endsAt) return false;

  if (rule.kind === "WEEKEND") {
    // Default to Friday/Saturday/Sunday, the days Kenyan operators actually
    // load fares, unless the rule names its own days.
    const days = rule.daysOfWeek?.length ? rule.daysOfWeek : [0, 5, 6];
    if (!days.includes(departureAt.getDay())) return false;
  }

  return true;
}

/**
 * The single place a passenger-facing price is decided.
 *
 * Returns the components as well as the total so the UI can show *why* a fare
 * is what it is — "Economy · weekend loading +10%" — rather than presenting an
 * unexplained number, which is what makes pricing feel arbitrary.
 */
export function computeFare({
  baseFare,
  vehicleClass = "ECONOMY",
  departureAt,
  routeId,
  rules = [],
}: {
  baseFare: number;
  vehicleClass?: VehicleClass;
  departureAt: Date;
  routeId?: string;
  rules?: FareRule[];
}): FareBreakdown {
  const classMultiplier = CLASS_MULTIPLIER[vehicleClass];
  let total = baseFare * classMultiplier;

  const applied: { name: string; multiplier: number }[] = [];

  // Highest priority first, so a promotion can be made to outrank a surcharge.
  const ordered = [...rules]
    .filter((r) => ruleApplies(r, departureAt, routeId))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const rule of ordered) {
    total *= rule.multiplier;
    applied.push({ name: rule.name, multiplier: rule.multiplier });
  }

  return {
    baseFare,
    vehicleClass,
    classMultiplier,
    applied,
    total: Math.max(MINIMUM_FARE, roundFare(total)),
  };
}

/**
 * Sanity guard. A fare wildly out of line with the corridor's market rate is
 * almost always a data-entry slip — a fare typed in cents, or an extra zero.
 * Scheduling refuses such a fare rather than quietly publishing it, which is
 * how a KES 500 route ends up advertised at KES 8,000.
 */
export function fareLooksReasonable(fare: number, baseFare: number) {
  if (baseFare <= 0) return { ok: true as const };

  const ratio = fare / baseFare;

  // Executive class (1.75) plus a festive surcharge (1.25) tops out near 2.2,
  // so 3x the base is generous headroom for any legitimate combination.
  if (ratio > 3) {
    return {
      ok: false as const,
      reason: `KES ${fare.toLocaleString()} is more than three times this route's normal fare of KES ${baseFare.toLocaleString()}. Check the amount, or raise the route's base fare if prices have genuinely changed.`,
    };
  }

  if (ratio < 0.25) {
    return {
      ok: false as const,
      reason: `KES ${fare.toLocaleString()} is far below this route's normal fare of KES ${baseFare.toLocaleString()}. Check the amount, or lower the route's base fare if prices have genuinely changed.`,
    };
  }

  return { ok: true as const };
}
