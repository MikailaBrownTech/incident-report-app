"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { secondaryButton } from "@/components/form";
import { inputClass } from "@/components/form";
import { severityName, type SeverityOverrides } from "@/copy";
import { useCopy } from "@/copy/provider";
import {
  SORT_KEYS,
  SEVERITIES,
  STATUSES,
  defaultDir,
  hasActiveFilters,
  type ListParams,
} from "@/features/incidents/list-params";

interface Props {
  params: ListParams;
  services: { id: string; name: string }[];
  severityLabels: SeverityOverrides;
}

const chip = (on: boolean) =>
  `rounded-full border px-3 py-1 text-sm ${on ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface hover:border-accent"}`;

/** Every control writes to the URL, so a filtered list can be shared, bookmarked and survives a reload. */
export function IncidentFilters({ params, services, severityLabels }: Props) {
  const t = useCopy();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(params.q);

  function update(changes: Record<string, string | string[] | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      next.delete(key);
      if (value === null) continue;
      if (Array.isArray(value)) {
        if (value.length > 0) next.set(key, value.join(","));
      } else if (value !== "") next.set(key, value);
    }
    next.delete("after"); // any change starts again from the first page
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Debounced search: wait for a pause in typing before touching the URL.
  useEffect(() => {
    if (q.trim() === params.q) return;
    const timer = setTimeout(() => update({ q: q.trim() || null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const toggle = <T extends string | number>(list: T[], value: T): string[] =>
    (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]).map(String);

  const hasFilters = hasActiveFilters(params);

  const sortLabel = {
    started: t.incidentList.sortStarted,
    severity: t.incidentList.sortSeverity,
    status: t.incidentList.sortStatus,
    number: t.incidentList.sortNumber,
  };

  return (
    <section aria-label={t.incidentList.filtersLabel} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <label htmlFor="incident-search" className="sr-only">
            {t.incidentList.searchLabel}
          </label>
          <input
            id="incident-search"
            type="search"
            value={q}
            placeholder={t.incidentList.searchPlaceholder}
            onChange={(e) => setQ(e.target.value)}
            className={inputClass}
          />
        </div>

        <label className="flex items-center gap-2 py-2 text-sm">
          <input
            type="checkbox"
            checked={params.openOnly && params.status.length === 0}
            disabled={params.status.length > 0}
            onChange={(e) => update({ open: e.target.checked ? null : "0" })}
          />
          {t.incidentList.openOnly}
        </label>

        <div className="flex items-center gap-2">
          <label htmlFor="incident-sort" className="text-sm text-muted">
            {t.incidentList.sortBy}
          </label>
          <select
            id="incident-sort"
            value={params.sort}
            onChange={(e) => update({ sort: e.target.value === "started" ? null : e.target.value, dir: null })}
            className="rounded border border-border bg-surface px-2 py-1.5 text-sm"
          >
            {SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {sortLabel[key]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={secondaryButton}
            aria-label={params.dir === "asc" ? t.incidentList.sortAscending : t.incidentList.sortDescending}
            onClick={() => {
              const flipped = params.dir === "asc" ? "desc" : "asc";
              update({ dir: flipped === defaultDir(params.sort) ? null : flipped });
            }}
          >
            <span aria-hidden="true">{params.dir === "asc" ? "↑" : "↓"}</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="sr-only">{t.incidentList.statusFilter}</legend>
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={params.status.includes(s)}
              className={chip(params.status.includes(s))}
              onClick={() => update({ status: toggle(params.status, s) })}
            >
              {t.status[s]}
            </button>
          ))}
        </fieldset>

        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="sr-only">{t.incidentList.severityFilter}</legend>
          {SEVERITIES.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={params.severity.includes(level)}
              className={chip(params.severity.includes(level))}
              onClick={() => update({ severity: toggle(params.severity, level) })}
            >
              {severityName(t, level, severityLabels)}
            </button>
          ))}
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <details className="relative">
          <summary className={`${secondaryButton} cursor-pointer list-none`}>
            {t.incidentList.serviceFilter}
            {params.serviceIds.length > 0 ? ` (${params.serviceIds.length})` : ""}
          </summary>
          <div className="absolute z-30 mt-1 max-h-60 w-64 overflow-auto rounded border border-border bg-surface p-2 shadow-lg">
            {services.length === 0 ? (
              <p className="px-1 py-1 text-sm text-muted">{t.incidentList.noServicesYet}</p>
            ) : (
              services.map((s) => (
                <label key={s.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-bg">
                  <input
                    type="checkbox"
                    checked={params.serviceIds.includes(s.id)}
                    onChange={() => update({ service: toggle(params.serviceIds, s.id) })}
                  />
                  {s.name}
                </label>
              ))
            )}
          </div>
        </details>

        <label className="flex items-center gap-2 text-sm">
          {t.incidentList.dateFrom}
          <input
            type="date"
            value={params.from ?? ""}
            max={params.to ?? undefined}
            onChange={(e) => update({ from: e.target.value || null })}
            className="rounded border border-border bg-surface px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          {t.incidentList.dateTo}
          <input
            type="date"
            value={params.to ?? ""}
            min={params.from ?? undefined}
            onChange={(e) => update({ to: e.target.value || null })}
            className="rounded border border-border bg-surface px-2 py-1"
          />
        </label>

        {hasFilters ? (
          <button
            type="button"
            className="text-sm text-accent underline underline-offset-2"
            onClick={() => {
              setQ("");
              router.replace(pathname, { scroll: false });
            }}
          >
            {t.incidentList.clearFilters}
          </button>
        ) : null}
      </div>
    </section>
  );
}
