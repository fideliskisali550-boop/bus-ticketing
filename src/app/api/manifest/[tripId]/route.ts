import { handler, ok, requireUser } from "@/lib/api";
import { getManifest } from "@/lib/manifest";

/**
 * Who is on this bus.
 *
 * Authorisation is inside `getManifest`, not here, because the answer differs
 * by role rather than being a yes/no: a conductor gets names, a driver gets
 * counts, and anybody not rostered on the departure gets nothing.
 */
type Ctx = { params: Promise<{ tripId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return handler(async () => {
    const user = await requireUser(req);
    const { tripId } = await params;
    return ok(await getManifest(tripId, user));
  });
}
