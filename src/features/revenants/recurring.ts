import { z } from "zod";
import { numberFromQuery } from "@/features/incidents/list-params";
import { loadRetroRules } from "@/features/postmortems/service";
import { getPostmortemStatus } from "@/features/postmortems/status";
import type { ScopedDb } from "@/server/db/tenant";
import { summarize } from "./candidates";
import { LOOKBACK_DAYS, STRONG_SCORE, SUSPECT_LIMIT, jaccard, scorePair, titleSimilarity } from "./score";
import { SORTS, type ChainMember, type ChainRow, type Suspect } from "./types";

const DAY = 86_400_000;

export const PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface ChainListParams {
  service: string[];
  minOccurrences: number;
  hasOpenRituals: boolean;
  q: string;
  sort: (typeof SORTS)[number];
  limit: number;
  cursor: string | null;
}

const blank = (v: unknown) => {
  const f = Array.isArray(v) ? v[0] : v;
  return typeof f === "string" && f.trim() === "" ? undefined : f;
};
const many = (v: unknown) =>
  v === undefined
    ? []
    : [
        ...new Set(
          (Array.isArray(v) ? v : [v])
            .flatMap((x) => String(x).split(","))
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      ];

const shape = {
  service: z.preprocess(many, z.array(z.string().min(1).max(100)).max(25)),
  minOccurrences: z.preprocess(
    blank,
    z.coerce
      .number({ error: "invalid_min" })
      .int("invalid_min")
      .min(2, "invalid_min")
      .max(50, "invalid_min")
      .default(2),
  ),
  hasOpenRituals: z.preprocess(blank, z.enum(["0", "1"], { error: "invalid_flag" }).optional()),
  q: z.preprocess(blank, z.string().trim().max(100, "too_long").default("")),
  sort: z.preprocess(blank, z.enum(SORTS, { error: "invalid_sort" }).default("recent")),
  limit: z.preprocess(
    blank,
    z.coerce
      .number({ error: "invalid_limit" })
      .int("invalid_limit")
      .min(1, "invalid_limit")
      .max(MAX_PAGE_SIZE, "invalid_limit")
      .default(PAGE_SIZE),
  ),
  cursor: z.preprocess(blank, z.string().min(1).max(300).optional()),
  view: z.preprocess(blank, z.enum(["chains", "suspects"], { error: "invalid_view" }).default("chains")),
};
export const chainQuerySchema = z.object(shape);

type Raw = Record<string, string | string[] | undefined>;
const toParams = (q: z.output<typeof chainQuerySchema>): ChainListParams & { view: "chains" | "suspects" } => ({
  service: q.service,
  minOccurrences: q.minOccurrences,
  hasOpenRituals: q.hasOpenRituals === "1",
  q: q.q,
  sort: q.sort,
  limit: q.limit,
  cursor: q.cursor ?? null,
  view: q.view,
});

export function parseChainQuery(raw: Raw) {
  const parsed = chainQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false as const, fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  return { ok: true as const, params: toParams(parsed.data) };
}

/** Lenient, for pages: ignores only the parts of a stale URL that are wrong. */
export function parseChainParams(raw: Raw) {
  const clean: Raw = {};
  for (const key of Object.keys(shape) as (keyof typeof shape)[]) {
    if (raw[key] !== undefined && z.object({ [key]: shape[key] }).safeParse({ [key]: raw[key] }).success)
      clean[key] = raw[key];
  }
  return toParams(chainQuerySchema.parse(clean));
}

const encode = (k: number, i: string) => Buffer.from(JSON.stringify({ k, i })).toString("base64url");
function decode(cursor: string): { k: number; i: string } | null {
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { k: unknown; i: unknown };
    return typeof v.k === "number" && typeof v.i === "string" ? { k: v.k, i: v.i } : null;
  } catch {
    return null;
  }
}

