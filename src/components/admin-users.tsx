"use client";

import { useEffect, useState } from "react";
import { formatDateShort } from "@/lib/time";
import { toast } from "sonner";
import { Plus, Search, UserX, ShieldCheck, UserCheck, Ban } from "lucide-react";
import { api, post, patch, ApiClientError } from "@/lib/client";
import { useSession } from "@/components/session-provider";
import { ROLE_LABEL, ROLE_BLURB } from "@/lib/roles";
import {
  Modal,
  EmptyState,
  TableSkeleton,
  Field,
  Spinner,
  StatusBadge,
  Pagination,
  useDebounced,
  cx,
} from "@/components/ui";

type User = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: string;
  isActive: boolean;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  _count: { bookings: number };
};

/**
 * The filter's role list, taken from the shared label table rather than typed
 * out here. Hardcoding it is how this control came to be offering PASSENGER,
 * STAFF and ADMIN long after those last two had been replaced.
 */
const ROLES = ["ALL", ...Object.keys(ROLE_LABEL)];

/** Roles an administrator may hand out from this screen. */
const ASSIGNABLE_ROLES = Object.keys(ROLE_LABEL);

export function AdminUsers() {
  // Read from the tab's own session rather than take a prop. The page that
  // renders this is a Server Component, and passing the user down meant a
  // render-prop child that React could not serialise across the boundary.
  const { user: currentUser } = useSession();
  const currentUserId = currentUser?.id;
  const [users, setUsers] = useState<User[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, perPage: 20, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("ALL");
  const [page, setPage] = useState(1);

  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    password: "",
    role: "BOOKING_STAFF",
  });

  const debounced = useDebounced(search);

  async function load(isCancelled: () => boolean = () => false) {
    if (!isCancelled()) setLoading(true);
    try {
      const q = new URLSearchParams({ role, page: String(page), perPage: "20" });
      if (debounced) q.set("search", debounced);

      const data = await api<{
        users: User[];
        total: number;
        page: number;
        perPage: number;
        pages: number;
      }>(`/api/users?${q}`);

      if (!isCancelled()) setUsers(data.users);
      if (!isCancelled()) setMeta({
        total: data.total,
        page: data.page,
        perPage: data.perPage,
        pages: data.pages,
      });
    } catch {
      toast.error("Could not load users.");
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    // Guards against a slow earlier request overwriting a newer one. Typing
    // quickly in the search box fires several requests, and without this the
    // one that happens to return last wins — showing results for a query the
    // user has already moved on from.
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, role, page]);

  useEffect(() => setPage(1), [debounced, role]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await post("/api/users", form);
      toast.success("User created");
      setCreating(false);
      setForm({ fullName: "", email: "", phone: "", password: "", role: "BOOKING_STAFF" });
      load();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrors(
          Object.fromEntries(
            Object.entries(error.details ?? {}).map(([k, v]) => [k, v[0] ?? ""]),
          ),
        );
        toast.error(error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function update(user: User, data: { role?: string; isActive?: boolean }) {
    try {
      await patch(`/api/users/${user.id}`, data);
      toast.success(`${user.fullName} updated`);
      load();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not update that user.",
      );
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Users</h1>
          <p className="mt-1 text-sm text-muted">
            Passengers, booking staff and administrators.
          </p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary">
          <Plus className="h-4 w-4" /> Add user
        </button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            className="input pl-9"
            placeholder="Search name, email or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search users"
          />
        </div>

        <div className="flex gap-1.5">
          {ROLES.map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              className={cx(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                role === r ? "bg-brand text-white" : "bg-elevated text-muted hover:text-ink",
              )}
            >
              {r === "ALL" ? "All" : r.toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="card mt-4 overflow-hidden">
        {loading ? (
          <TableSkeleton rows={8} cols={5} />
        ) : users.length === 0 ? (
          <EmptyState icon={<UserX className="h-6 w-6" aria-hidden />} title="No users found" description="Try a different search." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-sm">
                <thead className="border-b border-line bg-elevated text-left">
                  <tr>
                    {["User", "Contact", "Role", "Bookings", "Last seen", ""].map((h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {users.map((u) => {
                    const isSelf = u.id === currentUserId;

                    return (
                      <tr
                        key={u.id}
                        className={cx("hover:bg-elevated", !u.isActive && "opacity-60")}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand">
                              {u.fullName
                                .split(" ")
                                .slice(0, 2)
                                .map((p) => p[0])
                                .join("")
                                .toUpperCase()}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-bold text-ink">
                                {u.fullName}
                                {isSelf && (
                                  <span className="ml-1.5 text-[11px] font-medium text-muted">
                                    (you)
                                  </span>
                                )}
                              </p>
                              {!u.isActive && (
                                <span className="badge bg-danger/12 text-danger">
                                  Deactivated
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-3">
                          <p className="truncate text-muted">{u.email}</p>
                          <p className="text-[11px] text-muted">{u.phone}</p>
                        </td>

                        <td className="px-4 py-3">
                          <select
                            value={u.role}
                            // An admin changing their own role could lock
                            // everyone out; the server rejects it too.
                            disabled={isSelf}
                            onChange={(e) => update(u, { role: e.target.value })}
                            className="input w-auto py-1 text-xs disabled:opacity-50"
                            aria-label={`Role for ${u.fullName}`}
                          >
                            {ASSIGNABLE_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABEL[r]}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="px-4 py-3 font-semibold text-ink">
                          {u._count.bookings}
                        </td>

                        <td className="whitespace-nowrap px-4 py-3 text-muted">
                          {u.lastLoginAt
                            ?formatDateShort(new Date(u.lastLoginAt))
                            : "Never"}
                        </td>

                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => update(u, { isActive: !u.isActive })}
                            disabled={isSelf}
                            className={cx(
                              "btn-ghost p-2 disabled:opacity-30",
                              u.isActive
                                ? "text-danger hover:bg-danger/10"
                                : "text-ok hover:bg-ok/10",
                            )}
                            aria-label={
                              u.isActive
                                ? `Deactivate ${u.fullName}`
                                : `Reactivate ${u.fullName}`
                            }
                          >
                            {u.isActive ? (
                              <Ban className="h-4 w-4" />
                            ) : (
                              <UserCheck className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pagination
              page={meta.page}
              pages={meta.pages}
              total={meta.total}
              perPage={meta.perPage}
              onChange={setPage}
            />
          </>
        )}
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Add a user"
        description="Staff and administrators can only be created here, never by self-registration."
      >
        <form onSubmit={create} className="space-y-4">
          <Field label="Full name" error={errors.fullName}>
            <input
              className="input"
              value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" error={errors.email}>
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </Field>

            <Field label="Phone" error={errors.phone}>
              <input
                className="input"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="0712 345 678"
                required
              />
            </Field>
          </div>

          <Field
            label="Temporary password"
            error={errors.password}
            hint="At least 8 characters, with a capital letter and a number. Ask them to change it at first sign-in."
          >
            <input
              className="input"
              type="text"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              required
            />
          </Field>

          <Field label="Role" error={errors.role}>
            <select
              className="input"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                  {ROLE_BLURB[r] ? ` — ${ROLE_BLURB[r].toLowerCase()}` : ""}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex items-start gap-2 rounded-lg bg-elevated p-3 text-xs leading-relaxed text-muted">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
            The password is hashed with bcrypt before it is stored. It cannot be
            recovered — only reset.
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="btn-secondary flex-1"
            >
              Cancel
            </button>
            <button disabled={busy} className="btn-primary flex-1">
              {busy && <Spinner />} Create user
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
