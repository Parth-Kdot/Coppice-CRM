-- AI feature 2 (the Research Agent): two new AI call types, one for reading the fetched pages and
-- one for writing the brief from what was read. Only the enum values live here: Postgres can't use
-- a new enum value in the same transaction that adds it. IF NOT EXISTS keeps this safe to apply
-- in any order next to other migrations that add their own AiFeature values.

ALTER TYPE "AiFeature" ADD VALUE IF NOT EXISTS 'RESEARCH_READ';
ALTER TYPE "AiFeature" ADD VALUE IF NOT EXISTS 'RESEARCH_BRIEF';
