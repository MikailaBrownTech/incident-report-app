import { candidateRows } from "@/server/db/revenant-sql";
import type { ScopedDb } from "@/server/db/tenant";
import {
  DEFAULT_LIMIT,
  LOOKBACK_DAYS,
  MIN_TITLE_LENGTH,
  jaccard,
  matchStrength,
  normalizeTitle,
  scorePair,
} from "./score";
import type { IncidentSummary, RevenantCandidate } from "./types";

export const summarize = (i: {
  id: string;
  number: number;
  title: string;
  severity: number;
  status: string;
  startedAt: Date;
  resolvedAt: Date | null;
}): IncidentSummary => ({
  id: i.id,
  number: i.number,
  title: i.title,
  severity: i.severity,
  status: i.status,
  startedAt: i.startedAt.toISOString(),
  resolvedAt: i.resolvedAt?.toISOString() ?? null,
});

export interface CandidateQuery {
  title: string;
  serviceIds: string[];
  /** The incident the suggestions are for (left out, along with everything in its chain). */
  excludeIncidentId?: string;
  /** Only incidents that started before this (a new incident can only recur an earlier one). */
  startedBefore?: Date;
  limit?: number;
  /** Candidates this person marked "not a match" for `excludeIncidentId` are left out. */
  dismissedBy?: string;
  now?: Date;
}

/**
 * Earlier incidents in this workspace that look like the same trouble coming back.
 *
 * Score = 0.65 * title similarity + 0.35 * service overlap; a candidate qualifies at 0.35, or whenever its title alone
 * reaches 0.5. Soft-deleted incidents, anything older than a year, and anything in the incident's own chain are left
 * out, and each chain appears once. Best score first, then newest, then id, so the order is always the same.
 */
export async function findRevenantCandidates(db: ScopedDb, q: CandidateQuery): Promise<RevenantCandidate[]> {
  const normalizedTitle = normalizeTitle(q.title);
  const serviceIds = [...new Set(q.serviceIds)];
  if (normalizedTitle.length < MIN_TITLE_LENGTH && serviceIds.length === 0) return [];
  const now = q.now ?? new Date();
  const limit = q.limit ?? DEFAULT_LIMIT;

  // never suggest the incident itself, its own chain, or what this person already said is not a match
  const excluded = new Set<string>();
  if (q.excludeIncidentId) {
    excluded.add(q.excludeIncidentId);
    const self = await db.incident.findFirst({ where: { id: q.excludeIncidentId }, select: { revenantOfId: true } });
    const rootId = self?.revenantOfId ?? q.excludeIncidentId;
    const members = await db.incident.findMany({
      where: { OR: [{ id: rootId }, { revenantOfId: rootId }] },
      select: { id: true },
    });
    for (const m of members) excluded.add(m.id);
    if (q.dismissedBy) {
      const dismissed = await db.revenantDismissal.findMany({
        where: { incidentId: q.excludeIncidentId, dismissedById: q.dismissedBy },
        select: { candidateId: true },
      });
      for (const d of dismissed) excluded.add(d.candidateId);
    }
  }

  const rows = await candidateRows({
    workspaceId: db.$workspaceId,
    normalizedTitle,
    serviceIds,
    since: new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000),
    excludeIds: [...excluded],
    startedBefore: q.startedBefore ?? null,
  });
  if (rows.length === 0) return [];
  const titleScores = new Map(rows.map((r) => [r.id, r.titleScore]));

  const incidents = await db.incident.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
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
  });

  const scored = incidents
    .map((i) => {
      const serviceScore = jaccard(
        serviceIds,
        i.services.map((s) => s.service.id),
      );
      return { i, ...scorePair(titleScores.get(i.id) ?? 0, serviceScore) };
    })
    .filter((c) => c.qualifies)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.i.startedAt.getTime() - a.i.startedAt.getTime() ||
        (a.i.id < b.i.id ? -1 : a.i.id > b.i.id ? 1 : 0),
    );

  // one entry per chain: the best-scoring member, labelled with the chain's root
  const seen = new Set<string>();
  const unique = scored.filter((c) => {
    const key = c.i.revenantOfId ?? c.i.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const top = unique.slice(0, limit);

  const rootIds = [...new Set(top.map((c) => c.i.revenantOfId ?? c.i.id))];
  const [roots, sizes] = await Promise.all([
    db.incident.findMany({ where: { id: { in: rootIds } }, select: { id: true, number: true, title: true } }),
    db.incident.groupBy({ by: ["revenantOfId"], where: { revenantOfId: { in: rootIds } }, _count: { _all: true } }),
  ]);
  const rootById = new Map(roots.map((r) => [r.id, r]));
  const revenantCount = new Map(sizes.map((s) => [s.revenantOfId, s._count._all]));

  return top.map((c) => {
    const rootId = c.i.revenantOfId ?? c.i.id;
    const root = rootById.get(rootId);
    const size = (revenantCount.get(rootId) ?? 0) + 1;
    const shared = c.i.services.map((s) => s.service).filter((s) => serviceIds.includes(s.id));
    return {
      incident: summarize(c.i),
      score: c.score,
      titleScore: c.titleScore,
      serviceScore: c.serviceScore,
      strength: matchStrength(c.score),
      sharedServices: shared,
      reason: { similarTitle: c.titleScore >= 0.3, sharedServices: shared.map((s) => s.name) },
      chain: size > 1 && root ? { root, size } : null,
    };
  });
}
