-- AI feature 7: the stats page's "Explain these numbers" and the Template Lab. Additive only:
-- one new enum type, two new columns on Template (both nullable), a unique index on Template
-- (its id is already unique, so this can't fail; it lets other tables point at a template and its
-- workspace together), and three new tenant tables with row-level security (bottom of this file).
-- The AI call types these use (SCORECARD_EXPLAIN, TEMPLATE_LAB) were added by the two migrations
-- before this one.

-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('RUNNING', 'ENDED');

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "familyId" TEXT,
ADD COLUMN     "variantNote" TEXT;

-- CreateTable
CREATE TABLE "ScorecardNarrative" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "statsHash" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "paragraphs" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScorecardNarrative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateExperiment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "baseTemplateId" TEXT NOT NULL,
    "status" "ExperimentStatus" NOT NULL DEFAULT 'RUNNING',
    "startedById" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),
    "keptTemplateId" TEXT,

    CONSTRAINT "TemplateExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentArm" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,

    CONSTRAINT "ExperimentArm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScorecardNarrative_createdById_idx" ON "ScorecardNarrative"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "ScorecardNarrative_workspaceId_key" ON "ScorecardNarrative"("workspaceId");

-- CreateIndex
CREATE INDEX "TemplateExperiment_workspaceId_status_idx" ON "TemplateExperiment"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "TemplateExperiment_startedById_idx" ON "TemplateExperiment"("startedById");

-- CreateIndex
CREATE INDEX "TemplateExperiment_baseTemplateId_workspaceId_idx" ON "TemplateExperiment"("baseTemplateId", "workspaceId");

-- CreateIndex
CREATE INDEX "TemplateExperiment_keptTemplateId_workspaceId_idx" ON "TemplateExperiment"("keptTemplateId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateExperiment_id_workspaceId_key" ON "TemplateExperiment"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "ExperimentArm_experimentId_workspaceId_idx" ON "ExperimentArm"("experimentId", "workspaceId");

-- CreateIndex
CREATE INDEX "ExperimentArm_templateId_workspaceId_idx" ON "ExperimentArm"("templateId", "workspaceId");

-- CreateIndex
CREATE INDEX "ExperimentArm_workspaceId_idx" ON "ExperimentArm"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentArm_experimentId_templateId_key" ON "ExperimentArm"("experimentId", "templateId");

-- CreateIndex
CREATE INDEX "Template_familyId_workspaceId_idx" ON "Template"("familyId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Template_id_workspaceId_key" ON "Template"("id", "workspaceId");

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_familyId_workspaceId_fkey" FOREIGN KEY ("familyId", "workspaceId") REFERENCES "Template"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardNarrative" ADD CONSTRAINT "ScorecardNarrative_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardNarrative" ADD CONSTRAINT "ScorecardNarrative_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateExperiment" ADD CONSTRAINT "TemplateExperiment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateExperiment" ADD CONSTRAINT "TemplateExperiment_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateExperiment" ADD CONSTRAINT "TemplateExperiment_baseTemplateId_workspaceId_fkey" FOREIGN KEY ("baseTemplateId", "workspaceId") REFERENCES "Template"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateExperiment" ADD CONSTRAINT "TemplateExperiment_keptTemplateId_workspaceId_fkey" FOREIGN KEY ("keptTemplateId", "workspaceId") REFERENCES "Template"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentArm" ADD CONSTRAINT "ExperimentArm_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentArm" ADD CONSTRAINT "ExperimentArm_experimentId_workspaceId_fkey" FOREIGN KEY ("experimentId", "workspaceId") REFERENCES "TemplateExperiment"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentArm" ADD CONSTRAINT "ExperimentArm_templateId_workspaceId_fkey" FOREIGN KEY ("templateId", "workspaceId") REFERENCES "Template"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;


-- A variant is a one-change copy of its base; an arm's label is A (the original), B or C; the
-- kind is the original or one of the four kinds of change the Lab proposes.
ALTER TABLE "ExperimentArm" ADD CONSTRAINT "ExperimentArm_label_check" CHECK ("label" IN ('A', 'B', 'C'));
ALTER TABLE "ExperimentArm" ADD CONSTRAINT "ExperimentArm_kind_check" CHECK ("kind" IN ('original', 'opening', 'ask', 'closing', 'shorter'));
-- A running experiment has no end and keeps nothing; an ended one has both.
ALTER TABLE "TemplateExperiment" ADD CONSTRAINT "TemplateExperiment_ended_check" CHECK (
  ("status" = 'RUNNING' AND "endedAt" IS NULL AND "keptTemplateId" IS NULL)
  OR ("status" = 'ENDED' AND "endedAt" IS NOT NULL AND "keptTemplateId" IS NOT NULL)
);

-- One RUNNING experiment per workspace (student orgs send too few emails to split them further).
-- A partial index, which Prisma's schema can't express: `prisma migrate diff` ignores it.
-- The app also checks under the workspace's advisory lock (lib/template-lab/lab.ts).
CREATE UNIQUE INDEX "TemplateExperiment_one_running_key" ON "TemplateExperiment"("workspaceId") WHERE "status" = 'RUNNING';

-- =============================================================================================
-- Grants and row-level security (hand-written; rule 1.11 allows raw SQL in migrations).
-- The default privileges from tenant_rls already give app_user these rights; granting them here
-- too keeps this migration correct on its own.
-- =============================================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON "ScorecardNarrative", "TemplateExperiment", "ExperimentArm" TO app_user;

-- The explanation is the workspace's: any member may write it (any member can press the button)
-- and every member reads it. Same shape as the other tenant tables.
ALTER TABLE "ScorecardNarrative" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScorecardNarrative" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ScorecardNarrative"
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace()));

-- Experiments and their arms: every member reads them (the picker and the stats page show them),
-- only owners start, change or end one, and the database checks that too. Same shape as
-- ResearchSource (private.is_owner_of_current_workspace comes from the research_agent migration).
ALTER TABLE "TemplateExperiment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TemplateExperiment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "TemplateExperiment" FOR SELECT
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()));
CREATE POLICY owner_insert ON "TemplateExperiment" FOR INSERT
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_owner_of_current_workspace()));
CREATE POLICY owner_update ON "TemplateExperiment" FOR UPDATE
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_owner_of_current_workspace()))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_owner_of_current_workspace()));
CREATE POLICY owner_delete ON "TemplateExperiment" FOR DELETE
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_owner_of_current_workspace()));

ALTER TABLE "ExperimentArm" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExperimentArm" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "ExperimentArm" FOR SELECT
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()));
CREATE POLICY owner_insert ON "ExperimentArm" FOR INSERT
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_owner_of_current_workspace()));
CREATE POLICY owner_update ON "ExperimentArm" FOR UPDATE
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_owner_of_current_workspace()))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_owner_of_current_workspace()));
CREATE POLICY owner_delete ON "ExperimentArm" FOR DELETE
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_owner_of_current_workspace()));
