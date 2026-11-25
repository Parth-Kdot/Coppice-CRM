import type { Stage } from "@/generated/prisma/enums";
import { yearWindow } from "@/lib/capsule/year";
import { dayString, DAY_MS, formatYmd } from "@/lib/dates";
import { withTenant, type Tenant } from "@/lib/db";
import { storedItems } from "@/lib/research/brief";
import { DOOR_LABELS } from "@/lib/research/doors";
import { boardYearOf, yearLabel } from "@/lib/smart-import/dates";

// What the Claim Checker may use as proof besides the verified facts: the research brief items a
// person accepted ("Add to notes") for this company, and the company's own logged history (stage
// moves and replies marked on outreach). Only logged rows count, never free text: company notes,
// outreach notes and Smart import's stages are never read here.
//
// Server only. The rules in the browser get a plain copy of this (ruleSupport in
// lib/claim-rules.ts); the AI check gets the items' text and historyLines.

// One accepted brief item: its label ("Giving portal"), the brief's own text and the page it cites.
export type SupportItem = { label: string; title: string; detail: string; deadline: string | null; quote: string; url: string };
// One board year (by its starting year) of this company's history. `committed` holds only moves to
// Committed that lasted (see LASTING_DAYS).
export type YearHistory = { start: number; outreach: number; replies: number; committed: Date[]; declined: Date[] };
export type ClaimSupport = {
  items: SupportItem[];
  years: YearHistory[];
  currentYear: number;
  // The newest outcome: a lasting move to Committed, or a move to Declined. A reply followed by a
  // decline is no proof of a good relationship.
  lastOutcome: "COMMITTED" | "DECLINED" | null;
};

export const NO_SUPPORT = (currentYear: number): ClaimSupport => ({ items: [], years: [], currentYear, lastOutcome: null });

// A move to Committed counts only if the company stayed Committed this long, or still is, so a
// mistaken click undone a minute later is never proof.
export const LASTING_DAYS = 7;
// At most this many accepted items reach the checker, newest brief first.
export const SUPPORT_ITEMS = 12;
const BRIEFS_READ = 10;
// How many board years historyLines writes, newest first.
export const HISTORY_YEARS = 6;

// A move into one of these from outside them is the company answering. Defined here on purpose
// rather than read from REPLY_STAGES (lib/stages.ts): that list decides template stats, this one
// decides proof of having been in touch.
const ANSWER_STAGES: Stage[] = ["REPLIED", "IN_CONVERSATION"];
const ANSWERED: Stage[] = ["REPLIED", "IN_CONVERSATION", "COMMITTED"];

type Move = { fromStage: Stage; toStage: Stage; changedAt: Date };
type Sent = { sentAt: Date; gotReply: boolean };

// The pure part: rows in, a summary per board year out. `moves` oldest first.
export function summarize(outreach: Sent[], moves: Move[], currentYear: number): Omit<ClaimSupport, "items"> {
  const years = new Map<number, YearHistory>();
  const yearOf = (d: Date) => {
    const start = boardYearOf(dayString(d));
    let year = years.get(start);
    if (!year) years.set(start, (year = { start, outreach: 0, replies: 0, committed: [], declined: [] }));
    return year;
  };
  // A reply is usually both a move to Replied and a mark on the outreach that got it, so a year's
  // replies are the larger of the two counts, never their sum.
  const marked = new Map<number, number>();
  const answered = new Map<number, number>();
  for (const o of outreach) {
    const year = yearOf(o.sentAt);
    year.outreach += 1;
    if (o.gotReply) marked.set(year.start, (marked.get(year.start) ?? 0) + 1);
  }
  let lastOutcome: ClaimSupport["lastOutcome"] = null;
  moves.forEach((move, i) => {
    if (ANSWER_STAGES.includes(move.toStage) && !ANSWERED.includes(move.fromStage)) {
      const start = yearOf(move.changedAt).start;
      answered.set(start, (answered.get(start) ?? 0) + 1);
    }
    if (move.toStage === "DECLINED") {
      yearOf(move.changedAt).declined.push(move.changedAt);
      lastOutcome = "DECLINED";
    }
    if (move.toStage === "COMMITTED") {
      const out = moves.slice(i + 1).find((later) => later.fromStage === "COMMITTED");
      if (!out || out.changedAt.getTime() - move.changedAt.getTime() >= LASTING_DAYS * DAY_MS) {
        yearOf(move.changedAt).committed.push(move.changedAt);
        lastOutcome = "COMMITTED";
      }
    }
  });
  for (const year of years.values()) year.replies = Math.max(marked.get(year.start) ?? 0, answered.get(year.start) ?? 0);
  return { years: [...years.values()].sort((a, b) => b.start - a.start), currentYear, lastOutcome };
}

