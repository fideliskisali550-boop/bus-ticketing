import "server-only";
import { db } from "./db";

/**
 * Notification dispatch. In-app notifications are persisted and shown in the
 * header bell. Email and SMS are logged rather than sent — the SRS scopes the
 * prototype to simulated external integrations — but they travel through the
 * same call site, so wiring a real provider (Resend, Africa's Talking) means
 * replacing the two transport functions below and nothing else.
 */

type NotifyInput = {
  userId: string;
  title: string;
  body: string;
  link?: string;
  alsoEmail?: boolean;
  alsoSms?: boolean;
  /** Coarse kind, so the bell can be filtered: booking, payment, trip, account. */
  category?: string;
  /** Collapses repeats into one digest line, e.g. "booking:2026-07-20". */
  groupKey?: string;
};

async function sendEmail(to: string, title: string, body: string) {
  console.info(`[email->${to}] ${title}\n${body}`);
}

async function sendSms(to: string, body: string) {
  console.info(`[sms->${to}] ${body}`);
}

/** Never throws — a failed notification must not fail the booking behind it. */
export async function notify({
  userId,
  title,
  body,
  link,
  alsoEmail,
  alsoSms,
  category = "general",
  groupKey,
}: NotifyInput) {
  try {
    await db.notification.create({
      data: { userId, title, body, link, channel: "IN_APP", category, groupKey },
    });

    if (alsoEmail || alsoSms) {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { email: true, phone: true },
      });
      if (user) {
        if (alsoEmail) await sendEmail(user.email, title, body);
        if (alsoSms) await sendSms(user.phone, body);
      }
    }
  } catch (error) {
    console.error("[notify] failed", error);
  }
}
