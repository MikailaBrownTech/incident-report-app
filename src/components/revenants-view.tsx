"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SeverityBadge } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { inputClass, primaryButton, secondaryButton } from "@/components/form";
import { PostmortemBadge } from "@/components/postmortem-badge";
import * as rt from "@/components/responsive-table";
import { RelativeTime } from "@/components/time-display";
import { useToast } from "@/components/toast";
import { emptyMessage, severityName, type SeverityLevel, type SeverityOverrides } from "@/copy";
import { useCopy } from "@/copy/provider";
import type { PostmortemStateKey } from "@/copy/types";
import type { ChainListParams } from "@/features/revenants/recurring";
import { SORTS } from "@/features/revenants/recurring";
import type { ChainRow, Suspect } from "@/features/revenants/types";
import { api } from "@/lib/api-client";
import { formatDuration } from "@/lib/time";

interface Props {
  slug: string;
  view: "chains" | "suspects";
  params: ChainListParams;
  services: { id: string; name: string }[];
  severityLabels: SeverityOverrides;
  initial: ChainRow[];
  initialCursor: string | null;
  suspects: Suspect[];
  /** The filters as a query string without the cursor: what "load more" sends. */
  queryString: string;
}

const chip = (on: boolean) =>
  `rounded-full border px-3 py-1 text-sm ${on ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface hover:border-accent"}`;

