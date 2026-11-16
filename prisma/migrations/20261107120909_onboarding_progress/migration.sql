-- Onboarding: how far one person has got through the basics tour and the optional AI tour in one
-- workspace. Additive only: one new table, nothing existing changes. No row means "basics not
-- started", so existing members take the basics once on their next visit without a backfill.

-- CreateTable
CREATE TABLE "OnboardingProgress" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "basicsStep" INTEGER NOT NULL DEFAULT 0,
    "basicsDoneAt" TIMESTAMPTZ(3),
    "basicsRole" TEXT,
    "aiStep" INTEGER NOT NULL DEFAULT 0,
    "aiDoneAt" TIMESTAMPTZ(3),
    "aiDismissedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OnboardingProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnboardingProgress_userId_idx" ON "OnboardingProgress"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingProgress_workspaceId_userId_key" ON "OnboardingProgress"("workspaceId", "userId");

-- AddForeignKey
ALTER TABLE "OnboardingProgress" ADD CONSTRAINT "OnboardingProgress_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingProgress" ADD CONSTRAINT "OnboardingProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Steps are indexes into lib/onboarding-steps.ts; the role is the one the basics were finished as.
ALTER TABLE "OnboardingProgress" ADD CONSTRAINT "OnboardingProgress_steps_check" CHECK ("basicsStep" BETWEEN 0 AND 20 AND "aiStep" BETWEEN 0 AND 20);
ALTER TABLE "OnboardingProgress" ADD CONSTRAINT "OnboardingProgress_basicsRole_check" CHECK ("basicsRole" IS NULL OR "basicsRole" IN ('owner', 'member'));


-- =============================================================================================
-- Grants and row-level security (hand-written; rule 1.11 allows raw SQL in migrations).
-- The default privileges from tenant_rls already give app_user these rights; granting them here
-- too keeps this migration correct on its own.
-- A person's progress is their own: beyond the usual tenant policy, only the member it belongs
-- to can see or change it. Owners cannot read or write anyone else's row either.
-- =============================================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON "OnboardingProgress" TO app_user;

ALTER TABLE "OnboardingProgress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnboardingProgress" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OnboardingProgress"
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace())
         AND "userId" = (SELECT current_setting('app.user_id', true)))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace())
              AND "userId" = (SELECT current_setting('app.user_id', true)));
