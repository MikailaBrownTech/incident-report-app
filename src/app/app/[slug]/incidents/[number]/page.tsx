import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { SeverityBadge, StatusPill } from "@/components/badges";
import { LiveDuration, RelativeTime } from "@/components/time-display";
import { getCopy, severityName, type SeverityLevel, type SeverityOverrides } from "@/copy";
import { getIncidentByNumber } from "@/features/incidents/list";
import { getWorkspaceContext } from "@/server/auth/context";

/**
 * Incident detail. Showing the incident, its services and the "assign a commander" prompt for now;
 * role assignment, status changes and the timeline are not built yet.
 */
export default async function IncidentPage({ params }: PageProps<"/app/[slug]/incidents/[number]">) {
  const { slug, number } = await params;
  if (!/^\d{1,9}$/.test(number)) notFound();
  const ctx = await getWorkspaceContext(slug);
  const t = getCopy(ctx.skin);

  const found = await getIncidentByNumber(ctx.db, Number(number));
  if (!found) notFound();
  const { incident, creator } = found;
  const level = incident.severity as SeverityLevel;
  const commander = incident.assignments.find((a) => a.role === "COMMANDER")?.member.user ?? null;

  return (
    <article className="space-y-6">
      <Link href={`/app/${slug}/incidents`} className="text-sm text-accent underline underline-offset-2">
        {t.incidentDetail.backToList}
      </Link>

      <header className="space-y-3">
        <p className="font-mono text-sm text-muted">{t.incident.number(incident.number)}</p>
        <h1 className="text-2xl font-bold">{incident.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge
            level={level}
            label={severityName(t, level, ctx.workspace.severityLabels as SeverityOverrides)}
          />
          <StatusPill label={t.status[incident.status]} resolved={incident.status === "RESOLVED"} />
        </div>
      </header>

      {commander ? (
        <section className="flex items-center gap-3 rounded border border-border bg-surface p-4">
          <Avatar name={commander.name || commander.email} image={commander.image} />
          <div>
            <p className="text-xs text-muted">{t.incidentDetail.commander}</p>
            <p className="font-medium">{commander.name || commander.email}</p>
          </div>
        </section>
      ) : (
        <section role="note" className="rounded border border-warning p-4">
          <p className="font-semibold text-warning">{t.incidentDetail.assignCommanderTitle}</p>
          <p className="text-sm text-muted">{t.incidentDetail.assignCommanderBody}</p>
        </section>
      )}

      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted">{t.incidentDetail.startedLabel}</dt>
          <dd>
            <RelativeTime iso={incident.startedAt.toISOString()} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t.incidentDetail.durationLabel}</dt>
          <dd className="font-mono">
            <LiveDuration
              startedAt={incident.startedAt.toISOString()}
              resolvedAt={incident.resolvedAt?.toISOString() ?? null}
            />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t.incident.services}</dt>
          <dd>
            {incident.services.length === 0 ? (
              <span className="text-muted">{"—"}</span>
            ) : (
              <ul className="flex flex-wrap gap-1">
                {incident.services.map(({ service }) => (
                  <li key={service.id} className="rounded border border-border px-2 py-0.5 text-sm">
                    {service.name}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t.incidentDetail.summaryLabel}</h2>
        {incident.summary ? (
          <p className="whitespace-pre-wrap">{incident.summary}</p>
        ) : (
          <p className="text-muted">{t.incidentDetail.noSummary}</p>
        )}
      </section>

      {creator ? (
        <p className="text-sm text-muted">{t.incidentDetail.declaredBy(creator.name || creator.email)}</p>
      ) : null}
    </article>
  );
}
