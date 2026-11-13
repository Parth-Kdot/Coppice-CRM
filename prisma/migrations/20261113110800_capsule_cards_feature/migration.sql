-- Time Capsule: a new AI call type, for reading relationship cards from a company's notes. Only
-- the enum value lives here: Postgres can't use a new enum value in the same transaction that adds
-- it. IF NOT EXISTS keeps this safe to apply in any order next to other migrations that add their
-- own AiFeature values.

ALTER TYPE "AiFeature" ADD VALUE IF NOT EXISTS 'CAPSULE_CARDS';
