import type { Stage } from "@/generated/prisma/enums";
import { dbToday } from "@/lib/claims";
import type { Membership } from "@/lib/authz";
import { withTenant } from "@/lib/db";
import { addDays, dayString } from "@/lib/dates";
import { RECONTACT_MAX_DAYS } from "./limits";
import { fail, findReport, isOwner, NO_HANDOFF, OWNER_ONLY, PUBLISHED_LOCK, type Done } from "./shared";
import { cardBody, type CardBullet } from "./types";
import { daysFromTo } from "./year";

// Step 2e: the re-contact calendar. A card with a "next" bullet whose month code verified proposes
// the first day of that month's next occurrence after today, never more than a year out; any other
// card proposes nothing. The owner may change any date, set every blank to one date, and apply them
// (applying calls setFollowUp in lib/claims.ts, in apply.ts: nothing here writes to a company).
// What is saved here is only RelationshipCard.recontactOn, the handoff's own date.
//
// Proposals are made when a card is approved (redact.ts) from the bullets then visible. Hiding or
// showing a bullet later moves the saved date only if it was still the card's own proposal (the
// owner's changed dates are never touched); the calendar shows each next to the date saved.

const DAY_RANGE = (today: string) => ({ from: today, to: addDays(today, RECONTACT_MAX_DAYS) });

// The first day of `month`'s next occurrence after `today` ("2026-11-13"), or null when that is
// more than a year away (a leap day can push the 1st of a month to 366 days).
export function nextFirstOf(month: number, today: string): string | null {
  const year = Number(today.slice(0, 4));
  const first = (y: number) => `${y}-${String(month).padStart(2, "0")}-01`;
  const date = first(year) > today ? first(year) : first(year + 1);
  return daysFromTo(today, date) <= RECONTACT_MAX_DAYS ? date : null;
}

// The date a card proposes: the earliest of its visible "next" bullets' months. Declined companies
// are left alone, so they propose nothing.
export function proposeRecontact(bullets: readonly Pick<CardBullet, "section" | "month">[], stage: Stage, today: string): string | null {
  if (stage === "DECLINED") return null;
  const dates = bullets.flatMap((b) => (b.section === "next" && b.month !== null ? [nextFirstOf(b.month, today)] : [])).filter((d): d is string => d !== null);
  return dates.length > 0 ? dates.sort()[0] : null;
}

// Why a date can't be saved, or null. A calendar date from today to a year out, like any follow-up.
export function dateProblem(date: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    return "Enter a date like 2026-08-01.";
  }
  const { from, to } = DAY_RANGE(today);
  return date >= from && date <= to ? null : "Pick a date from today to a year from now.";
}

export type CalendarRow = {
  cardId: string;
  companyId: string;
  name: string;
  stage: Stage;
  // What the card proposes now, from its visible bullets, and the date saved (null is blank).
  proposed: string | null;
  date: string | null;
  // The company's own next follow-up day right now (what Apply sets), or null for none.
  followUp: string | null;
  // Closed deals can't take a date while closed: Committed needs "Reopen for next year", and
  // Declined is listed but left alone.
  closed: "COMMITTED" | "DECLINED" | null;
};

// The approved, unhidden cards of a handoff, for the calendar step. Owners only.
export async function loadCalendar(actor: Membership, reportId: string): Promise<Done<CalendarRow[]>> {
  if (!isOwner(actor)) return fail(OWNER_ONLY);
  const today = await dbToday();
  return withTenant(actor, async (tx) => {
    const report = await findReport(tx, actor.workspaceId, reportId);
    if (!report) return fail(NO_HANDOFF);
    const order = new Map((report.companyIds as string[]).map((id, i) => [id, i]));
    const cards = await tx.relationshipCard.findMany({
      where: { reportId, workspaceId: actor.workspaceId, approvedAt: { not: null } },
      select: { id: true, companyId: true, bullets: true, recontactOn: true, company: { select: { name: true, stage: true, nextFollowUpAt: true } }, redactions: { select: { bulletIndex: true } } },
    });
    const rows = cards
      .filter((c) => !c.redactions.some((r) => r.bulletIndex === null))
      .map((c): CalendarRow => {
        const hidden = new Set(c.redactions.map((r) => r.bulletIndex));
        const visible = cardBody(c.bullets).bullets.filter((_, i) => !hidden.has(i));
        const stage = c.company.stage;
        return {
          cardId: c.id,
          companyId: c.companyId,
          name: c.company.name,
          stage,
          proposed: proposeRecontact(visible, stage, today),
          date: c.recontactOn,
          followUp: c.company.nextFollowUpAt ? dayString(c.company.nextFollowUpAt) : null,
          closed: stage === "COMMITTED" || stage === "DECLINED" ? stage : null,
        };
      })
      .sort((a, b) => (order.get(a.companyId) ?? 0) - (order.get(b.companyId) ?? 0));
    return { ok: true, data: rows };
  });
}

