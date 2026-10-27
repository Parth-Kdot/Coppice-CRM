import { addDaysToIso, addDaysYmd, formatWhen, localYmd, zonedToIso } from "./dates";
import {
  COMPANY_NOT_FOUND,
  asMember,
  companyOf,
  done,
  heldMessage,
  liveClaimByOther,
  mapCompany,
  nextId,
  personName,
  refuse,
  type Step,
} from "./engine-core";
import { claimStateOf } from "./rules";
import { STAGES, STAGE_LABELS, REPLY_STAGES, isTerminalStage } from "./types";
import type { Channel, Company, DemoState, IsoDateTime, Outreach, Stage, StageChange } from "./types";
import { NOTE_MAX, checkChannel, checkNote, isYmd } from "./validation";

// Claims, outreach and stage moves: the rules of lib/claims.ts, as pure commands. Each one takes the
// state and returns the next state with the result the screen shows. A refused command changes
// nothing. The messages are the real app's, word for word.

const closedMessage = (stage: Stage) => `This company is ${STAGE_LABELS[stage]}, so it can't be claimed.`;

// A live claim by someone else blocks this person, unless they are an owner (blockedBy in lib/claims.ts).
function blockedBy(state: DemoState, company: Company, role: "owner" | "member"): string | null {
  if (!liveClaimByOther(state, company) || role === "owner") return null;
  return heldMessage(state, company);
}

// Claims a company for the workspace's claim window. Works when nobody holds it, the claim has
// expired, or you already hold it (which renews it).
export function claimCompany(state: DemoState, ws: string, companyId: string): Step<{ claimExpiresAt: IsoDateTime }> {
  const checked = asMember(state, ws);
  if (!checked.ok) return checked.step;
  const company = companyOf(state, ws, companyId);
  if (!company || company.archivedAt) return refuse(state, COMPANY_NOT_FOUND);
  if (isTerminalStage(company.stage)) return refuse(state, closedMessage(company.stage));
  if (liveClaimByOther(state, company)) {
    return refuse(state, `${personName(state, company.claimedById)} claimed this first. They hold it until ${formatWhen(company.claimExpiresAt as string)}.`);
  }
  const claimExpiresAt = addDaysToIso(state.now, checked.workspace.claimWindowDays);
  const next = mapCompany(state, companyId, (c) => ({ ...c, claimedById: state.meId, claimExpiresAt, updatedAt: state.now }));
  return done(next, { claimExpiresAt });
}

// Gives up your own claim. Only works if it is still yours (even a claim that has run out).
export function releaseClaim(state: DemoState, ws: string, companyId: string): Step {
  const checked = asMember(state, ws);
  if (!checked.ok) return checked.step;
  const company = companyOf(state, ws, companyId);
  if (!company || company.claimedById !== state.meId) return refuse(state, "You don't hold this company.");
  return done(mapCompany(state, companyId, (c) => ({ ...c, claimedById: null, claimExpiresAt: null })), undefined);
}

// An owner clears anyone's claim, for an officer who went quiet.
export function forceRelease(state: DemoState, ws: string, companyId: string): Step {
  const checked = asMember(state, ws);
  if (!checked.ok) return checked.step;
  if (checked.member.role !== "owner") return refuse(state, "Only an owner can force-release a claim.");
  const company = companyOf(state, ws, companyId);
  if (!company || company.claimedById === null) return refuse(state, "Nobody holds this company.");
  return done(mapCompany(state, companyId, (c) => ({ ...c, claimedById: null, claimExpiresAt: null })), undefined);
}

// What the log outreach form sends. Everything but the channel can be left out: the follow-up
// defaults to a week from today, and the note and template are optional.
export type OutreachInput = {
  channel: Channel | string;
  note?: string | null;
  // A calendar day like "2026-11-04", from today to a year out.
  followUpOn?: string;
  // The template this message was based on, for the per-template stats.
  templateId?: string | null;
  // Set by "I sent it" under an AI draft.
  aiDraftId?: string | null;
};

export const DEFAULT_FOLLOW_UP_DAYS = 7;
export const MAX_FOLLOW_UP_DAYS = 365;

