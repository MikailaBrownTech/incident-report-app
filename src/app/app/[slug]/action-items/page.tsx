import { Suspense } from "react";
import { ActionBoard } from "@/components/action-board";
import { ActionFilters } from "@/components/action-filters";
import { getCopy } from "@/copy";
import { parseListParams } from "@/features/action-items/schema";
import { getBoard } from "@/features/action-items/service";
import { listMembers } from "@/features/workspaces/queries";
import { getWorkspaceContext } from "@/server/auth/context";
import { hasRole } from "@/server/auth/permissions";

export default async function ActionItemsPage({ params, searchParams }: PageProps<"/app/[slug]/action-items">) {
  const { slug } = await params;
  const raw = await searchParams;
  const ctx = await getWorkspaceContext(slug);
  const t = getCopy(ctx.skin);

  const filters = parseListParams(raw);
  const [board, members, incidents] = await Promise.all([
    getBoard(ctx, filters),
    listMembers(ctx.db),
    // only incidents with a postmortem can have action items
    ctx.db.incident.findMany({
      where: { postmortem: { isNot: null } },
      select: { number: true, title: true, severity: true },
      orderBy: { number: "desc" },
      take: 300,
    }),
  ]);

  // The filters without paging or the board-only toggle: the board's key, and what refreshes and "load more" send.
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (key === "cursor" || key === "column" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) query.append(key, v);
  }
  const queryString = query.toString();
  const people = members.map(({ userId, name, email, image }) => ({ userId, name, email, image }));

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t.ritual.boardTitle}</h1>
      <Suspense>
        <ActionFilters filters={filters} members={people} incidents={incidents} />
      </Suspense>
      <Suspense>
        <ActionBoard
          key={queryString}
          slug={slug}
          initial={board}
          queryString={queryString}
          hasFilters={
            filters.owner !== "any" ||
            filters.overdue ||
            filters.dueThisWeek ||
            filters.incident !== null ||
            filters.q !== ""
          }
          members={people}
          incidents={incidents}
          currentUserId={ctx.user.id}
          isAdmin={hasRole(ctx.membership.role, "ADMIN")}
        />
      </Suspense>
    </div>
  );
}
