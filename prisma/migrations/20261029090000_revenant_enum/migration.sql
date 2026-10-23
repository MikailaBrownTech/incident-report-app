-- New enum values must be committed before use, so they get their own migration.
ALTER TYPE "EventType" ADD VALUE 'REVENANT_UNLINKED';
