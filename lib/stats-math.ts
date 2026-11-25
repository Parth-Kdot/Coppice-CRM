import type { Channel } from "@/generated/prisma/enums";
import { DAY_MS } from "@/lib/dates";

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
// - Next to the ranges, a chance figure says how likely one group's true reply rate is to be higher
//   than another's. Each rate starts from no opinion (a Beta(1,1) prior, as if one reply and one
//   miss), and the chance is an exact sum, so it never depends on randomness. A template is compared
//   only with the pooled counted sends of the other rated templates people can still use, the same
//   set that decides best and worst. The chance never decides best or worst, and a chance that
//   would read against a best or worst badge is left out.

export const MATURITY_DAYS = 14;
export const MIN_SENDS = 20;
// The z value for a two-sided 95% interval.
export const Z_95 = 1.959963984540054;

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

// ----- Chance figures (Beta posteriors) -----

export type Counts = { counted: number; replies: number };
export type Posterior = { alpha: number; beta: number };

// Whole, non-negative counts with replies never above counted. Bad input reads as no sends.
function cleanCounts({ counted, replies }: Counts): Counts {
  const n = Number.isFinite(counted) && counted > 0 ? Math.round(counted) : 0;
  const r = Number.isFinite(replies) && replies > 0 ? Math.min(Math.round(replies), n) : 0;
  return { counted: n, replies: r };
}

// The uniform Beta(1,1) prior updated with the counts: one more than the replies, one more than the misses.
export function posterior(counts: Counts): Posterior {
  const { counted, replies } = cleanCounts(counts);
  return { alpha: replies + 1, beta: counted - replies + 1 };
}

// ln(n!) for whole n, from a table of running sums of ln(k) that grows when a bigger n is asked for.
// The sums are compensated (Kahan), so ln(n!) stays accurate to about 1e-12 even at n in the tens of thousands.
let lnFactTable = new Float64Array([0, 0]);
let lnFactCarry = 0;
function lnF(n: number): number {
  if (n >= lnFactTable.length) {
    const size = Math.max(n + 1, lnFactTable.length * 2);
    const next = new Float64Array(size);
    next.set(lnFactTable);
    for (let k = lnFactTable.length; k < size; k++) {
      const y = Math.log(k) - lnFactCarry;
      const t = next[k - 1] + y;
      lnFactCarry = t - next[k - 1] - y;
      next[k] = t;
    }
    lnFactTable = next;
  }
  return lnFactTable[n];
}
// ln of the Beta function for whole x, y of at least 1.
const lnB = (x: number, y: number) => lnF(x - 1) + lnF(y - 1) - lnF(x + y - 1);

// P(y's true rate is higher than x's), as the exact finite sum for whole-number Beta parameters:
// the sum for i from 0 to alpha_y - 1 of B(alpha_x + i, beta_x + beta_y) / ((beta_y + i) B(1 + i, beta_y) B(alpha_x, beta_x)).
// Added up in log space (each term relative to the largest), so big counts neither overflow nor underflow.
function chanceYAboveX(x: Posterior, y: Posterior): number {
  const terms = new Float64Array(y.alpha);
  const base = lnB(x.alpha, x.beta);
  let top = -Infinity;
  for (let i = 0; i < y.alpha; i++) {
    const t = lnB(x.alpha + i, x.beta + y.beta) - Math.log(y.beta + i) - lnB(1 + i, y.beta) - base;
    terms[i] = t;
    if (t > top) top = t;
  }
  let sum = 0;
  for (let i = 0; i < terms.length; i++) sum += Math.exp(terms[i] - top);
  return Math.exp(top + Math.log(sum));
}

// The chance that a's true reply rate is higher than b's. Exact and deterministic; the sum runs over
// whichever side has the smaller alpha. Always between 0 and 1, and chanceAbove(a, b) + chanceAbove(b, a) is 1.
export function chanceAbove(a: Counts, b: Counts): number {
  const pa = posterior(a);
  const pb = posterior(b);
  const p = pa.alpha <= pb.alpha ? chanceYAboveX(pb, pa) : 1 - chanceYAboveX(pa, pb);
  return Math.min(1, Math.max(0, p));
}

// A chance that reads against a badge is never shown: a best needs at least an even chance, a worst
// at most one. Anything with no badge always agrees.
export function agreesWithStanding(chance: number, standing: "best" | "worst" | null): boolean {
  if (standing === "best") return chance >= 0.5;
  if (standing === "worst") return chance <= 0.5;
  return true;
}

export type LeadingPair = { first: string; second: string; chance: number };

// The two rated templates in use with the highest rates (name breaks a tie), and the chance the
// first's true rate is higher than the second's. Null with fewer than two.
export function leadingPair(templates: readonly TemplateLine[], min = MIN_SENDS): LeadingPair | null {
  const rated = templates
    .filter((t) => !t.archived && t.stat.status === "rated" && t.stat.rate !== null && t.stat.counted >= min)
    .sort((a, b) => (b.stat.rate as number) - (a.stat.rate as number) || a.name.localeCompare(b.name));
  if (rated.length < 2) return null;
  const [first, second] = rated;
  return { first: first.key, second: second.key, chance: chanceAbove(first.stat, second.stat) };
}

export type Chances = {
  // Template key to its chance of a higher true rate than the pooled other rated templates in use.
  vsOthers: Record<string, number>;
  pair: LeadingPair | null;
  // AI-drafted emails against hand-written ones, when both are rated.
  authorship: number | null;
};

