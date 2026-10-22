import { EmptyState } from "@/components/empty-state";
import { emptyMessage, getCopy } from "@/copy";
import { requireWorkspace } from "@/server/auth/context";

/** Placeholder until the incident milestones (M2+) populate the dashboard. */
export default async function DashboardPage({ params }: PageProps<"/w/[slug]/dashboard">) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug);
  const t = getCopy(ctx.skin);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t.dashboard.heading}</h1>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t.dashboard.openIncidents}</h2>
        <EmptyState message={emptyMessage(t, "incidents")} />
      </section>
    </div>
  );
}
