"use client";

import NextLink from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { forwardRef, useCallback, useMemo, useSyncExternalStore } from "react";
import { getSessionId, subscribeToSession } from "@/lib/session-store";

/**
 * Navigation that keeps the tab's account attached.
 *
 * The tab's chosen session travels in the URL as `?u=`, because that is the
 * only thing a browser sends on a page navigation which can differ between
 * tabs. It follows that every internal link has to carry it — a single plain
 * `<Link>` drops the parameter and the next server render silently falls back
 * to whichever account signed in most recently, which is the exact bug this
 * mechanism exists to prevent.
 *
 * So `Link` and `useTabRouter` here wrap the Next.js versions and re-attach the
 * parameter. Import these instead of `next/link` anywhere inside the app.
 */

// Single definition, shared with the middleware and the server.
export { SESSION_PARAM } from "@/lib/session-constants";
import { SESSION_PARAM } from "@/lib/session-constants";

/**
 * Reads the tab's session id: the URL first, then this tab's storage.
 *
 * The storage read has to be deferred past hydration. `sessionStorage` does not
 * exist on the server, so reading it during render gives `null` there and the
 * real id in the browser — and a link that renders `/search` on the server but
 * `/search?u=…` on the client is exactly the attribute mismatch React refuses
 * to reconcile. `useSyncExternalStore` with a `null` server snapshot makes the
 * first client render match the server, then re-renders with the stored value
 * once mounted, which React allows.
 *
 * The URL parameter, by contrast, is identical on both sides, so it is read
 * directly and still takes priority.
 */
export function useTabSessionId(): string | null {
  const params = useSearchParams();
  const stored = useSyncExternalStore(
    subscribeToSession,
    getSessionId,
    () => null,
  );
  return params.get(SESSION_PARAM) ?? stored;
}

/**
 * A plain-`<a>` href that carries the tab's account as `?sid=`.
 *
 * For links the browser hits directly — a PDF download, a spreadsheet export —
 * that never pass through the client `api()` helper and so cannot send the
 * `X-Session-Id` header. It is a hook rather than a plain function
 * because it has to read the session the hydration-safe way: computing the href
 * from `sessionStorage` during render gives one value on the server and another
 * in the browser, which is the attribute mismatch that lit up the console.
 */
export function useSessionHref(path: string): string {
  const sessionId = useTabSessionId();
  if (!sessionId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}sid=${encodeURIComponent(sessionId)}`;
}

/** Appends `?u=` to a path unless it already carries one or is external. */
export function withTabSession(href: string, sessionId: string | null): string {
  if (!sessionId) return href;

  // Absolute URLs, anchors and non-http schemes are left alone.
  if (/^([a-z]+:)?\/\//i.test(href) || href.startsWith("#") || href.startsWith("mailto:")) {
    return href;
  }

  const [path, hash] = href.split("#");
  const [base, query = ""] = path!.split("?");

  const search = new URLSearchParams(query);
  if (search.has(SESSION_PARAM)) return href;
  search.set(SESSION_PARAM, sessionId);

  return `${base}?${search.toString()}${hash ? `#${hash}` : ""}`;
}

type LinkProps = React.ComponentProps<typeof NextLink>;

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, ...rest },
  ref,
) {
  const sessionId = useTabSessionId();

  const resolved = useMemo(() => {
    if (typeof href !== "string") return href;
    return withTabSession(href, sessionId);
  }, [href, sessionId]);

  return <NextLink ref={ref} href={resolved} {...rest} />;
});

/** `useRouter`, with the tab's account preserved on push and replace. */
export function useTabRouter() {
  const router = useRouter();
  const sessionId = useTabSessionId();

  const push = useCallback(
    (href: string) => router.push(withTabSession(href, sessionId)),
    [router, sessionId],
  );

  const replace = useCallback(
    (href: string) => router.replace(withTabSession(href, sessionId)),
    [router, sessionId],
  );

  return useMemo(
    () => ({ push, replace, refresh: router.refresh, back: router.back }),
    [push, replace, router.refresh, router.back],
  );
}
