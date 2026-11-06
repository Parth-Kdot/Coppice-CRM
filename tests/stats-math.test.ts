import { describe, expect, it, test } from "vitest";
import {
  isMature,
  MIN_SENDS,
  NO_INDUSTRY,
  rate,
  scorecard,
  touchNumbers,
  touchOf,
  verdict,
  wilson,
  type OutreachRow,
  type Rated,
} from "@/lib/stats-math";

// The Scorecard's arithmetic on its own: no database, no AI. Expected values were worked out by hand
// (Wilson: centre = (p + z²/2n) / (1 + z²/n), half-width = z·√(p(1-p)/n + z²/4n²) / (1 + z²/n), z = 1.96).

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-05T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

describe("wilson", () => {
  test.each([
    // replies, sends, low, high
    [0, 10, 0, 0.2775],
    [10, 10, 0.7225, 1],
    [5, 10, 0.2366, 0.7634],
    [1, 20, 0.0089, 0.2361],
    [15, 25, 0.4074, 0.766],
    [2, 25, 0.0222, 0.2497],
    [1, 1, 0.20655, 1],
    [0, 1, 0, 0.79345],
  ])("%i replies of %i sends: %f to %f", (replies, sends, low, high) => {
    const interval = wilson(replies, sends);
    expect(interval?.low).toBeCloseTo(low, 4);
    expect(interval?.high).toBeCloseTo(high, 4);
  });

  test.each([0, -3, Number.NaN])("no interval for %f sends", (sends) => {
    expect(wilson(0, sends)).toBeNull();
  });

  it("keeps a bad count inside 0 to all sends", () => {
    expect(wilson(12, 10)).toEqual(wilson(10, 10));
    expect(wilson(-1, 10)).toEqual(wilson(0, 10));
  });

  it("narrows as the sample grows, around the same rate", () => {
    const small = wilson(3, 10) as { low: number; high: number };
    const big = wilson(300, 1000) as { low: number; high: number };
    expect(big.high - big.low).toBeLessThan(small.high - small.low);
    expect(big.low).toBeLessThan(0.3);
    expect(big.high).toBeGreaterThan(0.3);
  });
});

describe("the 14-day maturity rule", () => {
  test.each([
    ["sent 30 days ago", ago(30), true],
    ["sent exactly 14 days ago", ago(14), true],
    ["a millisecond short of 14 days", new Date(ago(14).getTime() + 1), false],
    ["sent today", ago(0), false],
    ["dated in the future", ago(-2), false],
  ])("%s: counts is %s", (_label, sentAt, mature) => {
    expect(isMature(sentAt, NOW)).toBe(mature);
  });
});

describe("touch numbers", () => {
  test.each([
    [1, "1"],
    [2, "2"],
    [3, "3+"],
    [9, "3+"],
  ] as const)("outreach number %i is touch %s", (n, touch) => {
    expect(touchOf(n)).toBe(touch);
  });

  it("numbers each company's outreach in time order, whatever order the rows come in", () => {
    const row = (id: string, companyId: string, days: number): OutreachRow => ({
      id,
      companyId,
      templateId: null,
      channel: "EMAIL",
      sentAt: ago(days),
      gotReply: false,
      aiDrafted: false,
      industry: null,
    });
    const touches = touchNumbers([row("c", "acme", 1), row("a", "acme", 30), row("x", "globex", 5), row("b", "acme", 10), row("d", "acme", 1)]);
    expect(Object.fromEntries(touches)).toEqual({ a: 1, b: 2, c: 3, d: 4, x: 1 });
  });
});

describe("the minimum sample rule", () => {
  test.each([
    ["nothing sent", { sent: 0, counted: 0, replies: 0 }, "none", null],
    ["all still maturing", { sent: 30, counted: 0, replies: 0 }, "too_few", null],
    ["one short of the minimum", { sent: 19, counted: 19, replies: 19 }, "too_few", 1],
    ["exactly the minimum, no replies", { sent: 20, counted: 20, replies: 0 }, "rated", 0],
    ["every send replied", { sent: 24, counted: 20, replies: 20 }, "rated", 1],
  ] as const)("%s: %s", (_label, t, status, r) => {
    const rated = rate(t);
    expect(rated.status).toBe(status);
    expect(rated.rate).toBe(r);
    expect(rated.maturing).toBe(t.sent - t.counted);
    expect(rated.interval === null).toBe(t.counted === 0);
  });

  it("uses MIN_SENDS, 20, unless told otherwise", () => {
    expect(MIN_SENDS).toBe(20);
    expect(rate({ sent: 5, counted: 5, replies: 1 }, 5).status).toBe("rated");
  });
});

