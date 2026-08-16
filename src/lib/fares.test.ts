import { describe, it, expect } from "vitest";
import {
  computeFare,
  estimateBaseFare,
  fareLooksReasonable,
  roundFare,
  CLASS_MULTIPLIER,
  type FareRule,
} from "./fares";

/**
 * Pricing is the part of this system a passenger will notice immediately if it
 * is wrong, so the rules that produce a fare are tested directly — including
 * the guard that stops a mistyped amount reaching the public.
 */

const monday = new Date("2026-08-03T07:00:00");
const saturday = new Date("2026-08-08T07:00:00");

describe("estimateBaseFare", () => {
  // Real corridors with known market rates. The estimator is only a fallback
  // for unpriced routes, but it should still land in the right neighbourhood.
  it.each([
    ["Nakuru–Nairobi", 157, 400, 700],
    ["Eldoret–Nairobi", 310, 900, 1400],
    ["Nairobi–Mombasa", 485, 1400, 2000],
    ["Mombasa–Kisumu", 830, 2200, 2900],
  ])("estimates %s within the real-world range", (_name, km, low, high) => {
    const fare = estimateBaseFare(km);
    expect(fare).toBeGreaterThanOrEqual(low);
    expect(fare).toBeLessThanOrEqual(high);
  });

  it("charges more for a cross-border journey of the same distance", () => {
    expect(estimateBaseFare(400, true)).toBeGreaterThan(estimateBaseFare(400, false));
  });

  it("never returns less than the minimum fare", () => {
    expect(estimateBaseFare(1)).toBeGreaterThanOrEqual(100);
  });

  it("always returns a round figure", () => {
    for (const km of [37, 88, 155, 349, 517, 941]) {
      expect(estimateBaseFare(km) % 50).toBe(0);
    }
  });
});

describe("computeFare", () => {
  it("returns the base fare for economy with no rules in force", () => {
    const fare = computeFare({ baseFare: 500, departureAt: monday });
    expect(fare.total).toBe(500);
    expect(fare.applied).toEqual([]);
  });

  it("prices VIP and Executive above Economy", () => {
    const economy = computeFare({ baseFare: 1700, vehicleClass: "ECONOMY", departureAt: monday });
    const vip = computeFare({ baseFare: 1700, vehicleClass: "VIP", departureAt: monday });
    const executive = computeFare({ baseFare: 1700, vehicleClass: "EXECUTIVE", departureAt: monday });

    expect(vip.total).toBeGreaterThan(economy.total);
    expect(executive.total).toBeGreaterThan(vip.total);
    // And in proportion to the configured multipliers.
    expect(executive.total / economy.total).toBeCloseTo(CLASS_MULTIPLIER.EXECUTIVE, 1);
  });

  const weekendRule: FareRule = {
    name: "Weekend loading",
    kind: "WEEKEND",
    multiplier: 1.1,
    daysOfWeek: [0, 5, 6],
  };

  it("applies a weekend rule on a Saturday", () => {
    const fare = computeFare({ baseFare: 1000, departureAt: saturday, rules: [weekendRule] });
    expect(fare.total).toBe(1100);
    expect(fare.applied).toHaveLength(1);
  });

  it("does not apply a weekend rule on a Monday", () => {
    const fare = computeFare({ baseFare: 1000, departureAt: monday, rules: [weekendRule] });
    expect(fare.total).toBe(1000);
    expect(fare.applied).toEqual([]);
  });

  it("ignores a rule outside its date window", () => {
    const festive: FareRule = {
      name: "Festive",
      kind: "PEAK_SEASON",
      multiplier: 1.25,
      startsAt: new Date("2026-12-15"),
      endsAt: new Date("2027-01-05"),
    };
    expect(computeFare({ baseFare: 1000, departureAt: monday, rules: [festive] }).total).toBe(1000);
    expect(
      computeFare({ baseFare: 1000, departureAt: new Date("2026-12-20"), rules: [festive] }).total,
    ).toBe(1250);
  });

  it("ignores a rule scoped to a different route", () => {
    const scoped: FareRule = {
      name: "Coast promo",
      kind: "PROMOTION",
      multiplier: 0.8,
      routeId: "route-a",
    };
    expect(computeFare({ baseFare: 1000, departureAt: monday, routeId: "route-b", rules: [scoped] }).total).toBe(1000);
    expect(computeFare({ baseFare: 1000, departureAt: monday, routeId: "route-a", rules: [scoped] }).total).toBe(800);
  });

  it("skips inactive rules", () => {
    const off: FareRule = { ...weekendRule, isActive: false };
    expect(computeFare({ baseFare: 1000, departureAt: saturday, rules: [off] }).total).toBe(1000);
  });

  it("lets a discount reduce the fare", () => {
    const promo: FareRule = { name: "Promo", kind: "PROMOTION", multiplier: 0.85 };
    expect(computeFare({ baseFare: 1000, departureAt: monday, rules: [promo] }).total).toBe(850);
  });

  it("reports which rules were applied, for display and audit", () => {
    const promo: FareRule = { name: "Promo", kind: "PROMOTION", multiplier: 0.9, priority: 1 };
    const fare = computeFare({
      baseFare: 1000,
      departureAt: saturday,
      rules: [weekendRule, promo],
    });
    expect(fare.applied.map((a) => a.name).sort()).toEqual(["Promo", "Weekend loading"]);
  });

  it("keeps a realistic fare realistic", () => {
    // The corridor the brief called out: Nakuru–Nairobi must stay near 500,
    // never balloon into the thousands.
    const fare = computeFare({ baseFare: 500, departureAt: saturday, rules: [weekendRule] });
    expect(fare.total).toBeLessThan(700);
  });
});

describe("fareLooksReasonable", () => {
  it("accepts a fare in line with the corridor", () => {
    expect(fareLooksReasonable(550, 500).ok).toBe(true);
    expect(fareLooksReasonable(875, 500).ok).toBe(true); // executive class
  });

  it("rejects the mistyped-zero case", () => {
    // The exact failure the brief described: KES 8,000 on a KES 500 route.
    const result = fareLooksReasonable(8000, 500);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("three times");
  });

  it("rejects an implausibly low fare", () => {
    expect(fareLooksReasonable(50, 1700).ok).toBe(false);
  });

  it("does not divide by zero on an unpriced route", () => {
    expect(fareLooksReasonable(500, 0).ok).toBe(true);
  });
});

describe("roundFare", () => {
  it("rounds to the nearest 50 shillings", () => {
    expect(roundFare(1247)).toBe(1250);
    expect(roundFare(1224)).toBe(1200);
    expect(roundFare(500)).toBe(500);
  });
});
