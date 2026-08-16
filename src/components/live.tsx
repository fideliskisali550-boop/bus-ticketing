"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { useTabSessionId } from "@/components/tab-link";
import { SIGNED_OUT_SESSION } from "@/lib/session-constants";

/**
 * Live dashboard updates.
 *
 * Every operational screen used to fetch once on mount and never again, so a
 * booking taken at the counter stayed invisible on the manager's dashboard
 * until somebody pressed reload. With several people working the same departure
 * that is not cosmetic: two clerks selling from stale seat maps is how a bus
 * gets sold twice.
 *
 * One EventSource is shared by the whole page. Components say which events they
 * care about and get a callback; the server pushes only the event *name*, and
 * the component re-fetches its own query. Nothing about the change travels down
 * the stream — see `lib/stream.ts` for why.
 */

type Handler = (event: { type: string; subjectId: string | null }) => void;

type LiveContext = {
  /** Registers interest in a set of event types. Returns an unsubscribe. */
  on: (types: string[], handler: Handler) => () => void;
  connected: boolean;
};

const Ctx = createContext<LiveContext>({ on: () => () => {}, connected: false });

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const handlers = useRef(new Set<{ types: string[]; handler: Handler }>());
  const sessionId = useTabSessionId();

  useEffect(() => {
    // Nothing to stream to a page nobody is signed into. Opening the connection
    // anyway meant an anonymous visitor's browser hammered /api/stream, each
    // attempt returning 401 and being logged on the server — a wall of "must be
    // signed in" errors in the console the moment the home or login page
    // loaded. A signed-in tab connects exactly as before; a signed-out one, or
    // one showing the signed-out sentinel, simply does not.
    if (!sessionId || sessionId === SIGNED_OUT_SESSION) {
      setConnected(false);
      return;
    }

    // The stream must resolve the same account this tab is acting as, so the
    // per-tab session id travels in the query string — EventSource cannot set
    // headers, which is the same constraint that shaped the whole tab-session
    // mechanism.
    const url = `/api/stream?sid=${encodeURIComponent(sessionId)}`;

    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      source = new EventSource(url);

      source.addEventListener("ready", () => {
        attempts = 0;
        setConnected(true);
      });

      source.addEventListener("domain", (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data) as {
            type: string;
            subjectId: string | null;
          };
          for (const { types, handler } of handlers.current) {
            if (types.includes(payload.type) || types.includes("*")) handler(payload);
          }
        } catch {
          /* a malformed frame must not take the stream down */
        }
      });

      source.onerror = () => {
        setConnected(false);
        source?.close();
        // Back off rather than hammering a server that may be restarting.
        const delay = Math.min(30_000, 1000 * 2 ** attempts++);
        retry = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, [sessionId]);

  const on = useCallback((types: string[], handler: Handler) => {
    const entry = { types, handler };
    handlers.current.add(entry);
    return () => {
      handlers.current.delete(entry);
    };
  }, []);

  return <Ctx.Provider value={{ on, connected }}>{children}</Ctx.Provider>;
}

/**
 * Re-runs `refresh` whenever one of `types` happens.
 *
 * The polling fallback is not redundancy for its own sake: a dashboard that has
 * silently lost its stream and shows a frozen number is worse than one that
 * never claimed to be live, and there is no way for the client to distinguish
 * "nothing has happened" from "I am no longer being told".
 */
export function useLive(
  types: string[],
  refresh: () => void,
  { pollMs = 60_000 }: { pollMs?: number } = {},
) {
  const { on, connected } = useContext(Ctx);
  const saved = useRef(refresh);
  saved.current = refresh;

  useEffect(() => {
    const off = on(types, () => saved.current());
    return off;
    // `types` is a literal array at every call site; joining keeps the identity
    // stable without asking every caller to memoise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, types.join(",")]);

  useEffect(() => {
    if (!pollMs) return;
    const timer = setInterval(() => saved.current(), pollMs);
    return () => clearInterval(timer);
  }, [pollMs]);

  return { connected };
}

/** Small "live" indicator, so a stalled stream is visible rather than silent. */
export function LiveDot({ className = "" }: { className?: string }) {
  const { connected } = useContext(Ctx);
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${className}`}
      title={connected ? "Updating live" : "Reconnecting…"}
    >
      <span className="relative flex h-2 w-2">
        {connected && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
        )}
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${connected ? "bg-ok" : "bg-muted/50"}`}
        />
      </span>
      <span className="text-muted">{connected ? "Live" : "Reconnecting"}</span>
    </span>
  );
}
