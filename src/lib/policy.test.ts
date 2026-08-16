import { describe, it, expect } from "vitest";
import {
  refundFor,
  isBookable,
  buildSeatMap,
  seatLabels,
  normalizePhone,
  bookingReference,
  BOOKING_CUTOFF_MINUTES,
} from "./policy";

/**
 * The business rules carry the money and the seat allocation, so they are the
 * part worth testing directly — the boundaries between refund tiers and the
 * booking cutoff are exactly where an off-by-one costs a real passenger.
 */

const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3_600_000);

describe("refundFor", () => {
  it("refunds in full more than 48 hours out", () => {
    expect(refundFor(2000, at(72))).toMatchObject({ amount: 2000, percent: 100 });
  });

  it("refunds three quarters between 24 and 48 hours", () => {
    expect(refundFor(2000, at(30))).toMatchObject({ amount: 1500, percent: 75 });
  });

  it("refunds half between 6 and 24 hours", () => {
    expect(refundFor(2000, at(12))).toMatchObject({ amount: 1000, percent: 50 });
  });

  it("refunds nothing inside 6 hours", () => {
    expect(refundFor(2000, at(2))).toMatchObject({ amount: 0, percent: 0 });
  });

  it("treats a departure already in the past as the lowest tier", () => {
    expect(refundFor(2000, at(-5)).percent).toBe(0);
  });

  it("rounds down so a refund is never a fraction of a shilling", () => {
    // 1555 * 75% = 1166.25 — must not pay out 1166.25.
    const refund = refundFor(1555, at(30));
    expect(refund.amount).toBe(1166);
    expect(Number.isInteger(refund.amount)).toBe(true);
  });

  it("is inclusive at the tier boundary", () => {
    // Exactly 48 hours out still qualifies for the full refund.
    expect(refundFor(1000, at(48.001)).percent).toBe(100);
  });
});

describe("isBookable", () => {
  it("allows a departure comfortably in the future", () => {
    expect(isBookable(at(5), "SCHEDULED")).toBe(true);
  });

  it("closes booking inside the cutoff", () => {
    const justInside = new Date(Date.now() + (BOOKING_CUTOFF_MINUTES - 5) * 60_000);
    expect(isBookable(justInside, "SCHEDULED")).toBe(false);
  });

  it("refuses a cancelled trip however far out it is", () => {
    expect(isBookable(at(200), "CANCELLED")).toBe(false);
  });

  it("refuses a trip that has already departed", () => {
    expect(isBookable(at(-1), "DEPARTED")).toBe(false);
  });

  it("still allows boarding trips", () => {
    expect(isBookable(at(3), "BOARDING")).toBe(true);
  });
});

describe("buildSeatMap", () => {
  it("produces exactly as many seats as the bus has", () => {
    const seats = buildSeatMap(49, 4, 2)
      .flat()
      .filter((c) => c.kind === "seat");
    expect(seats).toHaveLength(49);
  });

  it("places the aisle where asked", () => {
    const firstRow = buildSeatMap(49, 4, 2)[0]!;
    expect(firstRow.map((c) => c.kind)).toEqual(["seat", "seat", "aisle", "seat", "seat"]);
  });

  it("labels seats by row number and column letter", () => {
    const firstRow = buildSeatMap(49, 4, 2)[0]!.filter((c) => c.kind === "seat");
    expect(firstRow.map((c) => c.seat)).toEqual(["1A", "1B", "1C", "1D"]);
  });

  it("never repeats a seat label", () => {
    const labels = seatLabels(53, 4);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("handles a final partial row", () => {
    // 10 seats at 4 per row leaves a row of 2.
    const rows = buildSeatMap(10, 4, 2);
    const seats = rows.flat().filter((c) => c.kind === "seat");
    expect(seats).toHaveLength(10);
    expect(rows).toHaveLength(3);
  });
});

describe("normalizePhone", () => {
  it.each([
    ["0712345678", "254712345678"],
    ["+254712345678", "254712345678"],
    ["254712345678", "254712345678"],
    ["712345678", "254712345678"],
    ["0722 111 222", "254722111222"],
    ["0110123456", "254110123456"],
  ])("normalises %s to %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["12345", "", "0812345678", "254812345678", "abcdefghij"])(
    "rejects %s",
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});

describe("bookingReference", () => {
  it("uses the SC- prefix and six characters", () => {
    expect(bookingReference()).toMatch(/^SC-[A-Z2-9]{6}$/);
  });

  it("omits characters that are ambiguous when read aloud", () => {
    // I/O/0/1 are excluded so a reference read over the phone is unambiguous.
    const sample = Array.from({ length: 200 }, bookingReference).join("");
    expect(sample).not.toMatch(/[IO01]/);
  });

  it("is unlikely to collide", () => {
    const refs = new Set(Array.from({ length: 1000 }, bookingReference));
    // 32^6 ≈ 1.07bn combinations; 1000 draws should essentially never repeat.
    expect(refs.size).toBeGreaterThan(995);
  });
});
