"use client";

import { Link, useTabRouter } from "@/components/tab-link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Bus, Eye, EyeOff, ArrowRight } from "lucide-react";
import { api, post, ApiClientError } from "@/lib/client";
import { setSessionId } from "@/lib/session-store";
import { withTabSession } from "@/components/tab-link";
import { isOfficeRole, isCrewRole } from "@/lib/roles";
import { Field, Spinner } from "@/components/ui";

/** Where a role belongs when they sign in without an explicit destination. */
function homeForRole(role: string): string {
  if (isOfficeRole(role)) return "/admin";
  if (isCrewRole(role)) return "/crew";
  return "/dashboard";
}

type Mode = "login" | "register";

/**
 * Shared shell for sign-in and sign-up. Field errors returned by the server's
 * Zod validation are mapped back onto the inputs that produced them, so the
 * user is told exactly which field to fix.
 */
export function AuthForm({ mode }: { mode: Mode }) {
  const router = useTabRouter();
  const params = useSearchParams();
  // An explicit ?next= (a link that bounced through login) always wins. Absent
  // one, the destination is decided by role after signing in, so a clerk or a
  // driver is not dropped onto an empty passenger dashboard.
  const explicitNext = params.get("next");

  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    password: "",
    nationalId: "",
  });

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});

    try {
      const payload =
        mode === "login"
          ? { email: form.email, password: form.password }
          : form;

      const res = await post<{ sessionId: string }>(`/api/auth/${mode}`, payload);

      // Pin *this tab* to the account just signed in, in two places.
      //
      // sessionStorage is per-tab and survives a manual reload, but the browser
      // never sends it — so it cannot help a server render. The URL can, and is
      // also naturally per-tab, so it is the one the server actually reads.
      // Both are set: the URL drives rendering, storage is the fallback for a
      // navigation that somehow loses the parameter.
      setSessionId(res.sessionId);

      toast.success(mode === "login" ? "Welcome back" : "Account created");

      // Resolve the landing page. With an explicit ?next= we honour it; without
      // one we ask who just signed in and send them to their own home. The
      // lookup carries the session just stored, so it resolves the new account.
      let next = explicitNext;
      if (!next) {
        try {
          const me = await api<{ user: { role: string } | null }>("/api/auth/me");
          next = me.user ? homeForRole(me.user.role) : "/dashboard";
        } catch {
          next = "/dashboard";
        }
      }

      // A hard navigation rather than router.push: the previous account's
      // server-rendered payload is cached by the router, and pushing would
      // show it before the new identity took effect.
      const destination = withTabSession(next, res.sessionId);
      window.location.assign(destination);
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.details) {
          setErrors(
            Object.fromEntries(
              Object.entries(error.details).map(([k, v]) => [k, v[0] ?? ""]),
            ),
          );
        }
        toast.error(error.message);
      } else {
        toast.error("Could not reach the server. Check your connection.");
      }
    } finally {
      setBusy(false);
    }
  }

  const isLogin = mode === "login";

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl items-center px-4 py-10 sm:px-6">
      <div className="grid w-full gap-10 lg:grid-cols-2 lg:gap-16">
        {/* Form */}
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="mb-8 inline-flex items-center gap-2 lg:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white">
              <Bus className="h-5 w-5" />
            </span>
            <span className="text-lg font-extrabold tracking-tight">SafiriConnect</span>
          </Link>

          <h1 className="text-3xl font-extrabold tracking-tight text-ink">
            {isLogin ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {isLogin
              ? "Sign in to manage your bookings and tickets."
              : "It takes under a minute. You will need a phone number for M-Pesa."}
          </p>

          <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
            {!isLogin && (
              <Field label="Full name" error={errors.fullName}>
                <input
                  className="input"
                  value={form.fullName}
                  onChange={set("fullName")}
                  autoComplete="name"
                  placeholder="Jane Wanjiku"
                  required
                />
              </Field>
            )}

            <Field label="Email address" error={errors.email}>
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={set("email")}
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </Field>

            {!isLogin && (
              <Field
                label="Phone number"
                error={errors.phone}
                hint="Used for M-Pesa payments and ticket messages."
              >
                <input
                  className="input"
                  type="tel"
                  value={form.phone}
                  onChange={set("phone")}
                  autoComplete="tel"
                  placeholder="0712 345 678"
                  required
                />
              </Field>
            )}

            <Field
              label="Password"
              error={errors.password}
              hint={isLogin ? undefined : "At least 8 characters, with a capital letter and a number."}
            >
              <div className="relative">
                <input
                  className="input pr-11"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={set("password")}
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-2 text-muted hover:text-ink"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            {!isLogin && (
              <Field
                label="National ID (optional)"
                error={errors.nationalId}
                hint="Speeds up boarding — staff can match your ID to the manifest."
              >
                <input
                  className="input"
                  value={form.nationalId}
                  onChange={set("nationalId")}
                  placeholder="29384756"
                />
              </Field>
            )}

            <button type="submit" disabled={busy} className="btn-primary w-full py-2.5">
              {busy ? <Spinner /> : null}
              {isLogin ? "Sign in" : "Create account"}
              {!busy && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted">
            {isLogin ? "New to SafiriConnect? " : "Already have an account? "}
            <Link
              href={isLogin ? "/register" : "/login"}
              className="font-semibold text-brand hover:underline"
            >
              {isLogin ? "Create an account" : "Sign in"}
            </Link>
          </p>

          {isLogin && <DemoCredentials onPick={(email, password) => setForm((f) => ({ ...f, email, password }))} />}
        </div>

        {/* Decorative panel — hidden on small screens where it would just push
            the form below the fold. */}
        <div className="relative hidden overflow-hidden rounded-card border border-line bg-brand lg:block">
          <div className="absolute inset-0 hero-grid opacity-20" aria-hidden />
          <div className="relative flex h-full flex-col justify-between p-10">
            <Link href="/" className="inline-flex items-center gap-2 text-white">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15">
                <Bus className="h-5 w-5" />
              </span>
              <span className="text-xl font-extrabold tracking-tight">SafiriConnect</span>
            </Link>

            <div>
              <p className="text-3xl font-extrabold leading-tight text-white">
                No queues.
                <br />
                No double bookings.
                <br />
                No lost tickets.
              </p>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/70">
                Long-distance travel across Kenya, booked from your phone and paid
                for with M-Pesa.
              </p>
            </div>

            <dl className="grid grid-cols-3 gap-4 border-t border-white/15 pt-6">
              {[
                ["10", "Routes"],
                ["8", "Buses"],
                ["24/7", "Booking"],
              ].map(([value, label]) => (
                <div key={label}>
                  <dd className="text-2xl font-extrabold text-white">{value}</dd>
                  <dt className="text-xs text-white/60">{label}</dt>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Demo accounts, surfaced in development so an examiner can sign in as each
 * role without being handed credentials separately. Hidden in production
 * builds, where advertising working logins would be a vulnerability.
 */
function DemoCredentials({
  onPick,
}: {
  onPick: (email: string, password: string) => void;
}) {
  if (process.env.NODE_ENV === "production") return null;

  const accounts = [
    ["Administrator", "admin@safiriconnect.co.ke"],
    ["Booking staff", "staff@safiriconnect.co.ke"],
    ["Passenger", "passenger@example.com"],
  ];

  return (
    <div className="mt-8 rounded-card border border-dashed border-line p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        Demonstration accounts
      </p>
      <div className="mt-3 space-y-1.5">
        {accounts.map(([role, email]) => (
          <button
            key={email}
            type="button"
            onClick={() => onPick(email!, "Password123")}
            className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-elevated"
          >
            <span className="font-semibold text-ink">{role}</span>
            <span className="truncate font-mono text-muted">{email}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted">
        Password for all: <span className="font-mono font-semibold">Password123</span>
      </p>
    </div>
  );
}
