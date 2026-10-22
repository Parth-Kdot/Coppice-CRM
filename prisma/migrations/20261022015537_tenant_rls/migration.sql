-- CreateEnum
CREATE TYPE "Stage" AS ENUM ('NOT_CONTACTED', 'CONTACTED', 'REPLIED', 'IN_CONVERSATION', 'COMMITTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('EMAIL', 'LINKEDIN', 'IN_PERSON', 'OTHER');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "stage" "Stage" NOT NULL DEFAULT 'NOT_CONTACTED',
    "nextFollowUpAt" TIMESTAMPTZ(3),
    "lastContactedAt" TIMESTAMPTZ(3),
    "claimedById" TEXT,
    "claimExpiresAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "title" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outreach" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "templateId" TEXT,
    "channel" "Channel" NOT NULL DEFAULT 'EMAIL',
    "sentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "gotReply" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Outreach_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Company_workspaceId_nextFollowUpAt_idx" ON "Company"("workspaceId", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "Company_workspaceId_name_idx" ON "Company"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "Company_claimedById_idx" ON "Company"("claimedById");

-- CreateIndex
CREATE UNIQUE INDEX "Company_id_workspaceId_key" ON "Company"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "Contact_companyId_workspaceId_idx" ON "Contact"("companyId", "workspaceId");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_idx" ON "Contact"("workspaceId");

-- CreateIndex
CREATE INDEX "Template_workspaceId_idx" ON "Template"("workspaceId");

-- CreateIndex
CREATE INDEX "Outreach_workspaceId_templateId_idx" ON "Outreach"("workspaceId", "templateId");

-- CreateIndex
CREATE INDEX "Outreach_companyId_workspaceId_idx" ON "Outreach"("companyId", "workspaceId");

-- CreateIndex
CREATE INDEX "Outreach_senderId_idx" ON "Outreach"("senderId");

-- CreateIndex
CREATE INDEX "Outreach_templateId_idx" ON "Outreach"("templateId");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_companyId_workspaceId_fkey" FOREIGN KEY ("companyId", "workspaceId") REFERENCES "Company"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outreach" ADD CONSTRAINT "Outreach_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outreach" ADD CONSTRAINT "Outreach_companyId_workspaceId_fkey" FOREIGN KEY ("companyId", "workspaceId") REFERENCES "Company"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outreach" ADD CONSTRAINT "Outreach_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outreach" ADD CONSTRAINT "Outreach_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================================
-- Row-level security. Everything below is hand-written (rule 1.11 allows raw SQL in migrations).
--
-- How it fits together:
--   1. The app connects as app_user, a login role that can read and write rows but can't skip
--      row-level security or change table structure. Migrations keep using the owner role.
--   2. lib/db.ts withTenant() sets app.user_id and app.workspace_id for one transaction.
--   3. Each tenant table's policy shows a row only if its workspaceId is that workspace AND
--      that user is a member of it. If nothing was set, no rows match: it fails closed.
-- =============================================================================================

-- 1. The runtime role. Roles belong to the whole Postgres server (the dev and test databases
-- share it), so only create it if it isn't there yet. No password here: each environment sets
-- its own (tests/global-setup.ts locally and in CI, the Supabase dashboard in production).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- Read and write rows only: no TRUNCATE, no DDL. Better Auth's tables need this too, since the
-- app runs as app_user for everything.
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
-- Prisma's migration history is none of the app's business. (Prisma's temporary "shadow"
-- database used by migrate dev has no history table, hence the check.)
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE public."_prisma_migrations" FROM app_user;
  END IF;
END
$$;
-- Tables created by later migrations get the same rights automatically (but still need their
-- own policies).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- 2. Supabase exposes the public schema to its own anon and authenticated roles through its
-- Data API. We don't use that API (it is switched off), but in case it's ever turned back on,
-- those roles get nothing. Local Postgres and CI don't have these roles, so this is skipped there.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END
$$;

-- 3. "Is the current user a member of the current workspace?" Kept in a private schema that only
-- app_user can use. search_path is pinned so nobody can swap in a fake membership table.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO app_user;

CREATE FUNCTION private.is_member_of_current_workspace() RETURNS boolean
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.membership m
    WHERE m."workspaceId" = current_setting('app.workspace_id', true)
      AND m."userId" = current_setting('app.user_id', true)
  );
$$;
REVOKE ALL ON FUNCTION private.is_member_of_current_workspace() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_member_of_current_workspace() TO app_user;

-- 4. One policy per tenant table, for every command and every role. FORCE makes it apply to the
-- table owner too. The (SELECT ...) wrappers let Postgres work each check out once per query
-- instead of once per row.
ALTER TABLE "Company" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Company" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Company"
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace()));

ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Contact"
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace()));

ALTER TABLE "Template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Template" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Template"
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace()));

-- Outreach also checks that its template belongs to the same workspace. (The company is already
-- guaranteed by the (companyId, workspaceId) foreign key; Prisma can't express that kind of key
-- for an optional template, so the policy does it.)
ALTER TABLE "Outreach" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Outreach" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Outreach"
  USING ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
         AND (SELECT private.is_member_of_current_workspace()))
  WITH CHECK ("workspaceId" = (SELECT current_setting('app.workspace_id', true))
              AND (SELECT private.is_member_of_current_workspace())
              AND ("templateId" IS NULL OR EXISTS (
                SELECT 1 FROM public."Template" t
                WHERE t.id = "Outreach"."templateId" AND t."workspaceId" = "Outreach"."workspaceId"
              )));
