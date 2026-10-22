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
