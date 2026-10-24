-- Pin the owner guard's search_path (flagged by Supabase's security advisor).
--
-- Without a fixed search_path, the function looks up "workspace" and "membership" through
-- whatever schemas the calling session has on its path, so a look-alike table placed earlier on
-- that path could stand in for the real one. With search_path = '' the function only sees what it
-- names in full (public.workspace, public.membership). Built-ins like string_to_array still work:
-- Postgres always searches pg_catalog.
--
-- Same logic as the keep_an_owner migration. CREATE OR REPLACE keeps the existing trigger attached,
-- so the guard is never off, even for a moment.

CREATE OR REPLACE FUNCTION public.membership_keep_an_owner() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Only losing an owner can leave a workspace without one. Roles can be a comma-separated
  -- list in Better Auth, so check the list, not the whole string.
  IF NOT ('owner' = ANY (string_to_array(OLD.role, ','))) THEN
    RETURN NULL;
  END IF;

  -- If the workspace itself is being deleted, its memberships go with it; nothing to protect.
  PERFORM 1 FROM public.workspace WHERE id = OLD."workspaceId" FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.membership
    WHERE "workspaceId" = OLD."workspaceId" AND 'owner' = ANY (string_to_array(role, ','))
  ) THEN
    -- lib/actions.ts matches this exact message to show it to the user.
    RAISE EXCEPTION 'A workspace must keep at least one owner.';
  END IF;

  RETURN NULL;
END
$$;
