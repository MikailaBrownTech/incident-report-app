import type { CopyDictionary as Copy } from "@/copy/types";
import { severityName, type SeverityLevel, type SeverityOverrides } from "@/copy";
import { granularityOf, type Bucket, type Range } from "@/features/dashboard/range";

const W = 640;
const H = 180;
const PAD = { top: 12, right: 8, bottom: 24, left: 32 };

/** Bucket start as a short label: "Jan 5" for days, "Week of Jan 5", "Jan 2026" for months. */
export function bucketLabel(t: Copy, start: string, range: Range): string {
  const d = new Date(`${start}T00:00:00Z`);
  const g = granularityOf(range);
  if (g === "month") return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return g === "week" ? t.dashboard.weekOf(day) : day;
}

/**
 * Incidents per period as bars on one axis starting at zero. Each bar has a tooltip (SVG title) and a wider invisible
 * hit area; the same numbers are in a visually hidden table for screen readers.
 */
export function IncidentsOverTime({ t, buckets, range }: { t: Copy; buckets: Bucket[]; range: Range }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(1, buckets.length);
  const barW = Math.max(2, Math.min(24, slot - 2));
  const y = (n: number) => PAD.top + innerH - (n / max) * innerH;
  const first = buckets[0];
  const last = buckets[buckets.length - 1];

  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-semibold">{t.dashboard.overTime}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t.dashboard.overTime}>
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className="stroke-rule" strokeWidth={1} />
        <line x1={PAD.left} x2={W - PAD.right} y1={y(max)} y2={y(max)} className="stroke-rule" strokeDasharray="2 3" />
        <text x={PAD.left - 6} y={y(max) + 4} textAnchor="end" className="fill-muted text-xs">
          {max}
        </text>
        <text x={PAD.left - 6} y={y(0) + 4} textAnchor="end" className="fill-muted text-xs">
          {0}
        </text>
        {buckets.map((b, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const label = t.dashboard.chartBar(bucketLabel(t, b.start, range), b.count);
          return (
            <g key={b.start}>
              <title>{label}</title>
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH} fill="transparent" />
              {b.count > 0 && (
                <rect x={x} y={y(b.count)} width={barW} height={y(0) - y(b.count)} rx={2} className="fill-link" />
              )}
            </g>
          );
        })}
        {first && (
          <text x={PAD.left} y={H - 6} className="fill-muted text-xs">
            {bucketLabel(t, first.start, range)}
          </text>
        )}
        {last && last !== first && (
          <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-muted text-xs">
            {bucketLabel(t, last.start, range)}
          </text>
        )}
      </svg>
      <table className="sr-only">
        <caption>{t.dashboard.overTime}</caption>
        <thead>
          <tr>
            <th scope="col">{t.dashboard.chartColPeriod}</th>
            <th scope="col">{t.dashboard.chartColCount}</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.start}>
              <td>{bucketLabel(t, b.start, range)}</td>
              <td>{b.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Severity counts as horizontal bars. The numeral, the label and the count are all text; colour is only a tint. */
export function BySeverity({
  t,
  counts,
  labels,
}: {
  t: Copy;
  counts: Record<SeverityLevel, number>;
  labels: SeverityOverrides;
}) {
  const levels = [5, 4, 3, 2, 1] as const;
  const max = Math.max(1, ...levels.map((l) => counts[l]));
  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-semibold">{t.dashboard.bySeverity}</figcaption>
      <ul className="space-y-2">
        {levels.map((level) => (
          <li key={level} className="grid grid-cols-[minmax(0,10rem)_1fr_2rem] items-center gap-3 text-sm">
            <span className="truncate">{`${level} ${severityName(t, level, labels)}`}</span>
            <span className="h-2 rounded-tag bg-raised" aria-hidden="true">
              <span
                className="block h-2 rounded-tag"
                style={{ width: `${(counts[level] / max) * 100}%`, background: `var(--sev-${level})` }}
              />
            </span>
            <span className="text-right">{counts[level]}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
