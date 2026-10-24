-- Milestone 2a: duplicate-matching keys on Company, stage history, and "these are separate" decisions.

-- AlterTable. nameKey is added as optional, filled for any existing rows, then made required, so
-- this works even if Company already has data. (lib/duplicates.ts rewrites the key on every save;
-- lower(trim(name)) is a safe starting value. Company was empty everywhere when this was written.)
ALTER TABLE "Company" ADD COLUMN     "domainKey" TEXT,
ADD COLUMN     "nameKey" TEXT;
UPDATE "Company" SET "nameKey" = lower(trim("name")) WHERE "nameKey" IS NULL;
ALTER TABLE "Company" ALTER COLUMN "nameKey" SET NOT NULL;

-- CreateTable
CREATE TABLE "StageChange" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "fromStage" "Stage" NOT NULL,
    "toStage" "Stage" NOT NULL,
    "changedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyPairDecision" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyAId" TEXT NOT NULL,
    "companyBId" TEXT NOT NULL,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyPairDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StageChange_companyId_workspaceId_idx" ON "StageChange"("companyId", "workspaceId");

-- CreateIndex
CREATE INDEX "StageChange_workspaceId_changedAt_idx" ON "StageChange"("workspaceId", "changedAt");

-- CreateIndex
CREATE INDEX "StageChange_changedById_idx" ON "StageChange"("changedById");

-- CreateIndex
CREATE INDEX "CompanyPairDecision_companyAId_workspaceId_idx" ON "CompanyPairDecision"("companyAId", "workspaceId");

-- CreateIndex
CREATE INDEX "CompanyPairDecision_companyBId_workspaceId_idx" ON "CompanyPairDecision"("companyBId", "workspaceId");

-- CreateIndex
CREATE INDEX "CompanyPairDecision_decidedById_idx" ON "CompanyPairDecision"("decidedById");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyPairDecision_workspaceId_companyAId_companyBId_key" ON "CompanyPairDecision"("workspaceId", "companyAId", "companyBId");

-- CreateIndex
CREATE INDEX "Company_workspaceId_nameKey_idx" ON "Company"("workspaceId", "nameKey");

-- CreateIndex
CREATE INDEX "Company_workspaceId_domainKey_idx" ON "Company"("workspaceId", "domainKey");

-- AddForeignKey
ALTER TABLE "StageChange" ADD CONSTRAINT "StageChange_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageChange" ADD CONSTRAINT "StageChange_companyId_workspaceId_fkey" FOREIGN KEY ("companyId", "workspaceId") REFERENCES "Company"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageChange" ADD CONSTRAINT "StageChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPairDecision" ADD CONSTRAINT "CompanyPairDecision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPairDecision" ADD CONSTRAINT "CompanyPairDecision_companyAId_workspaceId_fkey" FOREIGN KEY ("companyAId", "workspaceId") REFERENCES "Company"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPairDecision" ADD CONSTRAINT "CompanyPairDecision_companyBId_workspaceId_fkey" FOREIGN KEY ("companyBId", "workspaceId") REFERENCES "Company"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPairDecision" ADD CONSTRAINT "CompanyPairDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================================
-- Hand-written below (rule 1.11 allows raw SQL in migrations).

-- Each pair is stored once, smaller id first, so (A,B) and (B,A) can't both exist.
ALTER TABLE "CompanyPairDecision"
  ADD CONSTRAINT "CompanyPairDecision_ordered_pair" CHECK ("companyAId" < "companyBId");

-- Row-level security, same policy as the other tenant tables (see tenant_rls): a row is visible and
-- writable only inside withTenant, for the workspace it belongs to, by a member of that workspace.
-- app_user's table grants come from the default privileges set in tenant_rls.
ALTER TABLE "StageChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StageChange" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StageChange"
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace()));

ALTER TABLE "CompanyPairDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyPairDecision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CompanyPairDecision"
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace()));