/** Every chain in the workspace with the numbers the Recurring issues table shows. Soft-deleted incidents are excluded. */
export async function listChains(
  db: ScopedDb,
  params: ChainListParams,
  now: Date = new Date(),
): Promise<{ items: ChainRow[]; nextCursor: string | null }> {
  const revenants = await db.incident.findMany({
    where: { revenantOfId: { not: null } },
    select: { revenantOfId: true },
  });
  const rootIds = [...new Set(revenants.map((r) => r.revenantOfId as string))];
  if (rootIds.length === 0) return { items: [], nextCursor: null };

  const members = await db.incident.findMany({
    where: { OR: [{ id: { in: rootIds } }, { revenantOfId: { in: rootIds } }] },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      number: true,
      title: true,
      severity: true,
      status: true,
      startedAt: true,
      resolvedAt: true,
      revenantOfId: true,
      services: { select: { service: { select: { id: true, name: true } } } },
      postmortem: { select: { status: true } },
    },
  });
  const [rules, open] = await Promise.all([
    loadRetroRules(db),
    db.actionItem.groupBy({
      by: ["incidentId"],
      where: {
        incidentId: { in: members.map((m) => m.id) },
        status: { in: ["OPEN", "IN_PROGRESS"] },
        incident: { deletedAt: null },
      },
      _count: { _all: true },
    }),
  ]);
  const openBy = new Map(open.map((o) => [o.incidentId, o._count._all]));

  const byRoot = new Map<string, typeof members>();
  for (const m of members) {
    const root = m.revenantOfId ?? m.id;
    byRoot.set(root, [...(byRoot.get(root) ?? []), m]);
  }

  const rows: ChainRow[] = [];
  for (const [rootId, list] of byRoot) {
    if (list.length < 2) continue; // the other occurrences were deleted: no chain left
    const root = list.find((m) => m.id === rootId) ?? list[0];
    const chain: ChainMember[] = list.map((m, i) => ({
      ...summarize(m),
      gapDays: i === 0 ? null : Math.floor((m.startedAt.getTime() - list[i - 1].startedAt.getTime()) / DAY),
    }));
    const services = new Map<string, string>();
    for (const m of list) for (const s of m.services) services.set(s.service.id, s.service.name);
    const latest = list[list.length - 1];
    rows.push({
      rootId,
      root: summarize(root),
      occurrences: list.length,
      firstAt: list[0].startedAt.toISOString(),
      lastAt: latest.startedAt.toISOString(),
      services: [...services].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      totalDurationMs: list.reduce((sum, m) => sum + ((m.resolvedAt ?? now).getTime() - m.startedAt.getTime()), 0),
      highestSeverity: Math.max(...list.map((m) => m.severity)),
      openRituals: list.reduce((sum, m) => sum + (openBy.get(m.id) ?? 0), 0),
      lastPostmortemState: getPostmortemStatus(latest, rules, latest.postmortem, now).state,
      members: chain,
    });
  }

  const needle = params.q.toLowerCase();
  const number = numberFromQuery(params.q);
  const filtered = rows.filter(
    (r) =>
      r.occurrences >= params.minOccurrences &&
      (!params.hasOpenRituals || r.openRituals > 0) &&
      (params.service.length === 0 || r.services.some((s) => params.service.includes(s.id))) &&
      (!needle ||
        r.members.some((m) => m.title.toLowerCase().includes(needle) || (number !== null && m.number === number))),
  );

  const key = (r: ChainRow) =>
    params.sort === "occurrences" ? r.occurrences : params.sort === "rituals" ? r.openRituals : Date.parse(r.lastAt);
  // best first; ties fall back to the most recent occurrence, then the id, so the order never wobbles
  const cmp = (a: ChainRow, b: ChainRow) =>
    key(b) - key(a) ||
    Date.parse(b.lastAt) - Date.parse(a.lastAt) ||
    (a.rootId < b.rootId ? -1 : a.rootId > b.rootId ? 1 : 0);
  filtered.sort(cmp);

  let start = 0;
  const at = params.cursor ? decode(params.cursor) : null;
  if (at) {
    const marker = filtered.findIndex((r) => r.rootId === at.i);
    start = marker >= 0 ? marker + 1 : filtered.findIndex((r) => key(r) < at.k || (key(r) === at.k && r.rootId > at.i)); // the row is gone: carry on after its place
    if (start === -1) start = filtered.length;
  }
  const items = filtered.slice(start, start + params.limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: start + params.limit < filtered.length && last ? encode(key(last), last.rootId) : null,
  };
}

/**
 * Pairs of incidents the similarity function calls a strong match that nobody has linked: a later incident with no chain
 * and the earlier one it resembles most. Computed on demand (pairwise over the last year's incidents), skipping pairs
 * anyone marked "not a match", best first, capped at `limit`.
 */
export async function findSuspects(
  db: ScopedDb,
  limit: number = SUSPECT_LIMIT,
  now: Date = new Date(),
): Promise<Suspect[]> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY);
  const [incidents, dismissals] = await Promise.all([
    db.incident.findMany({
      where: { startedAt: { gte: since } },
      orderBy: [{ startedAt: "desc" }, { id: "asc" }],
      take: 600,
      select: {
        id: true,
        number: true,
        title: true,
        severity: true,
        status: true,
        startedAt: true,
        resolvedAt: true,
        revenantOfId: true,
        services: { select: { service: { select: { id: true, name: true } } } },
      },
    }),
    db.revenantDismissal.findMany({ select: { incidentId: true, candidateId: true } }),
  ]);
  const dismissed = new Set(dismissals.map((d) => `${d.incidentId}:${d.candidateId}`));
  const hasRevenants = new Set(incidents.map((i) => i.revenantOfId).filter((v): v is string => v !== null));
  const sortedAsc = [...incidents].sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime() || (a.id < b.id ? -1 : 1),
  );

  const out: Suspect[] = [];
  for (const later of incidents) {
    if (later.revenantOfId || hasRevenants.has(later.id)) continue; // already in a chain
    const laterServices = later.services.map((s) => s.service.id);
    let best: { e: (typeof incidents)[number]; titleScore: number; serviceScore: number; score: number } | null = null;
    const seenChains = new Set<string>();
    for (const e of sortedAsc) {
      if (e.startedAt.getTime() >= later.startedAt.getTime() || e.id === later.id) continue;
      if (dismissed.has(`${later.id}:${e.id}`)) continue;
      const rootId = e.revenantOfId ?? e.id;
      if (seenChains.has(rootId) && best && (best.e.revenantOfId ?? best.e.id) === rootId) continue;
      const titleScore = titleSimilarity(later.title, e.title);
      const serviceScore = jaccard(
        laterServices,
        e.services.map((s) => s.service.id),
      );
      const s = scorePair(titleScore, serviceScore);
      if (s.score >= STRONG_SCORE && (!best || s.score > best.score))
        best = { e, titleScore, serviceScore, score: s.score };
      seenChains.add(rootId);
    }
    if (!best) continue;
    const rootId = best.e.revenantOfId ?? best.e.id;
    const root = incidents.find((i) => i.id === rootId) ?? best.e;
    const shared = later.services
      .map((s) => s.service)
      .filter((s) => best!.e.services.some((x) => x.service.id === s.id));
    out.push({
      incident: summarize(later),
      target: summarize(best.e),
      root: { id: root.id, number: root.number, title: root.title },
      score: best.score,
      titleScore: best.titleScore,
      serviceScore: best.serviceScore,
      sharedServices: shared.map((s) => s.name),
    });
  }
  out.sort((a, b) => b.score - a.score || b.incident.number - a.incident.number);
  return out.slice(0, limit);
}
