"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/time";
import { toast } from "sonner";
import { Search, ScrollText, ChevronDown, ChevronRight } from "lucide-react";
import { api } from "@/lib/client";
import {
  EmptyState,
  TableSkeleton,
  Pagination,
  useDebounced,
  cx,
} from "@/components/ui";

type Log = {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user: { fullName: string; email: string; role: string } | null;
};

/** Colour by consequence, so destructive actions stand out when scanning. */
function toneFor(action: string) {
  if (/DELETE|CANCEL|FAILED|DEACTIVATE|RETIRE/.test(action)) return "bg-danger/12 text-danger";
  if (/CREATE|REGISTER|SUCCESS/.test(action)) return "bg-ok/12 text-ok";
  if (/UPDATE|CHANGE/.test(action)) return "bg-warn/15 text-warn";
  if (/EXPORT|LOGIN|LOGOUT/.test(action)) return "bg-brand/12 text-brand";
  return "bg-muted/15 text-muted";
}

export function AdminAudit() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, perPage: 25, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("ALL");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const debounced = useDebounced(search);

  useEffect(() => {
    let cancelled = false;
    // Guards against a slow earlier request overwriting a newer one. Typing
    // quickly fires several requests, and without this the one that happens to
    // return last wins — showing results for a query already moved on from.
    setLoading(true);
    const q = new URLSearchParams({ action, page: String(page), perPage: "25" });
    if (debounced) q.set("search", debounced);

    api<{
      logs: Log[];
      total: number;
      page: number;
      perPage: number;
      pages: number;
      actions: string[];
    }>(`/api/audit?${q}`)
      .then((d) => {
        if (cancelled) return;
        setLogs(d.logs);
        setActions(d.actions);
        setMeta({ total: d.total, page: d.page, perPage: d.perPage, pages: d.pages });
      })
      .catch(() => {
        if (!cancelled) toast.error("Could not load the audit trail.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debounced, action, page]);

  useEffect(() => setPage(1), [debounced, action]);

  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Audit trail</h1>
      <p className="mt-1 text-sm text-muted">
        An append-only record of every state-changing action in the system.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            className="input pl-9"
            placeholder="Search user, entity or details…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search audit log"
          />
        </div>

        <select
          className="input w-auto"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          aria-label="Filter by action"
        >
          <option value="ALL">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a.replace(/_/g, " ").toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      <div className="card mt-4 overflow-hidden">
        {loading ? (
          <TableSkeleton rows={10} cols={4} />
        ) : logs.length === 0 ? (
          <EmptyState
            icon={<ScrollText className="h-6 w-6" aria-hidden />}
            title="No entries found"
            description="Try clearing the search or choosing a different action."
          />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {logs.map((log) => {
                const open = expanded === log.id;
                const hasDetail = Boolean(log.metadata || log.ipAddress);

                return (
                  <li key={log.id}>
                    <button
                      onClick={() => setExpanded(open ? null : log.id)}
                      disabled={!hasDetail}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-elevated disabled:cursor-default"
                      aria-expanded={open}
                    >
                      {hasDetail ? (
                        open ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                        )
                      ) : (
                        <span className="w-4 shrink-0" />
                      )}

                      <span
                        className={cx(
                          "badge shrink-0 font-mono",
                          toneFor(log.action),
                        )}
                      >
                        {log.action.replace(/_/g, " ").toLowerCase()}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {log.user
                            ? `${log.user.fullName} · ${log.entity}`
                            : `System · ${log.entity}`}
                        </span>
                        {log.entityId && (
                          <span className="block truncate font-mono text-[11px] text-muted">
                            {log.entityId}
                          </span>
                        )}
                      </span>

                      <span className="shrink-0 whitespace-nowrap text-xs text-muted">
                        {formatDateTime(new Date(log.createdAt))}
                      </span>
                    </button>

                    {open && (
                      <div className="border-t border-line bg-elevated px-11 py-4 text-xs">
                        <dl className="grid gap-3 sm:grid-cols-2">
                          {log.user && (
                            <div>
                              <dt className="font-semibold uppercase tracking-wide text-muted">
                                Actor
                              </dt>
                              <dd className="mt-0.5 text-ink">
                                {log.user.email} ({log.user.role.toLowerCase()})
                              </dd>
                            </div>
                          )}
                          {log.ipAddress && (
                            <div>
                              <dt className="font-semibold uppercase tracking-wide text-muted">
                                IP address
                              </dt>
                              <dd className="mt-0.5 font-mono text-ink">{log.ipAddress}</dd>
                            </div>
                          )}
                          {log.userAgent && (
                            <div className="sm:col-span-2">
                              <dt className="font-semibold uppercase tracking-wide text-muted">
                                User agent
                              </dt>
                              <dd className="mt-0.5 break-all text-ink">{log.userAgent}</dd>
                            </div>
                          )}
                          {log.metadata && (
                            <div className="sm:col-span-2">
                              <dt className="font-semibold uppercase tracking-wide text-muted">
                                Details
                              </dt>
                              <dd className="mt-1">
                                <pre className="overflow-x-auto rounded-lg border border-line bg-surface p-3 font-mono text-[11px] text-ink">
                                  {prettyJson(log.metadata)}
                                </pre>
                              </dd>
                            </div>
                          )}
                        </dl>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

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
    </>
  );
}

/** Metadata is stored as a JSON string; show it formatted, or raw if malformed. */
function prettyJson(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
