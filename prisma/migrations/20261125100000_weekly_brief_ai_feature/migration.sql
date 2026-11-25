-- The Monday brief: a new AI call type. Only the enum value lives here, because Postgres can't use
-- a value added in the same transaction; the next migration creates the table that goes with it.
-- IF NOT EXISTS keeps this safe to apply in any order next to other migrations that add their own
-- AiFeature values.

ALTER TYPE "AiFeature" ADD VALUE IF NOT EXISTS 'WEEKLY_BRIEF';
