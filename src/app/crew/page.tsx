import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { CrewBoard } from "@/components/crew-board";
import { isCrewRole } from "@/lib/roles";

export const metadata: Metadata = { title: "My trips" };

/**
 * The crew home. Drivers and conductors land here rather than on a passenger
 * dashboard — signing in, they want today's departures, not a booking history.
 */
export default async function CrewPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login?next=/crew");
  if (!isCrewRole(session.role)) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
        Your departures
      </h1>
      <p className="mt-1 text-sm text-muted">
        Everything you are rostered on over the next three days.
      </p>

      <div className="mt-6">
        <CrewBoard />
      </div>
    </div>
  );
}
