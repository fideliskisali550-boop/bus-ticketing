"use client";

/**
 * The tab's chosen account.
 *
 * `sessionStorage` is per-tab by definition: open a second tab and it starts
 * empty, which is exactly the isolation we want. What lives here is only an
 * opaque session *id*, never a token — the credential itself stays in the
 * httpOnly cookie, unreachable from JavaScript. Reading this value tells an
 * attacker which of several sessions a tab prefers and nothing more.
 */

const KEY = "sc_session_id";

/** Notifies components in this tab when the active account changes. */
const listeners = new Set<() => void>();

export function getSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    // Private browsing modes can throw on sessionStorage access. Falling back
    // to "no id" means the tab uses the default session rather than breaking.
    return null;
  }
}

export function setSessionId(sessionId: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (sessionId) window.sessionStorage.setItem(KEY, sessionId);
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Ignore — see above.
  }
  for (const listener of listeners) listener();
}

export function subscribeToSession(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * A brand-new tab has no id, so it would fall back to whichever account signed
 * in last. Copying the current default into this tab's storage on first load
 * pins it, so a later sign-in in another tab cannot change what this tab shows.
 */
export function adoptSessionId(sessionId: string | null | undefined) {
  if (!sessionId) return;
  if (getSessionId()) return;
  setSessionId(sessionId);
}
