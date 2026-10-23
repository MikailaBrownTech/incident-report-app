"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Avatar } from "@/components/avatar";
import { SeverityBadge, StatusPill } from "@/components/badges";
import { DeclareIncidentButton } from "@/components/declare-incident";
import { EmptyState } from "@/components/empty-state";
import { PostmortemBadge } from "@/components/postmortem-badge";
import { secondaryButton } from "@/components/form";
import * as rt from "@/components/responsive-table";
import { LiveDuration, RelativeTime } from "@/components/time-display";
import { useToast } from "@/components/toast";
import { emptyMessage, severityName, type SeverityLevel, type SeverityOverrides } from "@/copy";
import { useCopy } from "@/copy/provider";
import type { IncidentRow } from "@/features/incidents/list";
import { ALL_STATUSES, type StatusKey } from "@/features/incidents/schema";
import { NEEDS_ATTENTION, getPostmortemStatus, type RuleLike } from "@/features/postmortems/status";
import { api } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/api-messages";

interface Props {
  slug: string;
  initial: IncidentRow[];
  initialCursor: string | null;
  /** The current filters as a query string (without `cursor`), reused to fetch further pages. */
  queryString: string;
  hasFilters: boolean;
  severityLabels: SeverityOverrides;
  /** The workspace's retro rules, to badge rows whose postmortem is required, due soon or overdue. */
  retroRules?: RuleLike[];
}

