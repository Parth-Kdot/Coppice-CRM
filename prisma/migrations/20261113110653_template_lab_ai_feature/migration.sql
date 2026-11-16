-- AI feature 7 (the Template Lab): one more AI call type, for proposing one-change variants of a
-- template. Its own migration, like every new enum value: Postgres can't use a new enum value in
-- the transaction that adds it. IF NOT EXISTS keeps this safe to apply in any order.

ALTER TYPE "AiFeature" ADD VALUE IF NOT EXISTS 'TEMPLATE_LAB';
