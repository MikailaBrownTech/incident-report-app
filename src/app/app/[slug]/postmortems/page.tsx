import { Suspense } from "react";
import { PostmortemFilters } from "@/components/postmortem-filters";
import { PostmortemList } from "@/components/postmortem-list";
import { getCopy, type SeverityOverrides } from "@/copy";
import { listPostmortems } from "@/features/postmortems/list";
import { isFiltered, parseListParams } from "@/features/postmortems/schema";
import { getWorkspaceContext } from "@/server/auth/context";

export default async function PostmortemsPage({ params, searchParams }: PageProps<"/app/[slug]/postmortems">) {
  const { slug } = await params;
  const raw = await searchParams;
  const ctx = await getWorkspaceContext(slug);
  const t = getCopy(ctx.skin);

  const listParams = parseListParams(raw);
  const page = await listPostmortems(ctx.db, listParams);
  const severityLabels = ctx.workspace.severityLabels as SeverityOverrides;

  // The filters without the cursor: the list's key, and what further pages are fetched with.
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (key === "cursor" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) query.append(key, v);
  }
  const queryString = query.toString();
  // the page uses `attention=1`; the API calls it `needsAttention`
  const apiQuery = new URLSearchParams(queryString);
  if (apiQuery.has("attention")) {
    apiQuery.set("needsAttention", apiQuery.get("attention")!);
    apiQuery.delete("attention");
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t.postmortem.plural}</h1>
      <Suspense>
        <PostmortemFilters params={listParams} severityLabels={severityLabels} />
      </Suspense>
      <PostmortemList
        key={queryString}
        slug={slug}
        initial={page.items}
        initialCursor={page.nextCursor}
        queryString={apiQuery.toString()}
        hasFilters={isFiltered(listParams)}
        severityLabels={severityLabels}
      />
    </div>
  );
}
