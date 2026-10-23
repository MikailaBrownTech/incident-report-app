"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/avatar";
import { SeverityBadge, DueLabel } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { secondaryButton } from "@/components/form";
import { PostmortemBadge } from "@/components/postmortem-badge";
import * as rt from "@/components/responsive-table";
import { RelativeTime } from "@/components/time-display";
import { useToast } from "@/components/toast";
import { emptyMessage, severityName, type SeverityLevel, type SeverityOverrides } from "@/copy";
import { useCopy } from "@/copy/provider";
import type { PostmortemListPage, PostmortemListRow } from "@/features/postmortems/schema";
import { daysOverdue, daysUntil } from "@/features/postmortems/status";
import { api } from "@/lib/api-client";
import { formatExact } from "@/lib/time";

interface Props {
  slug: string;
  initial: PostmortemListRow[];
  initialCursor: string | null;
  /** The current filters as a query string (without `cursor`), reused to fetch further pages. */
  queryString: string;
  hasFilters: boolean;
  severityLabels: SeverityOverrides;
}

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** The table plus "Load more". The parent keys this on the query so new filters start fresh. */
export function PostmortemList({ slug, initial, initialCursor, queryString, hasFilters, severityLabels }: Props) {
  const t = useCopy();
  const l = t.postmortem.list;
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const now = useNow(60_000);
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    setFailed(false);
    const qs = new URLSearchParams(queryString);
    qs.set("cursor", cursor);
    const result = await api<PostmortemListPage>(`/api/w/${slug}/postmortems?${qs.toString()}`);
    setLoading(false);
    if (!result.ok) {
      setFailed(true);
      toast.error(l.loadFailed);
      return;
    }
    setItems((current) => [...current, ...result.data.items]);
    setCursor(result.data.nextCursor);
  }

  if (items.length === 0) {
    return hasFilters ? (
      <div className="space-y-3 text-center">
        <EmptyState message={l.noResults} />
        <button type="button" className={secondaryButton} onClick={() => router.push(pathname)}>
          {l.clearFilters}
        </button>
      </div>
    ) : (
      <EmptyState message={emptyMessage(t, "postmortems")} />
    );
  }

  return (
    <div className="space-y-4">
      <div className={rt.tableWrap}>
        <table role="table" className={rt.table}>
          <caption className="sr-only">{t.postmortem.plural}</caption>
          <thead role="rowgroup" className={rt.thead}>
            <tr role="row">
              {[
                l.columns.incident,
                l.columns.severity,
                l.columns.state,
                l.columns.author,
                l.columns.due,
                l.columns.published,
                l.columns.actionItems,
              ].map((label) => (
                <th key={label} role="columnheader" scope="col" className={rt.th}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup" className={rt.tbody}>
            {items.map((r) => {
              const due = r.dueAt ? new Date(r.dueAt) : null;
              const overdue = r.state === "OVERDUE" && due !== null;
              const href = r.postmortemId
                ? `/app/${slug}/incidents/${r.number}/postmortem`
                : `/app/${slug}/incidents/${r.number}`;
              return (
                <tr
                  key={r.incidentId}
                  role="row"
                  data-testid={`postmortem-${r.number}`}
                  className={`${rt.tr} hover:bg-surface`}
                >
                  <td role="cell" data-label={l.columns.incident} className={`${rt.td} min-w-56`}>
                    <Link href={href} className="font-medium hover:text-accent hover:underline">
                      <span className="mr-2 text-muted">{t.incident.number(r.number)}</span>
                      {r.title}
                    </Link>
                  </td>
                  <td role="cell" data-label={l.columns.severity} className={rt.td}>
                    <SeverityBadge
                      level={r.severity as SeverityLevel}
                      label={severityName(t, r.severity as SeverityLevel, severityLabels)}
                    />
                  </td>
                  <td role="cell" data-label={l.columns.state} className={rt.td}>
                    <PostmortemBadge state={r.state} label={t.postmortem.states[r.state]} />
                  </td>
                  <td role="cell" data-label={l.columns.author} className={rt.td}>
                    {r.author ? (
                      <span className="inline-flex items-center gap-2">
                        <Avatar name={r.author.name || r.author.email} image={r.author.image} />
                        <span>{r.author.name || r.author.email || t.timeline.actorFormerMember}</span>
                      </span>
                    ) : (
                      <span className="text-muted">{l.noAuthor}</span>
                    )}
                  </td>
                  <td role="cell" data-label={l.columns.due} className={`${rt.td} whitespace-nowrap`}>
                    {due ? (
                      <span title={formatExact(due)} suppressHydrationWarning>
                        <DueLabel
                          overdue={overdue}
                          iconLabel={t.a11y.overdueIcon}
                          label={
                            due.getTime() < now.getTime()
                              ? t.postmortem.overdueBy(daysOverdue(due, now))
                              : t.postmortem.dueIn(daysUntil(due, now))
                          }
                        />
                      </span>
                    ) : (
                      <span className="text-muted">{t.postmortem.noDueDate}</span>
                    )}
                  </td>
                  <td role="cell" data-label={l.columns.actionItems} className={rt.td}>
                    {r.actionItems && r.actionItems.total > 0 ? (
                      <span className="inline-flex flex-wrap items-center gap-2 text-sm">
                        {t.ritual.progress(r.actionItems.done, r.actionItems.total)}
                        {r.actionItems.overdue > 0 && (
                          <span className="inline-flex items-center gap-1 font-medium text-danger">
                            <AlertTriangle aria-hidden="true" className="size-3.5" />
                            {t.ritual.overdueCount(r.actionItems.overdue)}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted">{"-"}</span>
                    )}
                  </td>
                  <td role="cell" data-label={l.columns.published} className={`${rt.td} whitespace-nowrap`}>
                    {r.publishedAt ? <RelativeTime iso={r.publishedAt} /> : <span className="text-muted">{"-"}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {cursor && (
        <div className="text-center">
          <button type="button" className={secondaryButton} onClick={() => void loadMore()} disabled={loading}>
            {failed ? l.retry : l.loadMore}
          </button>
        </div>
      )}
    </div>
  );
}
