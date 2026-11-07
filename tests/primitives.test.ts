import { describe, expect, test } from "vitest";
import { anchorMoved, menuIndex, placePopover } from "@/components/ledger/popover";
import { moreLinkState, showAllLabel, showMoreSplit } from "@/components/ledger/show-more";
import { overdueText, shortDue } from "@/components/ledger/overdue";

// The pure logic inside the shared UI primitives (components/ledger): popover placement, menu
// keys, list caps and the compact due wording. The components themselves are checked in the browser.

describe("placePopover", () => {
  const viewport = { viewportWidth: 1280, viewportHeight: 800 };
  // A 38 x 38 button near the top right of the page.
  const anchor = { top: 100, bottom: 138, left: 1000, right: 1038 };

  test("sits under the anchor, right edges together", () => {
    expect(placePopover({ anchor, width: 220, height: 200, ...viewport })).toEqual({ left: 818, top: 144, maxHeight: 648, side: "below" });
  });

  test("align left puts the left edges together", () => {
    expect(placePopover({ anchor, width: 220, height: 200, align: "left", ...viewport }).left).toBe(1000);
  });

  test.each([
    // anchor left, width, align, expected left (8 px from either edge at most)
    [4, 220, "left", 8],
    [1200, 220, "left", 1052],
    [10, 220, "right", 8],
    [1270, 300, "right", 972],
  ] as const)("stays inside the viewport: left %i, width %i, align %s -> %i", (left, width, align, expected) => {
    const a = { top: 100, bottom: 138, left, right: left + 38 };
    expect(placePopover({ anchor: a, width, height: 100, align, ...viewport }).left).toBe(expected);
  });

  test("flips above when there is no room below", () => {
    const low = { top: 700, bottom: 738, left: 600, right: 638 };
    expect(placePopover({ anchor: low, width: 220, height: 200, ...viewport })).toEqual({ left: 418, top: 494, maxHeight: 686, side: "above" });
  });

  test("exactly fitting below stays below", () => {
    // below = 544; room below = 800 - 8 - 544 = 248, room above = 500 - 6 - 8 = 486
    const a = { top: 500, bottom: 538, left: 600, right: 638 };
    expect(placePopover({ anchor: a, width: 220, height: 248, ...viewport }).side).toBe("below");
    expect(placePopover({ anchor: a, width: 220, height: 249, ...viewport }).side).toBe("above");
  });

  test("when neither side fits it takes the roomier side and caps the height", () => {
    const mid = { top: 300, bottom: 338, left: 600, right: 638 };
    // below room 800-8-344 = 448, above room 300-6-8 = 286
    expect(placePopover({ anchor: mid, width: 220, height: 900, ...viewport })).toEqual({ left: 418, top: 344, maxHeight: 448, side: "below" });
    const high = { top: 600, bottom: 638, left: 600, right: 638 };
    // below room 148, above room 586: above, pinned 8 px from the top
    expect(placePopover({ anchor: high, width: 220, height: 900, ...viewport })).toEqual({ left: 418, top: 8, maxHeight: 586, side: "above" });
  });

  test("on a 375 px phone a wide card is held 8 px from both edges", () => {
    const phone = { viewportWidth: 375, viewportHeight: 700 };
    const a = { top: 60, bottom: 104, left: 320, right: 364 };
    expect(placePopover({ anchor: a, width: 320, height: 200, ...phone }).left).toBe(44);
    expect(placePopover({ anchor: a, width: 359, height: 200, ...phone }).left).toBe(8);
  });
});

describe("anchorMoved", () => {
  test.each([
    [{ top: 10, left: 10 }, false],
    [{ top: 11, left: 10 }, false],
    [{ top: 11.5, left: 10 }, true],
    [{ top: 10, left: 8 }, true],
  ])("from (10, 10) to %o -> %s", (now, moved) => {
    expect(anchorMoved({ top: 10, left: 10 }, now)).toBe(moved);
  });
});

