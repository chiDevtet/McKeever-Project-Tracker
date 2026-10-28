-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('ADMINISTRATOR', 'MEMBER');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('PROJECT_MANAGER', 'INTERNAL_VIEWER', 'FOREMAN_VIEWER');

-- CreateEnum
CREATE TYPE "PartyRole" AS ENUM ('CUSTOMER', 'GENERAL_CONTRACTOR', 'OWNER', 'OTHER');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PRELIMINARY', 'ACTIVE', 'ON_HOLD', 'COMPLETE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AreaKind" AS ENUM ('BUILDING', 'ROMP', 'DATA_HALL', 'ROOM', 'ZONE', 'OTHER');

-- CreateEnum
CREATE TYPE "MilestoneReview" AS ENUM ('NEEDS_REVIEW', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "PlanKind" AS ENUM ('WORKING', 'SCENARIO');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'PROMOTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "NodeKind" AS ENUM ('POOL', 'RESERVATION', 'CREW');

-- CreateEnum
CREATE TYPE "EntryKind" AS ENUM ('WEEK', 'DAY', 'BLOCK');

-- CreateEnum
CREATE TYPE "OnsiteMode" AS ENUM ('PROJECT_CALENDAR', 'WEEKDAYS');

-- CreateEnum
CREATE TYPE "ProgressStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "LineageKind" AS ENUM ('PDF_SCHEDULE', 'SPREADSHEET', 'MANUAL_TABLE');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'EXTRACTING', 'EXTRACTED', 'NEEDS_REVIEW', 'VALIDATED', 'COMMITTED', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportFormat" AS ENUM ('PDF', 'CSV', 'XLSX');

-- CreateEnum
CREATE TYPE "SnapshotKind" AS ENUM ('BASELINE', 'REPORT', 'REVISION_BACKUP');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('PDF', 'XLSX');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('QUEUED', 'RENDERING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

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
    "appDisplayName" TEXT NOT NULL DEFAULT 'M&N FieldOps',
    "brandColor" TEXT NOT NULL DEFAULT '#1d4f7a',
    "logoFileId" TEXT,
    "defaultTimezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "divisionTimezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "leadershipRoles" TEXT[] DEFAULT ARRAY['Project manager', 'Main foreman', 'Foreman', 'Superintendent']::TEXT[],
    "installerRoles" TEXT[] DEFAULT ARRAY['Installer']::TEXT[],
    "milestoneCodes" TEXT[] DEFAULT ARRAY['SWD', 'FEA', 'NEA', 'H2C', 'PFHO']::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workspaceRole" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "projectGrants" JSONB NOT NULL DEFAULT '[]',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMembership" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "userId" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectParty" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "PartyRole" NOT NULL,
    "label" TEXT,

    CONSTRAINT "ProjectParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PRELIMINARY',
    "description" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "activitySeq" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "System" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceAliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "System_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Phase" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Phase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "kind" "AreaKind" NOT NULL DEFAULT 'OTHER',
    "name" TEXT NOT NULL,
    "code" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseArea" (
    "phaseId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,

    CONSTRAINT "PhaseArea_pkey" PRIMARY KEY ("phaseId","areaId")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phaseId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE,
    "reviewStatus" "MilestoneReview" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "adoptedValueId" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MilestoneSourceValue" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "sourceVersionId" TEXT,
    "sourceLabel" TEXT NOT NULL,
    "sourceDate" DATE,
    "date" DATE,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilestoneSourceValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "PlanKind" NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "basedOnPlanId" TEXT,
    "basedOnRevision" INTEGER,
    "basedOnSnapshotId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanRevision" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "actorId" TEXT,
    "snapshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Calendar" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "definition" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseWindow" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "start" DATE,
    "finish" DATE,
    "note" TEXT,

    CONSTRAINT "PhaseWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phaseId" TEXT,
    "areaId" TEXT,
    "systemId" TEXT,
    "calendarKey" TEXT,
    "plannedStart" DATE NOT NULL,
    "plannedFinish" DATE NOT NULL,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLink" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,
    "successorId" TEXT NOT NULL,
    "lagDays" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ActivityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityMilestone" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,

    CONSTRAINT "ActivityMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationNode" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "parentId" TEXT,
    "kind" "NodeKind" NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'Installer',
    "phaseId" TEXT,
    "areaId" TEXT,
    "systemId" TEXT,
    "activityKey" TEXT,
    "calendarKey" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllocationNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingEntry" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "kind" "EntryKind" NOT NULL,
    "date" DATE NOT NULL,
    "slot" TEXT NOT NULL DEFAULT '',
    "headcount" INTEGER NOT NULL,
    "hours" DECIMAL(6,2),
    "startTime" TEXT,
    "endTime" TEXT,
    "label" TEXT,

    CONSTRAINT "StaffingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadershipAssignment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "personId" TEXT,
    "placeholderName" TEXT NOT NULL DEFAULT 'TBD',
    "role" TEXT NOT NULL,
    "responsibilitySystemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "responsibilityPhaseIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "responsibilityNote" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "onsiteMode" "OnsiteMode" NOT NULL DEFAULT 'PROJECT_CALENDAR',
    "onsiteWeekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "onsiteHours" DECIMAL(5,2),
    "onsiteStart" TEXT,
    "offsiteHoursPerWeek" DECIMAL(6,2),
    "dayOverrides" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LeadershipAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityProgress" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityKey" TEXT NOT NULL,
    "status" "ProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "actualStart" DATE,
    "actualFinish" DATE,
    "percentComplete" DECIMAL(5,2),
    "holdReason" TEXT,
    "holdReviewDate" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "note" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceLineage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "LineageKind" NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceLineage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceVersion" (
    "id" TEXT NOT NULL,
    "lineageId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "sourceDate" DATE,
    "dataDate" DATE,
    "fileId" TEXT,
    "sha256" TEXT,
    "importSessionId" TEXT,
    "comparedToId" TEXT,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "committedById" TEXT,
    "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRecord" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ACTIVITY',
    "name" TEXT NOT NULL,
    "wbsPath" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pageNumber" INTEGER,
    "start" DATE,
    "finish" DATE,
    "originalDuration" DECIMAL(8,2),
    "remainingDuration" DECIMAL(8,2),
    "startActual" BOOLEAN NOT NULL DEFAULT false,
    "finishActual" BOOLEAN NOT NULL DEFAULT false,
    "startConstrained" BOOLEAN NOT NULL DEFAULT false,
    "finishConstrained" BOOLEAN NOT NULL DEFAULT false,
    "original" JSONB NOT NULL,
    "reviewed" JSONB NOT NULL,
    "inScope" BOOLEAN NOT NULL DEFAULT false,
    "phaseId" TEXT,
    "areaId" TEXT,
    "systemId" TEXT,
    "changeKind" TEXT NOT NULL DEFAULT 'ADDED',
    "changes" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "SourceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivitySourceLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityKey" TEXT NOT NULL,
    "lineageId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivitySourceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportSession" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "lineageId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "format" "ImportFormat" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "fileSha256" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sourceDate" DATE,
    "columnMapping" JSONB,
    "extractionMeta" JSONB NOT NULL DEFAULT '{}',
    "issues" JSONB NOT NULL DEFAULT '[]',
    "compareToVersionId" TEXT,
    "identicalToVersionId" TEXT,
    "jobId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "pageNumber" INTEGER,
    "kind" TEXT NOT NULL,
    "externalId" TEXT,
    "wbsPath" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "original" JSONB NOT NULL,
    "reviewed" JSONB NOT NULL,
    "include" BOOLEAN NOT NULL DEFAULT false,
    "phaseId" TEXT,
    "areaId" TEXT,
    "systemId" TEXT,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "matchStatus" TEXT NOT NULL DEFAULT 'ADDED',
    "matchDetail" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planKind" "PlanKind" NOT NULL,
    "planName" TEXT NOT NULL,
    "planRevision" INTEGER NOT NULL,
    "kind" "SnapshotKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "data" JSONB NOT NULL,
    "dataHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportPreset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "presetId" TEXT,
    "presetName" TEXT,
    "title" TEXT NOT NULL,
    "format" "ReportFormat" NOT NULL,
    "settings" JSONB NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'QUEUED',
    "fileId" TEXT,
    "sizeBytes" INTEGER,
    "sha256" TEXT,
    "datasetHash" TEXT,
    "error" TEXT,
    "jobId" TEXT,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "exploratory" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "submissionId" TEXT,

    CONSTRAINT "GeneratedReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "recipientLabel" TEXT NOT NULL,
    "reference" TEXT,
    "acknowledgedIssues" JSONB NOT NULL DEFAULT '[]',
    "recordedById" TEXT,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "immutable" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDocument" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "kind" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityLimit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "maxHeadcount" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilityLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "planId" TEXT,
    "actorId" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailOutbox" (
    "id" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "html" TEXT,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailOutbox_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "WorkspaceMember_userId_key" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE INDEX "WorkspaceMember_workspaceId_idx" ON "WorkspaceMember"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_workspaceId_email_idx" ON "Invitation"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "ProjectMembership_userId_idx" ON "ProjectMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMembership_projectId_userId_key" ON "ProjectMembership"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_userId_key" ON "Person"("userId");

-- CreateIndex
CREATE INDEX "Person_workspaceId_idx" ON "Person"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_workspaceId_name_key" ON "Organization"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectParty_projectId_organizationId_role_key" ON "ProjectParty"("projectId", "organizationId", "role");

-- CreateIndex
CREATE INDEX "Contact_projectId_idx" ON "Contact"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_workspaceId_code_key" ON "Project"("workspaceId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "System_projectId_key_key" ON "System"("projectId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Phase_projectId_key_key" ON "Phase"("projectId", "key");

-- CreateIndex
CREATE INDEX "Area_projectId_idx" ON "Area"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Milestone_projectId_phaseId_code_key" ON "Milestone"("projectId", "phaseId", "code");

-- CreateIndex
CREATE INDEX "MilestoneSourceValue_milestoneId_idx" ON "MilestoneSourceValue"("milestoneId");

-- CreateIndex
CREATE INDEX "Plan_projectId_kind_idx" ON "Plan"("projectId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "PlanRevision_planId_revision_key" ON "PlanRevision"("planId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "Calendar_planId_key_key" ON "Calendar"("planId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "PhaseWindow_planId_phaseId_key" ON "PhaseWindow"("planId", "phaseId");

-- CreateIndex
CREATE INDEX "Activity_planId_idx" ON "Activity"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "Activity_planId_key_key" ON "Activity"("planId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityLink_predecessorId_successorId_key" ON "ActivityLink"("predecessorId", "successorId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityMilestone_activityId_milestoneId_key" ON "ActivityMilestone"("activityId", "milestoneId");

-- CreateIndex
CREATE INDEX "AllocationNode_planId_idx" ON "AllocationNode"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "AllocationNode_planId_key_key" ON "AllocationNode"("planId", "key");

-- CreateIndex
CREATE INDEX "StaffingEntry_planId_idx" ON "StaffingEntry"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffingEntry_nodeId_kind_date_slot_key" ON "StaffingEntry"("nodeId", "kind", "date", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "LeadershipAssignment_planId_key_key" ON "LeadershipAssignment"("planId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityProgress_projectId_activityKey_key" ON "ActivityProgress"("projectId", "activityKey");

-- CreateIndex
CREATE INDEX "ProgressEvent_projectId_activityKey_idx" ON "ProgressEvent"("projectId", "activityKey");

-- CreateIndex
CREATE UNIQUE INDEX "SourceLineage_projectId_name_key" ON "SourceLineage"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SourceVersion_importSessionId_key" ON "SourceVersion"("importSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceVersion_lineageId_versionNumber_key" ON "SourceVersion"("lineageId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SourceRecord_versionId_externalId_key" ON "SourceRecord"("versionId", "externalId");

-- CreateIndex
CREATE INDEX "ActivitySourceLink_projectId_lineageId_externalId_idx" ON "ActivitySourceLink"("projectId", "lineageId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivitySourceLink_activityKey_lineageId_externalId_key" ON "ActivitySourceLink"("activityKey", "lineageId", "externalId");

-- CreateIndex
CREATE INDEX "ImportSession_projectId_status_idx" ON "ImportSession"("projectId", "status");

-- CreateIndex
CREATE INDEX "ImportRow_sessionId_externalId_idx" ON "ImportRow"("sessionId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_sessionId_rowIndex_key" ON "ImportRow"("sessionId", "rowIndex");

-- CreateIndex
CREATE INDEX "PlanSnapshot_projectId_kind_idx" ON "PlanSnapshot"("projectId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ExportPreset_workspaceId_projectId_name_key" ON "ExportPreset"("workspaceId", "projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedReport_fileId_key" ON "GeneratedReport"("fileId");

-- CreateIndex
CREATE INDEX "GeneratedReport_projectId_createdAt_idx" ON "GeneratedReport"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_projectId_sequence_key" ON "Submission"("projectId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_storageKey_key" ON "StoredFile"("storageKey");

-- CreateIndex
CREATE INDEX "StoredFile_projectId_idx" ON "StoredFile"("projectId");

-- CreateIndex
CREATE INDEX "ProjectDocument_projectId_idx" ON "ProjectDocument"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundJob_idempotencyKey_key" ON "BackgroundJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BackgroundJob_projectId_kind_idx" ON "BackgroundJob"("projectId", "kind");

-- CreateIndex
CREATE INDEX "AuditEvent_workspaceId_createdAt_idx" ON "AuditEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_projectId_createdAt_idx" ON "AuditEvent"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMembership" ADD CONSTRAINT "ProjectMembership_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMembership" ADD CONSTRAINT "ProjectMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectParty" ADD CONSTRAINT "ProjectParty_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectParty" ADD CONSTRAINT "ProjectParty_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "System" ADD CONSTRAINT "System_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Phase" ADD CONSTRAINT "Phase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseArea" ADD CONSTRAINT "PhaseArea_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "Phase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseArea" ADD CONSTRAINT "PhaseArea_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "Phase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneSourceValue" ADD CONSTRAINT "MilestoneSourceValue_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneSourceValue" ADD CONSTRAINT "MilestoneSourceValue_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "SourceVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanRevision" ADD CONSTRAINT "PlanRevision_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calendar" ADD CONSTRAINT "Calendar_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseWindow" ADD CONSTRAINT "PhaseWindow_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLink" ADD CONSTRAINT "ActivityLink_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLink" ADD CONSTRAINT "ActivityLink_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLink" ADD CONSTRAINT "ActivityLink_successorId_fkey" FOREIGN KEY ("successorId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityMilestone" ADD CONSTRAINT "ActivityMilestone_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityMilestone" ADD CONSTRAINT "ActivityMilestone_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationNode" ADD CONSTRAINT "AllocationNode_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationNode" ADD CONSTRAINT "AllocationNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AllocationNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingEntry" ADD CONSTRAINT "StaffingEntry_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingEntry" ADD CONSTRAINT "StaffingEntry_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "AllocationNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadershipAssignment" ADD CONSTRAINT "LeadershipAssignment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadershipAssignment" ADD CONSTRAINT "LeadershipAssignment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityProgress" ADD CONSTRAINT "ActivityProgress_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressEvent" ADD CONSTRAINT "ProgressEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceLineage" ADD CONSTRAINT "SourceLineage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceVersion" ADD CONSTRAINT "SourceVersion_lineageId_fkey" FOREIGN KEY ("lineageId") REFERENCES "SourceLineage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SourceVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivitySourceLink" ADD CONSTRAINT "ActivitySourceLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportSession" ADD CONSTRAINT "ImportSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportSession" ADD CONSTRAINT "ImportSession_lineageId_fkey" FOREIGN KEY ("lineageId") REFERENCES "SourceLineage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ImportSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanSnapshot" ADD CONSTRAINT "PlanSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportPreset" ADD CONSTRAINT "ExportPreset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedReport" ADD CONSTRAINT "GeneratedReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedReport" ADD CONSTRAINT "GeneratedReport_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PlanSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedReport" ADD CONSTRAINT "GeneratedReport_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PlanSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackgroundJob" ADD CONSTRAINT "BackgroundJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityLimit" ADD CONSTRAINT "AvailabilityLimit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Immutability guards for frozen records (snapshots, submissions, issued
-- report files). Application code never updates these columns; the triggers
-- make that a database guarantee.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fieldops_reject_snapshot_update() RETURNS trigger AS $$
BEGIN
  IF NEW."data" IS DISTINCT FROM OLD."data"
     OR NEW."dataHash" IS DISTINCT FROM OLD."dataHash"
     OR NEW."planRevision" IS DISTINCT FROM OLD."planRevision"
     OR NEW."planId" IS DISTINCT FROM OLD."planId"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'PlanSnapshot % is immutable', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER plan_snapshot_immutable
  BEFORE UPDATE ON "PlanSnapshot"
  FOR EACH ROW EXECUTE FUNCTION fieldops_reject_snapshot_update();

CREATE OR REPLACE FUNCTION fieldops_reject_submission_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Submission % is immutable', OLD."id" USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER submission_immutable
  BEFORE UPDATE ON "Submission"
  FOR EACH ROW EXECUTE FUNCTION fieldops_reject_submission_update();

CREATE OR REPLACE FUNCTION fieldops_guard_report_update() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'READY' THEN
    IF NEW."fileId" IS DISTINCT FROM OLD."fileId"
       OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
       OR NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes"
       OR NEW."settings" IS DISTINCT FROM OLD."settings"
       OR NEW."snapshotId" IS DISTINCT FROM OLD."snapshotId"
       OR NEW."datasetHash" IS DISTINCT FROM OLD."datasetHash"
       OR NEW."status" IS DISTINCT FROM OLD."status"
       OR (OLD."submissionId" IS NOT NULL AND NEW."submissionId" IS DISTINCT FROM OLD."submissionId") THEN
      RAISE EXCEPTION 'Generated report % is issued and immutable', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER generated_report_guard
  BEFORE UPDATE ON "GeneratedReport"
  FOR EACH ROW EXECUTE FUNCTION fieldops_guard_report_update();

CREATE OR REPLACE FUNCTION fieldops_guard_file_update() RETURNS trigger AS $$
BEGIN
  IF OLD."immutable" AND (
       NEW."storageKey" IS DISTINCT FROM OLD."storageKey"
       OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
       OR NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes"
       OR NEW."immutable" IS DISTINCT FROM OLD."immutable") THEN
    RAISE EXCEPTION 'Stored file % is immutable', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stored_file_guard
  BEFORE UPDATE ON "StoredFile"
  FOR EACH ROW EXECUTE FUNCTION fieldops_guard_file_update();
