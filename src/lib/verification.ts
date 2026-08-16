/**
 * The ticket verification code — the human-facing handle a clerk uses to verify
 * a passenger at the gate.
 *
 * The QR token is 32 opaque characters: perfect for a scanner, impossible to
 * read off a phone and type. This code is the opposite — short, spoken aloud
 * without ambiguity, and printed on the receipt — while still being unguessable
 * enough that knowing one code tells you nothing about the next.
 *
 * Format: `SC-<year>-<six characters>` over a 32-symbol alphabet with the
 * letters and digits that look alike removed (no I/O/1/0), so `SC-2026-8F4K92`
 * reads the same whether it is scrawled on a boarding list or read down a phone.
 * Six symbols is ~1.07 billion possibilities within a year — with staff-only
 * access and rate limiting, not something that can be walked through.
 */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 symbols, no I/O/1/0
const CODE_LENGTH = 6;

/** A fresh code for the given year (defaults to now). Not checked for uniqueness
 *  here — the caller either retries against the unique index or dedupes a batch. */
export function ticketVerificationCode(year: number = new Date().getFullYear()): string {
  let body = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    body += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `SC-${year}-${body}`;
}

/**
 * Normalises whatever a clerk typed or a scanner emitted into a comparable
 * form: trimmed, upper-cased. Applied to both the stored code and the query so a
 * lower-case or space-padded entry still matches. The QR token is case-sensitive
 * and is matched separately, before this is applied.
 */
export function normaliseCode(input: string): string {
  return input.trim().toUpperCase();
}
