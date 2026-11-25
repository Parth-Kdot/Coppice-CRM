-- The Monday brief (Ask Coppice, AI feature 6): one row per workspace per week, shared by every
-- member. Additive only: one new enum type and one new tenant table with row-level security
-- (bottom of this file). The AI call type it uses (WEEKLY_BRIEF) was added by the migration before
-- this one, and nothing here uses it.

-- CreateEnum
CREATE TYPE "WeeklyBriefStatus" AS ENUM ('WRITING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "WeeklyBrief" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "status" "WeeklyBriefStatus" NOT NULL,
    "facts" JSONB,
    "paragraphs" JSONB,
    "droppedSentences" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedById" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "writtenAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyBrief_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyBrief_startedById_idx" ON "WeeklyBrief"("startedById");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyBrief_workspaceId_weekStart_key" ON "WeeklyBrief"("workspaceId", "weekStart");

-- AddForeignKey
ALTER TABLE "WeeklyBrief" ADD CONSTRAINT "WeeklyBrief_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyBrief" ADD CONSTRAINT "WeeklyBrief_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- What a row may hold. A week starts on a calendar date; a READY row has its facts and paragraphs
-- and no error; a FAILED row keeps one short error code and nothing the model wrote.
ALTER TABLE "WeeklyBrief" ADD CONSTRAINT "WeeklyBrief_weekStart_check" CHECK ("weekStart" ~ '^\d{4}-\d{2}-\d{2}$');
ALTER TABLE "WeeklyBrief" ADD CONSTRAINT "WeeklyBrief_attempts_check" CHECK ("attempts" BETWEEN 0 AND 10);
ALTER TABLE "WeeklyBrief" ADD CONSTRAINT "WeeklyBrief_ready_check" CHECK (
  "status" <> 'READY' OR ("facts" IS NOT NULL AND "paragraphs" IS NOT NULL AND "error" IS NULL)
);
ALTER TABLE "WeeklyBrief" ADD CONSTRAINT "WeeklyBrief_failed_check" CHECK (
  "status" <> 'FAILED' OR "error" IN ('rate_limited', 'timeout', 'unavailable', 'truncated', 'invalid_output', 'broke_rules', 'bad_key', 'blocked', 'rejected', 'not_configured', 'refused')
);
ALTER TABLE "WeeklyBrief" ADD CONSTRAINT "WeeklyBrief_paragraphs_check" CHECK ("paragraphs" IS NULL OR jsonb_typeof("paragraphs") = 'array');

-- =============================================================================================
-- Grants and row-level security (hand-written; rule 1.11 allows raw SQL in migrations).
-- The default privileges from tenant_rls already give app_user these rights; granting them here
-- too keeps this migration correct on its own.
-- =============================================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON "WeeklyBrief" TO app_user;

-- The brief is the workspace's: any member's queue view may start it, and every member reads it.
-- Same shape as ScorecardNarrative, with no condition on who started it.
ALTER TABLE "WeeklyBrief" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WeeklyBrief" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WeeklyBrief"
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace()));
