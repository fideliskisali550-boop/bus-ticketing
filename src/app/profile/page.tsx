import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ProfileForm } from "@/components/profile-form";

export const metadata: Metadata = { title: "Profile & settings" };

export default async function ProfilePage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login?next=/profile");

  const user = await db.user.findUnique({
    where: { id: session.id },
    select: {
      fullName: true, email: true, phone: true, nationalId: true,
      role: true, emailVerified: true, createdAt: true,
      _count: { select: { bookings: true } },
    },
  });

  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
        Profile & settings
      </h1>
      <p className="mt-1 text-sm text-muted">
        Manage your details and account security.
      </p>

      <div className="mt-6">
        <ProfileForm
          profile={{
            fullName: user.fullName,
            email: user.email,
            phone: user.phone,
            nationalId: user.nationalId,
            role: user.role,
            emailVerified: user.emailVerified,
            createdAt: user.createdAt.toISOString(),
            bookingCount: user._count.bookings,
          }}
        />
      </div>
    </div>
  );
}
