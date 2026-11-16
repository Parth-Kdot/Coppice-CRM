import type { Stage } from "@/generated/prisma/enums";
import {
  claimClosed,
  claimTaken,
  followUpClosed,
  followUpHeld,
  LOG_NEEDS_CLAIM,
  logClosed,
  logHeld,
  NOT_YOURS_TO_RELEASE,
  OWNERS_FORCE_RELEASE,
  stageHeld,
} from "@/lib/claim-messages";
import { STAGE_LABELS, STAGES, TERMINAL_STAGES } from "@/lib/stages";

// Which of the five things Ask Coppice can propose are legal for this person, on this company, right
// now. Pure: the company's state, the person's role and the database's clock go in, the answer comes
// out. The rules are the app's own (lib/claims.ts): a live claim by someone else blocks logging, a
// follow-up change and (for officers) a stage move; an owner may move a stage past a claim and
// force-release it, but nobody except the holder logs outreach or changes a follow-up; Committed and
// Declined end the pitch, so they can't be claimed, logged on or rescheduled, and moving into or out
// of them asks first. An illegal move carries the reason in the app's own words
// (lib/claim-messages.ts, which tests/copilot-moves.test.ts checks against the real actions).
// Every confirm still goes through the existing server action, which checks again.

export const MOVE_TYPES = ["CLAIM", "RELEASE", "LOG", "MOVE_STAGE", "SET_FOLLOW_UP"] as const;
export type MoveType = (typeof MOVE_TYPES)[number];

// The company as the database holds it. `holder*` is the claim; whether it is live is worked out
// against `now`, the database clock, here.
export type CompanyState = {
  stage: Stage;
  archived: boolean;
  holderId: string | null;
  holderName: string | null;
  holdEndsAt: Date | null;
};
export type Actor = { userId: string; role: "owner" | "member" };

export type Move = {
  type: MoveType;
  legal: boolean;
  // Why not, when it isn't legal.
  reason: string | null;
  // RELEASE only: an owner clearing someone else's claim (the forceRelease action, not releaseClaim).
  force: boolean;
};
export type LegalMoves = Record<MoveType, Move>;

export const MOVE_LABELS: Record<MoveType, string> = {
  CLAIM: "Claim",
  RELEASE: "Release",
  LOG: "Log outreach",
  MOVE_STAGE: "Move stage",
  SET_FOLLOW_UP: "Set follow-up",
};
export const FORCE_RELEASE_LABEL = "Force release";

const ARCHIVED = "This company is archived.";

// The line of a pitch, as the stage control on the company page ranks it: Declined sits after
// everything, so leaving it is a reopen.
const RANK: Record<Stage, number> = { NOT_CONTACTED: 0, CONTACTED: 1, REPLIED: 2, IN_CONVERSATION: 3, COMMITTED: 4, DECLINED: 5 };

// What kind of confirmation the app asks before this move: into Committed or Declined (closes the
// pitch and releases any claim), out of one of them (a reopen), or backwards. null: it moves at once.
export type StageConfirm = "closes" | "reopens" | "back";
export function stageConfirm(from: Stage, to: Stage): StageConfirm | null {
  if (TERMINAL_STAGES.includes(to)) return "closes";
  if (RANK[to] < RANK[from]) return TERMINAL_STAGES.includes(from) ? "reopens" : "back";
  return null;
}

const ok = (type: MoveType, force = false): Move => ({ type, legal: true, reason: null, force });
const no = (type: MoveType, reason: string): Move => ({ type, legal: false, reason, force: false });

export function legalMoves(company: CompanyState, actor: Actor, now: Date): LegalMoves {
  if (company.archived) {
    return Object.fromEntries(MOVE_TYPES.map((type) => [type, no(type, ARCHIVED)])) as LegalMoves;
  }
  const mine = company.holderId === actor.userId;
  const live = company.holderId !== null && company.holdEndsAt !== null && company.holdEndsAt > now;
  const othersLive = live && !mine;
  const closed = TERMINAL_STAGES.includes(company.stage);
  const ends = company.holdEndsAt as Date;

  const claim: Move = closed
    ? no("CLAIM", claimClosed(company.stage))
    : othersLive
      ? no("CLAIM", claimTaken(company.holderName, ends))
      : ok("CLAIM");

  // Release works on your own claim, live or not. An owner can clear someone else's live claim.
  const release: Move = mine
    ? ok("RELEASE")
    : othersLive
      ? actor.role === "owner"
        ? ok("RELEASE", true)
        : no("RELEASE", OWNERS_FORCE_RELEASE)
      : no("RELEASE", NOT_YOURS_TO_RELEASE);

  // Logging needs your own claim (renewed by logging, so an expired one of yours still works).
  const log: Move = closed ? no("LOG", logClosed(company.stage)) : mine ? ok("LOG") : othersLive ? no("LOG", logHeld(company.holderName, ends)) : no("LOG", LOG_NEEDS_CLAIM);

  const move: Move = othersLive && actor.role !== "owner" ? no("MOVE_STAGE", stageHeld(company.holderName, ends)) : ok("MOVE_STAGE");

  const followUp: Move = closed
    ? no("SET_FOLLOW_UP", followUpClosed(company.stage))
    : othersLive
      ? no("SET_FOLLOW_UP", followUpHeld(company.holderName, ends))
      : ok("SET_FOLLOW_UP");

  return { CLAIM: claim, RELEASE: release, LOG: log, MOVE_STAGE: move, SET_FOLLOW_UP: followUp };
}

// The stages a company can move to from where it is (every other stage), each with the confirmation
// the app asks first, if any. Empty when the stage move itself is illegal.
export function stageChoices(company: CompanyState, moves: LegalMoves): { stage: Stage; label: string; confirm: StageConfirm | null }[] {
  if (!moves.MOVE_STAGE.legal) return [];
  return STAGES.filter((stage) => stage !== company.stage).map((stage) => ({ stage, label: STAGE_LABELS[stage], confirm: stageConfirm(company.stage, stage) }));
}

// The one move shown beside a company in a list. `due` says the company's follow-up date has
// arrived or isn't set. A company you hold is for logging; one nobody holds is for claiming; one
// someone else holds shows Claim disabled with the reason (an owner can force-release it from the
// company's card); a closed or archived one has no next move.
export type NextMove = Move & { label: string };
export function nextBestMove(company: CompanyState, actor: Actor, now: Date): NextMove | null {
  if (company.archived || TERMINAL_STAGES.includes(company.stage)) return null;
  const moves = legalMoves(company, actor, now);
  const pick = moves.LOG.legal ? moves.LOG : moves.CLAIM;
  return { ...pick, label: MOVE_LABELS[pick.type] };
}
