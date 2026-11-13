import type { Stage } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import type { Membership } from "@/lib/authz";
import { literal } from "@/lib/board";
import { claimState, dbNow, dbToday, heldBy, notHeldByOthers, type ClaimState } from "@/lib/claims";
import { addDays, daysBetween, day, localMidnight, overdueLabel } from "@/lib/dates";
import { withTenant } from "@/lib/db";
import { nextBestMove, type CompanyState, type NextMove } from "@/lib/copilot/moves";
import { STAGE_LABELS, TERMINAL_STAGES } from "@/lib/stages";
import { formatCount } from "@/lib/stats-math";
import type { CopilotFilter } from "@/lib/validation";

// Running an intent's filter against the database, and shaping what the person sees. The model never
// reaches this far: by here the filter has been checked (lib/copilot/intent.ts), and every name,
// date, count and row on screen is read from the workspace by code. Runs inside withTenant (row-level
// security), names workspaceId in every where, leaves archived companies out and is bounded like
// lib/queue.ts and lib/board.ts: at most COPILOT_ROWS rows, and a total counted only when the page
// came back full. Claim rules stay in lib/claims.ts: this only combines its filters.

export const COPILOT_ROWS = 25;
// "Due this week" means the follow-up date falls in the next 7 days, today not included: companies
// due today have arrived and count as overdue, like the queue.
export const WEEK_DAYS = 7;

const ROW = {
  id: true,
  name: true,
  industry: true,
  stage: true,
  nextFollowUpAt: true,
  lastContactedAt: true,
  // Read only, for the claim label and the legal moves; liveness is decided against `now`.
  claimedById: true,
  claimExpiresAt: true,
  claimedBy: { select: { name: true } },
} as const satisfies Prisma.CompanySelect;
export type RowSource = Prisma.CompanyGetPayload<{ select: typeof ROW }>;

export type CopilotRow = {
  id: string;
  name: string;
  industry: string | null;
  stage: Stage;
  stageLabel: string;
  // "3 days overdue", "Due today", "Due Nov 21" or "No follow-up date".
  dueLabel: string;
  overdue: boolean;
  nextFollowUpAt: string | null;
  lastContactedAt: string | null;
  claim: { state: ClaimState; holderName: string | null; label: string };
  // The company's page.
  href: string;
  // The one move worth making next, from what is legal for this person right now.
  next: NextMove | null;
  // Why a plan lists it ("Yours, due"); null elsewhere.
  why: string | null;
};

export const companyHref = (workspaceId: string, companyId: string) => `/${workspaceId}/companies/${companyId}`;

export function dueText(next: Date | null, now: Date): { label: string; overdue: boolean } {
  if (!next) return { label: "No follow-up date", overdue: false };
  if (daysBetween(next, now) >= 0) return { label: overdueLabel(next, now), overdue: true };
  return { label: `Due ${day(next)}`, overdue: false };
}

const claimLabel = (state: ClaimState, source: RowSource): string => {
  if (state === "mine") return `Yours until ${day(source.claimExpiresAt as Date)}`;
  if (state === "theirs") return `${source.claimedBy?.name ?? "Someone"} until ${day(source.claimExpiresAt as Date)}`;
  return "Free";
};

// What the legal-moves rules need to know about a company row.
export const stateOf = (source: RowSource): CompanyState => ({
  stage: source.stage,
  archived: false,
  holderId: source.claimedById,
  holderName: source.claimedBy?.name ?? null,
  holdEndsAt: source.claimExpiresAt,
});

export function toRow(workspaceId: string, source: RowSource, actor: Membership, now: Date, why: string | null = null): CopilotRow {
  const state = claimState(source, now, actor.userId);
  const due = dueText(source.nextFollowUpAt, now);
  return {
    id: source.id,
    name: source.name,
    industry: source.industry,
    stage: source.stage,
    stageLabel: STAGE_LABELS[source.stage],
    dueLabel: due.label,
    overdue: due.overdue,
    nextFollowUpAt: source.nextFollowUpAt?.toISOString() ?? null,
    lastContactedAt: source.lastContactedAt?.toISOString() ?? null,
    claim: { state, holderName: source.claimedBy?.name ?? null, label: claimLabel(state, source) },
    href: companyHref(workspaceId, source.id),
    next: nextBestMove(stateOf(source), actor, now),
    why,
  };
}

// ----- The filter -----

// A claim filter. "free" is nobody holding it right now (never claimed, or any claim ran out, a
// person's own included), the same reading as the queue's Up for grabs.
const NOBODY = "";

