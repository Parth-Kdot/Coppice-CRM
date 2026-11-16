-- Additive. "Hide" on the basics is remembered: basicsHiddenAt is set when a person hides the coach
-- card, so later page loads show only the small Resume pill, and cleared when they resume.
-- Existing members are not backfilled: everyone, including people who were members before the
-- tours shipped, takes the basics once (owner decision).

ALTER TABLE "OnboardingProgress" ADD COLUMN "basicsHiddenAt" TIMESTAMPTZ(3);