export type SavedDates = { saved: number; refused: { companyId: string; reason: string }[] };

// Saves the owner's dates for approved cards (null clears one). A date outside today to a year out,
// a company with no approved card in this handoff, and a Declined company are refused with the
// reason; the others are saved. Committed companies keep a saved date: it takes effect only when
// they are reopened.
export async function saveRecontactDates(actor: Membership, reportId: string, dates: readonly { companyId: string; date: string | null }[]): Promise<Done<SavedDates>> {
  if (!isOwner(actor)) return fail(OWNER_ONLY);
  const today = await dbToday();
  return withTenant(actor, async (tx) => {
    const report = await findReport(tx, actor.workspaceId, reportId);
    if (!report) return fail(NO_HANDOFF);
    if (report.status !== "DRAFT") return fail(PUBLISHED_LOCK);
    const cards = await tx.relationshipCard.findMany({
      where: { reportId, workspaceId: actor.workspaceId, approvedAt: { not: null }, companyId: { in: dates.map((d) => d.companyId) } },
      select: { id: true, companyId: true, company: { select: { stage: true } } },
    });
    const byCompany = new Map(cards.map((c) => [c.companyId, c]));
    const refused: SavedDates["refused"] = [];
    // The date each accepted company ends with (a company listed twice keeps its last date), then
    // one update for each distinct date, not one per company.
    const accepted = new Map<string, string | null>();
    for (const { companyId, date } of dates) {
      const card = byCompany.get(companyId);
      if (!card) refused.push({ companyId, reason: "That company has no approved card in this handoff." });
      else if (card.company.stage === "DECLINED") refused.push({ companyId, reason: "This company declined, so it is left alone." });
      else {
        const problem = date === null ? null : dateProblem(date, today);
        if (problem) refused.push({ companyId, reason: problem });
        else accepted.set(companyId, date);
      }
    }
    const groups = new Map<string | null, string[]>();
    for (const [companyId, date] of accepted) {
      const ids = groups.get(date);
      const cardId = (byCompany.get(companyId) as { id: string }).id;
      if (ids) ids.push(cardId);
      else groups.set(date, [cardId]);
    }
    for (const [date, ids] of groups) await tx.relationshipCard.updateMany({ where: { id: { in: ids }, workspaceId: actor.workspaceId }, data: { recontactOn: date } });
    const saved = accepted.size;
    return { ok: true, data: { saved, refused } };
  });
}

// "Set every blank to one date": every approved, unhidden card with no date, except Declined
// companies (left alone), gets this date. Returns how many were set.
export async function fillBlankDates(actor: Membership, reportId: string, date: string): Promise<Done<{ set: number }>> {
  if (!isOwner(actor)) return fail(OWNER_ONLY);
  const today = await dbToday();
  const problem = dateProblem(date, today);
  if (problem) return fail(problem);
  return withTenant(actor, async (tx) => {
    const report = await findReport(tx, actor.workspaceId, reportId);
    if (!report) return fail(NO_HANDOFF);
    if (report.status !== "DRAFT") return fail(PUBLISHED_LOCK);
    const { count } = await tx.relationshipCard.updateMany({
      where: {
        reportId,
        workspaceId: actor.workspaceId,
        approvedAt: { not: null },
        recontactOn: null,
        company: { stage: { not: "DECLINED" } },
        redactions: { none: { bulletIndex: null } },
      },
      data: { recontactOn: date },
    });
    return { ok: true, data: { set: count } };
  });
}
