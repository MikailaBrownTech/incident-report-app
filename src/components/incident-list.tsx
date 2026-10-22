"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/avatar";
import { SeverityBadge, StatusPill } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { secondaryButton } from "@/components/form";
import * as rt from "@/components/responsive-table";
import { LiveDuration, RelativeTime } from "@/components/time-display";
import { useToast } from "@/components/toast";
import { emptyMessage, severityName, type SeverityLevel, type SeverityOverrides } from "@/copy";
import { useCopy } from "@/copy/provider";
import type { IncidentRow } from "@/features/incidents/list";
import { api } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/api-messages";

interface Props {
  slug: string;
  initial: IncidentRow[];
  initialCursor: string | null;
  /** The current filters as a query string (without `after`), reused to fetch further pages. */
  queryString: string;
  hasFilters: boolean;
  severityLabels: SeverityOverrides;
}

/** The table plus "Load more". The parent keys this on the query so new filters start fresh. */
export function IncidentList({ slug, initial, initialCursor, queryString, hasFilters, severityLabels }: Props) {
  const t = useCopy();
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    const qs = new URLSearchParams(queryString);
    qs.set("after", cursor);
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

  if (items.length === 0) {
    return <EmptyState message={hasFilters ? t.incidentList.noMatches : emptyMessage(t, "incidents")} />;
  }

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
            </tr>
          </thead>
          <tbody role="rowgroup" className={rt.tbody}>
            {items.map((i) => (
              <tr key={i.id} role="row" data-testid={`incident-${i.number}`} className={rt.tr}>
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
