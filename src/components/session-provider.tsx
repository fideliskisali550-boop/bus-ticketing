"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { api, post } from "@/lib/client";
import {
  adoptSessionId,
  getSessionId,
  setSessionId,
  subscribeToSession,
} from "@/lib/session-store";
import { SESSION_PARAM } from "@/components/tab-link";
import { SIGNED_OUT_SESSION } from "@/lib/session-constants";

/**
 * Resolves who *this tab* is.
 *
 * Identity is settled on the client rather than at render time on the server,
 * because the tab's chosen account travels in a header that server rendering
 * never sees. The server still enforces every permission — this only decides
 * what the interface shows.
 */

export type SessionAccount = {
  sessionId: string;
  id: string;
  fullName: string;
  email: string;
  role: string;
  /** Which transport company, if any. Null for passengers and platform staff. */
  operatorId?: string | null;
};

type SessionContextValue = {
  user: SessionAccount | null;
  accounts: SessionAccount[];
  loading: boolean;
  /** Switch this tab to another already signed-in account. */
  switchTo: (sessionId: string) => void;
  /** Sign this tab's account out, leaving other tabs untouched. */
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue>({
  user: null,
  accounts: [],
  loading: true,
  switchTo: () => undefined,
  signOut: async () => undefined,
  refresh: async () => undefined,
});

export const useSession = () => useContext(SessionContext);

export function SessionProvider({
  /** The server's best guess, used to avoid a blank header on first paint. */
  initialUser,
  children,
}: {
  initialUser: SessionAccount | null;
  children: ReactNode;
}) {
  const [user, setUser] = useState<SessionAccount | null>(initialUser);
  const [accounts, setAccounts] = useState<SessionAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [me, all] = await Promise.all([
        api<{ user: SessionAccount | null }>("/api/auth/me"),
        api<{ sessions: SessionAccount[] }>("/api/auth/sessions"),
      ]);
      setUser(me.user);
      setAccounts(all.sessions);
    } catch {
      setUser(null);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The server resolved this render from `?u=` when present, so its answer is
    // authoritative for this tab.
    //
    // `adopt` alone was not enough: it only fills an *empty* slot, so a tab
    // that already held one account and then followed a link carrying a
    // different `?u=` kept the old id in storage. The page then rendered as one
    // account on the server while every `api()` call sent the header of
    // another, and the client would bounce a perfectly valid administrator back
    // to a passenger dashboard. An explicit id in the URL has to win.
    const fromUrl = new URLSearchParams(window.location.search).get(SESSION_PARAM);
    const stored = getSessionId();

    if (fromUrl) {
      if (fromUrl !== stored) setSessionId(fromUrl);
      load();
      return;
    }

    /**
     * No `?u=` in the URL, but this tab holds a session.
     *
     * The server can no longer guess an identity from an unattributed request —
     * that guess was what leaked sessions between tabs — so a bookmark or a
     * hand-typed URL would otherwise render this tab as signed out even though
     * it has an account. Putting the id back and replacing the entry restores
     * it, and `replace` rather than `assign` keeps the Back button working
     * instead of trapping the user on a redirect loop.
     *
     * The sentinel is excluded deliberately: a tab that signed out has a stored
     * value, but restoring it would only reassert "signed out", and doing so
     * through a navigation would loop.
     */
    if (stored && stored !== SIGNED_OUT_SESSION) {
      const url = new URL(window.location.href);
      url.searchParams.set(SESSION_PARAM, stored);
      window.location.replace(url.toString());
      return;
    }

    // Genuinely nothing: a brand-new tab. It stays signed out rather than
    // inheriting whichever account signed in most recently.
    load();
  }, [initialUser?.sessionId, load]);

  // Re-resolve whenever this tab's chosen account changes.
  useEffect(() => {
    const unsubscribe = subscribeToSession(() => void load());
    return () => {
      unsubscribe();
    };
  }, [load]);

  const switchTo = useCallback(
    (sessionId: string) => {
      setSessionId(sessionId);

      // Rewrite the URL so the *server* renders as the new account. A
      // client-side refresh alone is not enough: server components read the
      // account from `?u=`, and without changing it the next render would
      // still resolve whoever signed in most recently.
      const url = new URL(window.location.href);
      url.searchParams.set("u", sessionId);

      // A full load, because the router caches server payloads per URL and the
      // previous account's markup would otherwise flash back.
      window.location.assign(url.toString());
    },
    [],
  );

  const signOut = useCallback(async () => {
    // Signs out only this tab's account; the envelope keeps the others, so the
    // other tabs carry on unaffected. The logout call runs first, while the
    // stored id still names the account being left, so the server destroys the
    // right session.
    await post("/api/auth/logout").catch(() => undefined);

    // Then mark this tab explicitly signed out. Clearing the id to null was the
    // bug: with no id the server fell back to the most recent remaining account,
    // so signing out of booking-staff dropped the tab straight into the
    // administrator session. The sentinel resolves to nobody and never falls
    // back; signing in again overwrites it.
    setSessionId(SIGNED_OUT_SESSION);

    // Carry the sentinel in the URL so the login page's own server render also
    // resolves to signed-out rather than the fallback account.
    window.location.assign(`/login?${SESSION_PARAM}=${SIGNED_OUT_SESSION}`);
  }, []);

  return (
    <SessionContext.Provider
      value={{ user, accounts, loading, switchTo, signOut, refresh: load }}
    >
      {children}
    </SessionContext.Provider>
  );
}
