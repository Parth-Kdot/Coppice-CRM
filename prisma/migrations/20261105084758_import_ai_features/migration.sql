-- Smart import (AI feature 3): one AiFeature value per AI call it makes. Enum values only, in a
-- migration of their own: Postgres can't use a new enum value in the transaction that adds it.
-- IF NOT EXISTS keeps this valid whatever order other branches' migrations merge in.
ALTER TYPE "AiFeature" ADD VALUE IF NOT EXISTS 'IMPORT_MAPPING';
ALTER TYPE "AiFeature" ADD VALUE IF NOT EXISTS 'IMPORT_LOOKALIKES';
ALTER TYPE "AiFeature" ADD VALUE IF NOT EXISTS 'IMPORT_ROWS';
