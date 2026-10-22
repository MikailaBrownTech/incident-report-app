-- Soft delete: rows stay for history, the scoped client hides them everywhere.
ALTER TABLE "Incident" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- New timeline event types for editing and deleting an incident.
ALTER TYPE "EventType" ADD VALUE 'TITLE_CHANGED';
ALTER TYPE "EventType" ADD VALUE 'SUMMARY_CHANGED';
ALTER TYPE "EventType" ADD VALUE 'INCIDENT_DELETED';
