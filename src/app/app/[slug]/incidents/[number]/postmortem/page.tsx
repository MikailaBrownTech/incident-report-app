import { notFound, redirect } from "next/navigation";
import { PostmortemPage } from "@/components/postmortem-page";
import type { SeverityOverrides } from "@/copy";
import { incidentNumberSchema, type StatusKey } from "@/features/incidents/schema";
import { getPostmortem } from "@/features/postmortems/service";
import { getWorkspaceContext } from "@/server/auth/context";
import { hasRole } from "@/server/auth/permissions";

/** The postmortem editor (draft) or read-only document (published). Without one yet, back to the incident to start it. */
export default async function PostmortemRoute({ params }: PageProps<"/app/[slug]/incidents/[number]/postmortem">) {
  const { slug, number } = await params;
  if (!incidentNumberSchema.safeParse(number).success) notFound();
  const ctx = await getWorkspaceContext(slug);
  const n = Number(number);

  const incident = await ctx.db.incident.findFirst({
    where: { number: n },
    select: { number: true, title: true, severity: true, status: true },
  });
  if (!incident) notFound();
  const payload = await getPostmortem(ctx, n);
  if (!payload) redirect(`/app/${slug}/incidents/${n}`);

  return (
    <PostmortemPage
      key={payload.postmortem.id}
      slug={slug}
      incident={{ ...incident, status: incident.status as StatusKey }}
      severityLabels={ctx.workspace.severityLabels as SeverityOverrides}
      initial={payload}
      canUnpublish={hasRole(ctx.membership.role, "ADMIN")}
    />
  );
}
