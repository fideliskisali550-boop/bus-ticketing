import { requireUser } from "@/lib/api";
import { subscribe } from "@/lib/stream";

/**
 * The live update channel.
 *
 * Holds one Server-Sent Events connection per open dashboard. The server pushes
 * the *name* of what changed; the client re-fetches the queries that care. See
 * `lib/stream.ts` for why nothing more than a name travels.
 */

// Node runtime, not Edge: the subscriber registry lives in module scope and
// must be the same instance the event bus publishes into.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Long enough to keep proxies from reaping an idle connection, short enough
 * that a client which has silently gone away is noticed.
 */
const HEARTBEAT_MS = 25_000;

export async function GET(req: Request) {
  const user = await requireUser(req);

  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (line: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(line));
        } catch {
          closed = true;
        }
      };

      // Tell the client it is connected before anything happens, so a dashboard
      // can show a live indicator rather than guessing.
      send(`event: ready\ndata: ${JSON.stringify({ role: user.role })}\n\n`);

      const unsubscribe = subscribe(user.operatorId ?? null, user.role, send);

      // A comment line is a valid SSE keep-alive and is ignored by clients.
      heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);

      cleanup = () => {
        closed = true;
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
      };

      // The browser closing the tab aborts the request; without this the
      // subscriber list would grow for the lifetime of the process.
      req.signal.addEventListener("abort", () => {
        cleanup?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      // Tells nginx not to buffer, which would defeat the whole mechanism.
      "X-Accel-Buffering": "no",
    },
  });
}
