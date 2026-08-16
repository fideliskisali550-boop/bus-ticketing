import "server-only";
import { db } from "./db";

/** Keys whose values must never reach the audit table in plain text. */
const REDACTED = new Set([
  "password",
  "passwordHash",
  "confirmPassword",
  "currentPassword",
  "newPassword",
  "token",
  "qrToken",
  "tokenHash",
]);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        REDACTED.has(k) ? "[redacted]" : redact(v),
      ]),
    );
  }
  return value;
}

type AuditInput = {
  userId?: string | null;
  action: string;
  /** Which company the action concerns, so a company admin can read their own
   *  history without being shown the platform-wide trail. */
  operatorId?: string | null;
  entity: string;
  entityId?: string | null;
  metadata?: unknown;
  req?: Request;
};

/**
 * Appends to the immutable audit trail. Deliberately never throws: an audit
 * write failing must not roll back the business action the user just completed.
 * Failures are logged for the operator to notice.
 */
export async function audit({
  userId,
  operatorId,
  action,
  entity,
  entityId,
  metadata,
  req,
}: AuditInput) {
  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        operatorId: operatorId ?? null,
        action,
        entity,
        entityId: entityId ?? null,
        metadata: metadata ? JSON.stringify(redact(metadata)) : null,
        ipAddress:
          req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: req?.headers.get("user-agent")?.slice(0, 255) ?? null,
      },
    });
  } catch (error) {
    console.error("[audit] failed to record", action, error);
  }
}
