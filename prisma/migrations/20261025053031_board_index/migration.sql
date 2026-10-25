-- The board reads one stage at a time per workspace, sorted by follow-up date. This index matches
-- that filter and sort, so a column reads its first 50 rows in order instead of sorting them all.
-- CreateIndex
CREATE INDEX "Company_workspaceId_stage_nextFollowUpAt_idx" ON "Company"("workspaceId", "stage", "nextFollowUpAt");
