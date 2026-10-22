-- Every workspace must keep at least one owner.
--
-- Better Auth already refuses to demote, remove or let the last owner leave, but it checks
-- by reading first and writing after. Two owners demoting themselves at the same moment can
-- both pass that check and leave the workspace with no owner. This trigger runs inside the
-- write itself, so it can't be raced.
--
-- How it avoids the race: it locks the workspace row before counting owners. A second,
-- simultaneous change to the same workspace waits for the first to commit, then counts
-- again and sees the result. FOR NO KEY UPDATE is the lightest lock that does this; it does
-- not block people joining the workspace at the same time.

CREATE FUNCTION membership_keep_an_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Only losing an owner can leave a workspace without one. Roles can be a comma-separated
  -- list in Better Auth, so check the list, not the whole string.
  IF NOT ('owner' = ANY (string_to_array(OLD.role, ','))) THEN
    RETURN NULL;
  END IF;

  -- If the workspace itself is being deleted, its memberships go with it; nothing to protect.
  PERFORM 1 FROM workspace WHERE id = OLD."workspaceId" FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM membership
    WHERE "workspaceId" = OLD."workspaceId" AND 'owner' = ANY (string_to_array(role, ','))
  ) THEN
    -- lib/actions.ts matches this exact message to show it to the user.
    RAISE EXCEPTION 'A workspace must keep at least one owner.';
  END IF;

  RETURN NULL;
END
$$;

CREATE TRIGGER membership_keep_an_owner
AFTER UPDATE OF role OR DELETE ON membership
FOR EACH ROW EXECUTE FUNCTION membership_keep_an_owner();
