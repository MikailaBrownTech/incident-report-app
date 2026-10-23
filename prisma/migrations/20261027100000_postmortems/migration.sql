-- ---- Templates: built-ins have no workspace ----
ALTER TABLE "PostmortemTemplate" ALTER COLUMN "workspaceId" DROP NOT NULL;
ALTER TABLE "PostmortemTemplate" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- The per-workspace "Default" templates (old section keys) were never used by anything.
DELETE FROM "PostmortemTemplate" WHERE "isSystem" = true AND "workspaceId" IS NOT NULL;

-- Fixed ids: code refers to these (features/postmortems/sections.ts holds the same definitions; a test keeps them equal).
INSERT INTO "PostmortemTemplate" ("id", "workspaceId", "name", "isSystem", "isDefault", "sections")
VALUES
  ('tpl_standard', NULL, 'Standard autopsy', true, true, '[{"key":"summary","required":true,"order":0},{"key":"impact","required":true,"order":1},{"key":"root_cause","required":true,"order":2},{"key":"detection","required":false,"order":3},{"key":"response","required":false,"order":4},{"key":"timeline","required":false,"order":5},{"key":"went_well","required":false,"order":6},{"key":"went_wrong","required":false,"order":7},{"key":"lucky","required":false,"order":8},{"key":"lessons","required":true,"order":9}]'::jsonb),
  ('tpl_quick', NULL, 'Quick review', true, false, '[{"key":"summary","required":true,"order":0},{"key":"root_cause","required":true,"order":1},{"key":"lessons","required":true,"order":2}]'::jsonb);

-- ---- Postmortems ----
ALTER TABLE "Postmortem" ADD COLUMN "templateId" TEXT NOT NULL DEFAULT 'tpl_standard';
ALTER TABLE "Postmortem" ALTER COLUMN "templateId" DROP DEFAULT;
ALTER TABLE "Postmortem" ADD COLUMN "publishedById" TEXT;
ALTER TABLE "Postmortem" ADD COLUMN "content" JSONB NOT NULL DEFAULT '{"sections":{}}';
ALTER TABLE "Postmortem" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Postmortem" ADD CONSTRAINT "Postmortem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PostmortemTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Postmortem_workspaceId_status_idx" ON "Postmortem"("workspaceId", "status");

-- ---- Retro rules: one per severity threshold ----
DROP INDEX "RetroRule_workspaceId_key";
ALTER TABLE "RetroRule" ADD COLUMN "dueInDays" INTEGER NOT NULL DEFAULT 5;
CREATE UNIQUE INDEX "RetroRule_workspaceId_minSeverity_key" ON "RetroRule"("workspaceId", "minSeverity");
UPDATE "RetroRule" SET "mode" = 'OPTIONAL' WHERE "mode" IN ('OFF', 'RECOMMENDED');

-- Backfill: every workspace gets the default rule (severity 4 and up REQUIRED, due in 5 days).
INSERT INTO "RetroRule" ("id", "workspaceId", "minSeverity", "mode", "dueInDays")
SELECT 'rr_' || w."id", w."id", 4, 'REQUIRED', 5
FROM "Workspace" w
WHERE NOT EXISTS (SELECT 1 FROM "RetroRule" r WHERE r."workspaceId" = w."id");
