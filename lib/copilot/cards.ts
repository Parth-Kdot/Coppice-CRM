import type { Stage } from "@/generated/prisma/enums";
import type { Membership } from "@/lib/authz";
import { CHANNEL_LABELS } from "@/lib/channels";
import { claimState, dbNow, dbToday, FOLLOW_UP_RANGE_MESSAGE, type ClaimState } from "@/lib/claims";
import { getCompanyDetail } from "@/lib/companies";
import { day, localMidnight } from "@/lib/dates";
import { prisma, withTenant } from "@/lib/db";
import { followUpOk } from "@/lib/copilot/intent";
import { FORCE_RELEASE_LABEL, legalMoves, MOVE_LABELS, stageChoices, stageConfirm, type CompanyState, type LegalMoves, type MoveType, type StageConfirm } from "@/lib/copilot/moves";
import { companyHref, dueText } from "@/lib/copilot/query";
import { STAGE_LABELS } from "@/lib/stages";
import type { ActionResult } from "@/lib/validation";

// Confirm cards and the company card. A card says exactly what will happen when it is confirmed, and
// whether it can: an illegal one is shown disabled with its reason (lib/copilot/moves.ts). The card
// itself changes nothing. Confirming calls the existing server action for its type (claimCompany,
// releaseClaim or forceRelease, moveStage, setFollowUp in app/(app)/[workspaceId]/companies/actions.ts)
// or, for LOG, opens the existing log form with nothing filled in. Each of those checks again on the
// server, so a card that was legal a minute ago can still be refused.

export type ActionCard = {
  // Unique within an answer.
  key: string;
  type: MoveType;
  companyId: string;
  companyName: string;
  // MOVE_STAGE only.
  stage: Stage | null;
  // SET_FOLLOW_UP only, YYYY-MM-DD.
  followUpOn: string | null;
  // RELEASE only: an owner clearing someone else's claim, so confirm calls forceRelease.
  force: boolean;
  // MOVE_STAGE only: the app asks first (into or out of Committed and Declined, or backwards).
  confirm: StageConfirm | null;
  // LOG only: confirming opens the log form instead of changing anything.
  opensForm: boolean;
  // The button's words.
  label: string;
  // What will happen, in one or two plain sentences.
  text: string;
  legal: boolean;
  reason: string | null;
  href: string;
};

export type ActionSpec = { type: MoveType; companyId: string; stage: Stage | null; followUpOn: string | null };
export type Known = { id: string; name: string; state: CompanyState };

// "Nov 21", with the year once it isn't this year's.
export function dateLabel(ymd: string, today: string): string {
  const base = day(localMidnight(ymd));
  return ymd.slice(0, 4) === today.slice(0, 4) ? base : `${base}, ${ymd.slice(0, 4)}`;
}

const COMPANY_NOT_FOUND = "Company not found.";

// The companies behind these ids, in this workspace only (an id from another workspace, or no
// company at all, is simply missing from the result), as the legal-moves rules see them.
export async function loadKnown(member: Membership, ids: readonly string[]): Promise<Map<string, Known>> {
  if (ids.length === 0) return new Map();
  const rows = await withTenant(member, (tx) =>
    tx.company.findMany({
      where: { workspaceId: member.workspaceId, id: { in: [...new Set(ids)] } },
      select: { id: true, name: true, stage: true, archivedAt: true, claimedById: true, claimExpiresAt: true, claimedBy: { select: { name: true } } },
    }),
  );
  return new Map(
    rows.map((r) => [
      r.id,
      { id: r.id, name: r.name, state: { stage: r.stage, archived: r.archivedAt !== null, holderId: r.claimedById, holderName: r.claimedBy?.name ?? null, holdEndsAt: r.claimExpiresAt } },
    ]),
  );
}

export type CardContext = { member: Membership; now: Date; today: string; claimWindowDays: number };

