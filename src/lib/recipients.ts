import "server-only";
import { db } from "./db";
import type { Role } from "@prisma/client";

/**
 * Who hears about an event, and how loudly.
 *
 * Two problems are solved here, and they pull in opposite directions.
 *
 * The first is scope. A booking on an Easy Coach departure must reach Easy
 * Coach's clerks and nobody else's. Before operator scoping existed the event
 * bus simply asked for "all users with role STAFF", which on a fifteen-operator
 * platform told every company about every other company's sales.
 *
 * The second is volume. Notifying every clerk of every booking does not scale:
 * an operator selling five hundred seats a day would send each of them five
 * hundred messages, and a bell that cries wolf is a bell nobody reads. So each
 * event carries a *delivery class* per role rather than a flat "notify" —
 * push, in-app, digest, or nothing at all because a dashboard number already
 * says it better.
 */

/**
 * How a recipient should learn about something.
 *
 * The distinction that matters most is PUSH versus everything else: it is
 * reserved for events that change where a person will be or what they will pay.
 */
export type Delivery =
  /** In-app plus email/SMS. Interrupts. */
  | "PUSH"
  /** The bell. Act within hours. */
  | "IN_APP"
  /** Collapsed into a periodic summary. */
  | "DIGEST"
  /** No message; a live dashboard figure carries it. */
  | "DASHBOARD";

export type Recipient = {
  userId: string;
  delivery: Delivery;
};

/**
 * Staff of one company holding any of the given roles.
 *
 * `operatorId` of null means platform staff, who are unscoped by definition.
 * Not cached: staff lists are small and change rarely, but a stale cache means
 * a newly hired clerk silently receives nothing, which is a far worse failure
 * than one indexed query per event.
 */
export async function staffOf(
  operatorId: string | null,
  roles: Role[],
): Promise<string[]> {
  const users = await db.user.findMany({
    where: {
      role: { in: roles },
      isActive: true,
      ...(operatorId ? { operatorId } : { operatorId: null }),
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** Platform-level staff, e.g. super admins and support. */
export const platformStaff = (roles: Role[]) => staffOf(null, roles);

/**
 * Which operator a trip belongs to.
 *
 * Ownership runs through the vehicle: whoever owns the bus owns the departure.
 * Routes are shared platform infrastructure, so they cannot answer this.
 */
export async function operatorOfTrip(tripId: string): Promise<string | null> {
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    select: { bus: { select: { operatorId: true } } },
  });
  return trip?.bus.operatorId ?? null;
}

/**
 * Whether a departure is close enough that staff should be interrupted.
 *
 * Urgency is a function of time-to-departure, not of event type. A cancellation
 * three weeks out is a number on a dashboard; the same cancellation ninety
 * minutes before boarding is something the conductor must be told, because they
 * are about to go looking for that passenger.
 */
export const IMMINENT_MS = 2 * 60 * 60_000;

export const isImminent = (departureAt: Date | null | undefined) =>
  Boolean(departureAt && departureAt.getTime() - Date.now() <= IMMINENT_MS);

/**
 * Builds a recipient list, dropping anyone who would be told about their own
 * action.
 *
 * A clerk who cancels a booking does not need a notification saying it was
 * cancelled — they are looking at the confirmation. Suppressing this is the
 * single largest reduction in pointless traffic.
 */
export function recipients(
  entries: { userIds: string[]; delivery: Delivery }[],
  actorId?: string | null,
): Recipient[] {
  const seen = new Set<string>();
  const out: Recipient[] = [];

  for (const { userIds, delivery } of entries) {
    // DASHBOARD is a live figure, not a message. Nothing to deliver.
    if (delivery === "DASHBOARD") continue;

    for (const userId of userIds) {
      if (userId === actorId) continue;
      if (seen.has(userId)) continue;
      seen.add(userId);
      out.push({ userId, delivery });
    }
  }

  return out;
}
