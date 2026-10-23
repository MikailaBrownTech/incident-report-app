import { ServicesManager } from "@/components/services-manager";
import { getCopy } from "@/copy";
import { listServices } from "@/features/services/service";
import { getServiceStats } from "@/features/services/stats";
import { getWorkspaceContext } from "@/server/auth/context";
import { hasRole } from "@/server/auth/permissions";

export default async function ServicesPage({ params }: PageProps<"/app/[slug]/settings/services">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const t = getCopy(ctx.skin);
  const [listed, stats] = await Promise.all([listServices(ctx.db), getServiceStats(ctx.db)]);
  const services = listed.map((s) => ({
    ...s,
    stats: stats.get(s.id) ?? { incidents90: 0, chains: 0, openRituals: 0 },
  }));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{t.services.heading}</h2>
        <p className="text-sm text-muted">{t.services.help}</p>
      </div>
      <ServicesManager slug={slug} services={services} canManage={hasRole(ctx.membership.role, "ADMIN")} />
    </div>
  );
}