// The company's history as short lines for the AI check, written by code: per board year, newest
// first, the outreach and reply counts and the month of each move to Committed or Declined. Never
// names, notes, senders, channels, templates, or the stage the company is in now.
export function historyLines(s: Pick<ClaimSupport, "years" | "currentYear">): string[] {
  const month = (d: Date) => formatYmd(dayString(d), { month: "long", year: "numeric" });
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const lines = s.years
    .filter((y) => y.outreach > 0 || y.replies > 0 || y.committed.length > 0 || y.declined.length > 0)
    .slice(0, HISTORY_YEARS)
    .map((y) => {
      const label = y.start === s.currentYear ? `This board year (${yearLabel(y.start)})` : yearLabel(y.start);
      const replies = y.replies > 0 ? plural(y.replies, "reply", "replies") : y.start === s.currentYear ? "no reply yet" : "no reply";
      const moves = [
        ...y.committed.map((d) => ({ d, text: `moved to Committed in ${month(d)}` })),
        ...y.declined.map((d) => ({ d, text: `moved to Declined in ${month(d)}` })),
      ]
        .sort((a, b) => a.d.getTime() - b.d.getTime())
        .map((m) => m.text);
      return `${label}: ${plural(y.outreach, "outreach entry", "outreach entries")}, ${replies}${moves.length ? `; ${moves.join(", ")}` : ""}.`;
    });
  return lines.length ? lines : ["(nothing logged)"];
}

// Everything the Claim Checker may use for this company. One transaction of reads, each scoped to
// the workspace; never call this inside a transaction that also calls a model.
export async function claimSupport(tenant: Tenant, companyId: string, today: string): Promise<ClaimSupport> {
  const currentYear = boardYearOf(today);
  const where = { companyId, workspaceId: tenant.workspaceId };
  const { briefs, outreach, moves } = await withTenant(tenant, async (tx) => {
    const briefs = await tx.companyBrief.findMany({
      where: { ...where, status: "READY", accepted: { isEmpty: false }, createdAt: { gte: yearWindow(currentYear - 1).from } },
      // Never the pages' inboxes or stored text: only where each page ended up.
      select: { brief: true, accepted: true, pages: { where: { workspaceId: tenant.workspaceId }, select: { position: true, finalUrl: true } } },
      orderBy: { createdAt: "desc" },
      take: BRIEFS_READ,
    });
    const outreach = await tx.outreach.findMany({ where, select: { sentAt: true, gotReply: true }, orderBy: { sentAt: "asc" }, take: 2000 });
    const moves = await tx.stageChange.findMany({
      where: { ...where, OR: [{ toStage: { in: ["REPLIED", "IN_CONVERSATION", "COMMITTED", "DECLINED"] } }, { fromStage: "COMMITTED" }] },
      select: { fromStage: true, toStage: true, changedAt: true },
      orderBy: [{ changedAt: "asc" }, { id: "asc" }],
      take: 500,
    });
    return { briefs, outreach, moves };
  });

  const items = briefs
    .flatMap((brief) => {
      const urls = new Map(brief.pages.map((p) => [p.position, p.finalUrl]));
      return storedItems(brief.brief).flatMap((item): SupportItem[] => {
        const url = urls.get(item.page);
        if (!url || !brief.accepted.includes(item.id)) return [];
        return [{ label: DOOR_LABELS[item.door], title: item.title, detail: item.detail, deadline: item.deadline, quote: item.quote, url }];
      });
    })
    .slice(0, SUPPORT_ITEMS);
  return { items, ...summarize(outreach, moves, currentYear) };
}
