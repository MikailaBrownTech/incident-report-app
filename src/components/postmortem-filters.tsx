"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { inputClass, secondaryButton } from "@/components/form";
import { severityName, type SeverityLevel, type SeverityOverrides } from "@/copy";
import { useCopy } from "@/copy/provider";
import { LIST_SORTS, LIST_STATES, isFiltered, type PostmortemListParams } from "@/features/postmortems/schema";

const SEVERITIES = [1, 2, 3, 4, 5] as const;
const chip = (on: boolean) =>
  `rounded-full border px-3 py-1 text-sm ${on ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface hover:border-accent"}`;

/** Every control writes to the URL, so a filtered list can be shared and survives a reload. */
export function PostmortemFilters({
  params,
  severityLabels,
}: {
  params: PostmortemListParams;
  severityLabels: SeverityOverrides;
}) {
  const t = useCopy();
  const l = t.postmortem.list;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [typed, setTyped] = useState<string | null>(null);
  const q = typed ?? params.q;

  function update(changes: Record<string, string | string[] | null>, mode: "push" | "replace" = "push") {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      next.delete(key);
      if (value === null) continue;
      if (Array.isArray(value)) {
        if (value.length > 0) next.set(key, value.join(","));
      } else if (value !== "") next.set(key, value);
    }
    next.delete("cursor"); // any change starts again from the first page
    const qs = next.toString();
    router[mode](qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // typing waits for a pause, then replaces the URL (so it doesn't fill the history)
  useEffect(() => {
    if (typed === null || typed.trim() === params.q) return;
    const timer = setTimeout(() => update({ q: typed.trim() || null }, "replace"), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  const toggle = <T extends string | number>(list: T[], value: T): string[] =>
    (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]).map(String);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label htmlFor="pm-search" className="sr-only">
            {l.searchLabel}
          </label>
          <input
            id="pm-search"
            type="search"
            value={q}
            placeholder={l.searchPlaceholder}
            onChange={(e) => setTyped(e.target.value)}
            className={inputClass}
          />
        </div>
        <button
          type="button"
          aria-pressed={params.needsAttention}
          className={chip(params.needsAttention)}
          onClick={() => update({ attention: params.needsAttention ? null : "1" })}
        >
          {l.needsAttention}
        </button>
        <div>
          <label htmlFor="pm-sort" className="sr-only">
            {l.sortLabel}
          </label>
          <select
            id="pm-sort"
            value={params.sort}
            onChange={(e) => update({ sort: e.target.value === "due" ? null : e.target.value, dir: null })}
            className={inputClass}
          >
            {LIST_SORTS.map((s) => (
              <option key={s} value={s}>
                {`${l.sortLabel}: ${l.sortOptions[s]}`}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div role="group" aria-label={l.filterState} className="flex flex-wrap items-center gap-2">
        {LIST_STATES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={params.state.includes(s)}
            className={chip(params.state.includes(s))}
            onClick={() => update({ state: toggle(params.state, s) })}
          >
            {t.postmortem.states[s]}
          </button>
        ))}
      </div>
      <div role="group" aria-label={l.filterSeverity} className="flex flex-wrap items-center gap-2">
        {SEVERITIES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={params.severity.includes(s)}
            className={chip(params.severity.includes(s))}
            onClick={() => update({ severity: toggle(params.severity, s) })}
          >
            {severityName(t, s as SeverityLevel, severityLabels)}
          </button>
        ))}
        {isFiltered(params) && (
          <button type="button" className={secondaryButton} onClick={() => router.push(pathname)}>
            {l.clearFilters}
          </button>
        )}
      </div>
    </div>
  );
}
