import { progressBy } from "@/features/action-items/service";
import { numberFromQuery } from "@/features/incidents/list-params";
import type { Prisma } from "@/generated/prisma/client";
import type { ScopedDb } from "@/server/db/tenant";
import type { PostmortemListPage, PostmortemListParams, PostmortemListRow } from "./schema";
import { NEEDS_ATTENTION, getPostmortemStatus, type PostmortemState } from "./status";
import { loadRetroRules, peopleFor } from "./service";

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

type SortKey = number | null;

function keyOf(row: PostmortemListRow, sort: PostmortemListParams["sort"]): SortKey {
  switch (sort) {
    case "due":
      return row.dueAt ? Date.parse(row.dueAt) : null;
    case "published":
      return row.publishedAt ? Date.parse(row.publishedAt) : null;
    case "severity":
      return row.severity;
    case "number":
      return row.number;
  }
}

/** Rows without a key (no due date, not published yet) always sort last, whichever direction is chosen. */
function compare(ka: SortKey, ia: string, kb: SortKey, ib: string, dir: "asc" | "desc"): number {
  if (ka !== kb) {
    if (ka === null) return 1;
    if (kb === null) return -1;
    return dir === "asc" ? ka - kb : kb - ka;
  }
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

const encodeCursor = (k: SortKey, i: string) => Buffer.from(JSON.stringify({ k, i })).toString("base64url");
function decodeCursor(cursor: string): { k: SortKey; i: string } | null {
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { k: unknown; i: unknown };
    if (typeof v.i !== "string" || !(v.k === null || typeof v.k === "number")) return null;
    return { k: v.k, i: v.i };
  } catch {
    return null;
  }
}

/**
 * Existing postmortems plus resolved incidents that REQUIRE one but have none yet (so "autopsy required" items show up).
 * The state depends on rules and the clock, so it is computed here with `getPostmortemStatus` rather than in SQL; the
 * candidate set is only resolved incidents and incidents with a postmortem. Sorting and the cursor (a position in the
 * sort order, so it survives rows appearing and disappearing) are applied to that computed list.
 */
export async function listPostmortems(
  db: ScopedDb,
  params: PostmortemListParams,
  now: Date = new Date(),
): Promise<PostmortemListPage> {
  const and: Prisma.IncidentWhereInput[] = [{ OR: [{ status: "RESOLVED" }, { postmortem: { isNot: null } }] }];
  if (params.severity.length > 0) and.push({ severity: { in: params.severity } });
  if (params.q) {
    const number = numberFromQuery(params.q);
    and.push({
      OR: [
        { title: { contains: escapeLike(params.q), mode: "insensitive" } },
        ...(number !== null ? [{ number }] : []),
      ],
    });
  }
  const [rules, incidents] = await Promise.all([
    loadRetroRules(db),
    db.incident.findMany({
      where: { AND: and },
      select: {
        id: true,
        number: true,
        title: true,
        severity: true,
        status: true,
        resolvedAt: true,
        postmortem: { select: { id: true, status: true, authorId: true, publishedAt: true } },
      },
    }),
  ]);

  const wanted = new Set<PostmortemState>(params.state);
  const rows: PostmortemListRow[] = [];
  for (const inc of incidents) {
    const s = getPostmortemStatus(inc, rules, inc.postmortem, now);
    // no postmortem and nothing required: not a row
    if (!inc.postmortem && !(NEEDS_ATTENTION as readonly string[]).includes(s.state)) continue;
    if (wanted.size > 0 && !wanted.has(s.state)) continue;
    if (params.needsAttention && !(NEEDS_ATTENTION as readonly string[]).includes(s.state)) continue;
    rows.push({
      incidentId: inc.id,
      number: inc.number,
      title: inc.title,
      severity: inc.severity,
      postmortemId: inc.postmortem?.id ?? null,
      state: s.state,
      // a published postmortem is no longer due, so it neither shows a deadline nor sorts among the due ones
      dueAt: s.state === "PUBLISHED" ? null : (s.dueAt?.toISOString() ?? null),
      publishedAt: inc.postmortem?.publishedAt?.toISOString() ?? null,
      author: null, // filled in for the page below
      actionItems: null,
    });
  }

  rows.sort((a, b) => compare(keyOf(a, params.sort), a.incidentId, keyOf(b, params.sort), b.incidentId, params.dir));

  let start = 0;
  const at = params.cursor ? decodeCursor(params.cursor) : null;
  if (at) {
    start = rows.findIndex((r) => compare(keyOf(r, params.sort), r.incidentId, at.k, at.i, params.dir) > 0);
    if (start === -1) start = rows.length;
  }
  const page = rows.slice(start, start + params.limit);
  const hasMore = start + params.limit < rows.length;

  const authorOf = new Map(incidents.map((i) => [i.id, i.postmortem?.authorId ?? null]));
  const people = await peopleFor(page.map((r) => authorOf.get(r.incidentId) ?? null));
  for (const r of page) {
    const id = authorOf.get(r.incidentId);
    r.author = id ? (people[id] ?? { userId: id, name: "", email: "", image: null }) : null;
  }
  const progress = await progressBy(
    db,
    "postmortemId",
    page.flatMap((r) => (r.postmortemId ? [r.postmortemId] : [])),
  );
  for (const r of page) r.actionItems = r.postmortemId ? (progress.get(r.postmortemId) ?? null) : null;
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor(keyOf(last, params.sort), last.incidentId) : null,
  };
}