// Records that you contacted the company. Requires your live claim. Sets last contacted and the
// next follow-up, renews your claim, and moves Not contacted to Contacted. Nothing is saved when
// the claim check fails.
export function logOutreach(state: DemoState, ws: string, companyId: string, input: OutreachInput): Step<{ outreachId: string }> {
  const checked = asMember(state, ws);
  if (!checked.ok) return checked.step;

  const channel = checkChannel(String(input.channel));
  if (!channel.ok) return refuse(state, channel.error);
  const note = checkNote(input.note, NOTE_MAX);
  if (!note.ok) return refuse(state, note.error);

  const today = localYmd(state.now);
  const followUpOn = input.followUpOn ?? addDaysYmd(today, DEFAULT_FOLLOW_UP_DAYS);
  if (!isYmd(followUpOn)) return refuse(state, "Pick a follow-up date.");
  if (followUpOn < today || followUpOn > addDaysYmd(today, MAX_FOLLOW_UP_DAYS)) {
    return refuse(state, "Pick a follow-up date from today to a year from now.");
  }

  const templateId = input.templateId ?? null;
  if (templateId && !state.templates.some((t) => t.id === templateId && t.workspaceId === ws)) {
    return refuse(state, "That template wasn't found. Nothing was saved.");
  }
  // Only your own draft of this company can be credited.
  const aiDraftId = input.aiDraftId ?? null;
  if (aiDraftId && !state.drafts.some((d) => d.id === aiDraftId && d.workspaceId === ws && d.companyId === companyId && d.createdById === state.meId)) {
    return refuse(state, "That draft wasn't found. Nothing was saved.");
  }

  const company = companyOf(state, ws, companyId);
  if (!company || company.archivedAt) return refuse(state, COMPANY_NOT_FOUND);
  if (isTerminalStage(company.stage)) return refuse(state, `This company is ${STAGE_LABELS[company.stage]}. Nothing was saved.`);
  const claim = claimStateOf(company, state.now, state.meId);
  if (claim === "theirs") {
    return refuse(state, `${personName(state, company.claimedById)} holds this company now, until ${formatWhen(company.claimExpiresAt as string)}. Nothing was saved.`);
  }
  if (claim === "expired" && company.claimedById === state.meId) {
    return refuse(state, "Your claim on this company has expired. Claim it again, then log your outreach. Nothing was saved.");
  }
  if (claim !== "mine") return refuse(state, "Claim this company before logging outreach. Nothing was saved.");

  const withOutreach = nextId(state, "out");
  const toStage: Stage = company.stage === "NOT_CONTACTED" ? "CONTACTED" : company.stage;
  const row: Outreach = {
    id: withOutreach.id,
    workspaceId: ws,
    companyId,
    senderId: state.meId,
    templateId,
    channel: channel.data,
    sentAt: state.now,
    note: note.data,
    gotReply: false,
    aiDraftId,
  };
  let next: DemoState = {
    ...withOutreach.state,
    outreach: [...withOutreach.state.outreach, row],
  };
  next = mapCompany(next, companyId, (c) => ({
    ...c,
    lastContactedAt: state.now,
    nextFollowUpAt: zonedToIso(followUpOn),
    claimExpiresAt: addDaysToIso(state.now, checked.workspace.claimWindowDays),
    stage: toStage,
    updatedAt: state.now,
  }));
  if (toStage !== company.stage) next = addStageChange(next, ws, companyId, company.stage, toStage);
  return done(next, { outreachId: row.id });
}

function addStageChange(state: DemoState, ws: string, companyId: string, fromStage: Stage, toStage: Stage): DemoState {
  const withId = nextId(state, "sc");
  const change: StageChange = {
    id: withId.id,
    workspaceId: ws,
    companyId,
    changedById: state.meId,
    fromStage,
    toStage,
    changedAt: state.now,
  };
  return { ...withId.state, stageChanges: [...withId.state.stageChanges, change] };
}

export type StageMoveOptions = {
  // Which outreach got the reply, when the company is moving to Replied or later. A string flags
  // that outreach, null says "none of these", and leaving it out changes no outreach.
  replyOutreachId?: string | null;
};

export type StageMoveResult = { changed: boolean; fromStage: Stage; toStage: Stage };

// Moves a company to a new stage and records the move. A company someone else holds can only be
// moved by them or an owner. Moving to Committed or Declined clears the claim: the pitch is over.
export function moveStage(state: DemoState, ws: string, companyId: string, toStage: Stage, options: StageMoveOptions = {}): Step<StageMoveResult> {
  const checked = asMember(state, ws);
  if (!checked.ok) return checked.step;
  if (!STAGES.includes(toStage)) return refuse(state, "Pick a stage.");
  const company = companyOf(state, ws, companyId);
  if (!company || company.archivedAt) return refuse(state, COMPANY_NOT_FOUND);

  const fromStage = company.stage;
  if (fromStage === toStage) return done(state, { changed: false, fromStage, toStage });
  const blocked = blockedBy(state, company, checked.member.role);
  if (blocked) return refuse(state, blocked);

  const replyId = REPLY_STAGES.includes(toStage) ? options.replyOutreachId : undefined;
  if (replyId && !state.outreach.some((o) => o.id === replyId && o.companyId === companyId && o.workspaceId === ws)) {
    return refuse(state, "That outreach wasn't found.");
  }

  let next: DemoState = replyId
    ? { ...state, outreach: state.outreach.map((o) => (o.id === replyId ? { ...o, gotReply: true } : o)) }
    : state;
  next = mapCompany(next, companyId, (c) => ({
    ...c,
    stage: toStage,
    ...(isTerminalStage(toStage) ? { claimedById: null, claimExpiresAt: null } : {}),
    updatedAt: state.now,
  }));
  next = addStageChange(next, ws, companyId, fromStage, toStage);
  return done(next, { changed: true, fromStage, toStage });
}

// Flags (or unflags) the outreach a company replied to, from the outreach log. Any member may.
export function setOutreachReply(state: DemoState, ws: string, outreachId: string, gotReply: boolean): Step {
  const checked = asMember(state, ws);
  if (!checked.ok) return checked.step;
  if (!state.outreach.some((o) => o.id === outreachId && o.workspaceId === ws)) return refuse(state, "That outreach wasn't found.");
  return done({ ...state, outreach: state.outreach.map((o) => (o.id === outreachId ? { ...o, gotReply } : o)) }, undefined);
}
