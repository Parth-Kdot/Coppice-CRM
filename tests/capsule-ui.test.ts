import { describe, expect, it, test } from "vitest";
import { contactSpan, groupByStage, monthName, plural, spanWords } from "@/components/ledger/capsule/format";
import { recapPages } from "@/components/ledger/capsule/recap-pages";
import { firstStep, STEPS, unappliedDates } from "@/components/ledger/capsule/steps";
import { swipeFor, turnFor } from "@/components/ledger/capsule/turn";
import type { CalendarRow, OwnerView, Recap } from "@/lib/capsule";

// The Time Capsule screens' decisions that need no browser: what each recap page says, what a key
// or a swipe means, how a handoff's cards group, and which step the stepper opens on.

const recap = (over: Partial<Recap["team"]> = {}, you: Partial<Recap["you"]> = {}, empty = false): Recap => ({
  year: { start: 2026, label: "2026-27" },
  empty,
  team: {
    companiesContacted: 30,
    outreachLogged: 81,
    repliesMarked: 12,
    companiesCommitted: 5,
    busiestMonth: { month: 10, count: 54 },
    longestThread: { companyId: "c1", name: "Atlas", count: 7 },
    fastestReply: { companyId: "c2", name: "Cedar", ms: 25 * 3_600_000, outreachAt: "2026-10-01T00:00:00Z", repliedAt: "2026-10-02T01:00:00Z" },
    bestTemplate: { id: "t1", name: "First touch", rate: 0.346, replies: 9, counted: 26 },
    ...over,
  },
  you: { outreachLogged: 20, repliesOnYours: 3, committed: 1, holding: 4, ...you },
});

describe("recapPages", () => {
  it("makes a cover, one figure per page and a closing page, every line saying this year", () => {
    const pages = recapPages(recap());
    expect(pages.map((p) => p.key)).toEqual(["cover", "contacted", "outreach", "replies", "committed", "busiest", "longest", "fastest", "template", "you-logged", "you-replies", "you-committed", "you-holding", "close"]);
    expect(pages[0]).toMatchObject({ kind: "cover", value: "2026-27" });
    expect(pages.at(-1)).toMatchObject({ kind: "close" });
    for (const p of pages.filter((p) => p.kind === "figure" && !["template", "fastest", "you-holding"].includes(p.key))) expect(p.line, p.key).toMatch(/this year/);
    expect(pages.find((p) => p.key === "contacted")).toMatchObject({ value: "30", line: "companies were contacted this year." });
    expect(pages.find((p) => p.key === "busiest")).toMatchObject({ value: "October", word: true });
    expect(pages.find((p) => p.key === "fastest")).toMatchObject({ value: "25 hours" });
    expect(pages.find((p) => p.key === "template")).toMatchObject({ value: "35%" });
  });

  it("leaves out a figure the year doesn't have, and says too early when no template is rated", () => {
    const pages = recapPages(recap({ busiestMonth: null, longestThread: null, fastestReply: null, bestTemplate: null }));
    expect(pages.map((p) => p.key)).not.toEqual(expect.arrayContaining(["busiest"]));
    expect(pages.some((p) => ["busiest", "longest", "fastest"].includes(p.key))).toBe(false);
    expect(pages.find((p) => p.key === "template")).toMatchObject({ value: "Too early", word: true });
  });

  it("says singular for one and keeps zero as a number", () => {
    const pages = recapPages(recap({ companiesContacted: 1, outreachLogged: 1, repliesMarked: 0 }, { holding: 1, committed: 0 }));
    expect(pages.find((p) => p.key === "contacted")?.line).toBe("company was contacted this year.");
    expect(pages.find((p) => p.key === "replies")).toMatchObject({ value: "0", line: "replies were marked this year." });
    expect(pages.find((p) => p.key === "you-holding")?.line).toBe("company is yours to work right now.");
    expect(pages.find((p) => p.key === "you-committed")?.value).toBe("0");
  });

  it("is one page that says there is nothing to look back on in an empty year", () => {
    const pages = recapPages(recap({}, {}, true));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ kind: "empty", value: "Nothing yet" });
    expect(pages[0].line).toMatch(/nothing to look back on yet/);
  });

  it("never uses an em dash, an arrow or a plus sign", () => {
    for (const p of [...recapPages(recap()), ...recapPages(recap({}, {}, true))]) expect(`${p.kicker} ${p.value} ${p.line}`).not.toMatch(/[—→+=]/);
  });
});

