-- Columns. position is compared as bytes (fractional indexing), hence COLLATE "C".
ALTER TABLE "ActionItem" ADD COLUMN "incidentId" TEXT;
ALTER TABLE "ActionItem" ADD COLUMN "createdById" TEXT;
ALTER TABLE "ActionItem" ADD COLUMN "wontDoReason" TEXT;
ALTER TABLE "ActionItem" ADD COLUMN "position" TEXT COLLATE "C" NOT NULL DEFAULT 'a0';
ALTER TABLE "ActionItem" ADD COLUMN "externalProvider" TEXT;
ALTER TABLE "ActionItem" ADD COLUMN "externalUrl" TEXT;
ALTER TABLE "ActionItem" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing rows: the incident comes from the postmortem, and the creator defaults to the owner.
UPDATE "ActionItem" a SET "incidentId" = p."incidentId", "createdById" = a."ownerId"
FROM "Postmortem" p WHERE p."id" = a."postmortemId";
ALTER TABLE "ActionItem" ALTER COLUMN "incidentId" SET NOT NULL;
ALTER TABLE "ActionItem" ALTER COLUMN "createdById" SET NOT NULL;

-- A due date is a calendar date and may be missing.
ALTER TABLE "ActionItem" ALTER COLUMN "dueDate" DROP NOT NULL;
ALTER TABLE "ActionItem" ALTER COLUMN "dueDate" TYPE DATE USING "dueDate"::date;

ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_incidentId_workspaceId_fkey" FOREIGN KEY ("incidentId", "workspaceId") REFERENCES "Incident"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX "ActionItem_workspaceId_ownerId_status_idx";
CREATE INDEX "ActionItem_ownerId_status_idx" ON "ActionItem"("ownerId", "status");
CREATE INDEX "ActionItem_postmortemId_idx" ON "ActionItem"("postmortemId");
CREATE INDEX "ActionItem_workspaceId_status_position_idx" ON "ActionItem"("workspaceId", "status", "position");