export async function cardContext(member: Membership, at?: Date): Promise<CardContext> {
  const [now, today, workspace] = await Promise.all([
    at ?? dbNow(),
    dbToday(),
    prisma.workspace.findUniqueOrThrow({ where: { id: member.workspaceId }, select: { claimWindowDays: true } }),
  ]);
  return { member, now, today, claimWindowDays: workspace.claimWindowDays };
}

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

export function buildCard(spec: ActionSpec, company: Known, key: string, ctx: CardContext): ActionCard {
  const moves = legalMoves(company.state, ctx.member, ctx.now);
  const move = moves[spec.type];
  const name = company.name;
  let text: string;
  let label: string = MOVE_LABELS[spec.type];
  let confirm: StageConfirm | null = null;
  let legal = move.legal;
  let reason = move.reason;

  switch (spec.type) {
    case "CLAIM": {
      const holding = company.state.holderId === ctx.member.userId && company.state.holdEndsAt !== null && company.state.holdEndsAt > ctx.now;
      text = holding ? `Renew your claim on ${name} for ${days(ctx.claimWindowDays)}.` : `Claim ${name} for ${days(ctx.claimWindowDays)}.`;
      if (holding) label = "Renew claim";
      break;
    }
    case "RELEASE":
      text = move.force
        ? `Force-release ${company.state.holderName}'s claim on ${name}.`
        : company.state.holderId === ctx.member.userId
          ? `Release your claim on ${name}. The stage and follow-up date stay as they are.`
          : `Release the claim on ${name}.`;
      if (move.force) label = FORCE_RELEASE_LABEL;
      break;
    case "LOG":
      text = `Log outreach for ${name}. The log form opens, and you write the note and pick the follow-up date.`;
      break;
    case "SET_FOLLOW_UP": {
      const when = spec.followUpOn ? dateLabel(spec.followUpOn, ctx.today) : "the date you pick";
      text = `Set the follow-up for ${name} to ${when}. Nothing else changes.`;
      break;
    }
    case "MOVE_STAGE": {
      const to = spec.stage as Stage;
      const from = company.state.stage;
      confirm = stageConfirm(from, to);
      label = `Move to ${STAGE_LABELS[to]}`;
      text =
        confirm === "closes"
          ? `Move ${name} to ${STAGE_LABELS[to]}. This closes the pitch and releases any claim.`
          : confirm === "reopens"
            ? `Reopen ${name} as ${STAGE_LABELS[to]}.`
            : confirm === "back"
              ? `Move ${name} back from ${STAGE_LABELS[from]} to ${STAGE_LABELS[to]}.`
              : `Move ${name} to ${STAGE_LABELS[to]}.`;
      if (legal && from === to) {
        legal = false;
        reason = `This company is already ${STAGE_LABELS[to]}.`;
      }
      break;
    }
  }
  return {
    key,
    type: spec.type,
    companyId: company.id,
    companyName: name,
    stage: spec.type === "MOVE_STAGE" ? spec.stage : null,
    followUpOn: spec.type === "SET_FOLLOW_UP" ? spec.followUpOn : null,
    force: spec.type === "RELEASE" && move.force,
    confirm,
    opensForm: spec.type === "LOG",
    label,
    text,
    legal,
    reason: legal ? null : reason,
    href: companyHref(ctx.member.workspaceId, company.id),
  };
}

// The cards for an intent's actions, one per company per action, in the order the intent listed
// them. A company that is gone is skipped.
export async function cardsFor(specs: readonly ActionSpec[], ctx: CardContext): Promise<ActionCard[]> {
  const known = await loadKnown(ctx.member, specs.map((s) => s.companyId));
  return specs.flatMap((spec, i) => {
    const company = known.get(spec.companyId);
    return company ? [buildCard(spec, company, `${spec.type}:${spec.companyId}:${i}`, ctx)] : [];
  });
}

export type CardInput = { companyId: string; type: MoveType; stage: Stage | null; followUpOn: string | null };

