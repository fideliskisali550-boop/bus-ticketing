import "server-only";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { createHash, randomBytes } from "crypto";
import type { Role } from "@prisma/client";
import { db } from "./db";
import { SIGNED_OUT_SESSION } from "./session-constants";

/**
 * Multi-session authentication.
 *
 * The problem this solves: cookies are scoped to an origin, not to a tab, so a
 * single session cookie makes every tab the same user. Testing an admin, a
 * staff member and a passenger side by side is then impossible.
 *
 * The naive fix — move tokens into sessionStorage, which *is* per-tab — trades
 * the problem for a worse one: anything JavaScript can read, injected
 * JavaScript can steal. httpOnly cookies exist precisely to prevent that.
 *
 * So the tokens stay in an httpOnly cookie, but that cookie now holds an
 * *envelope* of several sessions keyed by a short id. Each tab keeps only its
 * chosen session id in sessionStorage and sends it as a header. The id is not a
 * credential: on its own it grants nothing, because the matching token never
 * leaves the httpOnly cookie. An attacker who reads sessionStorage learns which
 * session a tab is using and nothing more.
 *
 * Sessions are resolved against the database on every request rather than from
 * a self-contained JWT. That costs one indexed lookup, and buys immediate
 * revocation — a deactivated user or a signed-out session stops working at
 * once, instead of remaining valid until a stateless token happens to expire.
 */

export const SESSIONS_COOKIE = "sc_sessions";
export const SESSION_HEADER = "x-session-id";

const REFRESH_TTL_SEC = 60 * 60 * 24 * 30;

/** bcrypt cost 12 — ~250ms per hash, slow enough to make offline cracking costly. */
const BCRYPT_ROUNDS = 12;

/** Account lockout thresholds, applied on top of per-IP rate limiting. */
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

/** More than this and the cookie starts to approach the 4 KB browser limit. */
const MAX_CONCURRENT_SESSIONS = 6;

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  /**
   * Which transport company this user works for; null for passengers and
   * platform staff. Carried on the session because every scoped query needs it
   * and re-reading the user row on each one would be a query per check.
   */
  operatorId: string | null;
  /** Which envelope entry this user was resolved from. */
  sessionId: string;
};

export function hashPassword(plain: string) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

type Envelope = Record<string, string>;

async function readEnvelope(): Promise<Envelope> {
  const raw = (await cookies()).get(SESSIONS_COOKIE)?.value;
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    // Defensive: only keep well-formed string pairs, so a tampered cookie
    // cannot inject unexpected shapes into the lookup below.
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([k, v]) => typeof k === "string" && typeof v === "string",
      ),
    ) as Envelope;
  } catch {
    return {};
  }
}

async function writeEnvelope(envelope: Envelope) {
  const jar = await cookies();

  if (Object.keys(envelope).length === 0) {
    jar.delete(SESSIONS_COOKIE);
    return;
  }

  jar.set(SESSIONS_COOKIE, JSON.stringify(envelope), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: REFRESH_TTL_SEC,
  });
}

/** The session id this request is for, from the header the client attaches. */
async function requestedSessionId(): Promise<string | null> {
  try {
    return (await headers()).get(SESSION_HEADER);
  } catch {
    // Not available in every rendering context; fall back to the default.
    return null;
  }
}

/**
 * Signs a user in, adding them to the envelope alongside any accounts already
 * signed in. Returns the session id for the tab to remember.
 */
export async function createSession(
  user: { id: string; email: string; fullName: string; role: Role },
  meta: { userAgent?: string; ipAddress?: string } = {},
): Promise<string> {
  const raw = randomBytes(48).toString("base64url");
  const sessionId = randomBytes(9).toString("base64url");

  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(raw),
      userAgent: meta.userAgent?.slice(0, 255),
      ipAddress: meta.ipAddress,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000),
    },
  });

  const envelope = await readEnvelope();

  // Signing into the same account twice replaces the earlier entry rather than
  // accumulating duplicates that would confuse the account switcher.
  const existing = await db.session.findMany({
    where: {
      tokenHash: { in: Object.values(envelope).map(hashToken) },
      userId: user.id,
      revokedAt: null,
    },
    select: { tokenHash: true },
  });
  const duplicateHashes = new Set(existing.map((s) => s.tokenHash));
  for (const [sid, token] of Object.entries(envelope)) {
    if (duplicateHashes.has(hashToken(token))) delete envelope[sid];
  }

  envelope[sessionId] = raw;

  // Bound the envelope so the cookie cannot grow past what browsers accept.
  const ids = Object.keys(envelope);
  while (ids.length > MAX_CONCURRENT_SESSIONS) {
    const oldest = ids.shift()!;
    delete envelope[oldest];
  }

  await writeEnvelope(envelope);
  return sessionId;
}

