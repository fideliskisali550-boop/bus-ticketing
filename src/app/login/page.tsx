import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth";
import { SESSION_PARAM } from "@/lib/session-constants";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Sign-in, and the last step of the tab's session self-heal.
 *
 * A signed-in tab that follows a bare URL to a protected page is bounced here
 * by that page's own guard, because without `?u=` the server cannot tell whose
 * request it is. `SessionProvider` then puts the tab's id back on the URL, and
 * this check catches the second pass: the account resolves, so the tab is sent
 * on to where it was going rather than being asked to sign in again.
 *
 * A genuinely new tab has no stored id, resolves to nobody, and gets the form —
 * which is what stops it inheriting whichever account signed in most recently.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const sessionId =
    typeof params[SESSION_PARAM] === "string" ? params[SESSION_PARAM] : undefined;
  const user = await getCurrentUser(sessionId);

  if (user) {
    const next = typeof params.next === "string" ? params.next : "/dashboard";
    // Internal paths only, so a crafted `?next=` cannot bounce someone off-site.
    const destination =
      next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
    const separator = destination.includes("?") ? "&" : "?";
    redirect(`${destination}${separator}${SESSION_PARAM}=${user.sessionId}`);
  }

  // useSearchParams inside AuthForm requires a Suspense boundary for streaming.
  return (
    <Suspense>
      <AuthForm mode="login" />
    </Suspense>
  );
}
