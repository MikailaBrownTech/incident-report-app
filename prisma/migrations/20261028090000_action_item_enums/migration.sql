-- New enum values must be committed before they can be used, so they get their own migration.
ALTER TYPE "ActionStatus" ADD VALUE 'WONT_DO';
ALTER TYPE "EventType" ADD VALUE 'RITUAL_COMPLETED';
