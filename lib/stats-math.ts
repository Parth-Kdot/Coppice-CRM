import type { Channel } from "@/generated/prisma/enums";

// The Scorecard's arithmetic: pure functions, no database and no AI, so every rule here is tested
// on its own with hand-worked numbers (tests/stats-math.test.ts). lib/stats.ts reads the rows and
// the database's clock and hands them in.
//
// The rules, so a chair never reads more into the numbers than they hold:
// - A send counts only once it is 14 days old by the database clock (MATURITY_DAYS). Replies take
//   time; a send from yesterday with no answer yet is not a failure. Younger sends are shown as
//   "still maturing" and left out of the rate entirely, replied or not, so the rate isn't flattered.
// - A template is rated only with at least MIN_SENDS counted sends. Below that it says "not enough
//   data yet" and is never ranked.
// - Every rate carries its 95% Wilson score interval: the range the true reply rate plausibly sits in.
// - A template is called best only when its whole interval sits above every other rated template's
//   interval, and worst only when it sits wholly below. Overlapping intervals mean the data can't
//   tell them apart yet, so nothing is called.

export const MATURITY_DAYS = 14;
export const MIN_SENDS = 20;
// The z value for a two-sided 95% interval.
export const Z_95 = 1.959963984540054;

const DAY_MS = 24 * 60 * 60 * 1000;

export type Interval = { low: number; high: number };

// The Wilson score interval for `replies` out of `sends`. Unlike the plain p ± z·√(p(1-p)/n), it
// stays inside 0 to 1 and doesn't collapse to a single point at 0 or all replies. No sends, no interval.
export function wilson(replies: number, sends: number, z = Z_95): Interval | null {
  if (!Number.isFinite(sends) || sends <= 0) return null;
  const x = Math.min(Math.max(replies, 0), sends);
  const p = x / sends;
  const z2 = z * z;
  const denominator = 1 + z2 / sends;
  const centre = (p + z2 / (2 * sends)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / sends + z2 / (4 * sends * sends))) / denominator;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

// Whether a send is old enough to count. `now` is the database's clock (dbNow), never the server's.
export function isMature(sentAt: Date, now: Date, days = MATURITY_DAYS): boolean {
  return now.getTime() - sentAt.getTime() >= days * DAY_MS;
}

// Touch number: the 1st, 2nd, or 3rd-or-later outreach to the same company.
export type Touch = "1" | "2" | "3+";
export const TOUCH_LABELS: Record<Touch, string> = { "1": "1st touch", "2": "2nd touch", "3+": "3rd touch or later" };
export const TOUCHES: Touch[] = ["1", "2", "3+"];
export const touchOf = (n: number): Touch => (n <= 1 ? "1" : n === 2 ? "2" : "3+");

// One outreach entry, as lib/stats.ts reads it.
export type OutreachRow = {
  id: string;
  companyId: string;
  templateId: string | null;
  channel: Channel;
  sentAt: Date;
  gotReply: boolean;
  aiDrafted: boolean;
  industry: string | null;
};

// Each entry's touch number within its company: entries ordered by time (then id, so two entries
// logged in the same millisecond still get a stable order).
export function touchNumbers(rows: readonly OutreachRow[]): Map<string, number> {
  const sorted = [...rows].sort(
    (a, b) => a.companyId.localeCompare(b.companyId) || a.sentAt.getTime() - b.sentAt.getTime() || a.id.localeCompare(b.id),
  );
  const out = new Map<string, number>();
  let company: string | null = null;
  let n = 0;
  for (const row of sorted) {
    n = row.companyId === company ? n + 1 : 1;
    company = row.companyId;
    out.set(row.id, n);
  }
  return out;
}

// sent: every entry. counted: the mature ones, which are the rate's denominator. replies: counted
// entries marked as the reply.
export type Tally = { sent: number; counted: number; replies: number };

export function tally(rows: readonly OutreachRow[], now: Date): Tally {
  let counted = 0;
  let replies = 0;
  for (const row of rows) {
    if (!isMature(row.sentAt, now)) continue;
    counted += 1;
    if (row.gotReply) replies += 1;
  }
  return { sent: rows.length, counted, replies };
}

// "none": nothing sent. "too_few": sent, but fewer than MIN_SENDS counted (including all still
// maturing). "rated": enough to show a rate and take part in best and worst.
export type RateStatus = "none" | "too_few" | "rated";
export type Rated = Tally & { maturing: number; rate: number | null; interval: Interval | null; status: RateStatus };

export function rate(t: Tally, min = MIN_SENDS): Rated {
  const status: RateStatus = t.sent === 0 ? "none" : t.counted < min ? "too_few" : "rated";
  return {
    ...t,
    maturing: t.sent - t.counted,
    rate: t.counted > 0 ? t.replies / t.counted : null,
    interval: wilson(t.replies, t.counted),
    status,
  };
}

// A whole interval above (or below) every other one. Touching ends count as overlapping.
const above = (a: Interval, b: Interval) => a.low > b.high;

export type Verdict<K> = { best: K | null; worst: K | null; rated: number };