/**
 * Resolves the caller for this request.
 *
 * A request must name the session it wants — through `?u=`, which the
 * middleware promotes to a header, or through `X-Session-Id` on a fetch. There
 * is no fallback.
 *
 * There used to be one: with no id, this returned the most recently added
 * session. It existed so a freshly opened tab would look signed in, and it is
 * precisely what made sessions leak between tabs. Opening a second tab on a
 * bare URL resolved to whoever had signed in last, and the client then pinned
 * that identity into the new tab — so a tab nobody had signed into came up as
 * the booking clerk. Guessing an identity from an ambiguous request is not
 * something an authentication layer should ever do; the cost of removing it is
 * that a brand-new tab starts signed out, which is the correct behaviour.
 *
 * The tab's own session is not lost by this. `SessionProvider` restores `?u=`
 * from the tab's storage when a URL arrives without it, so a signed-in tab
 * following a bookmark heals itself rather than being logged out.
 */
export async function getCurrentUser(
  explicitSessionId?: string,
): Promise<SessionUser | null> {
  const envelope = await readEnvelope();
  const ids = Object.keys(envelope);
  if (ids.length === 0) return null;

  const requested = explicitSessionId ?? (await requestedSessionId());

  // Nothing named: this request cannot be attributed to a tab, so it belongs to
  // nobody.
  if (!requested) return null;

  // A tab that has explicitly signed out carries this sentinel, which must also
  // resolve to nobody rather than to a remaining account.
  if (requested === SIGNED_OUT_SESSION) return null;

  // An id naming a session we do not hold — a stale tab, or one whose account
  // was signed out elsewhere — is likewise nobody.
  if (!envelope[requested]) return null;

  const sessionId = requested;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(envelope[sessionId]!) },
    include: {
      user: {
        select: {
          id: true, email: true, fullName: true, role: true, isActive: true,
          operatorId: true,
        },
      },
    },
  });

  if (
    !session ||
    session.revokedAt ||
    session.expiresAt < new Date() ||
    !session.user.isActive
  ) {
    return null;
  }

  const { id, email, fullName, role, operatorId } = session.user;
  return { id, email, fullName, role, operatorId, sessionId };
}

/** Every account currently signed in, for the account switcher. */
export async function listSessions(): Promise<
  { sessionId: string; id: string; fullName: string; email: string; role: Role }[]
> {
  const envelope = await readEnvelope();
  const entries = Object.entries(envelope);
  if (!entries.length) return [];

  const sessions = await db.session.findMany({
    where: {
      tokenHash: { in: entries.map(([, token]) => hashToken(token)) },
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      user: {
        select: { id: true, email: true, fullName: true, role: true, isActive: true },
      },
    },
  });

  const byHash = new Map(sessions.map((s) => [s.tokenHash, s]));

  return entries
    .map(([sessionId, token]) => {
      const session = byHash.get(hashToken(token));
      if (!session || !session.user.isActive) return null;
      return {
        sessionId,
        id: session.user.id,
        fullName: session.user.fullName,
        email: session.user.email,
        role: session.user.role,
      };
    })
    .filter(Boolean) as {
    sessionId: string;
    id: string;
    fullName: string;
    email: string;
    role: Role;
  }[];
}

/**
 * Signs out. With a session id, only that account is signed out and the other
 * tabs keep working — which is the behaviour the multi-session design exists to
 * provide. Without one, every account in the envelope is signed out.
 */
export async function destroySession(sessionId?: string) {
  const envelope = await readEnvelope();

  const targets = sessionId
    ? envelope[sessionId]
      ? { [sessionId]: envelope[sessionId]! }
      : {}
    : envelope;

  const hashes = Object.values(targets).map(hashToken);

  if (hashes.length) {
    await db.session
      .updateMany({
        where: { tokenHash: { in: hashes }, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => undefined);
  }

  for (const sid of Object.keys(targets)) delete envelope[sid];
  await writeEnvelope(envelope);
}

/** Revokes every session for a user — used on password change and deactivation. */
export async function revokeAllForUser(userId: string) {
  await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
