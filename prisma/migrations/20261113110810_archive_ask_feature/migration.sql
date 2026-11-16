-- Time Capsule: a new AI call type, for Ask the Archive (one answer from past notes). Only the enum
-- value lives here, for the same reason as the one before it. IF NOT EXISTS keeps this safe to
-- apply in any order next to other migrations that add their own AiFeature values.

ALTER TYPE "AiFeature" ADD VALUE IF NOT EXISTS 'ARCHIVE_ASK';
