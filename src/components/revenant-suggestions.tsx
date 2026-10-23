"use client";

import { useEffect, useRef, useState } from "react";
import { RevenantCandidateRow } from "@/components/revenant-candidate";
import { secondaryButton } from "@/components/form";
import { type SeverityOverrides } from "@/copy";
import { useCopy } from "@/copy/provider";
import type { RevenantCandidate } from "@/features/revenants/types";
import { api } from "@/lib/api-client";

/** How long to wait after the last keystroke or service change before asking. */
export const SUGGEST_DEBOUNCE_MS = 500;
export const SUGGEST_MIN_TITLE = 8;

interface Props {
  slug: string;
  title: string;
  serviceIds: string[];
  severityLabels: SeverityOverrides;
  /** The incident number picked as "this is a recurrence", or null. */
  selected: number | null;
  onSelect: (candidate: RevenantCandidate | null) => void;
}

/**
 * "Looks like a revenant": up to three earlier incidents under the title field while declaring. It loads in the background
 * and never gets in the way: while it waits, or if the request fails, the form simply works and the panel shows nothing.
 */
export function RevenantSuggestions({ slug, title, serviceIds, severityLabels, selected, onSelect }: Props) {
  const t = useCopy();
  const r = t.revenant;
  const [candidates, setCandidates] = useState<RevenantCandidate[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [picked, setPicked] = useState<RevenantCandidate | null>(null);
  const latest = useRef(0);
  const trimmed = title.trim();
  const services = serviceIds.join(",");

  useEffect(() => {
    const request = ++latest.current;
    if (trimmed.length < SUGGEST_MIN_TITLE) {
      // too short to compare: nothing to show (the effect only schedules work; state is cleared by the timer below)
      const clear = setTimeout(() => setCandidates([]), 0);
      return () => clearTimeout(clear);
    }
    const timer = setTimeout(async () => {
      const qs = new URLSearchParams({ title: trimmed, limit: "3" });
      if (services) qs.set("services", services);
      const result = await api<{ candidates: RevenantCandidate[] }>(
        `/api/w/${slug}/incidents/suggestions?${qs.toString()}`,
      );
      if (request !== latest.current) return; // a newer question has been asked since
      setCandidates(result.ok ? result.data.candidates : []);
    }, SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [slug, trimmed, services]);

  if (selected !== null && picked) {
    const root = picked.chain?.root.number ?? picked.incident.number;
    return (
      <p
        role="status"
        data-testid="revenant-selected"
        className="flex flex-wrap items-center gap-2 rounded border border-accent p-2 text-sm"
      >
        {r.selected(t.incident.number(root))}
        <button
          type="button"
          className={secondaryButton}
          onClick={() => {
            setPicked(null);
            onSelect(null);
          }}
        >
          {r.undo}
        </button>
      </p>
    );
  }

  const shown = candidates.filter((c) => !dismissed.has(c.incident.number)).slice(0, 3);
  if (shown.length === 0) return null;
  return (
    <section
      aria-labelledby="revenant-suggest-title"
      data-testid="revenant-suggestions"
      className="space-y-2 rounded border border-border bg-bg p-3"
    >
      <h3 id="revenant-suggest-title" className="font-semibold">
        {r.suggestionHeading}
      </h3>
      <p className="text-xs text-muted">{r.suggestionIntro}</p>
      <ul className="space-y-2">
        {shown.map((c) => (
          <RevenantCandidateRow
            key={c.incident.id}
            slug={slug}
            candidate={c}
            severityLabels={severityLabels}
            onLink={() => {
              setPicked(c);
              onSelect(c);
            }}
            onDismiss={() => setDismissed((d) => new Set(d).add(c.incident.number))}
          />
        ))}
      </ul>
    </section>
  );
}
