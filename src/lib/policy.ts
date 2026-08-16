/**
 * Business rules. The SRS describes booking and payment but does not state the
 * surrounding policy, so these are explicit, documented assumptions modelled on
 * how Kenyan long-distance operators actually work.
 */

/** Minutes a PENDING booking holds its seats before they return to the pool. */
export const HOLD_MINUTES = 15;

/** A single booking may not exceed this many seats — deters bulk seat squatting. */
export const MAX_SEATS_PER_BOOKING = 6;

/** Booking closes this long before departure so the manifest can be printed. */
export const BOOKING_CUTOFF_MINUTES = 30;

/**
 * Sliding-scale refund. Cancelling early costs nothing; cancelling close to
 * departure forfeits more, because the operator has little chance to resell.
 */
export const REFUND_TIERS = [
  { hoursBefore: 48, refundPct: 100, label: "48+ hours before departure" },
  { hoursBefore: 24, refundPct: 75, label: "24–48 hours before departure" },
  { hoursBefore: 6, refundPct: 50, label: "6–24 hours before departure" },
  { hoursBefore: 0, refundPct: 0, label: "Under 6 hours before departure" },
] as const;

export function refundFor(totalAmount: number, departureAt: Date, now = new Date()) {
  const hoursOut = (departureAt.getTime() - now.getTime()) / 3_600_000;
  const tier =
    REFUND_TIERS.find((t) => hoursOut >= t.hoursBefore) ??
    REFUND_TIERS[REFUND_TIERS.length - 1];

  return {
    // Round down to the shilling — never refund a fraction the operator
    // cannot actually transfer over M-Pesa.
    amount: Math.floor((totalAmount * tier.refundPct) / 100),
    percent: tier.refundPct,
    tier: tier.label,
  };
}

/** True when the trip is still open for new bookings. */
export function isBookable(departureAt: Date, status: string, now = new Date()) {
  if (status !== "SCHEDULED" && status !== "BOARDING") return false;
  return departureAt.getTime() - now.getTime() > BOOKING_CUTOFF_MINUTES * 60_000;
}

export type SeatCell = { seat: string; kind: "seat" | "aisle" };

/**
 * Builds the physical seat grid for a bus. Seats are labelled by row number and
 * a letter per column ("1A", "1B", …), matching the numbering passengers see
 * printed on the actual seat backs.
 */
export function buildSeatMap(
  capacity: number,
  seatsPerRow: number,
  aisleAfter: number,
): SeatCell[][] {
  const letters = "ABCDEF";
  const rows: SeatCell[][] = [];
  let assigned = 0;

  for (let row = 1; assigned < capacity; row++) {
    const cells: SeatCell[] = [];
    for (let col = 0; col < seatsPerRow && assigned < capacity; col++) {
      if (col === aisleAfter) cells.push({ seat: "", kind: "aisle" });
      cells.push({ seat: `${row}${letters[col]}`, kind: "seat" });
      assigned++;
    }
    rows.push(cells);
  }

  return rows;
}

/** Flat list of every valid seat label, used to validate booking requests. */
export function seatLabels(capacity: number, seatsPerRow: number) {
  return buildSeatMap(capacity, seatsPerRow, seatsPerRow)
    .flat()
    .filter((c) => c.kind === "seat")
    .map((c) => c.seat);
}

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 — unambiguous when read aloud

export function bookingReference() {
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  }
  return `SC-${out}`;
}

export const KES = (amount: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(amount);

/**
 * Normalises the many ways a Kenyan number is written (0712…, +254712…,
 * 254712…, 712…) to the 2547XXXXXXXX form M-Pesa requires.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}
