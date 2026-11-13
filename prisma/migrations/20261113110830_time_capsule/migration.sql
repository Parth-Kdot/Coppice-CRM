-- Time Capsule (the yearly handoff): one report per workspace per board year, a relationship card
-- per company in it, and the owner's redactions. Additive only: two new enum types and three new
-- tables, nothing existing changes. The two AiFeature values it uses were added by the two
-- migrations before the one that added Membership.departingAt, so nothing here uses a value added
-- in the same migration.

-- CreateEnum
CREATE TYPE "HandoffStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "CardSource" AS ENUM ('AI', 'CODE');

-- CreateTable
CREATE TABLE "HandoffReport" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "boardYearStart" INTEGER NOT NULL,
    "status" "HandoffStatus" NOT NULL DEFAULT 'DRAFT',
    "companyIds" JSONB NOT NULL,
    "chunkCount" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "HandoffReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationshipCard" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" "CardSource" NOT NULL,
    "bullets" JSONB NOT NULL,
    "model" TEXT,
    "approvedAt" TIMESTAMPTZ(3),
    "approvedById" TEXT,
    "recontactOn" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelationshipCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveRedaction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "bulletIndex" INTEGER,
    "hiddenById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchiveRedaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HandoffReport_createdById_idx" ON "HandoffReport"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "HandoffReport_workspaceId_boardYearStart_key" ON "HandoffReport"("workspaceId", "boardYearStart");

-- CreateIndex
CREATE UNIQUE INDEX "HandoffReport_id_workspaceId_key" ON "HandoffReport"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "RelationshipCard_reportId_workspaceId_idx" ON "RelationshipCard"("reportId", "workspaceId");

-- CreateIndex
CREATE INDEX "RelationshipCard_companyId_workspaceId_idx" ON "RelationshipCard"("companyId", "workspaceId");

-- CreateIndex
CREATE INDEX "RelationshipCard_workspaceId_idx" ON "RelationshipCard"("workspaceId");

-- CreateIndex
CREATE INDEX "RelationshipCard_approvedById_idx" ON "RelationshipCard"("approvedById");

-- CreateIndex
CREATE UNIQUE INDEX "RelationshipCard_reportId_companyId_key" ON "RelationshipCard"("reportId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "RelationshipCard_id_workspaceId_key" ON "RelationshipCard"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "ArchiveRedaction_cardId_workspaceId_idx" ON "ArchiveRedaction"("cardId", "workspaceId");

-- CreateIndex
CREATE INDEX "ArchiveRedaction_workspaceId_idx" ON "ArchiveRedaction"("workspaceId");

-- CreateIndex
CREATE INDEX "ArchiveRedaction_hiddenById_idx" ON "ArchiveRedaction"("hiddenById");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveRedaction_cardId_bulletIndex_key" ON "ArchiveRedaction"("cardId", "bulletIndex");

-- AddForeignKey
ALTER TABLE "HandoffReport" ADD CONSTRAINT "HandoffReport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoffReport" ADD CONSTRAINT "HandoffReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipCard" ADD CONSTRAINT "RelationshipCard_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipCard" ADD CONSTRAINT "RelationshipCard_reportId_workspaceId_fkey" FOREIGN KEY ("reportId", "workspaceId") REFERENCES "HandoffReport"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipCard" ADD CONSTRAINT "RelationshipCard_companyId_workspaceId_fkey" FOREIGN KEY ("companyId", "workspaceId") REFERENCES "Company"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipCard" ADD CONSTRAINT "RelationshipCard_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveRedaction" ADD CONSTRAINT "ArchiveRedaction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveRedaction" ADD CONSTRAINT "ArchiveRedaction_cardId_workspaceId_fkey" FOREIGN KEY ("cardId", "workspaceId") REFERENCES "RelationshipCard"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveRedaction" ADD CONSTRAINT "ArchiveRedaction_hiddenById_fkey" FOREIGN KEY ("hiddenById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A board year starts in a year Coppice could have been used in; a redaction hides bullet 0 or
-- later; a re-contact date is a plain calendar date.
ALTER TABLE "HandoffReport" ADD CONSTRAINT "HandoffReport_boardYearStart_check" CHECK ("boardYearStart" BETWEEN 2000 AND 2100);
ALTER TABLE "HandoffReport" ADD CONSTRAINT "HandoffReport_chunkCount_check" CHECK ("chunkCount" >= 0);
ALTER TABLE "RelationshipCard" ADD CONSTRAINT "RelationshipCard_recontactOn_check" CHECK ("recontactOn" IS NULL OR "recontactOn" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
ALTER TABLE "ArchiveRedaction" ADD CONSTRAINT "ArchiveRedaction_bulletIndex_check" CHECK ("bulletIndex" IS NULL OR "bulletIndex" >= 0);

-- A unique index treats two nulls as different, so on its own it would let a card be hidden twice.
-- This one allows exactly one whole-card row per card. Prisma has no syntax for a partial index and
-- ignores it when comparing the schema with the database.
CREATE UNIQUE INDEX "ArchiveRedaction_cardId_whole_key" ON "ArchiveRedaction"("cardId") WHERE "bulletIndex" IS NULL;

-- =============================================================================================
-- Grants and row-level security (hand-written; rule 1.11 allows raw SQL in migrations).
-- app_user gets these rights through the default privileges in tenant_rls already; they are
-- granted here as well so the tables never depend on which role ran the migration.
-- Every member of the workspace can read these rows; only an owner can add, change or remove one,
-- which the database checks as well as the app (private.is_owner_of_current_workspace comes from
-- the research_agent migration). Which rows an officer is shown (published, approved, not hidden)
-- is decided by the read functions in lib/capsule/, not here.
-- =============================================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON "HandoffReport", "RelationshipCard", "ArchiveRedaction" TO app_user;

ALTER TABLE "HandoffReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HandoffReport" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "HandoffReport" FOR SELECT
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()));
CREATE POLICY owner_insert ON "HandoffReport" FOR INSERT
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_owner_of_current_workspace()));
CREATE POLICY owner_update ON "HandoffReport" FOR UPDATE
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_owner_of_current_workspace()))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_owner_of_current_workspace()));
CREATE POLICY owner_delete ON "HandoffReport" FOR DELETE
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_owner_of_current_workspace()));

ALTER TABLE "RelationshipCard" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RelationshipCard" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "RelationshipCard" FOR SELECT
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()));
CREATE POLICY owner_insert ON "RelationshipCard" FOR INSERT
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_owner_of_current_workspace()));
CREATE POLICY owner_update ON "RelationshipCard" FOR UPDATE
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_owner_of_current_workspace()))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_owner_of_current_workspace()));
CREATE POLICY owner_delete ON "RelationshipCard" FOR DELETE
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_owner_of_current_workspace()));

ALTER TABLE "ArchiveRedaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ArchiveRedaction" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "ArchiveRedaction" FOR SELECT
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()));
CREATE POLICY owner_insert ON "ArchiveRedaction" FOR INSERT
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_owner_of_current_workspace()));
CREATE POLICY owner_update ON "ArchiveRedaction" FOR UPDATE
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_owner_of_current_workspace()))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_owner_of_current_workspace()));
CREATE POLICY owner_delete ON "ArchiveRedaction" FOR DELETE
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_owner_of_current_workspace()));
