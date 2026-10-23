import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./client";

/**
 * The one raw query behind revenant suggestions. It lives here because raw SQL is only allowed inside src/server/db, and it
 * takes the workspace id explicitly: every row it can return is filtered by it.
 *
 * Candidates are incidents that either have a similar title (the trigram `%` operator, which uses the GIN index on
 * the generated column `titleNorm`) or share a service (an index on IncidentService). Scoring and thresholds happen in the caller;
 * the database only narrows the field and reports each title's similarity.
 */

// table names are qualified so the query also works against the throwaway schema the database tests use
const table = (name: string) => Prisma.raw(`"${process.env.DATABASE_SCHEMA ?? "public"}"."${name}"`);

export interface CandidateRow {
  id: string;
  titleScore: number;
}

export async function candidateRows(input: {
  workspaceId: string;
  normalizedTitle: string;
  serviceIds: string[];
  since: Date;
  excludeIds: string[];
  startedBefore: Date | null;
}): Promise<CandidateRow[]> {
  const { workspaceId, normalizedTitle, serviceIds, since, excludeIds, startedBefore } = input;
  // Two branches, so each can use its own index: a similar title (GIN trigram index) or a shared service (IncidentService
  // index). A single OR across them would force a sequential scan.
  const rows = await prisma.$queryRaw<{ id: string; titleScore: number }[]>`
    SELECT i."id" AS "id", public.similarity(i."titleNorm", ${normalizedTitle}::text)::float8 AS "titleScore"
    FROM ${table("Incident")} i
    WHERE i."workspaceId" = ${workspaceId} AND i."deletedAt" IS NULL AND i."startedAt" >= ${since}
      AND NOT (i."id" = ANY(${excludeIds}::text[]))
      AND (${startedBefore}::timestamp IS NULL OR i."startedAt" < ${startedBefore}::timestamp)
      AND i."titleNorm" OPERATOR(public.%) ${normalizedTitle}::text
    UNION
    SELECT i."id", public.similarity(i."titleNorm", ${normalizedTitle}::text)::float8
    FROM ${table("Incident")} i
    JOIN ${table("IncidentService")} s ON s."incidentId" = i."id"
    WHERE i."workspaceId" = ${workspaceId} AND i."deletedAt" IS NULL AND i."startedAt" >= ${since}
      AND s."workspaceId" = ${workspaceId} AND s."serviceId" = ANY(${serviceIds}::text[])
      AND NOT (i."id" = ANY(${excludeIds}::text[]))
      AND (${startedBefore}::timestamp IS NULL OR i."startedAt" < ${startedBefore}::timestamp)`;
  return rows.map((r) => ({ id: r.id, titleScore: Number(r.titleScore) }));
}

/** EXPLAIN of the same query, for checking that the trigram index is used. */
export async function explainCandidates(input: {
  workspaceId: string;
  normalizedTitle: string;
  serviceIds: string[];
  since: Date;
  /** Turn sequential scans off for this one plan, to show whether the index CAN serve the query (small tables prefer a scan). */
  forceIndex?: boolean;
}): Promise<string[]> {
  const { workspaceId, normalizedTitle, serviceIds, since, forceIndex } = input;
  const explain = prisma.$queryRaw<Record<string, string>[]>`
    EXPLAIN
    SELECT i."id", public.similarity(i."titleNorm", ${normalizedTitle}::text)
    FROM ${table("Incident")} i
    WHERE i."workspaceId" = ${workspaceId} AND i."deletedAt" IS NULL AND i."startedAt" >= ${since}
      AND i."titleNorm" OPERATOR(public.%) ${normalizedTitle}::text
    UNION
    SELECT i."id", public.similarity(i."titleNorm", ${normalizedTitle}::text)
    FROM ${table("Incident")} i
    JOIN ${table("IncidentService")} s ON s."incidentId" = i."id"
    WHERE i."workspaceId" = ${workspaceId} AND i."deletedAt" IS NULL AND i."startedAt" >= ${since}
      AND s."serviceId" = ANY(${serviceIds}::text[])`;
  if (!forceIndex) return (await explain).map((r) => r["QUERY PLAN"]);
  const [, rows] = await prisma.$transaction([prisma.$executeRaw`SET LOCAL enable_seqscan = off`, explain]);
  return rows.map((r) => r["QUERY PLAN"]);
}
