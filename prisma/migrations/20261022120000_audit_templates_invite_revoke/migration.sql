-- CreateEnum
CREATE TYPE "RetroRuleMode" AS ENUM ('OFF', 'RECOMMENDED', 'REQUIRED');

-- AlterTable
ALTER TABLE "Invite" ADD COLUMN     "revokedAt" TIMESTAMP(3);

-- AlterTable: replace RetroRule.enabled with mode, preserving existing intent
ALTER TABLE "RetroRule" ADD COLUMN "mode" "RetroRuleMode" NOT NULL DEFAULT 'REQUIRED';
UPDATE "RetroRule" SET "mode" = CASE WHEN "enabled" THEN 'REQUIRED'::"RetroRuleMode" ELSE 'OFF'::"RetroRuleMode" END;
ALTER TABLE "RetroRule" DROP COLUMN "enabled",
ALTER COLUMN "minSeverity" SET DEFAULT 4;

-- CreateTable
CREATE TABLE "PostmortemTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sections" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostmortemTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostmortemTemplate_workspaceId_idx" ON "PostmortemTemplate"("workspaceId");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "PostmortemTemplate" ADD CONSTRAINT "PostmortemTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: workspaces created before this migration get the default system template
INSERT INTO "PostmortemTemplate" ("id", "workspaceId", "name", "isSystem", "sections")
SELECT gen_random_uuid()::text, w."id", 'Default', true,
       '[{"key":"CAUSE","position":0},{"key":"LAST_SIGHTING","position":1},{"key":"WITNESSES","position":2},{"key":"LEARNED","position":3}]'::jsonb
FROM "Workspace" w;
