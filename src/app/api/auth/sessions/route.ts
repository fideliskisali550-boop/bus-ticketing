import { handler, ok } from "@/lib/api";
import { listSessions } from "@/lib/auth";

/**
 * Every account currently signed in on this browser, for the account switcher.
 *
 * Returns identities only — never the tokens behind them, which stay in the
 * httpOnly cookie where JavaScript cannot reach them.
 */
export async function GET() {
  return handler(async () => {
    const sessions = await listSessions();
    return ok({ sessions });
  });
}
