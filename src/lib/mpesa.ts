import "server-only";
import { randomBytes } from "crypto";

/**
 * M-Pesa adapter.
 *
 * The SRS scopes payments as simulated (section 1.8), so this module implements
 * the Daraja STK-push contract against an in-process simulator. The exported
 * surface — `stkPush` and `queryStatus` — matches what a live Daraja client
 * would expose, so going live means implementing `LiveMpesa` against the same
 * interface and flipping MPESA_LIVE, with no changes to routes or the database.
 */

export type StkPushResult = {
  checkoutRequestId: string;
  customerMessage: string;
};

export type PaymentOutcome =
  | { status: "SUCCESS"; receiptNumber: string }
  | { status: "FAILED"; reason: string };

interface MpesaGateway {
  stkPush(input: { phone: string; amount: number; reference: string }): Promise<StkPushResult>;
  queryStatus(checkoutRequestId: string): Promise<PaymentOutcome | null>;
}

/** Failure reasons taken verbatim from real Daraja result descriptions. */
const FAILURE_REASONS = [
  "Request cancelled by user",
  "The balance is insufficient for the transaction",
  "DS timeout user cannot be reached",
];

function receipt() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "S";
  for (let i = 0; i < 9; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/**
 * Simulated gateway. A push resolves after a short delay — mirroring the real
 * world, where the customer must physically enter their PIN — and fails at a
 * configurable rate so the failure path is exercised during demos rather than
 * being dead code.
 */
class SimulatedMpesa implements MpesaGateway {
  /** checkoutRequestId -> when the "customer" will have responded, and how. */
  private pending = new Map<string, { readyAt: number; outcome: PaymentOutcome }>();

  private get failureRate() {
    return Number(process.env.MPESA_SIM_FAILURE_RATE ?? "0.1");
  }

  async stkPush({ phone, amount, reference }: { phone: string; amount: number; reference: string }) {
    const checkoutRequestId = `ws_CO_${Date.now()}_${randomBytes(6).toString("hex")}`;

    const willFail = Math.random() < this.failureRate;
    this.pending.set(checkoutRequestId, {
      // 3–6 seconds: long enough that the client genuinely polls, short enough
      // that a live demonstration does not stall.
      readyAt: Date.now() + 3000 + Math.random() * 3000,
      outcome: willFail
        ? {
            status: "FAILED",
            reason: FAILURE_REASONS[Math.floor(Math.random() * FAILURE_REASONS.length)]!,
          }
        : { status: "SUCCESS", receiptNumber: receipt() },
    });

    console.info(
      `[mpesa:sim] STK push to ${phone} for KES ${amount} (ref ${reference}) -> ${checkoutRequestId}`,
    );

    return {
      checkoutRequestId,
      customerMessage:
        "Enter your M-Pesa PIN on the prompt sent to your phone to complete this payment.",
    };
  }

  /** Returns null while the push is still outstanding. */
  async queryStatus(checkoutRequestId: string) {
    const entry = this.pending.get(checkoutRequestId);
    if (!entry) return null;
    if (Date.now() < entry.readyAt) return null;

    this.pending.delete(checkoutRequestId);
    return entry.outcome;
  }
}

/**
 * Placeholder for the production implementation. Kept as an explicit class so
 * the integration point is obvious to anyone extending the system, and so
 * misconfiguring MPESA_LIVE fails loudly instead of silently taking fake money.
 */
class LiveMpesa implements MpesaGateway {
  async stkPush(): Promise<StkPushResult> {
    throw new Error(
      "Live M-Pesa is not configured. Implement LiveMpesa against the Daraja API and supply MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET and MPESA_PASSKEY.",
    );
  }
  async queryStatus(): Promise<PaymentOutcome | null> {
    throw new Error("Live M-Pesa is not configured.");
  }
}

/** Cached on globalThis so pending pushes survive Next.js hot reloads. */
const g = globalThis as unknown as { __mpesa?: MpesaGateway };

export const mpesa: MpesaGateway =
  g.__mpesa ??
  (g.__mpesa =
    process.env.MPESA_LIVE === "true" ? new LiveMpesa() : new SimulatedMpesa());

export const isSimulated = process.env.MPESA_LIVE !== "true";
