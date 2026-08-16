"use client";

import { Link } from "@/components/tab-link";
import { ROLE_LABEL, ROLE_TONE, isOfficeRole, isCrewRole, canSwitchAccounts } from "@/lib/roles";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Bus,
  Menu,
  X,
  Sun,
  Moon,
  Bell,
  LogOut,
  User as UserIcon,
  LayoutDashboard,
  Ticket,
  Search,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { api } from "@/lib/client";
import { formatDateTime } from "@/lib/time";
import { cx } from "@/components/ui";
import { useSession, type SessionAccount } from "@/components/session-provider";

type Notification = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

const ROLE_STYLE: Record<string, string> = {
  SUPER_ADMIN: "bg-brand/12 text-brand",
  PLATFORM_SUPPORT: "bg-brand/12 text-brand",
  COMPANY_ADMIN: "bg-accent/15 text-accent",
  ROUTE_MANAGER: "bg-accent/15 text-accent",
  FINANCE_OFFICER: "bg-accent/15 text-accent",
  BOOKING_STAFF: "bg-accent/15 text-accent",
  CONDUCTOR: "bg-warn/15 text-warn",
  DRIVER: "bg-warn/15 text-warn",
  PASSENGER: "bg-muted/15 text-muted",
};

export function SiteHeader() {
  const pathname = usePathname();
  const { user } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);

  // The back office has its own sidebar chrome; a second global nav on top of
  // it would just be noise.
  if (pathname.startsWith("/admin")) return null;

  const office = isOfficeRole(user?.role);
  const crew = isCrewRole(user?.role);

  // Crew are shown their roster rather than a passenger dashboard: a driver
  // signing in wants today's departures, not a booking history.
  const links = [
    ...(crew ? [] : [{ href: "/search", label: "Find a bus", icon: Search }]),
    ...(user && !crew
      ? [
          { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
          { href: "/bookings", label: "My tickets", icon: Ticket },
        ]
      : []),
    ...(crew ? [{ href: "/crew", label: "My trips", icon: Bus }] : []),
    ...(office ? [{ href: "/admin", label: "Operations", icon: ShieldCheck }] : []),
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white">
            <Bus className="h-5 w-5" />
          </span>
          <span className="text-lg font-extrabold tracking-tight text-ink">
            Safiri<span className="text-brand">Connect</span>
          </span>
        </Link>

        <nav className="ml-4 hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cx(
                "rounded-lg px-3 py-2 text-sm font-semibold transition",
                pathname === l.href || pathname.startsWith(l.href + "/")
                  ? "bg-brand-soft text-brand"
                  : "text-muted hover:bg-elevated hover:text-ink",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          {user && <NotificationBell />}

          {user ? (
            <AccountMenu />
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <Link href="/login" className="btn-ghost">
                Sign in
              </Link>
              <Link href="/register" className="btn-primary">
                Create account
              </Link>
            </div>
          )}

          <button
            className="btn-ghost p-2 md:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Menu"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav className="border-t border-line bg-surface px-4 py-3 md:hidden">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-ink hover:bg-elevated"
            >
              <l.icon className="h-4 w-4 text-muted" />
              {l.label}
            </Link>
          ))}
          {!user && (
            <div className="mt-2 flex gap-2 border-t border-line pt-3">
              <Link href="/login" className="btn-secondary flex-1" onClick={() => setMobileOpen(false)}>
                Sign in
              </Link>
              <Link href="/register" className="btn-primary flex-1" onClick={() => setMobileOpen(false)}>
                Create account
              </Link>
            </div>
          )}
        </nav>
      )}
    </header>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Theme is unknown until hydration; rendering a fixed icon before then would
  // cause a hydration mismatch and a visible flicker.
  useEffect(() => setMounted(true), []);

  return (
    <button
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="btn-ghost p-2"
      aria-label="Toggle dark mode"
    >
      {mounted && resolvedTheme === "dark" ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </button>
  );
}

const initialsOf = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

