import type { Prisma } from "@/generated/prisma/client";
import type { Stage } from "@/generated/prisma/enums";
import type { Membership } from "@/lib/authz";
import { notHeldByOthers } from "@/lib/claims";
import { formatYmd } from "@/lib/dates";
import { withTenant, type Tenant } from "@/lib/db";
import { formatCount, plural } from "@/lib/format";
import { buildFactTable, type Fact, type FactTable } from "@/lib/scorecard/facts";
import { workspaceStats } from "@/lib/stats";
import { TERMINAL_STAGES } from "@/lib/stages";
import { weekEndOf, type WeekRanges } from "@/lib/weekly-brief/week";

// The Monday brief's numbers: last week's work and the coming week's, counted by code from the
// workspace's own rows. Each one is a fact (the same shape as "Explain these numbers" uses, so its
// checks apply unchanged): the model writes words around the keys, and the page draws each key as
// a chip whose text code wrote here. Counts only: no company, person or note is ever read into a
// fact, so none can reach the model.

// An answer: a move into Replied, In conversation or Committed from a stage outside those three, or
// a move to Declined from Contacted (they were written to, and said no). A company crossed off
// from Not contacted to Declined is a decline, not an answer. lib/stages.ts is left as it is.
const ANSWERED: Stage[] = ["REPLIED", "IN_CONVERSATION", "COMMITTED"];
const answerMove: Prisma.StageChangeWhereInput = {
  OR: [{ toStage: { in: ANSWERED }, fromStage: { notIn: ANSWERED } }, { toStage: "DECLINED", fromStage: "CONTACTED" }],
};

// Open companies: not archived and not Committed or Declined (the queue's own rule).
const open = (workspaceId: string): Prisma.CompanyWhereInput => ({ workspaceId, archivedAt: null, stage: { notIn: TERMINAL_STAGES } });
// Nobody holds it right now: never claimed, or the claim ran out. User ids are never empty.
const unclaimed = (now: Date) => notHeldByOthers("", now);

export type WeeklyCounts = {
  weekStart: string;
  last: { outreach: number; companies: number; members: number; answers: number; committed: number; declined: number; added: number };
  prev: { outreach: number };
  now: { overdue: number; dueThisWeek: number; claimsEnding: number; liveClaims: number; freshLeads: number; open: number };
};

// Every count, one query at a time inside one withTenant (never Promise.all on one transaction),
// each with workspaceId in its where. `today` is the start of today in West Lafayette, `now` the
// database clock: both are read by the caller from dbNow and dbToday.
export async function readWeeklyCounts(tenant: Tenant, weekStart: string, ranges: WeekRanges, clock: { now: Date; todayStart: Date }): Promise<WeeklyCounts> {
  const { workspaceId } = tenant;
  const { prevStart, lastStart, thisStart, nextStart } = ranges;
  const { now, todayStart } = clock;
  return withTenant(tenant, async (tx) => {
    const lastWeek = { gte: lastStart, lt: thisStart };
    const sentLast: Prisma.OutreachWhereInput = { workspaceId, sentAt: lastWeek };
    const outreach = await tx.outreach.count({ where: sentLast });
    // Distinct companies and senders: a week holds a few dozen rows at most, so the ids are few.
    const companies = (await tx.outreach.findMany({ where: sentLast, distinct: ["companyId"], select: { companyId: true } })).length;
    const members = (await tx.outreach.findMany({ where: sentLast, distinct: ["senderId"], select: { senderId: true } })).length;
    const prevOutreach = await tx.outreach.count({ where: { workspaceId, sentAt: { gte: prevStart, lt: lastStart } } });

    const movedLast = (where: Prisma.StageChangeWhereInput) =>
      tx.stageChange.findMany({ where: { workspaceId, changedAt: lastWeek, ...where }, distinct: ["companyId"], select: { companyId: true } });
    const answers = (await movedLast(answerMove)).length;
    const committed = (await movedLast({ toStage: "COMMITTED" })).length;
    const declined = (await movedLast({ toStage: "DECLINED" })).length;

    const added = await tx.company.count({ where: { workspaceId, archivedAt: null, createdAt: lastWeek } });

    // The coming week. Committed and Declined are never overdue or due: they are not open.
    const overdue = await tx.company.count({ where: { ...open(workspaceId), nextFollowUpAt: { lt: todayStart } } });
    const dueThisWeek = await tx.company.count({ where: { ...open(workspaceId), nextFollowUpAt: { gte: todayStart, lt: nextStart } } });
    const live: Prisma.CompanyWhereInput = { claimedById: { not: null }, claimExpiresAt: { gt: now } };
    const liveClaims = await tx.company.count({ where: { ...open(workspaceId), ...live } });
    const claimsEnding = await tx.company.count({ where: { ...open(workspaceId), claimedById: { not: null }, claimExpiresAt: { gt: now, lt: nextStart } } });
    const freshLeads = await tx.company.count({ where: { ...open(workspaceId), stage: "NOT_CONTACTED", nextFollowUpAt: null, ...unclaimed(now) } });
    const openCount = await tx.company.count({ where: open(workspaceId) });

    return {
      weekStart,
      last: { outreach, companies, members, answers, committed, declined, added },
      prev: { outreach: prevOutreach },
      now: { overdue, dueThisWeek, claimsEnding, liveClaims, freshLeads, open: openCount },
    };
  });
}

