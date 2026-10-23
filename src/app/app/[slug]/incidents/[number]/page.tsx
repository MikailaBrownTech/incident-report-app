import { notFound } from "next/navigation";
import { IncidentDetail } from "@/components/incident-detail";
import type { SeverityOverrides } from "@/copy";
import { getIncidentDetail } from "@/features/incidents/detail";
import { incidentNumberSchema } from "@/features/incidents/schema";
import { progressBy } from "@/features/action-items/service";
import { findRevenantCandidates } from "@/features/revenants/candidates";
import { getAccountability, getChain } from "@/features/revenants/chains";
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
  const postmortem = await ctx.db.postmortem.findFirst({
    where: { incidentId: incident.id },
    select: { status: true },
  });
  const progress = (await progressBy(ctx.db, "incidentId", [incident.id])).get(incident.id)!;
  // the chain it belongs to (with whether earlier fixes were completed), or suggestions while it is unlinked
  const chain = await getChain(ctx.db, incident.id);
  const [candidates, accountability] = await Promise.all([
    chain
      ? Promise.resolve([])
      : findRevenantCandidates(ctx.db, {
          title: incident.title,
          serviceIds: incident.services.map((s) => s.id),
          excludeIncidentId: incident.id,
          startedBefore: new Date(incident.startedAt),
          limit: 3,
          dismissedBy: ctx.user.id,
        }),
    chain ? getAccountability(ctx.db, chain, incident.id) : Promise.resolve(null),
  ]);
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
      rituals={progress}
      revenants={{ chain, candidates, accountability }}
    />
  );
}
