/** Pure and browser-safe: the date window of the dashboard and how its incidents are bucketed over time. */
export const RANGES = ["7d", "30d", "90d", "all"] as const;
export type Range = (typeof RANGES)[number];
export const DEFAULT_RANGE: Range = "30d";

const DAY = 86_400_000;
const DAYS: Record<Exclude<Range, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };

/** Lenient: anything unknown falls back to the default, so a stale URL still renders. */
export function parseRange(raw: string | string[] | undefined): Range {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return RANGES.find((r) => r === v) ?? DEFAULT_RANGE;
}

/** Start of the window (inclusive), or null for all time. */
export function rangeStart(range: Range, now: Date): Date | null {
  return range === "all" ? null : new Date(now.getTime() - DAYS[range] * DAY);
}

export type Granularity = "day" | "week" | "month";
export const granularityOf = (range: Range): Granularity =>
  range === "7d" || range === "30d" ? "day" : range === "90d" ? "week" : "month";

export interface Bucket {
  /** ISO date of the bucket's first day (UTC). */
  start: string;
  count: number;
}

const utcMidnight = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

function bucketStart(d: Date, g: Granularity): number {
  if (g === "day") return utcMidnight(d);
  if (g === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const day = (d.getUTCDay() + 6) % 7; // Monday first
  return utcMidnight(d) - day * DAY;
}

function nextStart(t: number, g: Granularity): number {
  if (g === "day") return t + DAY;
  if (g === "week") return t + 7 * DAY;
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/**
 * Counts per bucket with every bucket in between present (zeros included), so the chart has no gaps. For all time the
 * series runs from the oldest incident to now.
 */
export function bucketIncidents(startedAt: Date[], range: Range, now: Date): Bucket[] {
  const g = granularityOf(range);
  const from = rangeStart(range, now);
  const first = from ?? (startedAt.length ? new Date(Math.min(...startedAt.map((d) => d.getTime()))) : now);
  const counts = new Map<number, number>();
  for (const d of startedAt) counts.set(bucketStart(d, g), (counts.get(bucketStart(d, g)) ?? 0) + 1);
  const out: Bucket[] = [];
  const last = bucketStart(now, g);
  for (let t = bucketStart(first, g); t <= last; t = nextStart(t, g)) {
    out.push({ start: new Date(t).toISOString().slice(0, 10), count: counts.get(t) ?? 0 });
  }
  return out;
}
