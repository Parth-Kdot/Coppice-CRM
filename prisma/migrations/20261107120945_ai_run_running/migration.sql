-- Additive: an AI call is now written as RUNNING before the model is called (lib/ai/run.ts
-- reserveAi), inside a transaction that holds the workspace's advisory lock and counts first, so
-- calls made at the same moment can't all pass the workspace and per-person limits. It is updated
-- to SUCCEEDED or FAILED once the model answers. No existing row changes.
ALTER TYPE "AiRunStatus" ADD VALUE IF NOT EXISTS 'RUNNING';
