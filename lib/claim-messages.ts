import { day } from "@/lib/dates";
import { STAGE_LABELS } from "@/lib/stages";
import type { Stage } from "@/generated/prisma/enums";

// What a refusal says when a claim, a log, a stage move, a release or a follow-up change can't happen.
// No database here, so lib/copilot/moves.ts can show the same reason on a disabled card before
// anything is tried. The follow-up wordings are the ones lib/claims.ts setFollowUp returns. The
// others are written out here as lib/claims.ts words them (a log's refusals end "Nothing was saved.",
// which a card that was never tried leaves off); tests/copilot-moves.test.ts runs the real actions
// and checks every wording against what they return, so the two cannot drift.

export const claimClosed = (stage: Stage) => `This company is ${STAGE_LABELS[stage]}, so it can't be claimed.`;
export const claimTaken = (holderName: string | null, claimEnds: Date) => `${holderName} claimed this first. They hold it until ${day(claimEnds)}.`;

export const NOT_YOURS_TO_RELEASE = "You don't hold this company.";
export const OWNERS_FORCE_RELEASE = "Only an owner can force-release a claim.";

export const logClosed = (stage: Stage) => `This company is ${STAGE_LABELS[stage]}.`;
export const logHeld = (holderName: string | null, claimEnds: Date) => `${holderName} holds this company now, until ${day(claimEnds)}.`;
export const LOG_NEEDS_CLAIM = "Claim this company before logging outreach.";

export const stageHeld = (holderName: string | null, claimEnds: Date) => `${holderName} holds this company until ${day(claimEnds)}. Ask them, or an owner.`;

export const followUpClosed = (stage: Stage) => `This company is ${STAGE_LABELS[stage]}, so its follow-up can't change.`;
export const followUpHeld = (holderName: string | null, claimEnds: Date) => `${holderName} holds this company until ${day(claimEnds)}.`;
