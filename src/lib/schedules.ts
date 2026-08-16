import "server-only";
import { db } from "./db";
import { kenyanDayStart } from "./time";
import { badRequest } from "./errors";

/**
 * Recurring timetables.
 *
 * Operators do not schedule departures one at a time — they run the 07:00 to
 * Mombasa every weekday. Until now the only way to express that was to create
 * each departure by hand, which meant a change of departure time was forty
 * edits and a new month of service was a data-entry exercise.
 *
 * A template stores the pattern; generation projects it forward into real
 * `Trip` rows on a rolling horizon. Trips stay the unit everything else reads,
 * so search, availability and manifests need no knowledge of any of this.
 */

/** How far ahead departures are published. */
export const HORIZON_DAYS = 30;

export type GenerationResult = {
  created: number;
  skipped: number;
  horizonTo: Date;
};

/**
 * Projects one template forward, creating any departure that does not exist.
 *
 * Idempotent by design: it is safe to run repeatedly, on a schedule or from a
 * button, because a departure already generated for a given day is recognised
 * and left alone. Anything else would double the timetable every time somebody
 * pressed refresh.
 */
export async function generateFromTemplate(
  templateId: string,
  { days = HORIZON_DAYS }: { days?: number } = {},
): Promise<GenerationResult> {
  const template = await db.scheduleTemplate.findUnique({
    where: { id: templateId },
    include: {
      route: { select: { durationMin: true } },
      bus: { select: { id: true, operatorId: true } },
    },
  });

  if (!template) throw badRequest("That schedule could not be found.");
  if (!template.busId || !template.bus) {
    throw badRequest("Assign a bus to the schedule before generating departures.");
  }

  const daysOfWeek = JSON.parse(template.daysOfWeek) as number[];
  if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0) {
    throw badRequest("Choose at least one day of the week.");
  }

  const [hour, minute] = template.departureTime.split(":").map(Number);
  if (hour === undefined || minute === undefined) {
    throw badRequest("Departure time must look like 07:30.");
  }

  const today = new Date();
  const horizonTo = new Date(today.getTime() + days * 86_400_000);

  // Everything this template has already produced in the window, so a re-run
  // adds only what is missing.
  const existing = await db.trip.findMany({
    where: {
      scheduleTemplateId: templateId,
      departureAt: { gte: today, lte: horizonTo },
    },
    select: { departureAt: true },
  });
  const already = new Set(existing.map((t) => t.departureAt.toISOString()));

  const rows: {
    routeId: string;
    busId: string;
    driverId: string | null;
    conductorId: string | null;
    scheduleTemplateId: string;
    departureAt: Date;
    arrivalAt: Date;
    fare: number;
  }[] = [];

  let skipped = 0;

  for (let i = 0; i < days; i++) {
    const dayStartMs = kenyanDayStart(
      new Date(today.getTime() + i * 86_400_000).toISOString().slice(0, 10),
    );

    // The weekday is the Kenyan one. Deriving it from a UTC timestamp would put
    // a 01:00 departure on the wrong day of the week for a third of the night.
    const weekday = new Date(dayStartMs + 12 * 3_600_000).getUTCDay();
    if (!daysOfWeek.includes(weekday)) continue;

    const departureAt = new Date(dayStartMs + (hour * 60 + minute) * 60_000);

    if (departureAt < today) continue;
    if (template.validFrom > departureAt) continue;
    if (template.validTo && template.validTo < departureAt) continue;

    if (already.has(departureAt.toISOString())) {
      skipped++;
      continue;
    }

    rows.push({
      routeId: template.routeId,
      busId: template.busId,
      driverId: template.driverId,
      conductorId: template.conductorId,
      scheduleTemplateId: templateId,
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + template.route.durationMin * 60_000),
      fare: template.fare,
    });
  }

  // A bus cannot be in two places at once. Any generated departure that would
  // overlap something the vehicle is already committed to is dropped rather
  // than double-booking the fleet.
  const conflicts = await db.trip.findMany({
    where: {
      busId: template.busId,
      departureAt: { gte: today, lte: horizonTo },
      status: { not: "CANCELLED" },
      scheduleTemplateId: { not: templateId },
    },
    select: { departureAt: true, arrivalAt: true },
  });

  const clear = rows.filter((row) => {
    const clash = conflicts.some(
      (c) => row.departureAt < c.arrivalAt && c.departureAt < row.arrivalAt,
    );
    if (clash) skipped++;
    return !clash;
  });

  if (clear.length) {
    await db.trip.createMany({ data: clear });
  }

  return { created: clear.length, skipped, horizonTo };
}

/** Runs generation for every active template of an operator, or of all. */
export async function generateAll(operatorId?: string | null) {
  const templates = await db.scheduleTemplate.findMany({
    where: { isActive: true, ...(operatorId ? { operatorId } : {}) },
    select: { id: true },
  });

  let created = 0;
  let skipped = 0;

  for (const { id } of templates) {
    try {
      const result = await generateFromTemplate(id);
      created += result.created;
      skipped += result.skipped;
    } catch (error) {
      // One misconfigured template — no bus assigned, say — must not stop the
      // rest of the timetable being published.
      console.error(`[schedules] template ${id} failed`, error);
    }
  }

  return { templates: templates.length, created, skipped };
}
