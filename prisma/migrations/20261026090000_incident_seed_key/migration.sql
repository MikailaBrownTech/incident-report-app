-- AlterTable
ALTER TABLE "Incident" ADD COLUMN "seedKey" TEXT;

-- CreateIndex (NULLs are distinct, so real incidents are unaffected)
CREATE UNIQUE INDEX "Incident_workspaceId_seedKey_key" ON "Incident"("workspaceId", "seedKey");
