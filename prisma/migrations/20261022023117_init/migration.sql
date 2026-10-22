-- Trigram similarity for revenant detection (M5). Pinned to public so any search_path can call public.similarity().
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'TEAM', 'BUSINESS');

-- CreateEnum
CREATE TYPE "Skin" AS ENUM ('HAUNTED', 'PROFESSIONAL');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('INVESTIGATING', 'IDENTIFIED', 'MITIGATING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "IncidentRole" AS ENUM ('COMMANDER', 'SCRIBE', 'COMMS');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('USER', 'SYSTEM', 'INTEGRATION');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('NOTE', 'STATUS_CHANGED', 'SEVERITY_CHANGED', 'ROLE_ASSIGNED', 'ROLE_UNASSIGNED', 'SERVICES_CHANGED', 'REVENANT_LINKED', 'POSTMORTEM_PUBLISHED', 'RITUAL_CREATED', 'RETRO_OVERRIDE', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "PostmortemStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "stripeCustomerId" TEXT,
    "skin" "Skin" NOT NULL DEFAULT 'HAUNTED',
    "severityLabels" JSONB,
    "nextIncidentNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "severity" INTEGER NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'INVESTIGATING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "revenantOfId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentService" (
    "incidentId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "IncidentService_pkey" PRIMARY KEY ("incidentId","serviceId")
);

-- CreateTable
CREATE TABLE "IncidentAssignment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "IncidentRole" NOT NULL,

    CONSTRAINT "IncidentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "source" "EventSource" NOT NULL DEFAULT 'USER',
    "actorId" TEXT,
    "body" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "integrationId" TEXT,
    "externalId" TEXT,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secretHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Postmortem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "status" "PostmortemStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Postmortem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostmortemSection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "postmortemId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "PostmortemSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "postmortemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "ownerId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetroRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "minSeverity" INTEGER NOT NULL DEFAULT 3,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RetroRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_workspaceId_userId_key" ON "Membership"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");

-- CreateIndex
CREATE INDEX "Invite_workspaceId_email_idx" ON "Invite"("workspaceId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Service_workspaceId_name_key" ON "Service"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Service_id_workspaceId_key" ON "Service"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "Incident_workspaceId_status_idx" ON "Incident"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Incident_workspaceId_startedAt_idx" ON "Incident"("workspaceId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_workspaceId_number_key" ON "Incident"("workspaceId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_id_workspaceId_key" ON "Incident"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "IncidentService_workspaceId_serviceId_idx" ON "IncidentService"("workspaceId", "serviceId");

-- CreateIndex
CREATE INDEX "IncidentAssignment_workspaceId_userId_idx" ON "IncidentAssignment"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentAssignment_incidentId_role_key" ON "IncidentAssignment"("incidentId", "role");

-- CreateIndex
CREATE INDEX "Event_workspaceId_incidentId_occurredAt_idx" ON "Event"("workspaceId", "incidentId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Event_integrationId_externalId_key" ON "Event"("integrationId", "externalId");

-- CreateIndex
CREATE INDEX "Integration_workspaceId_idx" ON "Integration"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Postmortem_incidentId_key" ON "Postmortem"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "Postmortem_id_workspaceId_key" ON "Postmortem"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Postmortem_incidentId_workspaceId_key" ON "Postmortem"("incidentId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PostmortemSection_postmortemId_key_key" ON "PostmortemSection"("postmortemId", "key");

-- CreateIndex
CREATE INDEX "ActionItem_workspaceId_ownerId_status_idx" ON "ActionItem"("workspaceId", "ownerId", "status");

-- CreateIndex
CREATE INDEX "ActionItem_workspaceId_status_dueDate_idx" ON "ActionItem"("workspaceId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "RetroRule_workspaceId_key" ON "RetroRule"("workspaceId");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_revenantOfId_fkey" FOREIGN KEY ("revenantOfId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentService" ADD CONSTRAINT "IncidentService_incidentId_workspaceId_fkey" FOREIGN KEY ("incidentId", "workspaceId") REFERENCES "Incident"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentService" ADD CONSTRAINT "IncidentService_serviceId_workspaceId_fkey" FOREIGN KEY ("serviceId", "workspaceId") REFERENCES "Service"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentAssignment" ADD CONSTRAINT "IncidentAssignment_incidentId_workspaceId_fkey" FOREIGN KEY ("incidentId", "workspaceId") REFERENCES "Incident"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentAssignment" ADD CONSTRAINT "IncidentAssignment_workspaceId_userId_fkey" FOREIGN KEY ("workspaceId", "userId") REFERENCES "Membership"("workspaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_incidentId_workspaceId_fkey" FOREIGN KEY ("incidentId", "workspaceId") REFERENCES "Incident"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Postmortem" ADD CONSTRAINT "Postmortem_incidentId_workspaceId_fkey" FOREIGN KEY ("incidentId", "workspaceId") REFERENCES "Incident"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostmortemSection" ADD CONSTRAINT "PostmortemSection_postmortemId_workspaceId_fkey" FOREIGN KEY ("postmortemId", "workspaceId") REFERENCES "Postmortem"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_postmortemId_workspaceId_fkey" FOREIGN KEY ("postmortemId", "workspaceId") REFERENCES "Postmortem"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_workspaceId_ownerId_fkey" FOREIGN KEY ("workspaceId", "ownerId") REFERENCES "Membership"("workspaceId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroRule" ADD CONSTRAINT "RetroRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
