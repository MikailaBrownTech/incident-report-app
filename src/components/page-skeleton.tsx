"use client";

import { useCopy } from "@/copy/provider";

/** Loading state: pulsing blocks (static for reduced-motion users) with an accessible label. */
export function PageSkeleton() {
  const t = useCopy();
  return (
    <div role="status" aria-label={t.a11y.loading} className="space-y-4">
      <div className="h-8 w-56 rounded bg-surface motion-safe:animate-pulse" />
      <div className="h-24 rounded border border-border bg-surface motion-safe:animate-pulse" />
      <div className="h-24 rounded border border-border bg-surface motion-safe:animate-pulse" />
    </div>
  );
}

/** Loading state for list screens: a heading, a filter bar and a few pulsing rows. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  const t = useCopy();
  return (
    <div role="status" aria-label={t.a11y.loading} className="space-y-4">
      <div className="h-8 w-48 rounded bg-surface motion-safe:animate-pulse" />
      <div className="h-10 rounded bg-surface motion-safe:animate-pulse" />
      <div className="divide-y divide-border rounded border border-border">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-14 bg-surface/60 motion-safe:animate-pulse" />
        ))}
      </div>
    </div>
  );
}
