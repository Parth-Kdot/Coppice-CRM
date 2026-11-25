import { describe, expect, it, test } from "vitest";
import { isOpenByDefault, weekEndOf, weekRanges, weekStartOf } from "@/lib/weekly-brief/week";

// The Monday brief's week math: pure calendar dates, Monday 00:00 in West Lafayette, across the
// daylight-saving changes.

describe("weekStartOf", () => {
  // Nov 23, 2026 is a Monday.
  test.for([
    ["2026-11-23", "2026-11-23"],
    ["2026-11-24", "2026-11-23"],
    ["2026-11-25", "2026-11-23"],
    ["2026-11-26", "2026-11-23"],
    ["2026-11-27", "2026-11-23"],
    ["2026-11-28", "2026-11-23"],
    // A Sunday belongs to the Monday six days before.
    ["2026-11-29", "2026-11-23"],
    ["2026-11-30", "2026-11-30"],
  ])("%s starts the week of %s", ([day, monday]) => {
    expect(weekStartOf(day)).toBe(monday);
  });

  it("crosses a month and a year", () => {
    expect(weekStartOf("2026-12-03")).toBe("2026-11-30");
    expect(weekStartOf("2027-01-01")).toBe("2026-12-28");
  });

  it("names the Sunday that ends the week", () => {
    expect(weekEndOf("2026-11-23")).toBe("2026-11-29");
  });
});

describe("weekRanges", () => {
  it("gives four Mondays at local midnight that touch with no gap", () => {
    const r = weekRanges("2026-11-23");
    // EST is UTC-5 in November.
    expect(r.prevStart.toISOString()).toBe("2026-11-09T05:00:00.000Z");
    expect(r.lastStart.toISOString()).toBe("2026-11-16T05:00:00.000Z");
    expect(r.thisStart.toISOString()).toBe("2026-11-23T05:00:00.000Z");
    expect(r.nextStart.toISOString()).toBe("2026-11-30T05:00:00.000Z");
  });

  it("starts the fall-back week (Nov 1, 2026) at the right instant on both sides", () => {
    // Monday Oct 26 is still EDT (UTC-4); Monday Nov 2 is EST (UTC-5). The week is 7 days and 1 hour long.
    const r = weekRanges("2026-10-26");
    expect(r.thisStart.toISOString()).toBe("2026-10-26T04:00:00.000Z");
    expect(r.nextStart.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("starts the spring-forward week (Mar 14, 2027) at the right instant on both sides", () => {
    const r = weekRanges("2027-03-08");
    expect(r.thisStart.toISOString()).toBe("2027-03-08T05:00:00.000Z");
    expect(r.nextStart.toISOString()).toBe("2027-03-15T04:00:00.000Z");
  });
});

describe("isOpenByDefault", () => {
  test.for([
    ["2026-11-23", true],
    ["2026-11-24", true],
    ["2026-11-25", true],
    // Thursday Dec 3, the demo.
    ["2026-12-03", true],
    ["2026-11-27", false],
    ["2026-11-28", false],
    ["2026-11-29", false],
  ] as const)("%s open: %s", ([day, open]) => {
    expect(isOpenByDefault(day)).toBe(open);
  });
});