describe("best and worst", () => {
  // A rated stat with this many replies out of `n` counted sends.
  const s = (replies: number, n: number, min = MIN_SENDS): Rated => rate({ sent: n, counted: n, replies }, min);

  test.each([
    ["no templates", [], null, null],
    ["one rated template", [["a", s(15, 25)]], null, null],
    ["two whose ranges overlap", [["a", s(12, 25)], ["b", s(8, 25)]], null, null],
    ["two clearly apart", [["a", s(15, 25)], ["b", s(2, 25)]], "a", "b"],
    ["one clearly ahead of two that overlap", [["a", s(20, 25)], ["b", s(5, 25)], ["c", s(3, 25)]], "a", null],
    ["one clearly behind two that overlap", [["a", s(20, 25)], ["b", s(18, 25)], ["c", s(1, 25)]], null, "c"],
    ["a far better template with too few sends is not ranked", [["a", s(10, 10)], ["b", s(8, 25)], ["c", s(7, 25)]], null, null],
    ["every template replied to every time", [["a", s(25, 25)], ["b", s(30, 30)]], null, null],
  ] as const)("%s", (_label, items, best, worst) => {
    const result = verdict(items.map(([key, stat]) => ({ key, stat })));
    expect(result.best).toBe(best);
    expect(result.worst).toBe(worst);
  });

  it("calls nothing when one range ends exactly where the other starts", () => {
    const a: Rated = { ...s(10, 20), interval: { low: 0.5, high: 0.8 } };
    const b: Rated = { ...s(2, 20), interval: { low: 0.1, high: 0.5 } };
    expect(verdict([{ key: "a", stat: a }, { key: "b", stat: b }])).toEqual({ best: null, worst: null, rated: 2 });
  });
});

