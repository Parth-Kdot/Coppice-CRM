-- Previous versions: the value a company or contact field held before its latest change, kept for
-- one hour so it can be restored. Additive only: one new enum, one new table, and a unique index on
-- "Contact"("id", "companyId", "workspaceId") so the new table can point at a contact together with
-- its company and workspace, which keeps a slot from naming a contact of another company.
-- Nothing existing changes.

/*
  Warnings:

  - A unique constraint covering the columns `[id,companyId,workspaceId]` on the table `Contact` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "VersionField" AS ENUM ('NAME', 'INDUSTRY', 'WEBSITE', 'NOTES', 'EMAIL', 'TITLE');

-- CreateTable
CREATE TABLE "PreviousVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "subjectId" TEXT NOT NULL,
    "field" "VersionField" NOT NULL,
    "value" TEXT,
    "replacedById" TEXT NOT NULL,
    "via" "Via" NOT NULL DEFAULT 'APP',
    "replacedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT statement_timestamp(),

    CONSTRAINT "PreviousVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PreviousVersion_workspaceId_companyId_replacedAt_idx" ON "PreviousVersion"("workspaceId", "companyId", "replacedAt");

-- CreateIndex
CREATE INDEX "PreviousVersion_replacedAt_idx" ON "PreviousVersion"("replacedAt");

-- CreateIndex
CREATE INDEX "PreviousVersion_contactId_companyId_workspaceId_idx" ON "PreviousVersion"("contactId", "companyId", "workspaceId");

-- CreateIndex
CREATE INDEX "PreviousVersion_replacedById_idx" ON "PreviousVersion"("replacedById");

-- CreateIndex
CREATE UNIQUE INDEX "PreviousVersion_subjectId_field_key" ON "PreviousVersion"("subjectId", "field");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_id_companyId_workspaceId_key" ON "Contact"("id", "companyId", "workspaceId");

-- AddForeignKey
ALTER TABLE "PreviousVersion" ADD CONSTRAINT "PreviousVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreviousVersion" ADD CONSTRAINT "PreviousVersion_companyId_workspaceId_fkey" FOREIGN KEY ("companyId", "workspaceId") REFERENCES "Company"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreviousVersion" ADD CONSTRAINT "PreviousVersion_contactId_companyId_workspaceId_fkey" FOREIGN KEY ("contactId", "companyId", "workspaceId") REFERENCES "Contact"("id", "companyId", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreviousVersion" ADD CONSTRAINT "PreviousVersion_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================================
-- Hand-written (rule 1.11 allows raw SQL in migrations).
-- =============================================================================================

-- A slot is a company field (no contact, the subject is the company) or a contact field (the
-- subject is the contact), and only of the fields Coppice keeps previous versions of.
ALTER TABLE "PreviousVersion" ADD CONSTRAINT "PreviousVersion_subject_check" CHECK (
  ("contactId" IS NULL AND "subjectId" = "companyId" AND "field" IN ('NAME', 'INDUSTRY', 'WEBSITE', 'NOTES'))
  OR ("contactId" IS NOT NULL AND "subjectId" = "contactId" AND "field" IN ('NAME', 'EMAIL', 'TITLE'))
);

-- The database stamps every slot, so no caller can make one live longer (or shorter) than an hour
-- from the moment of the change. statement_timestamp() is the moment of the INSERT itself, where the
-- column default now() would be the start of the edit's transaction.
CREATE FUNCTION private.previous_version_stamp() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW."replacedAt" := statement_timestamp();
  RETURN NEW;
END
$$;
CREATE TRIGGER previous_version_stamp BEFORE INSERT ON public."PreviousVersion"
FOR EACH ROW EXECUTE FUNCTION private.previous_version_stamp();

-- Grants. The default privileges from tenant_rls give app_user all four rights on a new table. A
-- slot is only ever added or deleted (an overwrite deletes the old row and adds a new one), so
-- update is taken away: nothing in the app can change the value of a slot, and the trigger above
-- sets the time on every insert, so nothing can make a slot live longer either.
GRANT SELECT, INSERT, DELETE ON "PreviousVersion" TO app_user;
REVOKE UPDATE ON "PreviousVersion" FROM app_user;

-- Row-level security, shaped like the other tenant tables: every member of the workspace reads its
-- slots (they show what any member sees on the company page), a member adds a slot only as
-- themselves, and any member may delete one (an edit by anyone overwrites the slot of that field).
ALTER TABLE "PreviousVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PreviousVersion" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "PreviousVersion" FOR SELECT
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()));
CREATE POLICY member_insert ON "PreviousVersion" FOR INSERT
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace())
              AND "replacedById" = (SELECT current_setting('app.user_id', true)));
CREATE POLICY member_delete ON "PreviousVersion" FOR DELETE
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()));

-- The cleanup. One function deletes slots replaced more than an hour ago, in every workspace, and
-- can delete nothing else. It runs as the role that ran this migration (SECURITY DEFINER), so it
-- needs no workspace or user: the app calls it after every edit and page read of this feature, and
-- the daily cron route (app/api/cron/purge-previous-versions) calls it too. Anyone allowed to call
-- it can only make Coppice delete what it would delete anyway. Rows another transaction holds are
-- skipped (SKIP LOCKED), so a cleanup never waits on an edit or deadlocks with one; they are caught
-- next time. At most 1000 rows a call (PURGE_BATCH in lib/db.ts); the cron route calls again while
-- a call deletes a full batch.
--
-- The migration role on Supabase (postgres) may or may not bypass row-level security. So that the
-- function works either way, this policy lets that one role, and no other, see and lock expired rows
-- (the function's SELECT ... FOR UPDATE needs the SELECT and UPDATE policies, its DELETE the DELETE
-- policy). app_user never matches it, so the app still sees only its own workspace's rows.
CREATE POLICY owner_purge_expired ON "PreviousVersion" FOR ALL TO CURRENT_USER
  USING ("replacedAt" <= now() - interval '1 hour')
  WITH CHECK (false);

CREATE FUNCTION private.purge_expired_previous_versions() RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
  WITH expired AS (
    SELECT p.id FROM public."PreviousVersion" p
    WHERE p."replacedAt" <= now() - interval '1 hour'
    ORDER BY p."replacedAt", p.id
    LIMIT 1000
    FOR UPDATE SKIP LOCKED
  ), gone AS (
    DELETE FROM public."PreviousVersion" d
    USING expired
    WHERE d.id = expired.id AND d."replacedAt" <= now() - interval '1 hour'
    RETURNING 1
  )
  SELECT count(*)::integer FROM gone;
$$;
REVOKE ALL ON FUNCTION private.purge_expired_previous_versions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.purge_expired_previous_versions() TO app_user;
