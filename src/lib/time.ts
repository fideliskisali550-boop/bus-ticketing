/**
 * Time formatting, pinned to East Africa Time.
 *
 * A bus leaves Nairobi at 21:00 EAT whether the person looking at the screen is
 * in Mombasa, London or California. Timestamps are stored in UTC (as they must
 * be) but every passenger-facing time is rendered in Africa/Nairobi, never in
 * the viewer's local zone.
 *
 * Formatting in the browser's zone — the default for `toLocaleString` — is the
 * kind of bug that stays invisible during development on a Kenyan machine and
 * then shows every departure three hours out when the project is opened on a
 * laptop set to anything else.
 */

export const KENYA_TZ = "Africa/Nairobi";

/** Kenya has observed UTC+3 year-round since 1960; there is no DST to track. */
export const KENYA_UTC_OFFSET_HOURS = 3;

const withTz = (options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions => ({
  ...options,
  timeZone: KENYA_TZ,
});

const toDate = (value: Date | string) =>
  value instanceof Date ? value : new Date(value);

/** 21:30 */
export const formatTime = (value: Date | string) =>
  toDate(value).toLocaleTimeString("en-GB", withTz({ hour: "2-digit", minute: "2-digit", hour12: false }));

/** Sat 19 Jul */
export const formatDateShort = (value: Date | string) =>
  toDate(value).toLocaleDateString("en-GB", withTz({ weekday: "short", day: "numeric", month: "short" }));

/** 19 Jul 2026 */
export const formatDate = (value: Date | string) =>
  toDate(value).toLocaleDateString("en-GB", withTz({ day: "numeric", month: "short", year: "numeric" }));

/** Saturday 19 July 2026 */
export const formatDateLong = (value: Date | string) =>
  toDate(value).toLocaleDateString("en-GB", withTz({ weekday: "long", day: "numeric", month: "long", year: "numeric" }));

/** 19 Jul, 21:30 */
export const formatDateTime = (value: Date | string) =>
  toDate(value).toLocaleString("en-GB", withTz({ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }));

/** 19 Jul 2026, 21:30 */
export const formatDateTimeFull = (value: Date | string) =>
  toDate(value).toLocaleString("en-GB", withTz({ day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }));

/** 19 Jul — compact axis and chart labels. */
export const formatDayLabel = (value: Date | string) =>
  toDate(value).toLocaleDateString("en-GB", withTz({ day: "numeric", month: "short" }));

/**
 * 2026-07-19 21:30 — sortable, for spreadsheet exports where a reader will
 * filter and sort the column.
 */
export const formatSortable = (value: Date | string) =>
  `${toKenyaDateInput(value)} ${formatTime(value)}`;

/** Saturday 19 July 2026 at 21:30 — the ticket's headline departure line. */
export const formatDepartureLine = (value: Date | string) =>
  `${formatDateLong(value)} at ${formatTime(value)}`;

/** yyyy-MM-dd in Kenyan time — what a date input expects. */
export function toKenyaDateInput(value: Date | string) {
  // en-CA formats as ISO-like yyyy-MM-dd, which avoids assembling the string
  // by hand and getting the padding wrong.
  return toDate(value).toLocaleDateString("en-CA", withTz({}));
}

/** HH:mm in Kenyan time — what a time input expects. */
export function toKenyaTimeInput(value: Date | string) {
  return toDate(value).toLocaleTimeString("en-GB", withTz({ hour: "2-digit", minute: "2-digit", hour12: false }));
}

/** Today's date in Kenya, for date-input minimums and defaults. */
export const todayInKenya = () => toKenyaDateInput(new Date());

/**
 * Midnight in Nairobi for a yyyy-MM-dd, as a UTC instant.
 *
 * The obvious `Date.parse("2026-07-20T00:00:00")` is host-local midnight, which
 * is a different moment on every machine. A day boundary in this system is
 * always a Kenyan one.
 */
export const kenyanDayStart = (ymd: string) =>
  Date.parse(`${ymd}T00:00:00Z`) - KENYA_UTC_OFFSET_HOURS * 3_600_000;

/**
 * Builds a UTC instant from a Kenyan wall-clock date and time.
 *
 * Used when staff schedule a departure: they type "21:00 on the 19th" meaning
 * Kenyan time, and that must become the correct instant regardless of the
 * timezone the browser or server happens to be in.
 */
export function kenyaWallClockToUtc(dateYmd: string, timeHm: string) {
  const [year, month, day] = dateYmd.split("-").map(Number);
  const [hour, minute] = timeHm.split(":").map(Number);

  return new Date(
    Date.UTC(
      year!,
      (month ?? 1) - 1,
      day ?? 1,
      (hour ?? 0) - KENYA_UTC_OFFSET_HOURS,
      minute ?? 0,
    ),
  );
}

/**
 * True when arrival lands on a later calendar day than departure, in Kenyan
 * time — so the "+1" marker on an overnight service is correct for a passenger
 * in Nairobi rather than for whoever's laptop is rendering it.
 */
export function arrivesNextDay(departure: Date | string, arrival: Date | string) {
  return toKenyaDateInput(departure) !== toKenyaDateInput(arrival);
}
