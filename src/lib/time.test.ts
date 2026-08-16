import { describe, it, expect } from "vitest";
import {
  formatTime,
  formatDateShort,
  formatSortable,
  toKenyaDateInput,
  kenyaWallClockToUtc,
  arrivesNextDay,
  KENYA_UTC_OFFSET_HOURS,
} from "./time";

/**
 * These tests exist because the bug they guard against is invisible on a
 * machine set to Kenyan time. Every assertion below is written against a fixed
 * UTC instant, so it fails if the formatting ever drifts back to using the
 * host's local zone — regardless of where the test happens to run.
 */

describe("Kenyan time formatting", () => {
  // 18:30 UTC is 21:30 in Nairobi.
  const eveningDeparture = new Date("2026-07-19T18:30:00Z");

  it("renders a departure in EAT, not the host timezone", () => {
    expect(formatTime(eveningDeparture)).toBe("21:30");
  });

  it("rolls over the date correctly near midnight EAT", () => {
    // 22:00 UTC on the 19th is 01:00 on the 20th in Nairobi.
    const lateNight = new Date("2026-07-19T22:00:00Z");
    expect(formatTime(lateNight)).toBe("01:00");
    expect(toKenyaDateInput(lateNight)).toBe("2026-07-20");
  });

  it("does not roll the date back for an early-morning UTC time", () => {
    // 04:00 UTC is 07:00 the same day in Nairobi.
    const morning = new Date("2026-07-19T04:00:00Z");
    expect(formatTime(morning)).toBe("07:00");
    expect(toKenyaDateInput(morning)).toBe("2026-07-19");
  });

  it("formats a short date in EAT", () => {
    expect(formatDateShort(eveningDeparture)).toBe("Sun 19 Jul");
  });

  it("produces a sortable timestamp", () => {
    expect(formatSortable(eveningDeparture)).toBe("2026-07-19 21:30");
  });

  it("accepts an ISO string as readily as a Date", () => {
    expect(formatTime("2026-07-19T18:30:00Z")).toBe(formatTime(eveningDeparture));
  });
});

describe("kenyaWallClockToUtc", () => {
  it("converts a Kenyan wall-clock time to the right UTC instant", () => {
    // Staff scheduling "21:00 on 19 July" means 21:00 EAT = 18:00 UTC.
    const utc = kenyaWallClockToUtc("2026-07-19", "21:00");
    expect(utc.toISOString()).toBe("2026-07-19T18:00:00.000Z");
  });

  it("handles an early-morning departure that crosses back over UTC midnight", () => {
    // 01:00 EAT on the 20th is 22:00 UTC on the 19th.
    const utc = kenyaWallClockToUtc("2026-07-20", "01:00");
    expect(utc.toISOString()).toBe("2026-07-19T22:00:00.000Z");
  });

  it("round-trips through the formatter", () => {
    for (const time of ["06:00", "11:30", "15:45", "21:00", "23:59", "00:15"]) {
      const utc = kenyaWallClockToUtc("2026-07-19", time);
      expect(formatTime(utc)).toBe(time);
    }
  });

  it("uses the documented offset", () => {
    expect(KENYA_UTC_OFFSET_HOURS).toBe(3);
  });
});

describe("arrivesNextDay", () => {
  it("detects an overnight service in Kenyan terms", () => {
    // Departs 21:00 EAT, arrives 05:00 EAT the following morning.
    const departure = kenyaWallClockToUtc("2026-07-19", "21:00");
    const arrival = kenyaWallClockToUtc("2026-07-20", "05:00");
    expect(arrivesNextDay(departure, arrival)).toBe(true);
  });

  it("does not flag a same-day journey", () => {
    const departure = kenyaWallClockToUtc("2026-07-19", "07:00");
    const arrival = kenyaWallClockToUtc("2026-07-19", "15:00");
    expect(arrivesNextDay(departure, arrival)).toBe(false);
  });

  it("judges the day boundary in Nairobi, not in UTC", () => {
    // Both instants fall on the same UTC day, but straddle midnight in Nairobi.
    const departure = new Date("2026-07-19T20:00:00Z"); // 23:00 EAT on the 19th
    const arrival = new Date("2026-07-19T22:00:00Z"); // 01:00 EAT on the 20th
    expect(arrivesNextDay(departure, arrival)).toBe(true);
  });
});
