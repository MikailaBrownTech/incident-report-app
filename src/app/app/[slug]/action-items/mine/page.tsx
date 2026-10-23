import Link from "next/link";
import { ActionItemsMine } from "@/components/action-items-mine";
import { getCopy } from "@/copy";
import { parseListParams } from "@/features/action-items/schema";
import { getBoard, listItems } from "@/features/action-items/service";
import { listMembers } from "@/features/workspaces/queries";
import { getWorkspaceContext } from "@/server/auth/context";
import { hasRole } from "@/server/auth/permissions";

/** Everything assigned to me: open items (grouped on the client by the viewer's own date) and what I finished lately. */
export default async function MyActionItemsPage({ params }: PageProps<"/app/[slug]/action-items/mine">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const t = getCopy(ctx.skin);

  const mine = parseListParams({ owner: "me", limit: "100", sort: "due" });
  const [open, doneBoard, members] = await Promise.all([
    listItems(ctx, { ...mine, status: ["OPEN", "IN_PROGRESS"] }),
    getBoard(ctx, { ...mine, column: "DONE" }), // the last 14 days
    listMembers(ctx.db),
  ]);
  const done = doneBoard.columns[0].items;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">{t.ritual.mine}</h1>
        <Link href={`/app/${slug}/action-items`} className="text-sm text-accent underline">
          {t.ritual.boardTitle}
        </Link>
      </div>
      <p className="text-sm text-muted">{t.ritual.mineIntro}</p>
      <ActionItemsMine
        slug={slug}
        items={open.items}
        doneRecently={done}
        people={{ ...open.people, ...doneBoard.people }}
        members={members.map(({ userId, name, email, image }) => ({ userId, name, email, image }))}
        currentUserId={ctx.user.id}
        isAdmin={hasRole(ctx.membership.role, "ADMIN")}
      />
    </div>
  );
}
