import type { Channel, Stage } from "@/generated/prisma/enums";
import { dbNow, heldBy } from "@/lib/claims";
import { withTenant, type Tenant } from "@/lib/db";
import { scorecard, tally, type OutreachRow, type TemplateInfo } from "@/lib/stats-math";
import { currentBoardYear, monthOf, yearWindow, type YearWindow } from "./year";

// "Your year in Coppice" (Part 1 of the Time Capsule): code only, no AI. loadYearData reads the
// workspace's outreach, stage moves, companies and templates in a few flat queries, like
// lib/stats.ts does (never one per company), and recap() does all the counting on those rows, so
// every rule is tested with hand-worked numbers (tests/capsule-recap.test.ts).
//
// Anything the stats page also shows comes from lib/stats-math.ts, not from a second copy of its
// rules: sends are counted with tally(), and the best template is the scorecard's activeVerdict,
// named only when the scorecard rates one. A test compares them with lib/stats.ts. Nothing here
// ranks people against each other: "you" is only the person looking.

export type RecapOutreach = {
  id: string;
  companyId: string;
  senderId: string;
  templateId: string | null;
  channel: Channel;
  sentAt: Date;
  gotReply: boolean;
  aiDrafted: boolean;
};
export type RecapStageChange = { companyId: string; changedById: string; toStage: Stage; changedAt: Date };

// The rows one board year is worked out from. `outreach` holds every entry up to the end of the
// year, not only the year's own, so a company's touch number counts its earlier years too; recap()
// picks the year's entries out by `window`.
export type YearData = {
  now: Date;
  window: YearWindow;
  outreach: RecapOutreach[];
  // This year's moves into Replied or Committed.
  changes: RecapStageChange[];
  companies: Map<string, string>;
  templates: TemplateInfo[];
  // Companies the person holds right now.
  held: number;
};

export const MOVES_READ: Stage[] = ["REPLIED", "COMMITTED"];

