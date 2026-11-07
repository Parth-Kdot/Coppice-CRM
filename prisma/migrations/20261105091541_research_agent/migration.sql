-- AI feature 2 (the Research Agent): the web pages owners approved for research, the briefs built
-- from them, and the text of each page a brief read. All three are tenant data with the same
-- row-level security as the rest (bottom of this file); approved sources can be changed by owners
-- only, which the database checks too. Additive only: three new tables and one new enum type.

-- CreateEnum
CREATE TYPE "BriefStatus" AS ENUM ('READY', 'NO_PAGES');

-- CreateTable
CREATE TABLE "ResearchSource" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ResearchSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyBrief" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "BriefStatus" NOT NULL,
    "brief" JSONB NOT NULL,
    "accepted" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "model" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyBriefPage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "finalUrl" TEXT,
    "fetchedAt" TIMESTAMPTZ(3),
    "skipReason" TEXT,
    "sha256" TEXT,
    "text" TEXT,
    "injection" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "inboxes" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "CompanyBriefPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchSource_workspaceId_archivedAt_idx" ON "ResearchSource"("workspaceId", "archivedAt");

-- CreateIndex
CREATE INDEX "ResearchSource_addedById_idx" ON "ResearchSource"("addedById");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchSource_id_workspaceId_key" ON "ResearchSource"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "CompanyBrief_companyId_workspaceId_createdAt_idx" ON "CompanyBrief"("companyId", "workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyBrief_workspaceId_idx" ON "CompanyBrief"("workspaceId");

-- CreateIndex
CREATE INDEX "CompanyBrief_createdById_idx" ON "CompanyBrief"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyBrief_id_workspaceId_key" ON "CompanyBrief"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "CompanyBriefPage_briefId_workspaceId_idx" ON "CompanyBriefPage"("briefId", "workspaceId");

-- CreateIndex
CREATE INDEX "CompanyBriefPage_workspaceId_idx" ON "CompanyBriefPage"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyBriefPage_briefId_position_key" ON "CompanyBriefPage"("briefId", "position");

-- AddForeignKey
ALTER TABLE "ResearchSource" ADD CONSTRAINT "ResearchSource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSource" ADD CONSTRAINT "ResearchSource_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyBrief" ADD CONSTRAINT "CompanyBrief_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyBrief" ADD CONSTRAINT "CompanyBrief_companyId_workspaceId_fkey" FOREIGN KEY ("companyId", "workspaceId") REFERENCES "Company"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyBrief" ADD CONSTRAINT "CompanyBrief_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyBriefPage" ADD CONSTRAINT "CompanyBriefPage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyBriefPage" ADD CONSTRAINT "CompanyBriefPage_briefId_workspaceId_fkey" FOREIGN KEY ("briefId", "workspaceId") REFERENCES "CompanyBrief"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================================
-- Grants and row-level security (hand-written; rule 1.11 allows raw SQL in migrations).
-- app_user gets these rights through the default privileges in tenant_rls already; they are
-- granted here as well so the tables never depend on which role ran the migration.
-- =============================================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON "ResearchSource", "CompanyBrief", "CompanyBriefPage" TO app_user;

-- "Is the current user an owner of the current workspace?" Same shape as
-- private.is_member_of_current_workspace(): private schema, pinned search_path, tables named in full.
CREATE OR REPLACE FUNCTION private.is_owner_of_current_workspace() RETURNS boolean
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.membership m
    WHERE m."workspaceId" = current_setting('app.workspace_id', true)
      AND m."userId" = current_setting('app.user_id', true)
      AND m.role = 'owner'
  );
$$;
REVOKE ALL ON FUNCTION private.is_owner_of_current_workspace() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_owner_of_current_workspace() TO app_user;

-- Approved sources decide which hosts the server may fetch, so only owners may add, change or
-- archive one. Every member of the workspace can read them.
ALTER TABLE "ResearchSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ResearchSource" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "ResearchSource" FOR SELECT
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()));
CREATE POLICY owner_insert ON "ResearchSource" FOR INSERT
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_owner_of_current_workspace()));
CREATE POLICY owner_update ON "ResearchSource" FOR UPDATE
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_owner_of_current_workspace()))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_owner_of_current_workspace()));
CREATE POLICY owner_delete ON "ResearchSource" FOR DELETE
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_owner_of_current_workspace()));

-- Briefs and their pages: rows of the current workspace only, and only for its members. (The
-- company and the brief are already tied to the same workspace by composite foreign keys.)
ALTER TABLE "CompanyBrief" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyBrief" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CompanyBrief"
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace()));

ALTER TABLE "CompanyBriefPage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyBriefPage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CompanyBriefPage"
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace()));
