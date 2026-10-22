-- Lets the timeline's live refresh notice any change to an entry (edits and key-moment toggles included).
ALTER TABLE "Event" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Event" SET "updatedAt" = "createdAt";