export async function loadYearData(tenant: Tenant, start: number): Promise<YearData> {
  const now = await dbNow();
  const window = yearWindow(start);
  const { workspaceId } = tenant;
  const inYear = { gte: window.from, lt: window.to };
  const data = await withTenant(tenant, async (tx) => {
    const outreach = await tx.outreach.findMany({
      where: { workspaceId, sentAt: { lt: window.to } },
      select: { id: true, companyId: true, senderId: true, templateId: true, channel: true, sentAt: true, gotReply: true, aiDraftId: true },
    });
    const changes = await tx.stageChange.findMany({
      where: { workspaceId, toStage: { in: MOVES_READ }, changedAt: inYear },
      select: { companyId: true, changedById: true, toStage: true, changedAt: true },
    });
    const companies = await tx.company.findMany({
      where: { workspaceId, OR: [{ outreach: { some: { sentAt: inYear } } }, { stageChanges: { some: { toStage: { in: MOVES_READ }, changedAt: inYear } } }] },
      select: { id: true, name: true },
    });
    const templates = await tx.template.findMany({ where: { workspaceId }, select: { id: true, name: true, archivedAt: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
    const held = await tx.company.count({ where: { workspaceId, archivedAt: null, ...heldBy(tenant.userId, now) } });
    return { outreach, changes, companies, templates, held };
  });
  return {
    now,
    window,
    outreach: data.outreach.map(({ aiDraftId, ...o }) => ({ ...o, aiDrafted: aiDraftId !== null })),
    changes: data.changes,
    companies: new Map(data.companies.map((c) => [c.id, c.name])),
    templates: data.templates.map((t) => ({ id: t.id, name: t.name, archived: t.archivedAt !== null })),
    held: data.held,
  };
}

export type Recap = {
  year: { start: number; label: string };
  // Nothing was logged this year: the screen says there is nothing to look back on yet.
  empty: boolean;
  team: {
    companiesContacted: number;
    outreachLogged: number;
    // Every outreach marked as the one that got a reply (the stats page counts only sends old
    // enough to be rated, so its figure can be lower while sends are still maturing).
    repliesMarked: number;
    companiesCommitted: number;
    // The calendar month (1 to 12) with the most outreach; ties go to the earlier month in the
    // board year (July first).
    busiestMonth: { month: number; count: number } | null;
    longestThread: { companyId: string; name: string; count: number } | null;
    // The shortest time from an outreach to its company's move to Replied.
    fastestReply: { companyId: string; name: string; ms: number; outreachAt: string; repliedAt: string } | null;
    // Only when the scorecard rates a best template among the ones still in use; null reads "too early to tell".
    bestTemplate: { id: string; name: string; rate: number; replies: number; counted: number } | null;
  };
  you: { outreachLogged: number; repliesOnYours: number; committed: number; holding: number };
};

// Months in board-year order: July is first.
const boardOrder = (month: number) => (month + 5) % 12;

// The name of a company in this year's data; a company that isn't there reads as "A company".
const nameOf = (data: YearData, companyId: string) => data.companies.get(companyId) ?? "A company";

export function recap(data: YearData, userId: string): Recap {
  const { from, to } = data.window;
  const rows = data.outreach.filter((o) => o.sentAt >= from && o.sentAt < to);
  const outreachRows: OutreachRow[] = rows.map((o) => ({ ...o, industry: null }));
  // The same arithmetic as the stats page: tally() counts sends, scorecard() rates templates.
  const card = scorecard({ now: data.now, rows: outreachRows, templates: data.templates, repliedCompanyIds: [] });
  const sent = tally(outreachRows, data.now).sent;

  const perCompany = new Map<string, number>();
  const perMonth = new Map<number, number>();
  for (const row of rows) {
    perCompany.set(row.companyId, (perCompany.get(row.companyId) ?? 0) + 1);
    const month = monthOf(row.sentAt);
    perMonth.set(month, (perMonth.get(month) ?? 0) + 1);
  }
  const longest = [...perCompany.entries()].sort((a, b) => b[1] - a[1] || nameOf(data, a[0]).localeCompare(nameOf(data, b[0])) || a[0].localeCompare(b[0]))[0];
  const busiest = [...perMonth.entries()].sort((a, b) => b[1] - a[1] || boardOrder(a[0]) - boardOrder(b[0]))[0];

  const committed = data.changes.filter((c) => c.toStage === "COMMITTED");
  const byCompany = new Map<string, RecapOutreach[]>();
  for (const o of data.outreach) {
    const list = byCompany.get(o.companyId);
    if (list) list.push(o);
    else byCompany.set(o.companyId, [o]);
  }
  let fastest: Recap["team"]["fastestReply"] = null;
  for (const change of data.changes.filter((c) => c.toStage === "REPLIED")) {
    const before = (byCompany.get(change.companyId) ?? []).filter((o) => o.sentAt <= change.changedAt);
    if (before.length === 0) continue;
    const latest = before.reduce((a, b) => (b.sentAt > a.sentAt ? b : a));
    const ms = change.changedAt.getTime() - latest.sentAt.getTime();
    if (fastest === null || ms < fastest.ms || (ms === fastest.ms && change.companyId < fastest.companyId)) {
      fastest = { companyId: change.companyId, name: nameOf(data, change.companyId), ms, outreachAt: latest.sentAt.toISOString(), repliedAt: change.changedAt.toISOString() };
    }
  }

  const best = card.activeVerdict.best ? card.templates.find((t) => t.key === card.activeVerdict.best) : undefined;
  const mine = rows.filter((o) => o.senderId === userId);
  return {
    year: { start: data.window.start, label: data.window.label },
    empty: sent === 0,
    team: {
      companiesContacted: perCompany.size,
      outreachLogged: sent,
      repliesMarked: rows.filter((o) => o.gotReply).length,
      companiesCommitted: new Set(committed.map((c) => c.companyId)).size,
      busiestMonth: busiest ? { month: busiest[0], count: busiest[1] } : null,
      longestThread: longest ? { companyId: longest[0], name: nameOf(data, longest[0]), count: longest[1] } : null,
      fastestReply: fastest,
      bestTemplate: best && best.stat.rate !== null ? { id: best.key, name: best.name, rate: best.stat.rate, replies: best.stat.replies, counted: best.stat.counted } : null,
    },
    you: {
      outreachLogged: mine.length,
      repliesOnYours: mine.filter((o) => o.gotReply).length,
      committed: new Set(committed.filter((c) => c.changedById === userId).map((c) => c.companyId)).size,
      holding: data.held,
    },
  };
}

// The recap for a board year (this one unless a year is given), for the person asking.
export async function loadRecap(tenant: Tenant, start?: number): Promise<Recap> {
  return recap(await loadYearData(tenant, start ?? (await currentBoardYear())), tenant.userId);
}
