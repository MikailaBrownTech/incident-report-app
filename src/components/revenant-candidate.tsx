"use client";

import Link from "next/link";
import { SeverityBadge } from "@/components/badges";
import { primaryButton, secondaryButton } from "@/components/form";
import { RelativeTime } from "@/components/time-display";
import { severityName, type SeverityLevel, type SeverityOverrides } from "@/copy";
import { useCopy } from "@/copy/provider";
import type { RevenantCandidate } from "@/features/revenants/types";

interface Props {
  slug: string;
  candidate: RevenantCandidate;
  severityLabels: SeverityOverrides;
  onLink: () => void;
  onDismiss: () => void;
  linkDisabled?: boolean;
}

/** One suggested earlier incident: what it is, why it looks similar, and the two decisions. Nothing happens until a person picks one. */
export function RevenantCandidateRow({ slug, candidate, severityLabels, onLink, onDismiss, linkDisabled }: Props) {
  const t = useCopy();
  const r = t.revenant;
  const c = candidate;
  const label = t.incident.number(c.incident.number);
  const root = c.chain?.root;

  return (
    <li
      data-testid={`candidate-${c.incident.number}`}
      data-strength={c.strength}
      className="space-y-2 rounded border border-border p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/app/${slug}/incidents/${c.incident.number}`} className="text-sm text-accent underline">
          {label}
        </Link>
        <SeverityBadge
          level={c.incident.severity as SeverityLevel}
          label={severityName(t, c.incident.severity as SeverityLevel, severityLabels)}
        />
        <span className="rounded-tag border border-border px-2 py-0.5 text-xs">{r.strength[c.strength]}</span>
      </div>
      <p className="font-medium">{c.incident.title}</p>
      <p className="text-xs text-muted">
        <RelativeTime iso={c.incident.startedAt} />
        {" · "}
        {r.reason(c.reason.similarTitle, c.reason.sharedServices)}
      </p>
      {c.chain && root && (
        <p className="text-xs text-muted">{r.partOfChain(t.incident.number(root.number), c.chain.size)}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryButton} onClick={onLink} disabled={linkDisabled}>
          {r.link}
        </button>
        <button type="button" className={secondaryButton} onClick={onDismiss}>
          {r.dismiss}
        </button>
      </div>
    </li>
  );
}
