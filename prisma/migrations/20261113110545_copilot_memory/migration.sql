-- Ask Coppice (AI feature 6): a person's conversations about their pipeline. Additive only: one new
-- enum type and two new tables. Nothing existing changes. The AiFeature value COPILOT is in the
-- migration before this one, because Postgres can't use a new enum value where it is added.
-- Conversations are private to the person: beyond the usual workspace policy, only the member a row
-- belongs to can read or write it (bottom of this file).

-- CreateEnum
CREATE TYPE "CopilotTurnStatus" AS ENUM ('ANSWERED', 'FAILED');

-- CreateTable
CREATE TABLE "CopilotThread" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotTurn" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "intent" JSONB NOT NULL,
    "reply" TEXT NOT NULL,
    "shown" JSONB NOT NULL,
    "status" "CopilotTurnStatus" NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotTurn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CopilotThread_workspaceId_userId_updatedAt_idx" ON "CopilotThread"("workspaceId", "userId", "updatedAt");

-- CreateIndex
CREATE INDEX "CopilotThread_userId_idx" ON "CopilotThread"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CopilotThread_id_workspaceId_key" ON "CopilotThread"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "CopilotTurn_threadId_workspaceId_createdAt_idx" ON "CopilotTurn"("threadId", "workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "CopilotTurn_workspaceId_userId_createdAt_idx" ON "CopilotTurn"("workspaceId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "CopilotTurn_userId_idx" ON "CopilotTurn"("userId");

-- AddForeignKey
ALTER TABLE "CopilotThread" ADD CONSTRAINT "CopilotThread_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotThread" ADD CONSTRAINT "CopilotThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotTurn" ADD CONSTRAINT "CopilotTurn_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotTurn" ADD CONSTRAINT "CopilotTurn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotTurn" ADD CONSTRAINT "CopilotTurn_threadId_workspaceId_fkey" FOREIGN KEY ("threadId", "workspaceId") REFERENCES "CopilotThread"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bounds the app keeps, held by the database as well (lib/copilot/memory.ts writes within them).
ALTER TABLE "CopilotTurn" ADD CONSTRAINT "CopilotTurn_question_check" CHECK (char_length("question") BETWEEN 1 AND 500);
ALTER TABLE "CopilotTurn" ADD CONSTRAINT "CopilotTurn_reply_check" CHECK (char_length("reply") <= 600);
ALTER TABLE "CopilotTurn" ADD CONSTRAINT "CopilotTurn_intent_check" CHECK (jsonb_typeof("intent") = 'object');
ALTER TABLE "CopilotTurn" ADD CONSTRAINT "CopilotTurn_shown_check" CHECK (jsonb_typeof("shown") = 'array' AND jsonb_array_length("shown") <= 25);
-- A failed turn carries a short error code; an answered one never does.
ALTER TABLE "CopilotTurn" ADD CONSTRAINT "CopilotTurn_error_check" CHECK (
  ("status" = 'ANSWERED' AND "error" IS NULL) OR ("status" = 'FAILED' AND "error" IS NOT NULL AND char_length("error") <= 40)
);

-- =============================================================================================
-- Grants and row-level security (hand-written; rule 1.11 allows raw SQL in migrations).
-- The default privileges from tenant_rls already give app_user these rights; granting them here
-- too keeps this migration correct on its own.
-- A conversation is its person's own: the workspace policy AND "userId" = the current user. Owners
-- cannot read or write another member's threads or turns either.
-- =============================================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON "CopilotThread", "CopilotTurn" TO app_user;

ALTER TABLE "CopilotThread" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CopilotThread" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CopilotThread"
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace())
         AND "userId" = (SELECT current_setting('app.user_id', true)))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace())
              AND "userId" = (SELECT current_setting('app.user_id', true)));

-- A turn must also sit in a thread of the same person: the foreign key only ties it to the same
-- workspace, and it does not look through row-level security, so the policy checks it. The thread
-- table's own policy applies inside this check, so only the current user's threads are seen.
ALTER TABLE "CopilotTurn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CopilotTurn" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CopilotTurn"
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace())
         AND "userId" = (SELECT current_setting('app.user_id', true)))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace())
              AND "userId" = (SELECT current_setting('app.user_id', true))
              AND EXISTS (SELECT 1 FROM "CopilotThread" t
                          WHERE t."id" = "CopilotTurn"."threadId" AND t."workspaceId" = "CopilotTurn"."workspaceId"));
