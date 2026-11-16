-- MCP: what assistants changed. One row for each change an assistant makes through the MCP server,
-- so every member of a workspace can see it in Settings. Additive only: one new table, nothing
-- existing changes. No free text is stored: "tool" and "action" say what happened, and the names
-- shown are read from the company or target when the list is drawn. "clientId" is the OAuth
-- client and has no foreign key on purpose, so disconnecting an assistant keeps its history.

-- CreateTable
CREATE TABLE "AssistantActivity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT,
    "tool" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "companyId" TEXT,
    "targetId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantActivity_workspaceId_createdAt_idx" ON "AssistantActivity"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AssistantActivity_companyId_idx" ON "AssistantActivity"("companyId");

-- CreateIndex
CREATE INDEX "AssistantActivity_userId_idx" ON "AssistantActivity"("userId");

-- AddForeignKey
ALTER TABLE "AssistantActivity" ADD CONSTRAINT "AssistantActivity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantActivity" ADD CONSTRAINT "AssistantActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantActivity" ADD CONSTRAINT "AssistantActivity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- What the tool did, from a fixed list, so a row can never hold free text. The Settings line is
-- built from the pair (tool, action) by one table in lib/mcp/tools/shared.ts, which a test keeps
-- equal to this list. A new key needs a new migration.
ALTER TABLE "AssistantActivity" ADD CONSTRAINT "AssistantActivity_action_check" CHECK ("action" IN (
  'added', 'updated', 'archived', 'unarchived', 'claimed', 'released', 'force_released', 'logged',
  'replied', 'follow_up_set', 'stage_changed', 'kept_separate', 'archived_duplicate',
  'deleted_contact', 'deleted_fact', 'deleted_fact_sheet', 'verified', 'unverified', 'started',
  'ended', 'departing_set', 'departing_cleared', 'claims_released', 'cards_built', 'card_reviewed',
  'cards_approved', 'dates_saved', 'dates_filled', 'calendar_applied', 'reopened', 'published',
  'unpublished', 'imported', 'done'
));
-- Tool names and ids are short; the caps keep a row small whatever a caller sends.
ALTER TABLE "AssistantActivity" ADD CONSTRAINT "AssistantActivity_lengths_check" CHECK (
  length("tool") BETWEEN 1 AND 64 AND length("clientId") <= 512 AND length("targetId") <= 64
);

-- =============================================================================================
-- Grants and row-level security (hand-written; rule 1.11 allows raw SQL in migrations).
-- The default privileges from tenant_rls give app_user all four rights on a new table; this log
-- is add-only, so update and delete are taken away again and no policy allows them either.
-- Every member of the workspace can read the rows. A row can only be added by the member it is
-- about (userId is the signed-in person), and its company, when set, must be in the same workspace
-- (the company link is a plain key so a deleted company can clear it, so the policy checks it).
-- Deleting a workspace or a person's company still clears the rows through the foreign keys.
-- =============================================================================================
GRANT SELECT, INSERT ON "AssistantActivity" TO app_user;
REVOKE UPDATE, DELETE ON "AssistantActivity" FROM app_user;

ALTER TABLE "AssistantActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssistantActivity" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "AssistantActivity" FOR SELECT
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()));
CREATE POLICY member_insert ON "AssistantActivity" FOR INSERT
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace())
              AND "userId" = (SELECT current_setting('app.user_id', true))
              AND ("companyId" IS NULL OR EXISTS (
                SELECT 1 FROM public."Company" c
                WHERE c.id = "AssistantActivity"."companyId" AND c."workspaceId" = "AssistantActivity"."workspaceId"
              )));
