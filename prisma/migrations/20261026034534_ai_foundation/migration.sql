-- AI feature 1 (the Fact-Locked Pitch Drafter): workspace AI settings, a log of every AI call,
-- uploaded fact sheets with their page text, the facts themselves, and drafted emails. All new
-- tables are tenant data with the same row-level security as the rest (bottom of this file).

-- CreateEnum
CREATE TYPE "AiFeature" AS ENUM ('FACT_EXTRACTION', 'DRAFT', 'CLAIM_CHECK');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "FactSource" AS ENUM ('PDF', 'MANUAL');

-- CreateEnum
CREATE TYPE "DraftKind" AS ENUM ('FIRST_TOUCH', 'FOLLOW_UP');

-- AlterTable
ALTER TABLE "Outreach" ADD COLUMN     "aiDraftId" TEXT;

-- AlterTable
ALTER TABLE "workspace" ADD COLUMN     "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aiMonthlyLimit" INTEGER NOT NULL DEFAULT 300;

-- CreateTable
CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feature" "AiFeature" NOT NULL,
    "model" TEXT NOT NULL,
    "status" "AiRunStatus" NOT NULL,
    "error" TEXT,
    "promptTokens" INTEGER,
    "outputTokens" INTEGER,
    "thinkingTokens" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactSheet" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactSheetPage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "factSheetId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "FactSheetPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactSheetItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "factSheetId" TEXT,
    "source" "FactSource" NOT NULL,
    "text" TEXT NOT NULL,
    "quote" TEXT,
    "pageNumber" INTEGER,
    "quoteFound" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMPTZ(3),
    "verifiedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FactSheetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDraft" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "createdById" TEXT NOT NULL,
    "kind" "DraftKind" NOT NULL,
    "angle" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "check" JSONB,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiRun_workspaceId_createdAt_idx" ON "AiRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AiRun_userId_feature_createdAt_idx" ON "AiRun"("userId", "feature", "createdAt");

-- CreateIndex
CREATE INDEX "FactSheet_workspaceId_createdAt_idx" ON "FactSheet"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "FactSheet_uploadedById_idx" ON "FactSheet"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "FactSheet_id_workspaceId_key" ON "FactSheet"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "FactSheetPage_factSheetId_workspaceId_idx" ON "FactSheetPage"("factSheetId", "workspaceId");

-- CreateIndex
CREATE INDEX "FactSheetPage_workspaceId_idx" ON "FactSheetPage"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "FactSheetPage_factSheetId_pageNumber_key" ON "FactSheetPage"("factSheetId", "pageNumber");

-- CreateIndex
CREATE INDEX "FactSheetItem_workspaceId_verifiedAt_idx" ON "FactSheetItem"("workspaceId", "verifiedAt");

-- CreateIndex
CREATE INDEX "FactSheetItem_factSheetId_workspaceId_idx" ON "FactSheetItem"("factSheetId", "workspaceId");

-- CreateIndex
CREATE INDEX "FactSheetItem_createdById_idx" ON "FactSheetItem"("createdById");

-- CreateIndex
CREATE INDEX "FactSheetItem_verifiedById_idx" ON "FactSheetItem"("verifiedById");

-- CreateIndex
CREATE INDEX "AiDraft_companyId_workspaceId_createdAt_idx" ON "AiDraft"("companyId", "workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AiDraft_workspaceId_idx" ON "AiDraft"("workspaceId");

-- CreateIndex
CREATE INDEX "AiDraft_contactId_idx" ON "AiDraft"("contactId");

-- CreateIndex
CREATE INDEX "AiDraft_createdById_idx" ON "AiDraft"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "AiDraft_id_workspaceId_key" ON "AiDraft"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "Outreach_aiDraftId_workspaceId_idx" ON "Outreach"("aiDraftId", "workspaceId");

-- AddForeignKey
ALTER TABLE "Outreach" ADD CONSTRAINT "Outreach_aiDraftId_workspaceId_fkey" FOREIGN KEY ("aiDraftId", "workspaceId") REFERENCES "AiDraft"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactSheet" ADD CONSTRAINT "FactSheet_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactSheet" ADD CONSTRAINT "FactSheet_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactSheetPage" ADD CONSTRAINT "FactSheetPage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactSheetPage" ADD CONSTRAINT "FactSheetPage_factSheetId_workspaceId_fkey" FOREIGN KEY ("factSheetId", "workspaceId") REFERENCES "FactSheet"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactSheetItem" ADD CONSTRAINT "FactSheetItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactSheetItem" ADD CONSTRAINT "FactSheetItem_factSheetId_workspaceId_fkey" FOREIGN KEY ("factSheetId", "workspaceId") REFERENCES "FactSheet"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactSheetItem" ADD CONSTRAINT "FactSheetItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactSheetItem" ADD CONSTRAINT "FactSheetItem_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_companyId_workspaceId_fkey" FOREIGN KEY ("companyId", "workspaceId") REFERENCES "Company"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================================
-- Row-level security (hand-written; rule 1.11 allows raw SQL in migrations). Same policy as every
-- other tenant table: rows of the current workspace only, and only for its members.
-- app_user already has rights on new tables through the default privileges in tenant_rls.
-- =============================================================================================
ALTER TABLE "AiRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiRun"
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace()));

ALTER TABLE "FactSheet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FactSheet" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FactSheet"
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace()));

ALTER TABLE "FactSheetPage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FactSheetPage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FactSheetPage"
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace()));

ALTER TABLE "FactSheetItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FactSheetItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FactSheetItem"
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace()));

-- A draft's contact must belong to the same workspace. (The company is already guaranteed by the
-- (companyId, workspaceId) foreign key; the contact link is a plain key so it can be cleared when
-- a contact is removed, so the policy checks it.)
ALTER TABLE "AiDraft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiDraft" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiDraft"
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace())
              AND ("contactId" IS NULL OR EXISTS (
                SELECT 1 FROM public."Contact" c
                WHERE c.id = "AiDraft"."contactId" AND c."workspaceId" = "AiDraft"."workspaceId"
              )));
