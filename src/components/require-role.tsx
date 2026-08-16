"use client";

import { Link } from "@/components/tab-link";
import { ShieldAlert } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { canSee, ROLE_LABEL } from "@/lib/roles";
import { Spinner } from "@/components/ui";

/**
 * Gates a screen on the role of *this tab's* account.
 *
 * Server rendering cannot make this decision: a tab's chosen account travels in
 * a request header that the browser does not send on a navigation, so the
 * server only ever sees the default session. Here the tab's identity is known.
 *
 * This is a usability gate, not a security boundary. The matching API routes
 * check the same role server-side against the tab's real session, so someone
 * who reaches this markup still cannot read anything they should not.
 */
export function RequireRole({
  section,
  children,
}: {
  /**
   * The back-office area being gated, resolved through the same `SECTIONS`
   * table the sidebar filters on.
   *
   * It takes a section rather than a list of roles on purpose. The previous
   * signature took `roles={["ADMIN"]}`, which silently became a lock-everybody-
   * out gate the moment the roles were renamed — a hardcoded list in a page is
   * a copy of the rules that no one remembers to update. One table, consulted
   * by both the navigation and the gate, cannot drift apart from itself.
   */
  section: string;
  /**
   * A plain element, never a render prop.
   *
   * These pages are Server Components and this is a Client Component, so a
   * function child cannot cross the boundary — React refuses to serialise it
   * and the page dies with "Functions are not valid as a child of Client
   * Components". Anything needing the signed-in user reads it from
   * `useSession()` itself.
   */
  children: React.ReactNode;
}) {
  const { user, loading } = useSession();

  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Spinner className="h-6 w-6 text-brand" />
      </div>
    );
  }

  if (!user || !canSee(user.role, section)) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-6 text-center">
        <div>
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-warn/10 text-warn">
            <ShieldAlert className="h-7 w-7" />
          </span>
          <p className="mt-5 text-lg font-bold text-ink">Access restricted</p>
          <p className="mt-1 text-sm text-muted">
            {user
              ? `This tab is signed in as ${user.fullName}${
                  ROLE_LABEL[user.role] ? ` (${ROLE_LABEL[user.role].toLowerCase()})` : ""
                }, who does not have access to this screen.`
              : "Sign in with an account that has access to this screen."}
          </p>
          <Link href="/admin" className="btn-primary mt-5">
            Back to operations
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
