-- Slack joins USER (manual), SYSTEM and INTEGRATION (webhook) as an event source.
ALTER TYPE "EventSource" ADD VALUE 'SLACK';

-- Notes can be edited and flagged as key moments (pulled into postmortems later).
ALTER TABLE "Event" ADD COLUMN "editedAt" TIMESTAMP(3),
ADD COLUMN "isKeyMoment" BOOLEAN NOT NULL DEFAULT false;

-- occurredAt has always been NOT NULL, so nothing to backfill there; this just makes the guarantee explicit.
UPDATE "Event" SET "occurredAt" = "createdAt" WHERE "occurredAt" IS NULL;

-- Timeline paging: by when it happened, then id as the tie-break.
CREATE INDEX "Event_incidentId_occurredAt_id_idx" ON "Event"("incidentId", "occurredAt", "id");
