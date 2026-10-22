-- Service: slug + createdAt. Existing rows get a slug derived from the name plus an id suffix
-- so the backfill can never collide.
ALTER TABLE "Service" ADD COLUMN "slug" TEXT,
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Service"
SET "slug" = COALESCE(NULLIF(trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), ''), 'service')
             || '-' || substr("id", 1, 6);
ALTER TABLE "Service" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Service_workspaceId_slug_key" ON "Service"("workspaceId", "slug");

-- Trigram search on incident titles (revenant detection and the incidents search box).
-- The extension already lives in public (first migration); this is a no-op safeguard.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- gin_trgm_ops is schema-qualified so the index also builds when search_path points at a
-- throwaway test schema.
CREATE INDEX incident_title_trgm ON "Incident" USING gin (title public.gin_trgm_ops);

-- Severity is 1 (least) to 5 (most severe).
ALTER TABLE "Incident" ADD CONSTRAINT severity_range CHECK (severity BETWEEN 1 AND 5);
