import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import type { Role } from "@prisma/client";
import { can, assertScopeInvariant, OFFICE_ROLES, type Capability } from "./scope";
import { getCurrentUser, type SessionUser } from "./auth";

/**
 * Thin conventions layer shared by every route handler: one error envelope, one
 * place that decides HTTP status codes, and guards that fail closed.
 */

// Re-exported so the thirty handlers that already import these from here keep
// working; the definitions now live in ./errors to break an import cycle.
export {
  ApiError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  tooMany,
} from "./errors";
import { ApiError, unauthorized, forbidden, badRequest, tooMany } from "./errors";

/**
 * Success envelope. Accepts headers so endpoints serving slow-changing public
 * data (the place catalogue, route list) can declare their own caching without
 * every caller reaching for NextResponse directly.
 */
export const ok = <T>(data: T, status = 200, headers?: Record<string, string>) =>
  NextResponse.json(data, { status, headers });

/**
 * Wraps a handler so thrown errors become a consistent JSON envelope. Unknown
 * errors are logged in full but reported generically — leaking a stack trace or
 * a Prisma constraint name to the client is an information-disclosure bug.
 */
export function handler<T>(fn: () => Promise<NextResponse<T>>) {
  return fn().catch((error: unknown) => {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message, details: error.details },
        { status: error.status },
      );
    }

    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "The information provided is not valid.",
          details: error.flatten().fieldErrors,
        },
        { status: 422 },
      );
    }

    console.error("[unhandled]", error);
    return NextResponse.json(
      { error: "Something went wrong on our end. Please try again." },
      { status: 500 },
    );
  });
}

/** Validates and narrows a JSON body, or throws a 422 with per-field messages. */
export async function parseBody<T>(req: Request, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Expected a JSON request body.");
  }
  return schema.parse(raw);
}

/**
 * Which signed-in account this request is acting as.
 *
 * Normally the client sends it as a header, which `getCurrentUser` reads for
 * itself. Downloads and plain links cannot carry a header, so those endpoints
 * pass the request and the id is taken from `?sid=` instead.
 */
function sessionIdFrom(req?: Request): string | undefined {
  if (!req) return undefined;
  try {
    return new URL(req.url).searchParams.get("sid") ?? undefined;
  } catch {
    return undefined;
  }
}

export async function requireUser(req?: Request): Promise<SessionUser> {
  const user = await getCurrentUser(sessionIdFrom(req));
  if (!user) throw unauthorized();
  return user;
}

/** Authorises against an explicit list of roles. */
export async function requireRole(
  roles: Role[],
  req?: Request,
): Promise<SessionUser> {
  const user = await requireUser(req);
  if (!roles.includes(user.role)) throw forbidden();
  return user;
}

/**
 * Authorises by capability rather than by role name.
 *
 * Guards used to name roles: `requireStaff` meant "STAFF or ADMIN", which was
 * fine with three roles and quietly wrong the moment there were nine — a
 * finance officer is staff, and must not be able to edit a timetable. Asking
 * what the caller may *do* means adding a role is an edit to one table in
 * `lib/scope.ts` rather than an audit of thirty handlers.
 */
export async function requireCapability(
  capability: Capability,
  req?: Request,
): Promise<SessionUser> {
  const user = await requireUser(req);
  if (!can(user.role, capability)) throw forbidden();
  // A staff account that has lost its company would otherwise widen to
  // "every company", so the invariant is re-checked at point of use.
  assertScopeInvariant(user);
  return user;
}

/** Any back-office role: the shared shell, navigation and operational reads. */
export const requireOffice = (req?: Request) => requireRole([...OFFICE_ROLES], req);
/** Platform administration. */
export const requireAdmin = (req?: Request) => requireRole(["SUPER_ADMIN"], req);

/** Best-effort client IP, honouring the proxy headers a deployment would set. */
export function clientIp(req: Request) {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Fixed-window rate limiter held in process memory. Adequate for a single
 * instance; a multi-instance deployment should point this at Redis, which is
 * why callers only ever see the `limit()` signature.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function limit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (++bucket.count > max) throw tooMany();
}

// Periodically drop expired buckets so the map cannot grow without bound.
if (typeof setInterval === "function") {
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) if (b.resetAt < now) buckets.delete(key);
  }, 60_000);
  sweep.unref?.();
}
