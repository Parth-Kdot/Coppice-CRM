-- Time Capsule: a database guard on the leaving mark. Additive: one function and two triggers, no
-- table, column, grant or data change.
--
-- Who is leaving decides whose claims an owner's release gives back, so the mark may only be
-- written by an owner of the workspace the row belongs to. The app checks this in code
-- (lib/capsule/members.ts setDeparting runs inside withTenant after the owner check). This trigger
-- says the same in the database, so a bug or a stray query cannot mark someone in another
-- workspace, or as an officer.
--
-- It fires before an UPDATE that names "departingAt" or "workspaceId", and before an INSERT.
--   A marked row can never move to another workspace.
--   An update that leaves the mark as it was (the same time, or null to null) is allowed, so an
--     unmarked row that moves is not checked here.
--   Any other change of the mark, and an insert that carries one, needs all of: the row stays in
--     its workspace, that workspace is the one the transaction was opened for (app.workspace_id,
--     which withTenant sets), and the person it was opened for (app.user_id) is an owner of it
--     (private.is_owner_of_current_workspace()).
-- Better Auth's role changes and member removals name neither column, and its inserts carry no
-- mark, so they pass, and the keep-an-owner trigger (role or delete) is untouched.
--
-- Do not enable row-level security on membership unless the private helper functions first become
-- SECURITY DEFINER functions owned by a role that bypasses it, and Better Auth's unscoped reads
-- are planned for: the helpers read membership themselves, so a policy on membership that calls
-- them would call itself without end, and Better Auth reads membership with no workspace set.

CREATE FUNCTION public.membership_departing_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."departingAt" IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF OLD."departingAt" IS NOT NULL AND NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId" THEN
      RAISE EXCEPTION 'A member marked as leaving cannot move to another workspace.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW."departingAt" IS NOT DISTINCT FROM OLD."departingAt" THEN
      RETURN NEW;
    END IF;
  END IF;
  IF (TG_OP = 'UPDATE' AND NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId")
     OR NEW."workspaceId" IS DISTINCT FROM current_setting('app.workspace_id', true)
     OR NOT COALESCE(private.is_owner_of_current_workspace(), false) THEN
    RAISE EXCEPTION 'Only an owner of this workspace can change who is leaving.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER membership_departing_guard
BEFORE UPDATE OF "departingAt", "workspaceId" ON public.membership
FOR EACH ROW EXECUTE FUNCTION public.membership_departing_guard();

CREATE TRIGGER membership_departing_guard_insert
BEFORE INSERT ON public.membership
FOR EACH ROW EXECUTE FUNCTION public.membership_departing_guard();