export function filterWhere(filter: CopilotFilter, member: Membership, now: Date, today: string): Prisma.CompanyWhereInput {
  const all: Prisma.CompanyWhereInput[] = [
    { workspaceId: member.workspaceId, archivedAt: null },
    filter.stages.length > 0 ? { stage: { in: filter.stages } } : { stage: { notIn: TERMINAL_STAGES } },
  ];
  if (filter.industry) all.push({ industry: { equals: filter.industry, mode: "insensitive" } });
  if (filter.due === "overdue") all.push({ nextFollowUpAt: { lte: now } });
  if (filter.due === "due_this_week") all.push({ nextFollowUpAt: { gt: now, lt: localMidnight(addDays(today, WEEK_DAYS + 1)) } });
  if (filter.due === "no_date") all.push({ nextFollowUpAt: null });
  if (filter.claim === "mine") all.push(heldBy(member.userId, now));
  if (filter.claim === "free") all.push(notHeldByOthers(NOBODY, now));
  if (filter.claim === "held_by_others") all.push({ NOT: notHeldByOthers(member.userId, now) });
  if (filter.neverContacted) all.push({ lastContactedAt: null, outreach: { none: {} } });
  if (filter.nameOrSite) {
    const contains = { contains: literal(filter.nameOrSite), mode: "insensitive" } as const;
    all.push({ OR: [{ name: contains }, { website: contains }] });
  }
  if (filter.notesMention) {
    const contains = { contains: literal(filter.notesMention), mode: "insensitive" } as const;
    all.push({ OR: [{ notes: contains }, { outreach: { some: { workspaceId: member.workspaceId, note: contains } } }] });
  }
  return { AND: all };
}

const ORDER: Record<CopilotFilter["sort"], Prisma.CompanyOrderByWithRelationInput[]> = {
  most_overdue: [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { name: "asc" }, { id: "asc" }],
  name: [{ name: "asc" }, { id: "asc" }],
  recently_contacted: [{ lastContactedAt: { sort: "desc", nulls: "last" } }, { name: "asc" }, { id: "asc" }],
};

// "7 companies match. Most overdue: Bramblewick Consulting, 12 days." Built by code from the rows.
export function summaryLine(total: number, rows: readonly CopilotRow[], filter: CopilotFilter, now: Date): string {
  if (total === 0) return "No companies match.";
  let line = total === 1 ? "1 company matches." : `${formatCount(total)} companies match.`;
  const first = rows[0];
  if (filter.sort === "most_overdue" && first?.nextFollowUpAt) {
    const days = daysBetween(new Date(first.nextFollowUpAt), now);
    if (days >= 1) line += ` Most overdue: ${first.name}, ${days} ${days === 1 ? "day" : "days"}.`;
  }
  if (total > rows.length) line += ` Showing the first ${rows.length}.`;
  return line;
}

export type FilterResult = { rows: CopilotRow[]; total: number; summary: string };

export async function runFilter(member: Membership, filter: CopilotFilter, now?: Date): Promise<FilterResult> {
  const at = now ?? (await dbNow());
  const today = await dbToday();
  const where = filterWhere(filter, member, at, today);
  const { sources, total } = await withTenant(member, async (tx) => {
    const sources = await tx.company.findMany({ where, select: ROW, orderBy: ORDER[filter.sort], take: COPILOT_ROWS });
    // A count is only asked for when the page came back full; otherwise the rows are all of them.
    const total = sources.length < COPILOT_ROWS ? sources.length : await tx.company.count({ where });
    return { sources, total };
  });
  const rows = sources.map((s) => toRow(member.workspaceId, s, member, at));
  return { rows, total, summary: summaryLine(total, rows, filter, at) };
}

// ----- Finding a company by name -----

export type NameLookup = { kind: "one"; id: string } | { kind: "many" } | { kind: "none" };

// A company name the model gave, looked up by code in this workspace: the case-insensitive contains
// the board's search uses. One match is that company (an exact name wins over longer names that
// contain it); several are a list filtered by the name; none is none.
export async function lookupCompany(member: Membership, name: string): Promise<NameLookup> {
  const found = await withTenant(member, (tx) =>
    tx.company.findMany({
      where: { workspaceId: member.workspaceId, archivedAt: null, name: { contains: literal(name), mode: "insensitive" } },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 6,
    }),
  );
  if (found.length === 0) return { kind: "none" };
  if (found.length === 1) return { kind: "one", id: found[0].id };
  const exact = found.filter((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
  return exact.length === 1 ? { kind: "one", id: exact[0].id } : { kind: "many" };
}

export { ROW as ROW_SELECT };
