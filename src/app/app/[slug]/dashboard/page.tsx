import Link from "next/link";
import { SeverityBadge } from "@/components/badges";
import { BySeverity, IncidentsOverTime } from "@/components/dashboard-charts";
import { EmptyState } from "@/components/empty-state";
import { RelativeTime } from "@/components/time-display";
import { getCopy, severityName, type SeverityLevel, type SeverityOverrides } from "@/copy";
import { getDashboard } from "@/features/dashboard/queries";
import { RANGES, parseRange } from "@/features/dashboard/range";
import { getWorkspaceContext } from "@/server/auth/context";

const chip = (on: boolean) =>
  `rounded-tag border px-3 py-1 text-sm ${on ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface hover:border-accent"}`;

function Tile({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="space-y-1 rounded border border-border bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className={`text-xl font-semibold ${accent ? "text-accent" : ""}`}>{value}</p>
    </div>
  );
}

/** The workspace overview: counts, two charts and what needs attention, for a chosen time range (default 30 days). */
export default async function DashboardPage({ params, searchParams }: PageProps<"/app/[slug]/dashboard">) {
  const { slug } = await params;
  const range = parseRange((await searchParams).range);
  const ctx = await getWorkspaceContext(slug);
  const t = getCopy(ctx.skin);
  const d = t.dashboard;
  const labels = ctx.workspace.severityLabels as SeverityOverrides;
  const data = await getDashboard(ctx.db, range);
  const base = `/app/${slug}/dashboard`;

  return (
    <div className="space-y-6">
      <h1>{ctx.workspace.name}</h1>

      <nav aria-label={d.rangeLabel} className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <Link
            key={r}
            href={r === "30d" ? base : `${base}?range=${r}`}
            aria-current={r === range ? "page" : undefined}
            className={chip(r === range)}
          >
            {d.ranges[r]}
          </Link>
        ))}
      </nav>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" data-testid="dashboard-tiles">
        <Tile label={d.openNow} value={data.openNow} accent />
        <Tile label={d.incidentsInRange} value={data.inRange} />
        <Tile label={d.mttr} value={d.mttrValue(data.mttrMinutes)} />
        <Tile label={d.overdueRituals} value={data.overdueItems} />
        <Tile label={d.revenantCount} value={data.recurring} />
      </section>

      {data.inRange === 0 && (
        <div data-testid="dashboard-empty">
          <EmptyState
            message={data.totalAll === 0 ? d.emptyAll : d.emptyWindow(d.rangePhrase[range], data.olderCount)}
          />
        </div>
      )}

      <section className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-2 rounded border border-border bg-surface p-4">
          <IncidentsOverTime t={t} buckets={data.buckets} range={range} />
        </div>
        <div className="space-y-2 rounded border border-border bg-surface p-4">
          <BySeverity t={t} counts={data.bySeverity} labels={labels} />
        </div>
      </section>

      <section aria-labelledby="needs-attention" className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="needs-attention" className="text-lg font-semibold">
            {d.needsAttention}
          </h2>
          <Link href={`/app/${slug}/incidents`} className="text-sm text-accent underline">
            {d.seeAll}
          </Link>
        </div>
        {data.needsAttention.length === 0 ? (
          <EmptyState message={d.noneOpen} />
        ) : (
          <ul className="divide-y divide-border rounded border border-border bg-surface" data-testid="needs-attention">
            {data.needsAttention.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 p-3">
                <Link href={`/app/${slug}/incidents/${i.number}`} className="text-sm text-accent underline">
                  {t.incident.number(i.number)}
                </Link>
                <span className="min-w-0 flex-1 font-medium">{i.title}</span>
                <SeverityBadge
                  level={i.severity as SeverityLevel}
                  label={severityName(t, i.severity as SeverityLevel, labels)}
                />
                <span className="text-xs text-muted">
                  <RelativeTime iso={i.startedAt} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
