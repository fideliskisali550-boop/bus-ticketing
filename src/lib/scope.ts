import "server-only";
import type { Role } from "@prisma/client";
import { forbidden } from "./errors";

/**
 * Operator scoping — the rule that stops one transport company reading
 * another's business.
 *
 * SafiriConnect is a marketplace. Fifteen companies trade on it, and until now
 * nothing in the code expressed that: `User` had no company, so a booking clerk
 * at Easy Coach could list and edit Modern Coast's buses, and the analytics
 * endpoint handed whole-platform revenue to any staff account that asked.
 *
 * The fix is one idea applied everywhere. Every role belongs to a *plane*:
 *
 *   platform  — SUPER_ADMIN, PLATFORM_SUPPORT, PASSENGER: `operatorId` is null
 *   operator  — everyone else: `operatorId` is required
 *
 * and every staff-facing query passes its filter through this module rather
 * than writing `where` clauses by hand. Scoping that is written out by hand at
 * forty call sites is scoping that is wrong at one of them.
 */

/** Roles that see across every operator. */
export const PLATFORM_ROLES: Role[] = ["SUPER_ADMIN", "PLATFORM_SUPPORT"];

/** Roles that belong to exactly one company. */
export const OPERATOR_ROLES: Role[] = [
  "COMPANY_ADMIN",
  "ROUTE_MANAGER",
  "FINANCE_OFFICER",
  "BOOKING_STAFF",
  "CONDUCTOR",
  "DRIVER",
];

/** Roles limited to the trips they are personally rostered on. */
export const CREW_ROLES: Role[] = ["CONDUCTOR", "DRIVER"];

/** Any role with a back-office function; excludes passengers and crew. */
export const OFFICE_ROLES: Role[] = [
  "SUPER_ADMIN",
  "PLATFORM_SUPPORT",
  "COMPANY_ADMIN",
  "ROUTE_MANAGER",
  "FINANCE_OFFICER",
  "BOOKING_STAFF",
];

export const isPlatform = (role: Role) => PLATFORM_ROLES.includes(role);
export const isOperator = (role: Role) => OPERATOR_ROLES.includes(role);
export const isCrew = (role: Role) => CREW_ROLES.includes(role);

export type Scoped = { id: string; role: Role; operatorId?: string | null };

/**
 * The invariant SQL cannot express: an operator role must have a company, a
 * platform role must not.
 *
 * Checked when accounts are created and again when they are used, because a
 * staff row that lost its `operatorId` would otherwise silently widen to
 * "everything" — the failure mode that matters most here is the one that grants
 * access rather than denying it.
 */
export function assertScopeInvariant(user: Scoped) {
  if (isOperator(user.role) && !user.operatorId) {
    throw forbidden(
      "This account is not linked to a transport company. Ask an administrator to assign it.",
    );
  }
  if (!isOperator(user.role) && user.operatorId) {
    throw forbidden("A platform account cannot belong to a transport company.");
  }
}

/**
 * The operator whose data this user may read, or `null` for platform-wide.
 *
 * Returning null rather than throwing is deliberate: callers spread the result
 * into a `where`, and an empty filter is exactly right for a platform role.
 */
export function operatorScope(user: Scoped): string | null {
  assertScopeInvariant(user);
  return isOperator(user.role) ? user.operatorId! : null;
}

/**
 * A `where` fragment restricting trips to the user's own company.
 *
 * Operator ownership runs through the bus: a trip belongs to whoever owns the
 * vehicle running it. Routes are shared platform infrastructure — six companies
 * run Nairobi–Mombasa — so scoping on the route would be wrong.
 */
export function tripScope(user: Scoped) {
  const operatorId = operatorScope(user);
  if (!operatorId) return {};

  // Crew see only what they are rostered on, not the whole company timetable.
  if (isCrew(user.role)) {
    return {
      bus: { operatorId },
      OR: [{ driverId: user.id }, { conductorId: user.id }],
    };
  }

  return { bus: { operatorId } };
}

/** A `where` fragment restricting bookings to the user's own company. */
export function bookingScope(user: Scoped) {
  const operatorId = operatorScope(user);
  if (!operatorId) return {};
  if (isCrew(user.role)) {
    return { trip: { OR: [{ driverId: user.id }, { conductorId: user.id }] } };
  }
  return { trip: { bus: { operatorId } } };
}

/** A `where` fragment restricting buses to the user's own company. */
export function busScope(user: Scoped) {
  const operatorId = operatorScope(user);
  return operatorId ? { operatorId } : {};
}

/** A `where` fragment restricting payments to the user's own company. */
export function paymentScope(user: Scoped) {
  const operatorId = operatorScope(user);
  return operatorId ? { booking: { trip: { bus: { operatorId } } } } : {};
}