describe("format", () => {
  test.each([
    [10 * 60_000, 10, "minute"],
    [20_000, 1, "minute"],
    [90 * 60_000, 2, "hour"],
    [47 * 3_600_000, 47, "hour"],
    [49 * 3_600_000, 2, "day"],
    [10 * 86_400_000, 10, "day"],
  ])("a reply %i ms after is %i %s", (ms, value, unit) => {
    expect(spanWords(ms)).toEqual({ value, unit });
  });

  it("names months and refuses anything else", () => {
    expect(monthName(1)).toBe("January");
    expect(monthName(12)).toBe("December");
    for (const bad of [0, 13, 2.5, Number.NaN]) expect(monthName(bad)).toBeNull();
  });

  it("pluralizes and groups", () => {
    expect(plural(1, "card", "cards")).toBe("1 card");
    expect(plural(1200, "card", "cards")).toBe("1,200 cards");
    const groups = groupByStage([
      { id: 1, stage: "DECLINED" as const },
      { id: 2, stage: "COMMITTED" as const },
      { id: 3, stage: "CONTACTED" as const },
      { id: 4, stage: "COMMITTED" as const },
    ] as const);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["Committed", [2, 4]],
      ["Contacted", [3]],
      ["Declined", [1]],
    ]);
  });

  it("writes a contact span from the first and last day", () => {
    expect(contactSpan("2026-10-05T12:00:00Z", "2026-12-01T12:00:00Z")).toBe("Oct 5 to Dec 1");
    expect(contactSpan("2026-10-05T12:00:00Z", "2026-10-05T18:00:00Z")).toBe("Oct 5");
    expect(contactSpan(null, null)).toBeNull();
  });
});

describe("keys and swipes in the recap", () => {
  test.each([
    ["ArrowRight", "next"],
    ["ArrowDown", "next"],
    ["PageDown", "next"],
    ["ArrowLeft", "back"],
    ["ArrowUp", "back"],
    ["Home", "first"],
    ["End", "last"],
    ["Enter", null],
    ["a", null],
  ])("%s means %s", (key, turn) => {
    expect(turnFor({ key })).toBe(turn);
  });

  it("leaves browser and tour shortcuts alone", () => {
    for (const mod of ["altKey", "ctrlKey", "metaKey"] as const) expect(turnFor({ key: "ArrowRight", [mod]: true })).toBeNull();
  });

  test.each([
    [-120, 10, "next"],
    [120, -10, "back"],
    [-30, 0, null],
    [-80, 90, null],
    [60, 30, "back"],
    [0, 200, null],
  ])("a swipe of %i across and %i down turns to %s", (dx, dy, turn) => {
    expect(swipeFor(dx, dy)).toBe(turn);
  });
});

const view = (over: { status?: "DRAFT" | "PUBLISHED"; next?: number | null; pending?: number; approved?: number } = {}): OwnerView =>
  ({
    report: { id: "r", boardYearStart: 2026, label: "2026-27", status: over.status ?? "DRAFT", createdAt: "", publishedAt: null, companies: 3, chunkCount: 1 },
    chunks: { total: 1, done: 0, next: over.next === undefined ? null : over.next },
    cards: [],
    counts: { cards: 3, approved: over.approved ?? 0, hidden: 0, pending: over.pending ?? 0 },
    ai: { on: true, configured: true },
  }) as OwnerView;

describe("the stepper", () => {
  it("has six steps in order", () => {
    expect(STEPS.map((s) => s.key)).toEqual(["leaving", "cards", "review", "playbook", "calendar", "publish"]);
  });

  test.each([
    ["no handoff yet", null, 0],
    ["chunks left to read", view({ next: 2, pending: 3 }), 1],
    ["cards still to review", view({ pending: 2, approved: 1 }), 2],
    ["nothing approved yet", view({ pending: 0, approved: 0 }), 2],
    ["all approved", view({ approved: 3 }), 4],
    ["published", view({ status: "PUBLISHED", approved: 3 }), 5],
  ])("opens on the right step: %s", (_, v, step) => {
    expect(firstStep(v)).toBe(step);
  });

  it("counts the saved dates that aren't on their company yet, ignoring closed deals", () => {
    const row = (over: Partial<CalendarRow>): CalendarRow => ({ cardId: "k", companyId: "c", name: "A", stage: "CONTACTED", proposed: null, date: null, followUp: null, closed: null, ...over });
    expect(
      unappliedDates([
        row({ date: "2027-01-01", followUp: null }),
        row({ date: "2027-01-01", followUp: "2027-01-01" }),
        row({ date: null }),
        row({ date: "2027-02-01", followUp: "2027-01-01" }),
        row({ stage: "COMMITTED", closed: "COMMITTED", date: "2027-03-01" }),
        row({ stage: "DECLINED", closed: "DECLINED", date: "2027-03-01" }),
      ]),
    ).toBe(2);
  });
});