function chancesOf(templates: readonly TemplateLine[], standing: Verdict<string>, ai: Rated, hand: Rated, min: number): Chances {
  const rated = templates.filter((t) => !t.archived && t.stat.status === "rated" && t.stat.counted >= min);
  const vsOthers: Record<string, number> = {};
  for (const t of rated) {
    const others = rated.filter((o) => o !== t);
    if (others.length === 0) continue;
    const pooled = { counted: others.reduce((n, o) => n + o.stat.counted, 0), replies: others.reduce((n, o) => n + o.stat.replies, 0) };
    if (pooled.counted < min) continue;
    const chance = chanceAbove(t.stat, pooled);
    const badge = t.key === standing.best ? "best" : t.key === standing.worst ? "worst" : null;
    if (agreesWithStanding(chance, badge)) vsOthers[t.key] = chance;
  }
  const bothRated = ai.status === "rated" && hand.status === "rated" && ai.counted >= min && hand.counted >= min;
  return { vsOthers, pair: leadingPair(templates, min), authorship: bothRated ? chanceAbove(ai, hand) : null };
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
  // Best and worst among every template, archived ones included (history).
  verdict: Verdict<string>;
  // Best and worst among the templates people can still use, which is what the page names; and a
  // retired template that did better than all of them, noted underneath.
  activeVerdict: ActiveVerdict;
  // Emails only (an AI draft is always an email, so other channels would not compare like for like).
  authorship: { ai: Rated; hand: Rated; lead: "ai" | "hand" | null };
  // Chance figures beside the Wilson ranges. They never decide best or worst.
  chances: Chances;
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

export type ActiveVerdict = Verdict<string> & { retiredBetter: { key: string; name: string; rate: number } | null };

// Best and worst among active templates only. An archived template can't be picked any more, so it
// is never named best or worst; if a rated one beat every active rated template, it is returned as
// retiredBetter ("A retired template did better: Fall pitch (49%)").
export function activeVerdict(templates: readonly TemplateLine[]): ActiveVerdict {
  const active = templates.filter((t) => !t.archived);
  const v = verdict(active.map((t) => ({ key: t.key, stat: t.stat })));
  const rated = (t: TemplateLine) => t.stat.status === "rated" && t.stat.rate !== null;
  const topActive = Math.max(-1, ...active.filter(rated).map((t) => t.stat.rate as number));
  const retired = templates
    .filter((t) => t.archived && rated(t) && (t.stat.rate as number) > topActive)
    .sort((a, b) => (b.stat.rate as number) - (a.stat.rate as number))[0];
  return { ...v, retiredBetter: retired && topActive >= 0 ? { key: retired.key, name: retired.name, rate: retired.stat.rate as number } : null };
}

// ----- Formatting, shared by the page and its tests -----

const COUNT = new Intl.NumberFormat("en-US");
// "4,440".
export const formatCount = (n: number) => COUNT.format(n);

// "49%". A value above 0 that would round to 0% or 1% reads "<1%", so a tiny but real rate (or the
// top of a range) never looks like a certain zero; exactly 0 stays "0%".
export function formatPct(x: number): string {
  if (x > 0 && x < 0.01) return "<1%";
  if (x < 1 && x > 0.99) return ">99%";
  return `${Math.round(x * 100)}%`;
}

// "98% chance". Never "0%" or "100%": the figure is a chance, so it is never shown as certain.
export const formatChance = (p: number) => `${formatPct(Math.min(0.999, Math.max(0.001, p)))} chance`;
// "98% chance above the other rated templates".
export const vsOthersText = (p: number) => `${formatChance(p)} above the other rated templates`;
// "Alumni angle against Career fair: 89% chance of the higher true reply rate".
export const pairText = (first: string, second: string, p: number) => `${first} against ${second}: ${formatChance(p)} of the higher true reply rate`;
// "63% chance AI-drafted emails have the higher true reply rate".
export const authorshipChanceText = (p: number) => `${formatChance(p)} AI-drafted emails have the higher true reply rate`;

// "12% to 31%".
export const formatRange = (i: Interval) => `${formatPct(i.low)} to ${formatPct(i.high)}`;

// The industries worth showing under a template: the `n` with the most counted sends, then ordered
// by reply rate (highest first; no rate yet last). The rest stay one click away.
export function topParts(parts: readonly Part[], n = 5): { top: Part[]; rest: Part[] } {
  const bySends = [...parts].sort((a, b) => b.stat.counted - a.stat.counted || b.stat.sent - a.stat.sent || a.label.localeCompare(b.label));
  const byRate = (list: Part[]) => list.sort((a, b) => (b.stat.rate ?? -1) - (a.stat.rate ?? -1) || a.label.localeCompare(b.label));
  return { top: byRate(bySends.slice(0, n)), rest: byRate(bySends.slice(n)) };
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

  const standing = activeVerdict(templates);

  return {
    templates,
    noTemplate: line(NO_TEMPLATE, "No template", false),
    verdict: verdict(templates.map((t) => ({ key: t.key, stat: t.stat }))),
    activeVerdict: standing,
    authorship: { ai, hand, lead: authorVerdict.best },
    chances: chancesOf(templates, standing, ai, hand, min),
    byTouch: partsOf(rows, "touch", touches, now, min),
    gaps: {
      noTemplate: rows.filter((r) => r.templateId === null).length,
      repliedUnmarked: new Set(input.repliedCompanyIds.filter((id) => !marked.has(id))).size,
      maturing: all.sent - all.counted,
    },
  };
}
