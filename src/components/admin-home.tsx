"use client";

import { useEffect } from "react";
import { useSession } from "@/components/session-provider";
import { useTabRouter } from "@/components/tab-link";
import { canSee } from "@/lib/roles";
import { AdminOverview } from "@/components/admin-overview";
import { StaffDashboard } from "@/components/staff-dashboard";
import { Spinner } from "@/components/ui";

/**
 * Picks the right home for whoever this tab is.
 *
 * `/admin` used to render the analytics overview unconditionally, but that
 * screen needs `VIEW_ANALYTICS`. A booking clerk or a support agent — both
 * back-office roles that legitimately reach `/admin` — do not hold it, so the
 * dashboard's own fetch was refused and the page sat on skeletons forever. The
 * fix is to route by what the role can actually do:
 *
 *   analytics roles      -> the operations overview
 *   booking staff        -> the counter dashboard
 *   anyone else (support)-> their first usable section
 *
 * The decision is made on the client because a tab's chosen account is not
 * visible during server rendering — the same reason the rest of the back office
 * gates on `useSession` rather than at render time.
 */
export function AdminHome() {
  const { user, loading } = useSession();
  const router = useTabRouter();

  const showOverview = canSee(user?.role, "overview");
  const showStaff = user?.role === "BOOKING_STAFF";

  useEffect(() => {
    if (loading || !user) return;
    if (showOverview || showStaff) return;
    // Support and any future office role without a dashboard of its own land on
    // the first thing they can use rather than on a broken overview.
    router.replace("/admin/bookings");
  }, [loading, user, showOverview, showStaff, router]);

  if (!loading && user && showOverview) return <AdminOverview />;
  if (!loading && user && showStaff) return <StaffDashboard />;

  return (
    <div className="grid min-h-[60vh] place-items-center">
      <Spinner className="h-6 w-6 text-brand" />
    </div>
  );
}