// Last week's outreach against the week before, in words code wrote. The comparing words live
// only in this chip's text, never in the model's.
export function trendText(last: number, prev: number): string {
  if (last === prev) return "the same as the week before";
  const diff = Math.abs(last - prev);
  return last > prev ? `${formatCount(diff)} more than the week before` : `${formatCount(diff)} fewer than the week before`;
}

const count = (key: string, value: number, what: string): Fact => ({ key, value, text: formatCount(value), what });

// The counts as keyed facts, in the order the prompt lists them.
export function countFacts(c: WeeklyCounts): Fact[] {
  return [
    { key: "week.start", value: c.weekStart, text: formatYmd(c.weekStart), what: "the Monday the coming week starts" },
    { key: "week.end", value: weekEndOf(c.weekStart), text: formatYmd(weekEndOf(c.weekStart)), what: "the Sunday the coming week ends" },
    count("last.outreach", c.last.outreach, "outreach entries logged last week"),
    count("last.companies", c.last.companies, "companies that got outreach last week"),
    count("last.members", c.last.members, "members who logged outreach last week"),
    count("prev.outreach", c.prev.outreach, "outreach entries logged the week before last"),
    { key: "trend.outreach", value: c.last.outreach - c.prev.outreach, text: trendText(c.last.outreach, c.prev.outreach), what: "last week's outreach entries next to the week before" },
    count("last.answers", c.last.answers, "companies that answered last week (moved to Replied, In conversation or Committed, or to Declined after being contacted)"),
    count("last.committed", c.last.committed, "companies that moved to Committed last week"),
    count("last.declined", c.last.declined, "companies that moved to Declined last week"),
    count("last.added", c.last.added, "companies added last week that are still active"),
    count("now.overdue", c.now.overdue, "open companies whose follow-up date has passed"),
    count("now.dueThisWeek", c.now.dueThisWeek, "open companies with a follow-up due from today to Sunday"),
    count("now.claimsEnding", c.now.claimsEnding, "live claims that end before next Monday"),
    count("now.liveClaims", c.now.liveClaims, "companies someone holds with a live claim"),
    count("now.freshLeads", c.now.freshLeads, "open companies nobody has contacted or claimed yet"),
    count("now.open", c.now.open, "open companies (not archived, not Committed or Declined)"),
  ];
}

// The verdict the stats page already decides, and the sample rule behind it. Only the names of the
// templates the verdict names go with it (at most two). Reads the whole stats page, so it is called
// only right before a brief is written, never for the code-only lines.
const VERDICT_KEYS = ["verdict.best", "verdict.worst", "verdict.rated", "rule.minSends", "rule.maturityDays"];
export async function verdictFacts(member: Membership): Promise<FactTable> {
  const table = buildFactTable(await workspaceStats(member, "none"));
  const facts = table.facts.filter((f) => VERDICT_KEYS.includes(f.key));
  const named = new Set(facts.filter((f) => f.key === "verdict.best" || f.key === "verdict.worst").map((f) => f.text));
  const names: Record<string, string> = {};
  for (const [key, name] of Object.entries(table.names)) {
    if (!named.has(name)) continue;
    names[key] = name;
    const nameFact = table.facts.find((f) => f.key === `${key}.name`);
    if (nameFact) facts.push(nameFact);
  }
  return { facts, names };
}

// Nothing happened and nothing is coming: no call is made, and the card shows the code lines alone.
export function isQuiet(c: WeeklyCounts): boolean {
  return c.last.outreach === 0 && c.last.answers === 0 && c.last.added === 0 && c.now.overdue === 0 && c.now.dueThisWeek === 0 && c.now.claimsEnding === 0;
}

// The numbers as plain sentences, by code alone: what the card shows before (or instead of) the
// model's words, and under "The numbers" after.
export function weeklyLines(c: WeeklyCounts): string[] {
  const lines: string[] = [];
  if (c.last.outreach === 0) lines.push("Last week nobody logged outreach.");
  else {
    lines.push(
      `Last week ${plural(c.last.members, "member", "members")} logged ${plural(c.last.outreach, "outreach entry", "outreach entries")} to ${plural(c.last.companies, "company", "companies")}, ${trendText(c.last.outreach, c.prev.outreach)}.`,
    );
  }
  lines.push(
    `${plural(c.last.answers, "company", "companies")} answered, ${formatCount(c.last.committed)} committed and ${formatCount(c.last.declined)} declined. ${plural(c.last.added, "company was", "companies were")} added.`,
  );
  lines.push(
    `This week: ${plural(c.now.overdue, "follow-up is", "follow-ups are")} overdue, ${formatCount(c.now.dueThisWeek)} ${c.now.dueThisWeek === 1 ? "is" : "are"} due by Sunday, and ${plural(c.now.claimsEnding, "claim ends", "claims end")} by Sunday.`,
  );
  lines.push(`${plural(c.now.open, "company is", "companies are")} open, ${formatCount(c.now.liveClaims)} held by a claim and ${plural(c.now.freshLeads, "fresh lead", "fresh leads")} waiting.`);
  return lines;
}
