/**
 * How roles are described to people, and which capabilities each one holds.
 *
 * Client-safe: no server imports, so the navigation and any screen can decide
 * what to offer without a round trip. It is a *presentation* mirror of
 * `lib/scope.ts` — every real decision is still made server-side, because a
 * capability list in the browser is a hint about what to render, never a
 * security boundary.
 */

export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Administrator",
  PLATFORM_SUPPORT: "Support",
  COMPANY_ADMIN: "Company admin",
  ROUTE_MANAGER: "Operations",
  FINANCE_OFFICER: "Finance",
  BOOKING_STAFF: "Booking staff",
  CONDUCTOR: "Conductor",
  DRIVER: "Driver",
  PASSENGER: "Passenger",
};

/** One line on what the role is for, shown on the account switcher. */
export const ROLE_BLURB: Record<string, string> = {
  SUPER_ADMIN: "Runs the platform",
  PLATFORM_SUPPORT: "Helps passengers across companies",
  COMPANY_ADMIN: "Runs one transport company",
  ROUTE_MANAGER: "Timetable, fleet and crew",
  FINANCE_OFFICER: "Payments, refunds and revenue",
  BOOKING_STAFF: "Sells tickets and boards passengers",
  CONDUCTOR: "Manifest and boarding",
  DRIVER: "Departures and arrivals",
  PASSENGER: "Books and travels",
};

/** Colour of the role chip; platform roles read as brand, crew as accent. */
export const ROLE_TONE: Record<string, string> = {
  SUPER_ADMIN: "text-brand",
  PLATFORM_SUPPORT: "text-brand",
  COMPANY_ADMIN: "text-accent",
  ROUTE_MANAGER: "text-accent",
  FINANCE_OFFICER: "text-accent",
  BOOKING_STAFF: "text-accent",
  CONDUCTOR: "text-warn",
  DRIVER: "text-warn",
  PASSENGER: "text-muted",
};

/** Roles that get the back-office shell at /admin. */
export const OFFICE = new Set([
  "SUPER_ADMIN",
  "PLATFORM_SUPPORT",
  "COMPANY_ADMIN",
  "ROUTE_MANAGER",
  "FINANCE_OFFICER",
  "BOOKING_STAFF",
]);

/** Roles whose home is the crew screen: their own trips and nothing else. */
export const CREW = new Set(["DRIVER", "CONDUCTOR"]);

export const isOfficeRole = (role?: string | null) => Boolean(role && OFFICE.has(role));
export const isCrewRole = (role?: string | null) => Boolean(role && CREW.has(role));

/**
 * Which back-office sections a role should be offered.
 *
 * Mirrors CAPABILITIES in `lib/scope.ts`. Showing a finance officer a fleet
 * screen that refuses every action is worse than not showing it: it reads as a
 * broken system rather than a boundary.
 */
export const SECTIONS: Record<string, string[]> = {
  overview: ["SUPER_ADMIN", "COMPANY_ADMIN", "ROUTE_MANAGER", "FINANCE_OFFICER"],
  reports: ["SUPER_ADMIN", "COMPANY_ADMIN", "ROUTE_MANAGER", "FINANCE_OFFICER"],
  bookings: ["SUPER_ADMIN", "PLATFORM_SUPPORT", "COMPANY_ADMIN", "BOOKING_STAFF"],
  trips: ["SUPER_ADMIN", "COMPANY_ADMIN", "ROUTE_MANAGER"],
  schedules: ["SUPER_ADMIN", "COMPANY_ADMIN", "ROUTE_MANAGER"],
  buses: ["SUPER_ADMIN", "COMPANY_ADMIN", "ROUTE_MANAGER"],
  routes: ["SUPER_ADMIN", "COMPANY_ADMIN", "ROUTE_MANAGER"],
  refunds: ["SUPER_ADMIN", "COMPANY_ADMIN", "FINANCE_OFFICER"],
  checkin: ["SUPER_ADMIN", "COMPANY_ADMIN", "BOOKING_STAFF"],
  users: ["SUPER_ADMIN", "COMPANY_ADMIN"],
  audit: ["SUPER_ADMIN", "COMPANY_ADMIN"],
};

export const canSee = (role: string | undefined | null, section: string) =>
  Boolean(role && SECTIONS[section]?.includes(role));

/**
 * Who may hold several signed-in identities in one browser and switch between
 * them from the account menu.
 *
 * This is impersonation, and it is a platform-administrator power — not a
 * convenience for everyone. A passenger or a booking clerk seeing a list of
 * other people's accounts (an administrator, a company admin, a conductor) and
 * stepping into them with one click is both a privacy leak — it discloses who
 * else uses the machine and in what role — and a plausible way to end up acting
 * as an account you were never authorised to hold. Every other role sees only
 * their own account: their profile, and sign out.
 *
 * Per-tab session isolation is unaffected. Different tabs can still be different
 * accounts; this governs only the in-app switcher, not how a tab resolves its
 * own identity.
 */
export const canSwitchAccounts = (role: string | undefined | null) =>
  role === "SUPER_ADMIN";
