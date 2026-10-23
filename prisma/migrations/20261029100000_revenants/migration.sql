-- An incident can't be a recurrence of itself.
ALTER TABLE "Incident" ADD CONSTRAINT revenant_not_self CHECK ("revenantOfId" IS NULL OR "revenantOfId" <> "id");
CREATE INDEX "Incident_revenantOfId_idx" ON "Incident"("revenantOfId");

-- "Not a match" decisions.
CREATE TABLE "RevenantDismissal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "dismissedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RevenantDismissal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RevenantDismissal_incidentId_candidateId_key" ON "RevenantDismissal"("incidentId", "candidateId");
CREATE INDEX "RevenantDismissal_workspaceId_idx" ON "RevenantDismissal"("workspaceId");
ALTER TABLE "RevenantDismissal" ADD CONSTRAINT "RevenantDismissal_incidentId_workspaceId_fkey" FOREIGN KEY ("incidentId", "workspaceId") REFERENCES "Incident"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RevenantDismissal" ADD CONSTRAINT "RevenantDismissal_candidateId_workspaceId_fkey" FOREIGN KEY ("candidateId", "workspaceId") REFERENCES "Incident"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Titles compared for similarity are lowercased with digits and punctuation removed, so "Checkout API timeouts #2"
-- and "checkout api timeout spike" are close. One immutable function is used by the index AND the query, so the planner
-- can use the index. Pinned to public like the trigram extension, so any search_path can call it.
CREATE OR REPLACE FUNCTION public.revenant_norm(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT btrim(regexp_replace(lower(t), '[[:digit:][:punct:]_]+', ' ', 'g')) $$;
-- The normalised title is a stored generated column, so the trigram index is on a plain column and the planner can always match it
-- (an index on the function call was never chosen: the planner inlines the SQL function in queries but not in the index).
-- Prisma does not know about the column; it only exists for the similarity query, and `prisma migrate dev` would want to drop it,
-- so keep it in migrations only.
ALTER TABLE "Incident" ADD COLUMN "titleNorm" text GENERATED ALWAYS AS (public.revenant_norm(title)) STORED;
CREATE INDEX incident_title_norm_trgm ON "Incident" USING gin ("titleNorm" public.gin_trgm_ops);
