-- Smart import (AI feature 3): staging for an import read a chunk at a time. Nothing here is a
-- company or contact; the final import writes those in one transaction and deletes the session.
-- Both tables are tenant data with row-level security (bottom of this file).

-- CreateTable
CREATE TABLE "ImportSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "freeText" JSONB NOT NULL,
    "rows" JSONB NOT NULL,
    "cycleStart" INTEGER NOT NULL,
    "chunkCount" INTEGER NOT NULL,
    "lookalikes" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportChunk" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "proposals" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportSession_workspaceId_createdAt_idx" ON "ImportSession"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportSession_createdById_idx" ON "ImportSession"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "ImportSession_id_workspaceId_key" ON "ImportSession"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "ImportChunk_sessionId_workspaceId_idx" ON "ImportChunk"("sessionId", "workspaceId");

-- CreateIndex
CREATE INDEX "ImportChunk_workspaceId_idx" ON "ImportChunk"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportChunk_sessionId_index_key" ON "ImportChunk"("sessionId", "index");

-- AddForeignKey
ALTER TABLE "ImportSession" ADD CONSTRAINT "ImportSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportSession" ADD CONSTRAINT "ImportSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportChunk" ADD CONSTRAINT "ImportChunk_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportChunk" ADD CONSTRAINT "ImportChunk_sessionId_workspaceId_fkey" FOREIGN KEY ("sessionId", "workspaceId") REFERENCES "ImportSession"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;


-- =============================================================================================
-- Grants and row-level security (hand-written; rule 1.11 allows raw SQL in migrations).
-- The default privileges from tenant_rls already give app_user these rights; granting them here
-- too keeps this migration correct on its own.
-- A session holds cell text from someone's sheet (which can include names), so beyond the usual
-- tenant policy only the member who started it can see it or its chunks.
-- =============================================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON "ImportSession", "ImportChunk" TO app_user;

ALTER TABLE "ImportSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportSession" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ImportSession"
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace())
         AND "createdById" = (SELECT current_setting('app.user_id', true)))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace())
              AND "createdById" = (SELECT current_setting('app.user_id', true)));

-- A chunk belongs to a session of the same workspace (composite foreign key) that the current
-- member started (the policy, since the session's own policy hides everyone else's).
ALTER TABLE "ImportChunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportChunk" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ImportChunk"
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace())
         AND EXISTS (SELECT 1 FROM public."ImportSession" s
                     WHERE s.id = "ImportChunk"."sessionId" AND s."workspaceId" = "ImportChunk"."workspaceId"))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace())
              AND EXISTS (SELECT 1 FROM public."ImportSession" s
                          WHERE s.id = "ImportChunk"."sessionId" AND s."workspaceId" = "ImportChunk"."workspaceId"));
