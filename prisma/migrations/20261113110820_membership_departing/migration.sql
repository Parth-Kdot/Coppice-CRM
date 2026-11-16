-- Time Capsule: when an owner marks a member as leaving at the next turnover. Additive: one
-- nullable column on Better Auth's member table (named "membership" here), no default and no
-- backfill, so every existing member reads as not departing. The keep-an-owner trigger fires only
-- on a change to role or a delete, so setting this never touches it. No grant or policy change:
-- membership has no row-level security (the app checks it in lib/authz.ts) and app_user already
-- holds table-level rights, which cover a new column.

ALTER TABLE "membership" ADD COLUMN     "departingAt" TIMESTAMPTZ(3);