/**
 * Confirms a specific record belongs to the caller's company.
 *
 * Used after fetching by id, where a `where` filter would have turned a
 * cross-company read into a confusing "not found" rather than a clear refusal.
 */
export function assertSameOperator(user: Scoped, recordOperatorId: string | null | undefined) {
  const scope = operatorScope(user);
  if (scope && recordOperatorId !== scope) {
    throw forbidden("That record belongs to another transport company.");
  }
}

/* -------------------------------------------------------------------------- */
/* Capabilities                                                               */
/* -------------------------------------------------------------------------- */

/**
 * What each role may do, in one table.
 *
 * Endpoint guards used to name roles directly — `requireStaff`, which meant
 * "STAFF or ADMIN" and quietly became wrong the moment there were nine roles.
 * Naming the *capability* instead means adding a role is an edit to this table
 * rather than an audit of every handler.
 */
export const CAPABILITIES = {
  /** Fleet: add, edit and retire vehicles. */
  MANAGE_FLEET: ["SUPER_ADMIN", "COMPANY_ADMIN", "ROUTE_MANAGER"],
  /** Timetable: create departures, schedule templates, assign crew. */
  MANAGE_SCHEDULE: ["SUPER_ADMIN", "COMPANY_ADMIN", "ROUTE_MANAGER"],
  /** Corridors themselves — platform infrastructure. */
  MANAGE_NETWORK: ["SUPER_ADMIN"],
  /** Pricing. Deliberately excludes the route manager. */
  MANAGE_FARES: ["SUPER_ADMIN", "COMPANY_ADMIN"],
  /** Staff accounts within a company. */
  MANAGE_STAFF: ["SUPER_ADMIN", "COMPANY_ADMIN"],
  /** Operator onboarding and platform configuration. */
  MANAGE_PLATFORM: ["SUPER_ADMIN"],
  /** Sell at the counter and amend bookings. */
  SELL_TICKETS: ["SUPER_ADMIN", "COMPANY_ADMIN", "BOOKING_STAFF"],
  /** Scan a boarding pass at the gate or on the bus. */
  SCAN_TICKETS: ["SUPER_ADMIN", "COMPANY_ADMIN", "BOOKING_STAFF", "CONDUCTOR"],
  /** Use the ticket-verification desk: look a ticket up by its code and act on it. */
  VERIFY_TICKETS: ["SUPER_ADMIN", "COMPANY_ADMIN", "BOOKING_STAFF"],
  /** Override a completed verification — undo a verify or a boarding. Admins only. */
  OVERRIDE_VERIFICATION: ["SUPER_ADMIN", "COMPANY_ADMIN"],
  /** Read the passenger manifest, with names. */
  VIEW_MANIFEST: ["SUPER_ADMIN", "COMPANY_ADMIN", "ROUTE_MANAGER", "BOOKING_STAFF", "CONDUCTOR"],
  /** Report a trip departed or arrived. */
  OPERATE_TRIP: ["SUPER_ADMIN", "COMPANY_ADMIN", "ROUTE_MANAGER", "DRIVER"],
  /** Read any passenger's booking — customer care across companies. */
  VIEW_ANY_BOOKING: ["SUPER_ADMIN", "PLATFORM_SUPPORT"],
  /** Cancel someone else's booking. */
  CANCEL_ANY_BOOKING: ["SUPER_ADMIN", "PLATFORM_SUPPORT", "COMPANY_ADMIN", "BOOKING_STAFF"],
  /** Approve or reject a refund. Separated from booking modification on purpose. */
  APPROVE_REFUNDS: ["SUPER_ADMIN", "COMPANY_ADMIN", "FINANCE_OFFICER"],
  /** Revenue, payments, reconciliation. */
  VIEW_FINANCE: ["SUPER_ADMIN", "COMPANY_ADMIN", "FINANCE_OFFICER"],
  /** Operational dashboards and analytics. */
  VIEW_ANALYTICS: ["SUPER_ADMIN", "COMPANY_ADMIN", "ROUTE_MANAGER", "FINANCE_OFFICER"],
  /** The audit trail. Company admins see their own; super admins see everything. */
  VIEW_AUDIT: ["SUPER_ADMIN", "COMPANY_ADMIN"],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

export const can = (role: Role, capability: Capability): boolean =>
  (CAPABILITIES[capability] as readonly Role[]).includes(role);

/** Every capability a role holds — handed to the client so the UI can hide what it must not offer. */
export function capabilitiesFor(role: Role): Capability[] {
  return (Object.keys(CAPABILITIES) as Capability[]).filter((c) => can(role, c));
}
