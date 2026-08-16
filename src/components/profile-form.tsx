"use client";

import { useTabRouter } from "@/components/tab-link";
import { useState } from "react";
import { formatDate } from "@/lib/time";

import { toast } from "sonner";
import { Save, KeyRound, ShieldCheck } from "lucide-react";
import { patch, post, ApiClientError } from "@/lib/client";
import { Field, Spinner, StatusBadge } from "@/components/ui";

type Profile = {
  fullName: string;
  email: string;
  phone: string;
  nationalId: string | null;
  role: string;
  emailVerified: boolean;
  createdAt: string;
  bookingCount: number;
};

export function ProfileForm({ profile }: { profile: Profile }) {
  const router = useTabRouter();

  const [details, setDetails] = useState({
    fullName: profile.fullName,
    phone: profile.phone,
    nationalId: profile.nationalId ?? "",
  });
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});

  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "" });
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});

  const flatten = (details?: Record<string, string[]>) =>
    Object.fromEntries(Object.entries(details ?? {}).map(([k, v]) => [k, v[0] ?? ""]));

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    setSavingDetails(true);
    setDetailErrors({});
    try {
      await patch("/api/profile", details);
      toast.success("Profile updated");
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setDetailErrors(flatten(error.details));
        toast.error(error.message);
      }
    } finally {
      setSavingDetails(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setSavingPassword(true);
    setPasswordErrors({});
    try {
      await post("/api/auth/password", passwords);
      toast.success("Password changed. Other devices have been signed out.");
      setPasswords({ currentPassword: "", newPassword: "" });
    } catch (error) {
      if (error instanceof ApiClientError) {
        setPasswordErrors(flatten(error.details));
        toast.error(error.message);
      }
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px] lg:items-start">
      <div className="space-y-6">
        <form onSubmit={saveDetails} className="card p-6">
          <h2 className="font-bold text-ink">Personal details</h2>
          <p className="mt-1 text-sm text-muted">
            Used on your tickets and for M-Pesa payments.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Full name" error={detailErrors.fullName}>
              <input
                className="input"
                value={details.fullName}
                onChange={(e) => setDetails((d) => ({ ...d, fullName: e.target.value }))}
              />
            </Field>

            <Field label="Phone number" error={detailErrors.phone}>
              <input
                className="input"
                value={details.phone}
                onChange={(e) => setDetails((d) => ({ ...d, phone: e.target.value }))}
              />
            </Field>

            <Field
              label="Email address"
              hint="Contact support to change your email."
            >
              {/* Read-only: the email is the account identifier, and changing it
                  needs a verification flow that is out of scope here. */}
              <input className="input opacity-60" value={profile.email} disabled />
            </Field>

            <Field label="National ID" error={detailErrors.nationalId}>
              <input
                className="input"
                value={details.nationalId}
                onChange={(e) =>
                  setDetails((d) => ({ ...d, nationalId: e.target.value }))
                }
                placeholder="29384756"
              />
            </Field>
          </div>

          <button disabled={savingDetails} className="btn-primary mt-5">
            {savingDetails ? <Spinner /> : <Save className="h-4 w-4" />} Save changes
          </button>
        </form>

        <form onSubmit={changePassword} className="card p-6">
          <h2 className="flex items-center gap-2 font-bold text-ink">
            <KeyRound className="h-4 w-4 text-brand" /> Change password
          </h2>
          <p className="mt-1 text-sm text-muted">
            Changing your password signs you out everywhere else.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Current password" error={passwordErrors.currentPassword}>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={passwords.currentPassword}
                onChange={(e) =>
                  setPasswords((p) => ({ ...p, currentPassword: e.target.value }))
                }
                required
              />
            </Field>

            <Field
              label="New password"
              error={passwordErrors.newPassword}
              hint="At least 8 characters, with a capital letter and a number."
            >
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={passwords.newPassword}
                onChange={(e) =>
                  setPasswords((p) => ({ ...p, newPassword: e.target.value }))
                }
                required
              />
            </Field>
          </div>

          <button disabled={savingPassword} className="btn-secondary mt-5">
            {savingPassword ? <Spinner /> : null} Update password
          </button>
        </form>
      </div>

      <aside className="card p-5">
        <h2 className="text-sm font-bold text-ink">Account</h2>

        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-muted">Role</dt>
            <dd>
              <StatusBadge status={profile.role} />
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted">Bookings</dt>
            <dd className="font-bold text-ink">{profile.bookingCount}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted">Member since</dt>
            <dd className="font-semibold text-ink">
              {formatDate(new Date(profile.createdAt))}
            </dd>
          </div>
        </dl>

        <div className="mt-5 flex items-start gap-2 border-t border-line pt-4 text-xs leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />
          Your password is stored as a bcrypt hash. Nobody at SafiriConnect can read it.
        </div>
      </aside>
    </div>
  );
}
