import type { Tenant } from "@/lib/db";
import { workspaceStats } from "@/lib/stats";
import { touchNumbers, type ActiveVerdict, type OutreachRow, type Part, type Scorecard, type TemplateLine } from "@/lib/stats-math";
import { loadYearData, type YearData } from "./recap";
import { currentBoardYear, monthOf } from "./year";

// Step 2d: the playbook, one ledger page of what worked (code only, no model call). The template
// verdict, the reply rate by touch and AI-drafted against hand-written are exactly what the stats
// page shows, because they are workspaceStats() (lib/stats.ts, on all the workspace's outreach) and
// a test compares them. The month, touch and day figures are read from the board year's own rows
// (the recap's flat queries) and say how many companies they rest on.

const DAY_MS = 24 * 60 * 60 * 1000;

// The middle value (the mean of the two middle ones for an even count), or null for none.
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type Usual = { median: number; n: number };

export type YearFigures = {
  // The calendar month (1 to 12) in which most outreach marked as the reply was sent; ties go to
  // the earlier month of the board year (July first).
  monthWithMostReplies: { month: number; count: number } | null;
  // The usual touch number of the outreach that got a company's reply (1 is the first email).
  touchesBeforeReply: Usual | null;
  // The usual days from a company's first outreach to its move to Replied.
  daysToReply: Usual | null;
};

export function yearFigures(data: YearData): YearFigures {
  const { from, to } = data.window;
  const rows = data.outreach;
  const inYear = rows.filter((o) => o.sentAt >= from && o.sentAt < to);

  const perMonth = new Map<number, number>();
  for (const o of inYear.filter((r) => r.gotReply)) perMonth.set(monthOf(o.sentAt), (perMonth.get(monthOf(o.sentAt)) ?? 0) + 1);
  const best = [...perMonth.entries()].sort((a, b) => b[1] - a[1] || ((a[0] + 5) % 12) - ((b[0] + 5) % 12))[0];

  // Touch numbers count every earlier outreach to the company, this year's or not.
  const touches = touchNumbers(rows.map((o): OutreachRow => ({ ...o, industry: null })));
  const firstMarked = new Map<string, (typeof inYear)[number]>();
  for (const o of inYear.filter((r) => r.gotReply)) {
    const seen = firstMarked.get(o.companyId);
    if (!seen || o.sentAt < seen.sentAt) firstMarked.set(o.companyId, o);
  }
  const touchValues = [...firstMarked.values()].map((o) => touches.get(o.id) ?? 1);

  const firstSent = new Map<string, Date>();
  for (const o of rows) {
    const seen = firstSent.get(o.companyId);
    if (!seen || o.sentAt < seen) firstSent.set(o.companyId, o.sentAt);
  }
  const firstReplied = new Map<string, Date>();
  for (const c of data.changes.filter((ch) => ch.toStage === "REPLIED")) {
    const seen = firstReplied.get(c.companyId);
    if (!seen || c.changedAt < seen) firstReplied.set(c.companyId, c.changedAt);
  }
  const dayValues = [...firstReplied.entries()].flatMap(([companyId, repliedAt]) => {
    const first = firstSent.get(companyId);
    return first && first <= repliedAt ? [Math.round(((repliedAt.getTime() - first.getTime()) / DAY_MS) * 10) / 10] : [];
  });

  const usual = (values: number[]): Usual | null => {
    const m = median(values);
    return m === null ? null : { median: m, n: values.length };
  };
  return {
    monthWithMostReplies: best ? { month: best[0], count: best[1] } : null,
    touchesBeforeReply: usual(touchValues),
    daysToReply: usual(dayValues),
  };
}

export type Playbook = YearFigures & {
  year: { start: number; label: string };
  // From the stats page, among the templates still in use. Both null reads "too early to tell"
  // (rated says how many templates have enough sends to be rated at all).
  best: TemplateLine | null;
  worst: TemplateLine | null;
  rated: number;
  retiredBetter: ActiveVerdict["retiredBetter"];
  byTouch: Part[];
  authorship: Scorecard["authorship"];
};

export async function loadPlaybook(tenant: Tenant, start?: number): Promise<Playbook> {
  const year = start ?? (await currentBoardYear());
  const [stats, data] = [await workspaceStats(tenant), await loadYearData(tenant, year)];
  const line = (key: string | null) => stats.templates.find((t) => t.key === key) ?? null;
  return {
    year: { start: data.window.start, label: data.window.label },
    ...yearFigures(data),
    best: line(stats.activeVerdict.best),
    worst: line(stats.activeVerdict.worst),
    rated: stats.activeVerdict.rated,
    retiredBetter: stats.activeVerdict.retiredBetter,
    byTouch: stats.byTouch,
    authorship: stats.authorship,
  };
}