/** The table plus "Load more". The parent keys this on the query so new filters start fresh. */
export function IncidentList({
  slug,
  initial,
  initialCursor,
  queryString,
  hasFilters,
  severityLabels,
  retroRules = [],
}: Props) {
  const t = useCopy();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    const qs = new URLSearchParams(queryString);
    qs.set("cursor", cursor);
    const result = await api<{ items: IncidentRow[]; nextCursor: string | null }>(
      `/api/w/${slug}/incidents?${qs.toString()}`,
    );
    setLoading(false);
    if (!result.ok) {
      toast.error(apiErrorMessage(t, result.code));
      return;
    }
    setItems((current) => [...current, ...result.data.items]);
    setCursor(result.data.nextCursor);
  }

  /** Optimistic: show the new status now, put the old one back (and say so) if the server refuses. */
  async function changeStatus(row: IncidentRow, status: StatusKey) {
    if (row.status === status) return;
    const before = { status: row.status, resolvedAt: row.resolvedAt };
    const patchRow = (patch: Partial<IncidentRow>) =>
      setItems((current) => current.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
    patchRow({
      status,
      resolvedAt:
        status === "RESOLVED" ? new Date().toISOString() : before.status === "RESOLVED" ? null : before.resolvedAt,
    });
    const result = await api(`/api/w/${slug}/incidents/${row.number}/status`, { method: "POST", body: { status } });
    if (!result.ok) {
      patchRow(before);
      toast.error(apiErrorMessage(t, result.code));
      return;
    }
    toast.success(t.incidentList.statusChanged(t.status[status]));
  }

  async function copyLink(row: IncidentRow) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/app/${slug}/incidents/${row.number}`);
      toast.success(t.incidentList.linkCopied);
    } catch {
      toast.error(t.incidentList.copyFailed);
    }
  }

  if (items.length === 0) {
    return hasFilters ? (
      <div className="space-y-3 text-center">
        <EmptyState message={t.incidentList.noMatches} />
        <button type="button" className={secondaryButton} onClick={() => router.push(pathname)}>
          {t.incidentList.clearFilters}
        </button>
      </div>
    ) : (
      <div className="space-y-3 text-center">
        <EmptyState message={emptyMessage(t, "incidents")} />
        <DeclareIncidentButton />
      </div>
    );
  }

  const open = (row: IncidentRow) => router.push(`/app/${slug}/incidents/${row.number}`);

  return (
    <div className="space-y-4">
      <div className={rt.tableWrap}>
        <table role="table" className={rt.table}>
          <caption className="sr-only">{t.incidentList.heading}</caption>
          <thead role="rowgroup" className={rt.thead}>
            <tr role="row">
              {[
                t.incidentList.colNumber,
                t.incidentList.colTitle,
                t.incidentList.colSeverity,
                t.incidentList.colStatus,
                t.incidentList.colServices,
                t.incidentList.colCommander,
                t.incidentList.colStarted,
                t.incidentList.colDuration,
              ].map((label) => (
                <th key={label} role="columnheader" scope="col" className={rt.th}>
                  {label}
                </th>
              ))}
              <th role="columnheader" scope="col" className={rt.th}>
                <span className="sr-only">{t.incidentList.changeStatus}</span>
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup" className={rt.tbody}>
            {items.map((i) => (
              <tr
                key={i.id}
                role="row"
                tabIndex={0}
                data-testid={`incident-${i.number}`}
                className={`${rt.tr} group cursor-pointer hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent`}
                onClick={(e: MouseEvent<HTMLTableRowElement>) => {
                  // Links, buttons and the menu do their own thing; anywhere else on the row opens the incident.
                  if ((e.target as Element).closest("a, button, input, select, [role='menu']")) return;
                  open(i);
                }}
                onKeyDown={(e: KeyboardEvent<HTMLTableRowElement>) => {
                  if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    open(i);
                  }
                }}
              >
                <td
                  role="cell"
                  data-label={t.incidentList.colNumber}
                  className={`${rt.td} whitespace-nowrap font-mono`}
                >
                  {t.incident.number(i.number)}
                </td>
                <td role="cell" data-label={t.incidentList.colTitle} className={`${rt.td} min-w-48 font-medium`}>
                  <Link href={`/app/${slug}/incidents/${i.number}`} className="hover:text-accent hover:underline">
                    {i.title}
                  </Link>
                  <PostmortemRowBadge row={i} rules={retroRules} now={now} />
                </td>
                <td role="cell" data-label={t.incidentList.colSeverity} className={rt.td}>
                  <SeverityBadge
                    level={i.severity as SeverityLevel}
                    label={severityName(t, i.severity as SeverityLevel, severityLabels)}
                  />
                </td>
                <td role="cell" data-label={t.incidentList.colStatus} className={rt.td}>
                  <StatusPill label={t.status[i.status]} resolved={i.status === "RESOLVED"} />
                </td>
                <td role="cell" data-label={t.incidentList.colServices} className={rt.td}>
                  <ServiceChips services={i.services} />
                </td>
                <td role="cell" data-label={t.incidentList.colCommander} className={rt.td}>
                  {i.commander ? (
                    <span className="inline-flex items-center gap-2">
                      <Avatar name={i.commander.name || i.commander.email} image={i.commander.image} />
                      <span className="sr-only">{i.commander.name || i.commander.email}</span>
                    </span>
                  ) : (
                    <span className="text-muted">{t.incidentList.unassigned}</span>
                  )}
                </td>
                <td role="cell" data-label={t.incidentList.colStarted} className={`${rt.td} whitespace-nowrap`}>
                  <RelativeTime iso={i.startedAt} />
                </td>
                <td
                  role="cell"
                  data-label={t.incidentList.colDuration}
                  className={`${rt.td} whitespace-nowrap font-mono`}
                >
                  <LiveDuration startedAt={i.startedAt} resolvedAt={i.resolvedAt} />
                </td>
                <td role="cell" className={`${rt.td} md:text-right`}>
                  <RowActions
                    label={t.incident.number(i.number)}
                    current={i.status}
                    onStatus={(status) => changeStatus(i, status)}
                    onCopy={() => copyLink(i)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cursor ? (
        <div className="flex justify-center">
          <button type="button" onClick={loadMore} disabled={loading} className={secondaryButton}>
            {t.incidentList.loadMore}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Per-row menu: change status, copy link. Appears on hover or keyboard focus (always visible on phones).
 * Keyboard: Enter/Space opens, arrows move, Escape closes and returns focus to the button.
 */
function RowActions({
  label,
  current,
  onStatus,
  onCopy,
}: {
  label: string;
  current: StatusKey;
  onStatus: (status: StatusKey) => void;
  onCopy: () => void;
}) {
  const t = useCopy();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const items = () => [...(wrapper.current?.querySelectorAll<HTMLElement>("[role^='menuitem']:not(:disabled)") ?? [])];
  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const run = (action: () => void) => {
    close(true);
    action();
  };

  return (
    <div
      ref={wrapper}
      className="relative inline-block opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close(true);
        } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && open) {
          e.preventDefault();
          const list = items();
          const at = list.indexOf(document.activeElement as HTMLElement);
          list[(at + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
        }
      }}
      onBlur={(e) => {
        if (!wrapper.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.incidentList.rowActionsFor(label)}
        className={secondaryButton}
        onClick={() => {
          setOpen((o) => !o);
          // focus the first item once the menu is rendered
          setTimeout(() => items()[0]?.focus(), 0);
        }}
      >
        <span aria-hidden="true">{"⋯"}</span>
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={t.incidentList.rowActionsFor(label)}
          className="absolute right-0 z-30 mt-1 w-52 space-y-0.5 rounded border border-border bg-surface p-1 text-left shadow-lg"
        >
          <p role="presentation" className="px-2 py-1 text-xs text-muted">
            {t.incidentList.changeStatus}
          </p>
          {ALL_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              role="menuitemradio"
              aria-checked={status === current}
              disabled={status === current}
              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-bg focus:bg-bg disabled:text-muted"
              onClick={() => run(() => onStatus(status))}
            >
              {t.status[status]}
              {status === current ? <span aria-hidden="true">{"✓"}</span> : null}
            </button>
          ))}
          <hr className="my-1 border-border" />
          <button
            type="button"
            role="menuitem"
            className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-bg focus:bg-bg"
            onClick={() => run(onCopy)}
          >
            {t.incidentList.copyLink}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** First two services, then "+N" (the rest are listed in the tooltip). */
function ServiceChips({ services }: { services: { id: string; name: string }[] }) {
  const t = useCopy();
  if (services.length === 0) return <span className="text-muted">{"—"}</span>;
  const shown = services.slice(0, 2);
  const rest = services.slice(2);
  return (
    <ul className="flex flex-wrap gap-1">
      {shown.map((s) => (
        <li key={s.id} className="rounded border border-border px-2 py-0.5 text-xs">
          {s.name}
        </li>
      ))}
      {rest.length > 0 ? (
        <li
          className="rounded border border-border px-2 py-0.5 text-xs text-muted"
          title={rest.map((s) => s.name).join(", ")}
        >
          {t.incidentList.moreServices(rest.length)}
        </li>
      ) : null}
    </ul>
  );
}

/** A small badge for rows that need a postmortem: required, due soon or overdue. Nothing for any other state. */
function PostmortemRowBadge({ row, rules, now }: { row: IncidentRow; rules: RuleLike[]; now: Date }) {
  const t = useCopy();
  const { state } = getPostmortemStatus(row, rules, row.postmortemStatus ? { status: row.postmortemStatus } : null, now);
  if (!(NEEDS_ATTENTION as readonly string[]).includes(state)) return null;
  return (
    <span className="ml-2 inline-block align-middle">
      <PostmortemBadge state={state} label={t.postmortem.states[state]} />
    </span>
  );
}
