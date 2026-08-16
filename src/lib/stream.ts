import "server-only";
import type { Role } from "@prisma/client";
import { isOperator } from "./scope";

/**
 * Live dashboard updates.
 *
 * Every admin screen used to fetch once on mount and never again, so a booking
 * taken at the counter was invisible on the manager's dashboard until somebody
 * pressed reload. With several people working the same departure that is not a
 * cosmetic problem: two clerks can sell the same seat map from stale numbers.
 *
 * The transport is Server-Sent Events rather than WebSockets. The traffic is
 * one-directional — the server tells clients something changed, clients never
 * push back — and SSE needs no second process, no new dependency and no
 * upgrade handshake to get through a proxy. Clients reconnect on their own.
 *
 * What travels is deliberately thin: the event name and the operator it
 * concerns, never the payload. Clients re-fetch the queries that care. Pushing
 * data down the stream would mean re-implementing every dashboard's
 * authorisation rules a second time, in a second place, with no server to
 * check them — a stale number is a bug, but a leaked one is a breach.
 */

type Subscriber = {
  id: number;
  /** null for platform staff, who see everything. */
  operatorId: string | null;
  role: Role;
  send: (line: string) => void;
};

/**
 * Connections are held in module scope, which ties them to one server process.
 * That is correct for a single instance and for the demonstration; a
 * multi-instance deployment would put Redis pub/sub behind `publish` and leave
 * every call site unchanged.
 */
const subscribers = new Map<number, Subscriber>();
let nextId = 1;

export function subscribe(
  operatorId: string | null,
  role: Role,
  send: (line: string) => void,
): () => void {
  const id = nextId++;
  subscribers.set(id, { id, operatorId, role, send });
  return () => subscribers.delete(id);
}

/** How many clients are currently listening — surfaced on the platform dashboard. */
export const listenerCount = () => subscribers.size;

/**
 * Tells interested clients that something changed.
 *
 * Scoping is applied here rather than in the browser: a company's staff are
 * never sent even the *name* of another company's events, because the pattern
 * of activity is itself commercially sensitive.
 */
export async function publish(
  type: string,
  operatorId: string | null,
  subjectId: string | null,
) {
  if (!subscribers.size) return;

  const line = `event: domain\ndata: ${JSON.stringify({
    type,
    operatorId,
    subjectId,
    at: Date.now(),
  })}\n\n`;

  for (const sub of subscribers.values()) {
    // Operator staff hear only their own company. Platform staff hear all.
    if (isOperator(sub.role) && sub.operatorId !== operatorId) continue;

    try {
      sub.send(line);
    } catch {
      // A client that has gone away without closing cleanly; drop it rather
      // than letting a dead socket hold the whole broadcast up.
      subscribers.delete(sub.id);
    }
  }
}