describe("menuIndex", () => {
  // Items 1 and 3 are disabled (they stay focusable, so the arrows reach them).
  const disabled = [false, true, false, true];
  test.each([
    [-1, "ArrowDown", 0],
    [-1, "ArrowUp", 3],
    [0, "ArrowDown", 1],
    [3, "ArrowDown", 0],
    [0, "ArrowUp", 3],
    [2, "ArrowUp", 1],
    [2, "Home", 0],
    // End searches backwards from the last item for an enabled one.
    [0, "End", 2],
  ] as const)("from %i, %s -> %i", (current, key, expected) => {
    expect(menuIndex(disabled, current, key)).toBe(expected);
  });

  test("Home skips leading disabled items", () => {
    expect(menuIndex([true, true, false], -1, "Home")).toBe(2);
  });
  test("an all-disabled menu still lands somewhere", () => {
    expect(menuIndex([true, true], -1, "Home")).toBe(0);
    expect(menuIndex([true, true], -1, "End")).toBe(1);
  });
  test("an empty menu has nothing to focus", () => {
    expect(menuIndex([], -1, "ArrowDown")).toBe(-1);
    expect(menuIndex([], -1, "End")).toBe(-1);
  });
});

describe("ShowMore slicing", () => {
  test.each([
    // count, initial, shown, hidden
    [0, 5, 0, 0],
    [3, 5, 3, 0],
    [5, 5, 5, 0],
    [6, 5, 5, 1],
    [120, 10, 10, 110],
    [4, 0, 0, 4],
    [4, -2, 0, 4],
    [9, 3.7, 3, 6],
  ])("%i items, initial %d -> %i shown, %i hidden", (count, initial, shown, hidden) => {
    expect(showMoreSplit(count, initial)).toEqual({ shown, hidden });
  });

  test.each([
    [12, "outreach entries", "Show all 12 outreach entries"],
    [2000, "companies", "Show all 2,000 companies"],
    [7, "", "Show all 7"],
  ])("label for %i %s", (count, label, text) => {
    expect(showAllLabel(count, label)).toBe(text);
  });
});

describe("MoreLink labels", () => {
  test.each([
    // shown, total, expected
    [50, 362, { kind: "more", next: 50, left: 312, text: "Show 50 more (312 left)" }],
    [50, 62, { kind: "more", next: 12, left: 12, text: "Show 12 more" }],
    [50, 100, { kind: "more", next: 50, left: 50, text: "Show 50 more" }],
    [150, 2400, { kind: "more", next: 50, left: 2250, text: "Show 50 more (2,250 left)" }],
    [180, 312, { kind: "more", next: 20, left: 132, text: "Show 20 more (132 left)" }],
    [200, 2400, { kind: "cap", text: "Showing 200 of 2,400. Use search or filters to narrow." }],
    [200, 200, { kind: "none" }],
    [40, 40, { kind: "none" }],
    [0, 0, { kind: "none" }],
  ] as const)("%i of %i", (shown, total, expected) => {
    expect(moreLinkState(shown, total)).toEqual(expected);
  });

  test("step and cap can be changed", () => {
    expect(moreLinkState(100, 600, 100, 500)).toEqual({ kind: "more", next: 100, left: 500, text: "Show 100 more (500 left)" });
    expect(moreLinkState(500, 600, 100, 500)).toEqual({ kind: "cap", text: "Showing 500 of 600. Use search or filters to narrow." });
  });
});

describe("shortDue", () => {
  test.each([
    [0, "Due today"],
    [1, "1d late"],
    [9, "9d late"],
    [111, "111d late"],
    [-1, "In 1d"],
    [-3, "In 3d"],
    [-30, "In 30d"],
  ])("%i days -> %s", (days, text) => {
    expect(shortDue(days)).toBe(text);
  });

  test("keeps the same sign as overdueText", () => {
    expect(overdueText(9)).toBe("9 days overdue");
    expect(shortDue(9)).toBe("9d late");
    expect(overdueText(-3)).toBe("Due in 3 days");
    expect(shortDue(-3)).toBe("In 3d");
  });
});
