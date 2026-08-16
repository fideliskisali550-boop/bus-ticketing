import { NextResponse, type NextRequest } from "next/server";
import { SESSION_PARAM } from "@/lib/session-constants";

/**
 * Edge middleware does three things: it carries the tab's chosen account into
 * server rendering, redirects signed-out visitors away from protected routes,
 * and sets security headers.
 *
 * The first is the important one.
 *
 * Cookies are shared by every tab of a browser, so a single session cookie
 * makes every tab the same user. Custom headers solve that for `fetch`, but a
 * browser sends *no* custom headers when it navigates to a page — so server
 * components had no way to know which of several signed-in accounts a tab was
 * acting as, and fell back to whichever signed in last. That is why two tabs
 * both rendered the same person.
 *
 * The only thing a browser transmits on a navigation that can legitimately
 * differ between tabs is the URL. So the tab's session id travels as `?u=`,
 * and this middleware promotes it into a request header that `getCurrentUser`
 * already knows how to read. Server components then resolve the correct
 * account, and two tabs on the same browser stay genuinely independent.
 *
 * This is the same reason Gmail's URLs look like /mail/u/0/.
 */

const SESSIONS_COOKIE = "sc_sessions";

/** Query parameter naming the tab's account. */


/** Prefixes requiring a signed-in user of any role. */
const PROTECTED = ["/dashboard", "/bookings", "/profile", "/checkout", "/admin", "/crew"];

export function middleware(req: NextRequest) {
  const { pathname, search, searchParams } = req.nextUrl;

  // Promote ?u= into a request header so server components see it. Response
  // headers cannot do this — the header has to be on the *request* that the
  // rendering pass reads.
  const requestHeaders = new Headers(req.headers);
  const tabSession = searchParams.get(SESSION_PARAM);
  if (tabSession) requestHeaders.set("x-session-id", tabSession);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  if (PROTECTED.some((p) => pathname.startsWith(p))) {
    // Presence only — the cookie's contents are validated server-side against
    // the session table on every request that matters.
    const hasSession = Boolean(req.cookies.get(SESSIONS_COOKIE)?.value);

    if (!hasSession) {
      const login = new URL("/login", req.url);
      login.searchParams.set("next", pathname + search);
      response = NextResponse.redirect(login);
    }
  }

  const headers = response.headers;
  headers.set("X-Frame-Options", "DENY"); // clickjacking
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      // Next.js injects inline hydration scripts; 'unsafe-eval' is required by
      // the dev-mode React refresh runtime only.
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
