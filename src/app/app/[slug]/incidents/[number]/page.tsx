import { notFound } from "next/navigation";
import { IncidentDetail } from "@/components/incident-detail";
import type { SeverityOverrides } from "@/copy";
import { getIncidentDetail } from "@/features/incidents/detail";
import { incidentNumberSchema } from "@/features/incidents/schema";
import { listServices } from "@/features/services/service";
import { listMembers } from "@/features/workspaces/queries";
import { getWorkspaceContext } from "@/server/auth/context";
import { hasRole } from "@/server/auth/permissions";

/** Incident detail. Missing, soft-deleted and other workspaces' incidents are all the same 404. */
export default async function IncidentPage({ params }: PageProps<"/app/[slug]/incidents/[number]">) {
  const { slug, number } = await params;
  if (!incidentNumberSchema.safeParse(number).success) notFound();
  const ctx = await getWorkspaceContext(slug);

  const [incident, members, services] = await Promise.all([
    getIncidentDetail(ctx.db, Number(number)),
    listMembers(ctx.db),
    listServices(ctx.db),
  ]);
  if (!incident) notFound();

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
    />
  );
}