// Best and worst among the rated items, by the rule at the top of this file. Needs two rated items.
export function verdict<K>(items: readonly { key: K; stat: Rated }[]): Verdict<K> {
  const rated = items.filter((i): i is { key: K; stat: Rated & { interval: Interval } } => i.stat.status === "rated" && i.stat.interval !== null);
  if (rated.length < 2) return { best: null, worst: null, rated: rated.length };
  const best = rated.find((a) => rated.every((b) => b === a || above(a.stat.interval, b.stat.interval)));
  const worst = rated.find((a) => rated.every((b) => b === a || above(b.stat.interval, a.stat.interval)));
  return { best: best?.key ?? null, worst: worst?.key ?? null, rated: rated.length };
}

// ----- The Scorecard -----

export const NO_TEMPLATE = "none";
export type Split = "none" | "industry" | "touch";
export const NO_INDUSTRY = "No industry";

export type TemplateInfo = { id: string; name: string; archived: boolean };
export type Part = { label: string; stat: Rated };
export type TemplateLine = { key: string; name: string; archived: boolean; stat: Rated; parts: Part[] };

export type Scorecard = {
  // Real templates: rated ones by reply rate (highest first), then the rest by name.
  templates: TemplateLine[];
  // Outreach logged without a template, kept apart: it is not a template and is never ranked.
  noTemplate: TemplateLine;
  verdict: Verdict<string>;
  // Emails only (an AI draft is always an email, so other channels would not compare like for like).
  authorship: { ai: Rated; hand: Rated; lead: "ai" | "hand" | null };
  byTouch: Part[];
  gaps: { noTemplate: number; repliedUnmarked: number; maturing: number };
};

export type ScorecardInput = {
  now: Date;
  rows: readonly OutreachRow[];
  templates: readonly TemplateInfo[];
  // Companies in a reply stage (Replied, In conversation, Committed), not archived.
  repliedCompanyIds: readonly string[];
};

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function partsOf(rows: readonly OutreachRow[], split: Split, touches: Map<string, number>, now: Date, min: number): Part[] {
  if (split === "none") return [];
  const groups = new Map<string, OutreachRow[]>();
  const keyOf = (row: OutreachRow) => (split === "touch" ? TOUCH_LABELS[touchOf(touches.get(row.id) ?? 1)] : (row.industry?.trim() || NO_INDUSTRY));
  // Touches always show all three, in order, so rows line up from template to template.
  if (split === "touch") for (const t of TOUCHES) groups.set(TOUCH_LABELS[t], []);
  for (const row of rows) {
    const key = keyOf(row);
    push(groups, key, row);
  }
  const parts = [...groups.entries()].map(([label, group]) => ({ label, stat: rate(tally(group, now), min) }));
  if (split === "industry") {
    parts.sort((a, b) => (a.label === NO_INDUSTRY ? 1 : b.label === NO_INDUSTRY ? -1 : a.label.localeCompare(b.label)));
  }
  return parts;
}

export function scorecard(input: ScorecardInput, split: Split = "none", min = MIN_SENDS): Scorecard {
  const { now, rows } = input;
  const touches = touchNumbers(rows);
  const byTemplate = new Map<string, OutreachRow[]>();
  for (const row of rows) {
    push(byTemplate, row.templateId ?? NO_TEMPLATE, row);
  }
  const line = (key: string, name: string, archived: boolean): TemplateLine => {
    const group = byTemplate.get(key) ?? [];
    return { key, name, archived, stat: rate(tally(group, now), min), parts: partsOf(group, split, touches, now, min) };
  };

  const templates = input.templates.map((t) => line(t.id, t.name, t.archived));
  templates.sort((a, b) => {
    const ra = a.stat.status === "rated" ? 0 : 1;
    const rb = b.stat.status === "rated" ? 0 : 1;
    if (ra !== rb) return ra - rb;
    if (ra === 0 && a.stat.rate !== b.stat.rate) return (b.stat.rate ?? 0) - (a.stat.rate ?? 0);
    return a.name.localeCompare(b.name);
  });

  const emails = rows.filter((r) => r.channel === "EMAIL");
  const ai = rate(tally(emails.filter((r) => r.aiDrafted), now), min);
  const hand = rate(tally(emails.filter((r) => !r.aiDrafted), now), min);
  const authorVerdict = verdict([
    { key: "ai" as const, stat: ai },
    { key: "hand" as const, stat: hand },
  ]);

  const marked = new Set(rows.filter((r) => r.gotReply).map((r) => r.companyId));
  const all = tally(rows, now);

  return {
    templates,
    noTemplate: line(NO_TEMPLATE, "No template", false),
    verdict: verdict(templates.map((t) => ({ key: t.key, stat: t.stat }))),
    authorship: { ai, hand, lead: authorVerdict.best },
    byTouch: partsOf(rows, "touch", touches, now, min),
    gaps: {
      noTemplate: rows.filter((r) => r.templateId === null).length,
      repliedUnmarked: new Set(input.repliedCompanyIds.filter((id) => !marked.has(id))).size,
      maturing: all.sent - all.counted,
    },
  };
}