// A next-move chip chosen on a row, or a move chosen on the company's card: its confirm card, from
// the company as it is right now. No AI call. A company in another workspace is simply not found.
export async function previewMove(member: Membership, input: CardInput): Promise<ActionResult<ActionCard>> {
  const ctx = await cardContext(member);
  const company = (await loadKnown(member, [input.companyId])).get(input.companyId);
  if (!company) return { ok: false, error: COMPANY_NOT_FOUND };
  if (input.type === "MOVE_STAGE" && !input.stage) return { ok: false, error: "Pick a stage." };
  if (input.type === "SET_FOLLOW_UP" && !followUpOk(input.followUpOn, ctx.today)) return { ok: false, error: FOLLOW_UP_RANGE_MESSAGE };
  return { ok: true, data: buildCard(input, company, `${input.type}:${input.companyId}:0`, ctx) };
}

// ----- The company card -----

export type CompanyCard = {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  stage: Stage;
  stageLabel: string;
  archived: boolean;
  claim: { state: ClaimState; holderName: string | null; label: string };
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  dueLabel: string;
  contacts: { id: string; name: string; email: string | null; title: string | null }[];
  // The last three, newest first, as the company page lists them.
  outreach: { id: string; sentAt: string; sentLabel: string; channelLabel: string; by: string; viaAssistant: boolean; note: string | null; templateName: string | null; aiDrafted: boolean; gotReply: boolean }[];
  outreachTotal: number;
  moves: LegalMoves;
  // The stages a move can go to, each with the confirmation the app asks first. Empty when moving is illegal.
  stages: { stage: Stage; label: string; confirm: StageConfirm | null }[];
  href: string;
};

export const CARD_OUTREACH = 3;

export async function companyCard(member: Membership, companyId: string, now?: Date): Promise<CompanyCard | null> {
  const at = now ?? (await dbNow());
  const detail = await getCompanyDetail(member, companyId, { outreach: CARD_OUTREACH, history: 1 });
  if (!detail) return null;
  const state: CompanyState = {
    stage: detail.stage,
    archived: detail.archivedAt !== null,
    holderId: detail.claimedById,
    holderName: detail.claimedBy?.name ?? null,
    holdEndsAt: detail.claimExpiresAt,
  };
  const moves = legalMoves(state, member, at);
  const claim = claimState(detail, at, member.userId);
  const due = dueText(detail.nextFollowUpAt, at);
  return {
    id: detail.id,
    name: detail.name,
    industry: detail.industry,
    website: detail.website,
    stage: detail.stage,
    stageLabel: STAGE_LABELS[detail.stage],
    archived: state.archived,
    claim: {
      state: claim,
      holderName: state.holderName,
      label: claim === "mine" ? `Yours until ${day(detail.claimExpiresAt as Date)}` : claim === "theirs" ? `${state.holderName ?? "Someone"} until ${day(detail.claimExpiresAt as Date)}` : "Free",
    },
    lastContactedAt: detail.lastContactedAt?.toISOString() ?? null,
    nextFollowUpAt: detail.nextFollowUpAt?.toISOString() ?? null,
    dueLabel: due.label,
    contacts: detail.contacts,
    outreach: detail.outreach.slice(0, CARD_OUTREACH).map((o) => ({
      id: o.id,
      sentAt: o.sentAt.toISOString(),
      sentLabel: day(o.sentAt),
      channelLabel: CHANNEL_LABELS[o.channel],
      by: o.sender.name,
      viaAssistant: o.via === "ASSISTANT",
      note: o.note,
      templateName: o.template?.name ?? null,
      aiDrafted: o.aiDraftId !== null,
      gotReply: o.gotReply,
    })),
    outreachTotal: detail.outreachTotal,
    moves,
    stages: stageChoices(state, moves),
    href: companyHref(member.workspaceId, detail.id),
  };
}
