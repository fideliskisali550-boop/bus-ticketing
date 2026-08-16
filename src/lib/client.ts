"use client";

import { getSessionId } from "./session-store";

/** Browser-side fetch helper: one place that knows the error envelope shape. */

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, string[]>,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const sessionId = getSessionId();

  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      // Tells the server which of the signed-in accounts this tab is acting as.
      // Without it the server falls back to the most recent sign-in, which is
      // what would otherwise make every tab share one identity.
      ...(sessionId ? { "X-Session-Id": sessionId } : {}),
      ...init?.headers,
    },
    // Cookies carry the credentials; without this they are dropped on
    // same-origin fetches that specify a mode.
    credentials: "same-origin",
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      details?: Record<string, string[]>;
    };
    throw new ApiClientError(
      res.status,
      body.error ?? "Something went wrong. Please try again.",
      body.details,
    );
  }

  return res.json() as Promise<T>;
}

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });

export const patch = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined });

export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });

// A session-bearing href for plain `<a>` links and downloads now lives in
// `components/tab-link.tsx` as the `useSessionHref` hook. It has to be a hook,
// not a plain function reading storage, so the value it produces is the same on
// the server and in the browser — reading `sessionStorage` during render was
// the cause of a hydration mismatch on every signed-in page.

/** Formats KES consistently on the client, mirroring lib/policy.ts. */
export const KES = (amount: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(amount);
