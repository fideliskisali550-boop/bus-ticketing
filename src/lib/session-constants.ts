/**
 * Constants shared between the client session store and the server resolver.
 *
 * Kept in a directive-free module so both `"use client"` and `"server-only"`
 * files can import it without dragging one runtime's code into the other.
 */

/**
 * The query parameter carrying the tab's chosen account.
 *
 * It travels in the URL because that is the only per-tab signal a browser sends
 * on a plain navigation — headers are not sent, and cookies are shared by every
 * tab of the origin. The middleware promotes it to `X-Session-Id` so server
 * components resolve the same account the tab's own fetches do.
 */
export const SESSION_PARAM = "u";

/**
 * A reserved session id meaning "this tab has explicitly signed out".
 *
 * The multi-account design keeps several sessions in one cookie envelope, and a
 * tab with no chosen id falls back to the most recent of them — which is what a
 * freshly opened tab wants. But a tab that has just *signed out* wants the
 * opposite: it must not silently adopt whichever other account happens to
 * remain in the envelope. It therefore carries this sentinel, which
 * `getCurrentUser` resolves to "nobody" without falling back. Signing in again
 * overwrites it with a real id.
 *
 * It can never collide with a real session id, which is a 12-character nanoid.
 */
export const SIGNED_OUT_SESSION = "signed-out";
