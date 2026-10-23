import { notFound, redirect } from "next/navigation";
import { PostmortemPage } from "@/components/postmortem-page";
import type { SeverityOverrides } from "@/copy";
import { incidentNumberSchema, type StatusKey } from "@/features/incidents/schema";
import { parseListParams } from "@/features/action-items/schema";
import { listItems } from "@/features/action-items/service";
import { getPostmortem } from "@/features/postmortems/service";
import { getAccountability, getChain } from "@/features/revenants/chains";
import { listMembers } from "@/features/workspaces/queries";
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

  const incidentRow = await ctx.db.incident.findFirst({ where: { number: n }, select: { id: true } });
  const chain = incidentRow ? await getChain(ctx.db, incidentRow.id) : null;
  const accountability = chain && incidentRow ? await getAccountability(ctx.db, chain, incidentRow.id) : null;
  const [items, members] = await Promise.all([
    listItems(ctx, parseListParams({ incident: String(n), sort: "created", limit: "100" })),
    listMembers(ctx.db),
  ]);

  return (
    <PostmortemPage
      key={payload.postmortem.id}
      slug={slug}
      incident={{ ...incident, status: incident.status as StatusKey }}
      severityLabels={ctx.workspace.severityLabels as SeverityOverrides}
      initial={payload}
      canUnpublish={hasRole(ctx.membership.role, "ADMIN")}
      actionItems={items.items}
      actionPeople={items.people}
      members={members.map(({ userId, name, email, image }) => ({ userId, name, email, image }))}
      currentUserId={ctx.user.id}
      isAdmin={hasRole(ctx.membership.role, "ADMIN")}
      isRevenant={Boolean(chain && incidentRow && chain.rootId !== incidentRow.id)}
      earlier={accountability}
    />
  );
}
