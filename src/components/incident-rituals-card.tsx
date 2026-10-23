import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useCopy } from "@/copy/provider";
import type { Progress } from "@/features/action-items/schema";

interface Props {
  slug: string;
  incidentNumber: number;
  /** Whether the incident has a postmortem (action items live on one). */
  hasPostmortem: boolean;
  progress: Progress;
}

/** Progress of this incident's action items. Real counts only: with no postmortem or no items it says exactly that. */
export function IncidentRitualsCard({ slug, incidentNumber, hasPostmortem, progress }: Props) {
  const r = useCopy().ritual;
  const href = `/app/${slug}/incidents/${incidentNumber}/postmortem`;
  const percent = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);

  return (
    <section
      aria-labelledby="rituals-heading"
      data-testid="rituals-card"
      className="space-y-3 rounded border border-border bg-surface p-4"
    >
      <h2 id="rituals-heading" className="text-lg font-semibold">
        {r.card.heading}
      </h2>
      {!hasPostmortem ? (
        <p className="text-sm text-muted">{r.card.startFirst}</p>
      ) : progress.total === 0 ? (
        <p className="text-sm text-muted">{r.card.none}</p>
      ) : (
        <>
          <div
            role="progressbar"
            aria-label={r.card.heading}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
            aria-valuetext={r.progress(progress.done, progress.total)}
            className="h-2 overflow-hidden rounded-full bg-bg"
          >
            <div className="h-full bg-success" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-sm">{r.progress(progress.done, progress.total)}</p>
          {progress.overdue > 0 && (
            <p className="inline-flex items-center gap-1.5 text-sm font-medium text-danger">
              <AlertTriangle aria-hidden="true" className="size-4" />
              {r.overdueCount(progress.overdue)}
            </p>
          )}
        </>
      )}
      {hasPostmortem && (
        <Link href={href} className="block text-sm text-accent underline">
          {r.card.viewPostmortem}
        </Link>
      )}
    </section>
  );
}
