"use client";

import { useEffect, useState } from "react";
import { useCopy } from "@/copy/provider";
import { formatDuration, formatExact, formatRelative } from "@/lib/time";

/** Current time that re-renders every `intervalMs`. */
function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** "3 hours ago" with the exact local time in the tooltip. */
export function RelativeTime({ iso }: { iso: string }) {
  const now = useNow(30_000);
  const date = new Date(iso);
  return (
    // Server and browser clocks differ by a few seconds and time zones differ, so allow the text to change on hydration.
    <time dateTime={iso} title={formatExact(date)} suppressHydrationWarning>
      {formatRelative(date, now)}
    </time>
  );
}

/** Elapsed time. Ticks every second while the incident is open; fixed once it is resolved. */
export function LiveDuration({ startedAt, resolvedAt }: { startedAt: string; resolvedAt: string | null }) {
  const t = useCopy();
  const now = useNow(resolvedAt ? 3_600_000 : 1000);
  const start = new Date(startedAt).getTime();
  const end = resolvedAt ? new Date(resolvedAt).getTime() : now.getTime();
  return (
    <span suppressHydrationWarning>
      {formatDuration(end - start)}
      {resolvedAt ? null : <span className="sr-only">{t.incidentList.ongoing}</span>}
    </span>
  );
}