/**
 * Account menu.
 *
 * Most people see only their own account here: profile and sign out. The
 * multi-account switcher — signing several identities into one browser and
 * stepping between them — is an impersonation power reserved for the platform
 * administrator (`canSwitchAccounts`). A passenger or a booking clerk must never
 * be shown a list of other users' accounts, nor be able to step into one; that
 * is a privacy leak and an authorisation hole, and it is exactly what the
 * screenshots showed. Per-tab isolation is untouched — different tabs can still
 * be different accounts.
 */
function AccountMenu() {
  const { user, accounts, switchTo, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!user) return null;

  // Only the platform administrator may see or act on other signed-in accounts.
  const maySwitch = canSwitchAccounts(user.role);
  const others = maySwitch ? accounts.filter((a) => a.sessionId !== user.sessionId) : [];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition hover:bg-elevated"
        aria-label="Account menu"
        aria-expanded={open}
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand">
          {initialsOf(user.fullName)}
        </span>
        <span
          className={cx(
            "hidden text-[10px] font-bold uppercase tracking-wide sm:inline",
            ROLE_TONE[user.role] ?? "text-muted",
          )}
        >
          {ROLE_LABEL[user.role] ?? user.role}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 overflow-hidden rounded-card border border-line bg-surface shadow-lift animate-fade-up">
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-bold text-ink">{user.fullName}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
            <span className={cx("badge mt-1.5", ROLE_STYLE[user.role])}>
              {ROLE_LABEL[user.role] ?? user.role}
            </span>
          </div>

          {others.length > 0 && (
            <div className="border-b border-line py-1">
              <p className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                Switch account · this tab only
              </p>
              {others.map((account) => (
                <AccountRow
                  key={account.sessionId}
                  account={account}
                  onSelect={() => {
                    switchTo(account.sessionId);
                    setOpen(false);
                    toast.success(`Now viewing as ${account.fullName}`);
                  }}
                />
              ))}
            </div>
          )}

          <div className="py-1">
            <Link
              href="/profile"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-ink hover:bg-elevated"
            >
              <UserIcon className="h-4 w-4 text-muted" /> Profile &amp; settings
            </Link>

            {maySwitch && (
              <Link
                href="/login?add=true"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-ink hover:bg-elevated"
              >
                <UserPlus className="h-4 w-4 text-muted" /> Sign in to another account
              </Link>
            )}

            <button
              onClick={signOut}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium text-danger hover:bg-elevated"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AccountRow({
  account,
  onSelect,
}: {
  account: SessionAccount;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-elevated"
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-elevated text-[10px] font-bold text-muted">
        {initialsOf(account.fullName)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">
          {account.fullName}
        </span>
        <span className="block truncate text-[11px] text-muted">
          {ROLE_LABEL[account.role] ?? account.role}
        </span>
      </span>
    </button>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await api<{ notifications: Notification[]; unread: number }>(
          "/api/notifications",
        );
        if (cancelled) return;
        setItems(data.notifications);
        setUnread(data.unread);
      } catch {
        // A failed poll is not worth interrupting the user over.
      }
    }

    load();
    // Light polling stands in for websockets; at one request a minute the load
    // is negligible and the badge stays close to live.
    const timer = setInterval(load, 60_000);

    return () => {
      // Without this the interval keeps firing after the header unmounts,
      // holding the component in memory and polling indefinitely.
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function markAll() {
    await api("/api/notifications", { method: "PATCH" }).catch(() => undefined);
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
  }

  return (
    <div className="relative" ref={ref}>
      <button
        className="btn-ghost relative p-2"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-card border border-line bg-surface shadow-lift animate-fade-up">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-bold text-ink">Notifications</p>
            {unread > 0 && (
              <button onClick={markAll} className="text-xs font-semibold text-brand hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">Nothing yet.</p>
            ) : (
              items.map((n) => (
                <Link
                  key={n.id}
                  href={n.link ?? "#"}
                  onClick={() => setOpen(false)}
                  className={cx(
                    "block border-b border-line px-4 py-3 last:border-0 hover:bg-elevated",
                    !n.readAt && "bg-brand-soft/50",
                  )}
                >
                  <p className="text-sm font-semibold text-ink">{n.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{n.body}</p>
                  <p className="mt-1 text-[11px] text-muted/70">{formatDateTime(n.createdAt)}</p>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
