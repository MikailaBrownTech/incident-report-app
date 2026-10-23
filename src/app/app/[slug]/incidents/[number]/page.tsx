import { notFound } from "next/navigation";
import { IncidentDetail } from "@/components/incident-detail";
import type { SeverityOverrides } from "@/copy";
import { getIncidentDetail } from "@/features/incidents/detail";
import { incidentNumberSchema } from "@/features/incidents/schema";
import { listTemplates, loadRetroRules } from "@/features/postmortems/service";
import { listServices } from "@/features/services/service";
import { listTimeline } from "@/features/timeline/queries";
import { DEFAULT_LIMIT, parseTimelineView } from "@/features/timeline/schema";
import { listMembers } from "@/features/workspaces/queries";
import { getWorkspaceContext } from "@/server/auth/context";
import { hasRole } from "@/server/auth/permissions";

/** Incident detail. Missing, soft-deleted and other workspaces' incidents are all the same 404. */
export default async function IncidentPage({ params, searchParams }: PageProps<"/app/[slug]/incidents/[number]">) {
  const { slug, number } = await params;
  const view = parseTimelineView(await searchParams);
  if (!incidentNumberSchema.safeParse(number).success) notFound();
  const ctx = await getWorkspaceContext(slug);

  const [incident, members, services, rules, templates] = await Promise.all([
    getIncidentDetail(ctx.db, Number(number)),
    listMembers(ctx.db),
    listServices(ctx.db),
    loadRetroRules(ctx.db),
    listTemplates(ctx.db),
  ]);
  if (!incident) notFound();
  // The newest entries first; the client reverses them for oldest-first display and pages backwards from here.
  const postmortem = await ctx.db.postmortem.findFirst({ where: { incidentId: incident.id }, select: { status: true } });
  const page = await listTimeline(ctx.db, incident.id, { filter: view.filter, order: "desc", limit: DEFAULT_LIMIT });

  return (
    <IncidentDetail
      // a fresh instance per incident, so edits in progress never leak between incidents
      key={incident.id}
      slug={slug}
      initial={incident}
      members={members.map(({ userId, name, email, image }) => ({ userId, name, email, image }))}
      services={services.map((s) => ({ id: s.id, name: s.name }))}
      severityLabels={ctx.workspace.severityLabels as SeverityOverrides}
      canDelete={hasRole(ctx.membership.role, "ADMIN")}
      currentUserId={ctx.user.id}
      timeline={{ page, filter: view.filter, order: view.order }}
      postmortem={{ status: postmortem?.status ?? null, rules, templates }}
    />
  );
}
