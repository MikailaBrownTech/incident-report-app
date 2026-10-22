import { EmptyState } from "@/components/empty-state";
import { emptyMessage, getCopy } from "@/copy";
import { getWorkspaceContext } from "@/server/auth/context";

/** Placeholder until the incident milestones populate the dashboard; it shows the real (empty) state. */
export default async function DashboardPage({ params }: PageProps<"/app/[slug]/dashboard">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const t = getCopy(ctx.skin);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{ctx.workspace.name}</h1>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t.dashboard.openIncidents}</h2>
        <EmptyState message={emptyMessage(t, "incidents")} />
      </section>
    </div>
  );
}