export function RevenantsView(props: Props) {
  const t = useCopy();
  const p = t.revenant.page;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [typed, setTyped] = useState<string | null>(null);

  function update(changes: Record<string, string | null>, mode: "push" | "replace" = "push") {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      next.delete(key);
      if (value !== null && value !== "") next.set(key, value);
    }
    next.delete("cursor");
    const qs = next.toString();
    router[mode](qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  useEffect(() => {
    if (typed === null || typed.trim() === props.params.q) return;
    const timer = setTimeout(() => update({ q: typed.trim() || null }, "replace"), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  const toggleService = (id: string) => {
    const list = props.params.service.includes(id)
      ? props.params.service.filter((s) => s !== id)
      : [...props.params.service, id];
    update({ service: list.join(",") || null });
  };

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label={p.title} className="flex gap-2">
        {(["chains", "suspects"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={props.view === v}
            onClick={() => update({ view: v === "chains" ? null : v })}
            className={`rounded-t border-b-2 px-3 py-2 text-sm ${props.view === v ? "border-accent font-semibold" : "border-transparent text-muted"}`}
          >
            {v === "chains" ? p.tabChains : p.tabSuspects}
          </button>
        ))}
      </div>

      {props.view === "suspects" ? (
        <SuspectsList slug={props.slug} initial={props.suspects} severityLabels={props.severityLabels} />
      ) : (
        <>
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-48 flex-1">
                <label htmlFor="rv-search" className="sr-only">
                  {p.filters.search}
                </label>
                <input
                  id="rv-search"
                  type="search"
                  value={typed ?? props.params.q}
                  placeholder={p.filters.search}
                  onChange={(e) => setTyped(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="rv-min" className="sr-only">
                  {p.filters.minOccurrences}
                </label>
                <select
                  id="rv-min"
                  value={props.params.minOccurrences}
                  onChange={(e) => update({ minOccurrences: e.target.value === "2" ? null : e.target.value })}
                  className={inputClass}
                >
                  {[2, 3, 5].map((n) => (
                    <option key={n} value={n}>
                      {p.filters.atLeast(n)}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                aria-pressed={props.params.hasOpenRituals}
                className={chip(props.params.hasOpenRituals)}
                onClick={() => update({ hasOpenRituals: props.params.hasOpenRituals ? null : "1" })}
              >
                {p.filters.hasOpenRituals}
              </button>
              <div>
                <label htmlFor="rv-sort" className="sr-only">
                  {p.sort.label}
                </label>
                <select
                  id="rv-sort"
                  value={props.params.sort}
                  onChange={(e) => update({ sort: e.target.value === "recent" ? null : e.target.value })}
                  className={inputClass}
                >
                  {SORTS.map((s) => (
                    <option key={s} value={s}>
                      {`${p.sort.label}: ${p.sort[s]}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {props.services.length > 0 && (
              <div role="group" aria-label={p.filters.service} className="flex flex-wrap gap-2">
                {props.services.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={props.params.service.includes(s.id)}
                    className={chip(props.params.service.includes(s.id))}
                    onClick={() => toggleService(s.id)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <ChainTable {...props} onClear={() => router.push(pathname)} />
        </>
      )}
    </div>
  );
}

function ChainTable({
  slug,
  params,
  severityLabels,
  initial,
  initialCursor,
  queryString,
  onClear,
}: Props & { onClear: () => void }) {
  const t = useCopy();
  const p = t.revenant.page;
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const filtered = params.q !== "" || params.service.length > 0 || params.minOccurrences > 2 || params.hasOpenRituals;

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    const qs = new URLSearchParams(queryString);
    qs.set("cursor", cursor);
    const result = await api<{ items: ChainRow[]; nextCursor: string | null }>(
      `/api/w/${slug}/revenants?${qs.toString()}`,
    );
    setLoading(false);
    if (!result.ok) {
      toast.error(p.loadFailed);
      return;
    }
    setItems((cur) => [...cur, ...result.data.items]);
    setCursor(result.data.nextCursor);
  }

  if (items.length === 0) {
    return filtered ? (
      <div className="space-y-3 text-center">
        <EmptyState message={p.noResults} />
        <button type="button" className={secondaryButton} onClick={onClear}>
          {p.clearFilters}
        </button>
      </div>
    ) : (
      <EmptyState message={emptyMessage(t, "revenants")} />
    );
  }

  const c = p.columns;
  return (
    <div className="space-y-4">
      <div className={rt.tableWrap}>
        <table role="table" className={rt.table}>
          <caption className="sr-only">{t.revenant.plural}</caption>
          <thead role="rowgroup" className={rt.thead}>
            <tr role="row">
              {[c.root, c.occurrences, c.first, c.last, c.services, c.time, c.severity, c.rituals, c.postmortem].map(
                (h) => (
                  <th key={h} role="columnheader" scope="col" className={rt.th}>
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody role="rowgroup" className={rt.tbody}>
            {items.map((r) => {
              const expanded = open.has(r.rootId);
              return (
                <ChainRowView
                  key={r.rootId}
                  row={r}
                  slug={slug}
                  expanded={expanded}
                  severityLabels={severityLabels}
                  onToggle={() =>
                    setOpen((s) => {
                      const n = new Set(s);
                      if (n.has(r.rootId)) n.delete(r.rootId);
                      else n.add(r.rootId);
                      return n;
                    })
                  }
                />
              );
            })}
          </tbody>
        </table>
      </div>
      {cursor && (
        <div className="text-center">
          <button type="button" className={secondaryButton} onClick={() => void loadMore()} disabled={loading}>
            {p.loadMore}
          </button>
        </div>
      )}
    </div>
  );
}

function ChainRowView({
  row: r,
  slug,
  expanded,
  severityLabels,
  onToggle,
}: {
  row: ChainRow;
  slug: string;
  expanded: boolean;
  severityLabels: SeverityOverrides;
  onToggle: () => void;
}) {
  const t = useCopy();
  const p = t.revenant.page;
  const c = p.columns;
  return (
    <>
      <tr role="row" data-testid={`chain-row-${r.root.number}`} className={`${rt.tr} hover:bg-surface`}>
        <td role="cell" data-label={c.root} className={`${rt.td} min-w-56`}>
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`${expanded ? p.collapse : p.expand}: ${r.root.title}`}
            onClick={onToggle}
            className="text-left font-medium hover:underline"
          >
            <span className="mr-2 font-mono text-muted">{t.incident.number(r.root.number)}</span>
            {r.root.title}
          </button>
        </td>
        <td role="cell" data-label={c.occurrences} className={rt.td}>
          {r.occurrences}
        </td>
        <td role="cell" data-label={c.first} className={`${rt.td} whitespace-nowrap`}>
          <RelativeTime iso={r.firstAt} />
        </td>
        <td role="cell" data-label={c.last} className={`${rt.td} whitespace-nowrap`}>
          <RelativeTime iso={r.lastAt} />
        </td>
        <td role="cell" data-label={c.services} className={rt.td}>
          {r.services.map((s) => s.name).join(", ") || "-"}
        </td>
        <td role="cell" data-label={c.time} className={`${rt.td} whitespace-nowrap font-mono`}>
          {formatDuration(r.totalDurationMs)}
        </td>
        <td role="cell" data-label={c.severity} className={rt.td}>
          <SeverityBadge
            level={r.highestSeverity as SeverityLevel}
            label={severityName(t, r.highestSeverity as SeverityLevel, severityLabels)}
          />
        </td>
        <td role="cell" data-label={c.rituals} className={rt.td}>
          {r.openRituals}
        </td>
        <td role="cell" data-label={c.postmortem} className={rt.td}>
          <PostmortemBadge
            state={r.lastPostmortemState as PostmortemStateKey}
            label={t.postmortem.states[r.lastPostmortemState as PostmortemStateKey]}
          />
        </td>
      </tr>
      {expanded && (
        <tr role="row" className="block md:table-row">
          <td role="cell" colSpan={9} className="block bg-surface p-3 md:table-cell">
            <ol className="space-y-1 text-sm">
              {r.members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/app/${slug}/incidents/${m.number}`} className="font-mono text-accent underline">
                    {t.incident.number(m.number)}
                  </Link>
                  <span>{m.title}</span>
                  <span className="text-xs text-muted">
                    <RelativeTime iso={m.startedAt} />
                    {m.gapDays !== null ? ` · ${t.revenant.gapLater(m.gapDays)}` : ` · ${t.revenant.firstOccurrence}`}
                  </span>
                </li>
              ))}
            </ol>
          </td>
        </tr>
      )}
    </>
  );
}

function SuspectsList({
  slug,
  initial,
  severityLabels,
}: {
  slug: string;
  initial: Suspect[];
  severityLabels: SeverityOverrides;
}) {
  const t = useCopy();
  const r = t.revenant;
  const toast = useToast();
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function link(s: Suspect) {
    setBusy(s.incident.id);
    const result = await api(`/api/w/${slug}/incidents/${s.incident.number}/revenant-link`, {
      method: "POST",
      body: { revenantOfNumber: s.target.number },
    });
    setBusy(null);
    if (!result.ok) {
      toast.error(result.fieldErrors?.revenantOfNumber ? r.toasts.notEarlier : r.toasts.linkFailed);
      return;
    }
    toast.success(r.toasts.linked);
    setItems((cur) => cur.filter((x) => x.incident.id !== s.incident.id));
    router.refresh();
  }

  async function dismiss(s: Suspect) {
    setBusy(s.incident.id);
    const result = await api(`/api/w/${slug}/incidents/${s.incident.number}/revenant-dismiss`, {
      method: "POST",
      body: { candidateNumber: s.target.number },
    });
    setBusy(null);
    if (!result.ok) {
      toast.error(r.toasts.linkFailed);
      return;
    }
    toast.success(r.toasts.dismissed);
    setItems((cur) => cur.filter((x) => x.incident.id !== s.incident.id));
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{r.page.suspectsIntro}</p>
      {items.length === 0 ? (
        <EmptyState message={r.page.noSuspects} />
      ) : (
        <ul className="space-y-3">
          {items.map((s) => (
            <li
              key={s.incident.id}
              data-testid={`suspect-${s.incident.number}`}
              className="space-y-2 rounded border border-border p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/app/${slug}/incidents/${s.incident.number}`} className="font-mono text-accent underline">
                  {t.incident.number(s.incident.number)}
                </Link>
                <span className="font-medium">{s.incident.title}</span>
                <SeverityBadge
                  level={s.incident.severity as SeverityLevel}
                  label={severityName(t, s.incident.severity as SeverityLevel, severityLabels)}
                />
              </div>
              <p className="text-sm">
                <Link href={`/app/${slug}/incidents/${s.target.number}`} className="font-mono text-accent underline">
                  {t.incident.number(s.target.number)}
                </Link>{" "}
                {s.target.title}
              </p>
              <p className="text-xs text-muted">
                {r.strength.strong}
                {" · "}
                {r.reason(s.titleScore >= 0.3, s.sharedServices)}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={primaryButton}
                  disabled={busy === s.incident.id}
                  onClick={() => void link(s)}
                >
                  {r.page.linkSuspect}
                </button>
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={busy === s.incident.id}
                  onClick={() => void dismiss(s)}
                >
                  {r.dismiss}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
