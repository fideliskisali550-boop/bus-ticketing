import { z } from "zod";
import { MAX_SEATS_PER_BOOKING, normalizePhone } from "./policy";

/**
 * Every request body is validated here before it reaches business logic. Input
 * validation is the first line of defence — Prisma parameterises queries so SQL
 * injection is structurally prevented, but type confusion and oversized payloads
 * are not.
 */

const phone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const normalized = normalizePhone(v);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid Kenyan phone number, e.g. 0712 345 678.",
      });
      return z.NEVER;
    }
    return normalized;
  });

/**
 * Length floor plus a character-class requirement. Deliberately not a maze of
 * rules — NIST guidance favours length over composition, and an 8-char minimum
 * with mixed classes blocks the passwords that actually appear in breach lists.
 */
const password = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password is too long.")
  .regex(/[a-z]/, "Include at least one lowercase letter.")
  .regex(/[A-Z]/, "Include at least one uppercase letter.")
  .regex(/\d/, "Include at least one number.");

const name = z.string().trim().min(2, "Please enter a full name.").max(80);

export const registerSchema = z.object({
  fullName: name,
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  phone,
  password,
  nationalId: z.string().trim().max(20).optional().or(z.literal("")),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export const updateProfileSchema = z.object({
  fullName: name.optional(),
  phone: phone.optional(),
  nationalId: z.string().trim().max(20).optional().or(z.literal("")),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: password,
});

/**
 * Base shape kept separate from `routeSchema` because the cross-field `.refine`
 * below produces a ZodEffects, which has no `.partial()` — and PATCH needs one.
 */
const routeFields = z
  .object({
    origin: z.string().trim().min(2).max(60),
    destination: z.string().trim().min(2).max(60),
    distanceKm: z.coerce.number().int().min(1).max(5000),
    durationMin: z.coerce.number().int().min(10).max(4320),
    /**
     * Either a bare name or a fully described stop. Both are accepted so that
     * anything written against the older API keeps working; `serializeStops`
     * normalises the two into one stored shape.
     */
    stops: z
      .array(
        z.union([
          z.string().trim().min(1).max(60),
          z.object({
            name: z.string().trim().min(1).max(60),
            offsetMin: z.number().int().min(0).max(60 * 72).nullable().optional(),
            pickup: z.boolean().optional(),
            dropoff: z.boolean().optional(),
          }),
        ]),
      )
      .max(30)
      .default([]),
    /// Optional on input: when omitted the fare engine estimates one from the
    /// distance, so an operator adding a route is never forced to invent a
    /// number on the spot.
    baseFare: z.coerce
      .number()
      .int()
      .min(50, "A fare of less than KES 50 is not realistic.")
      .max(20000, "A fare above KES 20,000 is not realistic for a bus journey.")
      .optional(),
    isInternational: z.boolean().default(false),
    fareChangeReason: z.string().trim().max(200).optional().or(z.literal("")),
    isActive: z.boolean().default(true),
  });

const differentEndpoints = (v: { origin?: string; destination?: string }) =>
  !v.origin || !v.destination || v.origin.toLowerCase() !== v.destination.toLowerCase();

export const routeSchema = routeFields.refine(differentEndpoints, {
  message: "Origin and destination cannot be the same place.",
  path: ["destination"],
});

/** PATCH accepts any subset; the endpoint check applies only if both are sent. */
export const routeUpdateSchema = routeFields.partial().refine(differentEndpoints, {
  message: "Origin and destination cannot be the same place.",
  path: ["destination"],
});

export const busSchema = z.object({
  registration: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^K[A-Z]{2} \d{3}[A-Z]$/, "Use the Kenyan plate format, e.g. KDA 123B."),
  model: z.string().trim().min(2).max(60),
  capacity: z.coerce.number().int().min(10).max(80),
  seatsPerRow: z.coerce.number().int().min(2).max(6).default(4),
  aisleAfter: z.coerce.number().int().min(1).max(5).default(2),
  hasWifi: z.boolean().default(false),
  hasChargingPorts: z.boolean().default(false),
  hasToilet: z.boolean().default(false),
  hasAirCon: z.boolean().default(true),
  status: z.enum(["ACTIVE", "MAINTENANCE", "RETIRED"]).default("ACTIVE"),
});

/**
 * Base shape kept separate from `tripSchema` because the cross-field `.refine`
 * below produces a ZodEffects, which has no `.partial()` — and PATCH needs one.
 */
const tripFields = z.object({
    routeId: z.string().min(1, "Choose a route."),
    busId: z.string().min(1, "Choose a bus."),
    driverId: z.string().optional().or(z.literal("")),
    departureAt: z.coerce.date(),
    arrivalAt: z.coerce.date(),
    /// Optional: when omitted the fare engine derives it from the route's
    /// market rate and the class of the assigned vehicle, which is the normal
    /// path. Supplying one is an override, and it is sanity-checked against
    /// the corridor's base fare before it is accepted.
    fare: z.coerce
      .number()
      .int()
      .min(50, "Fare must be at least KES 50.")
      .max(20000, "A fare above KES 20,000 is not realistic for a bus journey.")
      .optional(),
    status: z
      .enum(["SCHEDULED", "BOARDING", "DEPARTED", "ARRIVED", "CANCELLED"])
      .default("SCHEDULED"),
});

export const tripSchema = tripFields.refine(
  (v) => v.arrivalAt > v.departureAt,
  { message: "Arrival must be after departure.", path: ["arrivalAt"] },
);

/** PATCH accepts any subset, so the cross-field rule is applied conditionally. */
export const tripUpdateSchema = tripFields.partial().refine(
  (v) => !v.arrivalAt || !v.departureAt || v.arrivalAt > v.departureAt,
  { message: "Arrival must be after departure.", path: ["arrivalAt"] },
);

export const createBookingSchema = z.object({
  tripId: z.string().min(1),
  seats: z
    .array(
      z.object({
        seatNumber: z.string().trim().regex(/^\d{1,2}[A-F]$/, "Invalid seat."),
        passengerName: name,
        passengerPhone: phone,
        passengerIdNo: z.string().trim().max(20).optional().or(z.literal("")),
      }),
    )
    .min(1, "Select at least one seat.")
    .max(MAX_SEATS_PER_BOOKING, `You may book at most ${MAX_SEATS_PER_BOOKING} seats at once.`)
    .refine(
      (seats) => new Set(seats.map((s) => s.seatNumber)).size === seats.length,
      "The same seat was selected twice.",
    ),
});

export const payInitSchema = z.object({
  bookingId: z.string().min(1),
  method: z.enum(["MPESA", "CARD", "CASH"]).default("MPESA"),
  phone: phone.optional(),
});

export const cancelBookingSchema = z.object({
  reason: z.string().trim().max(300).optional().or(z.literal("")),
});

export const checkInSchema = z.object({
  qrToken: z.string().trim().min(10, "Scan or paste a valid ticket code."),
});

/** An action taken from the ticket-verification desk against one ticket. */
export const verifyActionSchema = z.object({
  ticketId: z.string().min(1),
  action: z.enum(["verify", "board", "reject", "cancel"]),
  reason: z.string().trim().max(300).optional().or(z.literal("")),
  /** Set by an administrator to push past a duplicate-verification guard. */
  override: z.boolean().optional(),
});

export const adminUserSchema = z.object({
  fullName: name,
  email: z.string().trim().toLowerCase().email(),
  phone,
  password,
  role: z.enum(["SUPER_ADMIN", "PLATFORM_SUPPORT", "COMPANY_ADMIN", "ROUTE_MANAGER", "FINANCE_OFFICER", "BOOKING_STAFF", "CONDUCTOR", "DRIVER", "PASSENGER"]),
  /// Only a platform administrator may name the company; a company admin's
  /// own operator is used instead.
  operatorId: z.string().optional(),
});

export const updateUserSchema = z.object({
  role: z.enum(["SUPER_ADMIN", "PLATFORM_SUPPORT", "COMPANY_ADMIN", "ROUTE_MANAGER", "FINANCE_OFFICER", "BOOKING_STAFF", "CONDUCTOR", "DRIVER", "PASSENGER"]).optional(),
  isActive: z.boolean().optional(),
});
