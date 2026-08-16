"use client";

import { Link, useTabRouter } from "@/components/tab-link";
import { ROLE_LABEL, isOfficeRole, canSee } from "@/lib/roles";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  Bus,
  LayoutDashboard,
  Route as RouteIcon,
  CalendarClock,
  Ticket,
  Users,
  BarChart3,
  ScrollText,
  Repeat,
  Banknote,
  BadgeCheck,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  ExternalLink,
} from "lucide-react";
import { cx, Spinner } from "@/components/ui";
import { useSession } from "@/components/session-provider";

/**
 * The back-office navigation, grouped by area.
 *
 * The groups are a presentation device: a flat list of ten items reads as a
 * wall, while three labelled clusters — what you run, the money, the platform —
 * let the eye find a section at a glance. Each item still carries the `section`
 * that `canSee` filters on, so a group with no visible items simply disappears
 * for that role rather than leaving an empty heading.
 */
const NAV_GROUPS = [
  {
    label: "Operations",
    items: [
      { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true, section: "overview" },
      { href: "/admin/trips", label: "Departures", icon: CalendarClock, section: "trips" },
      { href: "/admin/schedules", label: "Schedules", icon: Repeat, section: "schedules" },
      { href: "/admin/routes", label: "Routes", icon: RouteIcon, section: "routes" },
      { href: "/admin/buses", label: "Fleet", icon: Bus, section: "buses" },
    ],
  },
  {
    label: "Bookings",
    items: [
      { href: "/admin/bookings", label: "Bookings", icon: Ticket, section: "bookings" },
      { href: "/admin/refunds", label: "Refunds", icon: Banknote, section: "refunds" },
      { href: "/admin/checkin", label: "Verify tickets", icon: BadgeCheck, section: "checkin" },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/admin/reports", label: "Reports", icon: BarChart3, section: "reports" },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/admin/users", label: "Staff", icon: Users, section: "users" },
      { href: "/admin/audit", label: "Audit trail", icon: ScrollText, section: "audit" },
    ],
  },
];

type NavItem = (typeof NAV_GROUPS)[number]["items"][number];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useTabRouter();
  const { user, loading, signOut } = useSession();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  // The resolved theme is unknown until the client has mounted. Rendering an
  // icon based on it during SSR causes a hydration mismatch and a visible flicker.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isStaff = isOfficeRole(user?.role);

  /**
   * The role gate for this tab.
   *
   * The server layout could only confirm that *somebody* is signed in, because
   * a tab's chosen account is not visible during server rendering. Here the
   * tab's own identity is known, so a passenger who navigated to /admin is
   * sent away. Every admin API enforces the same rule independently, so this
   * is about not showing a useless screen rather than about keeping data safe.
   */
  useEffect(() => {
    if (!loading && !isStaff) router.replace("/dashboard");
  }, [loading, isStaff, router]);

  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg">
        <Spinner className="h-6 w-6 text-brand" />
      </div>
    );
  }

  if (!isStaff) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg px-6 text-center">
        <div>
          <p className="text-lg font-bold text-ink">Operations access only</p>
          <p className="mt-1 text-sm text-muted">
            This tab is signed in as {user.fullName}
            {ROLE_LABEL[user.role] ? ` (${ROLE_LABEL[user.role].toLowerCase()})` : ""}, who does
            not have back-office access.
          </p>
          <Link href="/dashboard" className="btn-primary mt-5">
            Go to your dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Each role is offered only the sections it can actually use. Showing a
  // finance officer a fleet screen that refuses every action reads as a broken
  // system rather than as a boundary.
  // Filter within each group, then drop any group the role can see nothing in.
  const groups = NAV_GROUPS.map((g) => ({
    label: g.label,
    items: g.items.filter((n) => canSee(user.role, n.section)),
  })).filter((g) => g.items.length > 0);

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  const sidebar = (
    <div className="flex h-full flex-col">
      <Link href="/admin" className="flex items-center gap-2 px-5 py-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white">
          <Bus className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold tracking-tight text-ink">
            SafiriConnect
          </p>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Operations
          </p>
        </div>
      </Link>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3">
        {groups.map((group) => (
          <div key={group.label} className="space-y-0.5">
            <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-muted/70">
              {group.label}
            </p>
            {group.items.map((item) => {
              const active = isActive(item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
                    active
                      ? "bg-brand text-white shadow-brand"
                      : "text-muted hover:bg-brand-soft hover:text-brand-ink",
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-line p-3">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-muted hover:bg-elevated hover:text-ink"
        >
          <ExternalLink className="h-4 w-4" /> Passenger site
        </Link>

        <div className="mt-2 flex items-center gap-2 rounded-lg bg-elevated px-3 py-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand">
            {user.fullName
              .split(" ")
              .slice(0, 2)
              .map((p) => p[0])
              .join("")
              .toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-ink">{user.fullName}</p>
            <p className="truncate text-[11px] text-muted">
              {ROLE_LABEL[user.role] ?? user.role}
            </p>
          </div>
          <button
            onClick={() => {
              void signOut();
              toast.success("Signed out");
            }}
            className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-danger"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-line bg-surface lg:block">
        <div className="sticky top-0 h-screen">{sidebar}</div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="relative h-full w-64 border-r border-line bg-surface animate-fade-up">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/80 px-4 backdrop-blur-md lg:justify-end">
          <button
            className="btn-ghost p-2 lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <span className="text-sm font-bold text-ink lg:hidden">Operations</span>

          <button
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="btn-ghost ml-auto p-2 lg:ml-0"
            aria-label="Toggle dark mode"
          >
            {mounted && resolvedTheme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
        </header>

        <div className="p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
