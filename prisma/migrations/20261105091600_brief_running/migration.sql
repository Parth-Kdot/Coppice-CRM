-- Research briefs take their slot in the per-person daily limit before any page is fetched: the
-- row is written as RUNNING first and marked READY, NO_PAGES or FAILED at the end
-- (lib/research/brief.ts), so parallel requests can't all pass the count. Additive only: two new
-- enum values and one index.

-- AlterEnum
ALTER TYPE "BriefStatus" ADD VALUE 'RUNNING';
ALTER TYPE "BriefStatus" ADD VALUE 'FAILED';

-- CreateIndex
CREATE INDEX "CompanyBrief_workspaceId_createdById_createdAt_idx" ON "CompanyBrief"("workspaceId", "createdById", "createdAt");
