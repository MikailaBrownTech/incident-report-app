-- New enum values must be committed before they can be used, so they get their own migration.
ALTER TYPE "EventType" ADD VALUE 'POSTMORTEM_STARTED';
ALTER TYPE "EventType" ADD VALUE 'POSTMORTEM_UNPUBLISHED';
ALTER TYPE "RetroRuleMode" ADD VALUE 'OPTIONAL';
ALTER TYPE "RetroRuleMode" ADD VALUE 'SKIP';
