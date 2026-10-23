import Link from "next/link";
import { notFound } from "next/navigation";
import { SeverityBadge, StatusPill } from "@/components/badges";
import { RelativeTime } from "@/components/time-display";
import { getCopy, severityName, type SeverityLevel, type SeverityOverrides } from "@/copy";
import { getServiceHistory } from "@/features/services/history";
import { getWorkspaceContext } from "@/server/auth/context";
import { formatDuration } from "@/lib/time";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** One service: its incident history (latest 25, paged), the recurring issues touching it, mean time to resolve, and counts by severity. */
export default async function ServicePage({ params, searchParams }: PageProps<"/app/[slug]/services/[serviceSlug]">) {
  const { slug, serviceSlug } = await params;
  const raw = await searchParams;
  const ctx = await getWorkspaceContext(slug);
  const t = getCopy(ctx.skin);
  const s = t.revenant.services;
  const labels = ctx.workspace.severityLabels as SeverityOverrides;

  const cursor = first(raw.cursor)?.slice(0, 200) || null;
  const history = await getServiceHistory(ctx.db, serviceSlug, { limit: 25, cursor });
  if (!history) notFound();

  return (
    <div className="space-y-6">
      <Link href={`/app/${slug}/settings/services`} className="text-sm text-accent underline">
        {s.back}
      </Link>
      <h1 className="text-2xl font-bold">{history.service.name}</h1>

      <section aria-labelledby="svc-stats" className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1 rounded border border-border p-4">
          <h2 id="svc-stats" className="text-sm font-semibold">
            {s.mttr}
          </h2>
          <p className="text-2xl font-bold" data-testid="mttr">
            {history.mttrMs === null ? s.noResolved : formatDuration(history.mttrMs)}
          </p>
        </div>
        <div className="space-y-1 rounded border border-border p-4">
          <h2 className="text-sm font-semibold">{s.bySeverity}</h2>
          <ul className="space-y-1 text-sm" data-testid="by-severity">
            {([5, 4, 3, 2, 1] as const).map((level) => (
              <li key={level} className="flex justify-between gap-2">
                <span>{severityName(t, level as SeverityLevel, labels)}</span>
                <span>{history.bySeverity[level]}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="svc-chains" className="space-y-2">
        <h2 id="svc-chains" className="text-lg font-semibold">
          {s.chainsTitle}
        </h2>
        {history.chains.length === 0 ? (
          <p className="text-sm text-muted">{s.noChains}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {history.chains.map((c) => (
              <li key={c.rootId}>
                <Link href={`/app/${slug}/incidents/${c.root.number}`} className="text-accent underline">
                  {`${t.incident.number(c.root.number)} ${c.root.title}`}
                </Link>
                <span className="text-muted">{` · ${t.revenant.occurrenceLabel}: ${c.occurrences}`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="svc-history" className="space-y-2">
        <h2 id="svc-history" className="text-lg font-semibold">
          {s.historyTitle}
        </h2>
        {history.items.length === 0 ? (
          <p className="text-sm text-muted">{s.noHistory}</p>
        ) : (
          <ul className="divide-y divide-border rounded border border-border" data-testid="history">
            {history.items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 p-3">
                <Link href={`/app/${slug}/incidents/${i.number}`} className="text-sm text-accent underline">
                  {t.incident.number(i.number)}
                </Link>
                <span className="min-w-0 flex-1 font-medium">{i.title}</span>
                <SeverityBadge
                  level={i.severity as SeverityLevel}
                  label={severityName(t, i.severity as SeverityLevel, labels)}
                />
                <StatusPill label={t.status[i.status as keyof typeof t.status]} resolved={i.status === "RESOLVED"} />
                <span className="text-xs text-muted">
                  <RelativeTime iso={i.startedAt} />
                </span>
              </li>
            ))}
          </ul>
        )}
        {history.nextCursor && (
          <Link
            href={`/app/${slug}/services/${serviceSlug}?cursor=${encodeURIComponent(history.nextCursor)}`}
            className="inline-block rounded border border-border px-3 py-1.5 text-sm hover:border-accent"
          >
            {t.revenant.page.loadMore}
          </Link>
        )}
      </section>
    </div>
  );
}
