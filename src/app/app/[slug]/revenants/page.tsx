import { Suspense } from "react";
import { RevenantsView } from "@/components/revenants-view";
import { getCopy, type SeverityOverrides } from "@/copy";
import { findSuspects, listChains, parseChainParams } from "@/features/revenants/recurring";
import { listServices } from "@/features/services/service";
import { getWorkspaceContext } from "@/server/auth/context";

export default async function RevenantsPage({ params, searchParams }: PageProps<"/app/[slug]/revenants">) {
  const { slug } = await params;
  const raw = await searchParams;
  const ctx = await getWorkspaceContext(slug);
  const t = getCopy(ctx.skin);

  const { view, ...filters } = parseChainParams(raw);
  const [services, page, suspects] = await Promise.all([
    listServices(ctx.db),
    view === "chains" ? listChains(ctx.db, filters) : Promise.resolve({ items: [], nextCursor: null }),
    view === "suspects" ? findSuspects(ctx.db) : Promise.resolve([]),
  ]);

  // the filters without paging or the tab: the table's key, and what "load more" sends
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (key === "cursor" || key === "view" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) query.append(key, v);
  }
  const queryString = query.toString();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t.revenant.page.title}</h1>
        <p className="text-sm text-muted">{t.revenant.page.intro}</p>
      </div>
      <Suspense>
        <RevenantsView
          key={`${view}:${queryString}`}
          slug={slug}
          view={view}
          params={{ ...filters, cursor: null }}
          services={services.map((s) => ({ id: s.id, name: s.name }))}
          severityLabels={ctx.workspace.severityLabels as SeverityOverrides}
          initial={page.items}
          initialCursor={page.nextCursor}
          suspects={suspects}
          queryString={queryString}
        />
      </Suspense>
    </div>
  );
}
