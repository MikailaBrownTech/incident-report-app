import { Suspense } from "react";
import { DeclareIncidentButton } from "@/components/declare-incident";
import { IncidentFilters } from "@/components/incident-filters";
import { IncidentList } from "@/components/incident-list";
import { getCopy, type SeverityOverrides } from "@/copy";
import { listIncidents } from "@/features/incidents/list";
import { hasActiveFilters, parseListParams } from "@/features/incidents/list-params";
import { loadRetroRules } from "@/features/postmortems/service";
import { listServices } from "@/features/services/service";
import { getWorkspaceContext } from "@/server/auth/context";

export default async function IncidentsPage({ params, searchParams }: PageProps<"/app/[slug]/incidents">) {
  const { slug } = await params;
  const raw = await searchParams;
  const ctx = await getWorkspaceContext(slug);
  const t = getCopy(ctx.skin);

  const listParams = parseListParams(raw);
  const [page, services, retroRules] = await Promise.all([
    listIncidents(ctx.db, listParams),
    listServices(ctx.db),
    loadRetroRules(ctx.db),
  ]);
  const severityLabels = ctx.workspace.severityLabels as SeverityOverrides;

  // The filters without the cursor: used as the list's key and to fetch further pages.
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (key === "cursor" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) query.append(key, v);
  }
  const queryString = query.toString();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t.incidentList.heading}</h1>
        <DeclareIncidentButton />
      </div>
      <Suspense>
        <IncidentFilters
          params={listParams}
          services={services.map((s) => ({ id: s.id, name: s.name }))}
          severityLabels={severityLabels}
        />
      </Suspense>
      <IncidentList
        key={queryString}
        slug={slug}
        initial={page.items}
        initialCursor={page.nextCursor}
        queryString={queryString}
        hasFilters={hasActiveFilters(listParams)}
        severityLabels={severityLabels}
        retroRules={retroRules}
      />
    </div>
  );
}
