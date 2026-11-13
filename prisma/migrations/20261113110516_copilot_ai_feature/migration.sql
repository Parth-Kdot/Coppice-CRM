-- Ask Coppice (AI feature 6): one AiFeature value for its one AI call per question. Enum value only,
-- in a migration of its own: Postgres can't use a new enum value in the transaction that adds it.
-- IF NOT EXISTS keeps this valid whatever order other branches' migrations merge in.
ALTER TYPE "AiFeature" ADD VALUE IF NOT EXISTS 'COPILOT';
