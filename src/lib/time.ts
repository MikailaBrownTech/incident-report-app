const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400_000],
  ["month", 30.44 * 86_400_000],
  ["week", 7 * 86_400_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "3 minutes ago", "yesterday", "in 2 hours". Anything under a minute is "now". */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const diff = date.getTime() - now.getTime();
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size) return rtf.format(Math.trunc(diff / size), unit);
  }
  return rtf.format(0, "second");
}

/** Compact elapsed time: "42s", "7m", "3h 05m", "2d 4h". Negative input is treated as zero. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

/** Local date/time for tooltips, e.g. "Jan 2, 2026, 3:04 PM". */
export function formatExact(date: Date): string {
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

/** Value for <input type="datetime-local">: local time, minute precision. */
export function toLocalInput(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}