describe("scorecard", () => {
  // A small hand-made workspace with a minimum sample of 4, so every rule shows with few rows.
  // t1 "Alumni": 6 counted (5 replies) + 1 maturing. t2 "Cold" (archived): 5 counted, 0 replies.
  // t3 "Fair": 2 counted. t4 "Unused": nothing. No template: 2 counted (1 reply, AI-drafted) and
  // 1 LinkedIn message.
  let n = 0;
  const row = (companyId: string, templateId: string | null, days: number, extra: Partial<OutreachRow> = {}): OutreachRow => ({
    id: `o${String(n++).padStart(2, "0")}`,
    companyId,
    templateId,
    channel: "EMAIL",
    sentAt: ago(days),
    gotReply: false,
    aiDrafted: false,
    industry: companyId.startsWith("tech") ? "Tech" : companyId.startsWith("energy") ? "Energy" : null,
    ...extra,
  });
  const replied = { gotReply: true };
  const rows: OutreachRow[] = [
    // Cold went out first, to tech-1..3 and energy-1..2: no replies.
    row("tech-1", "t2", 60),
    row("tech-2", "t2", 60),
    row("tech-3", "t2", 60),
    row("energy-1", "t2", 60),
    row("energy-2", "t2", 60),
    // Alumni followed up on all five (their 2nd touch) and reached a new one, energy-3.
    row("tech-1", "t1", 30, replied),
    row("tech-2", "t1", 30, replied),
    row("tech-3", "t1", 30),
    row("energy-1", "t1", 30, replied),
    row("energy-2", "t1", 30, replied),
    row("energy-3", "t1", 30, replied),
    // Still maturing: 3 days old, replied already, but not counted yet.
    row("other-1", "t1", 3, replied),
    row("other-2", "t3", 20, replied),
    row("other-3", "t3", 20),
    // No template: an AI draft that got a reply, a hand-written email, and a LinkedIn message (3rd touch for tech-1).
    row("other-4", null, 20, { gotReply: true, aiDrafted: true }),
    row("other-5", null, 20),
    row("tech-1", null, 15, { channel: "LINKEDIN" }),
  ];
  const templates = [
    { id: "t1", name: "Alumni", archived: false },
    { id: "t2", name: "Cold", archived: true },
    { id: "t3", name: "Fair", archived: false },
    { id: "t4", name: "Unused", archived: false },
  ];
  const input = { now: NOW, rows, templates, repliedCompanyIds: ["tech-1", "other-3", "lonely", "other-3"] };

  it("tallies each template, ranks only the rated ones and keeps archived templates", () => {
    const card = scorecard(input, "none", 4);
    expect(card.templates.map((t) => [t.name, t.archived, t.stat.status, t.stat.sent, t.stat.counted, t.stat.replies])).toEqual([
      // Rated first, highest rate first; then the rest by name.
      ["Alumni", false, "rated", 7, 6, 5],
      ["Cold", true, "rated", 5, 5, 0],
      ["Fair", false, "too_few", 2, 2, 1],
      ["Unused", false, "none", 0, 0, 0],
    ]);
    expect(card.templates[0].stat.rate).toBeCloseTo(5 / 6, 6);
    // Alumni 5/6: 0.4365 to 0.9699. Cold 0/5: 0 to 0.4345. Apart, so both are called.
    expect(card.templates[0].stat.interval?.low).toBeCloseTo(0.4365, 4);
    expect(card.templates[1].stat.interval?.high).toBeCloseTo(0.4345, 4);
    expect(card.verdict).toEqual({ best: "t1", worst: "t2", rated: 2 });
    expect(card.noTemplate).toMatchObject({ key: "none", name: "No template", stat: { sent: 3, counted: 3, replies: 1, status: "too_few" } });
  });

  it("splits by industry, with a No industry group last", () => {
    const card = scorecard(input, "industry", 4);
    const alumni = card.templates.find((t) => t.key === "t1");
    expect(alumni?.parts.map((p) => [p.label, p.stat.sent, p.stat.counted, p.stat.replies])).toEqual([
      ["Energy", 3, 3, 3],
      ["Tech", 3, 3, 2],
      [NO_INDUSTRY, 1, 0, 0],
    ]);
  });

  it("splits by touch: every template shows all three touches, in order", () => {
    const card = scorecard(input, "touch", 4);
    const parts = (key: string) => card.templates.find((t) => t.key === key)?.parts.map((p) => [p.label, p.stat.counted, p.stat.replies]);
    expect(parts("t1")).toEqual([
      ["1st touch", 1, 1],
      ["2nd touch", 5, 4],
      ["3rd touch or later", 0, 0],
    ]);
    expect(parts("t2")).toEqual([
      ["1st touch", 5, 0],
      ["2nd touch", 0, 0],
      ["3rd touch or later", 0, 0],
    ]);
    expect(card.byTouch.map((p) => [p.label, p.stat.sent, p.stat.counted, p.stat.replies])).toEqual([
      ["1st touch", 11, 10, 3],
      ["2nd touch", 5, 5, 4],
      ["3rd touch or later", 1, 1, 0],
    ]);
  });

  it("compares AI-drafted and hand-written emails only, and calls nothing on thin data", () => {
    const card = scorecard(input, "none", 4);
    expect(card.authorship.ai).toMatchObject({ sent: 1, counted: 1, replies: 1, status: "too_few" });
    // Every email that wasn't drafted: 15 sent, 14 counted (one maturing), 6 replies (5 Alumni, 1 Fair).
    // The LinkedIn message is left out.
    expect(card.authorship.hand).toMatchObject({ sent: 15, counted: 14, replies: 6, status: "rated" });
    expect(card.authorship.lead).toBeNull();
  });

  it("counts the gaps: no template, replied companies with nothing marked, and sends still maturing", () => {
    // tech-1 has marked replies; other-3 and lonely don't (other-3 is listed twice but counts once).
    expect(scorecard(input).gaps).toEqual({ noTemplate: 3, repliedUnmarked: 2, maturing: 1 });
  });

  it("handles an empty workspace", () => {
    const card = scorecard({ now: NOW, rows: [], templates: [], repliedCompanyIds: [] });
    expect(card.templates).toEqual([]);
    expect(card.verdict).toEqual({ best: null, worst: null, rated: 0 });
    expect(card.noTemplate.stat).toMatchObject({ sent: 0, status: "none", rate: null, interval: null });
    expect(card.gaps).toEqual({ noTemplate: 0, repliedUnmarked: 0, maturing: 0 });
  });
});
