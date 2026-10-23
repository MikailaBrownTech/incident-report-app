-- Per-workspace switch for AI features (on by default). Admins turn it off in Settings.
ALTER TABLE "Workspace" ADD COLUMN "aiEnabled" BOOLEAN NOT NULL DEFAULT true;
