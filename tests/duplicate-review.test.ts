import { describe, expect, it, test } from "vitest";
import { archivedNote, initialPairList, keepLeaving, openPairs, pairLabel, pairListReducer, separateNote, type PairListState } from "@/lib/duplicate-review";

// The board's "Possible duplicates" list as plain data (lib/duplicate-review.ts): no database, no
// browser. The server's list is the truth; the screen only keeps a resolved pair a little longer.

type P = { key: string };
const p = (key: string): P => ({ key });
const keys = (list: P[]) => list.map((x) => x.key);
const run = (state: PairListState<P>, ...actions: Parameters<typeof pairListReducer<P>>[1][]) => actions.reduce((s, a) => pairListReducer(s, a), state);

describe("keepLeaving: a dropped pair stays in its place", () => {
  test.each([
    { name: "first dropped", shown: ["a", "b", "c"], next: ["b", "c"], list: ["a", "b", "c"], dropped: ["a"] },
    { name: "middle dropped", shown: ["a", "b", "c"], next: ["a", "c"], list: ["a", "b", "c"], dropped: ["b"] },
    { name: "last dropped", shown: ["a", "b", "c"], next: ["a", "b"], list: ["a", "b", "c"], dropped: ["c"] },
    { name: "two dropped side by side", shown: ["a", "b", "c", "d"], next: ["a", "d"], list: ["a", "b", "c", "d"], dropped: ["b", "c"] },
    { name: "all dropped", shown: ["a", "b"], next: [], list: ["a", "b"], dropped: ["a", "b"] },
    { name: "one dropped and a new one at the end", shown: ["a", "b"], next: ["b", "z"], list: ["a", "b", "z"], dropped: ["a"] },
    { name: "nothing changed", shown: ["a", "b"], next: ["a", "b"], list: ["a", "b"], dropped: [] },
  ])("$name", ({ shown, next, list, dropped }) => {
    const result = keepLeaving(shown.map(p), next.map(p));
    expect(keys(result.list)).toEqual(list);
    expect(result.dropped).toEqual(dropped);
  });
});

describe("pairListReducer", () => {
  const start = () => initialPairList(["a", "b", "c"].map(p));

  it("starts with every pair open and nothing moving", () => {
    const s = start();
    expect(keys(openPairs(s))).toEqual(["a", "b", "c"]);
    expect(s.leaving.size).toBe(0);
    expect(s.arrived.size).toBe(0);
    expect(s.resolved).toBe(0);
  });

  it("answered, then the server drops it: it leaves with the label it had, then goes", () => {
    let s = run(start(), { type: "resolve", key: "b" });
    expect(s.leaving.get("b")).toEqual({ n: 2, of: 3 });
    expect(keys(openPairs(s))).toEqual(["a", "c"]);
    s = run(s, { type: "sync", pairs: ["a", "c"].map(p) });
    expect(keys(s.shown)).toEqual(["a", "b", "c"]);
    s = run(s, { type: "left", key: "b" });
    expect(keys(s.shown)).toEqual(["a", "c"]);
    expect(s.leaving.size).toBe(0);
    expect(s.gone.size).toBe(0);
    expect(s.resolved).toBe(1);
  });

  it("the server's fresh list arrives before the answer does: the pair is still drawn, already leaving", () => {
    let s = run(start(), { type: "sync", pairs: ["b", "c"].map(p) });
    expect(keys(s.shown)).toEqual(["a", "b", "c"]);
    expect(s.leaving.get("a")).toEqual({ n: 1, of: 3 });
    s = run(s, { type: "resolve", key: "a" });
    expect(s.leaving.get("a")).toEqual({ n: 1, of: 3 });
    s = run(s, { type: "left", key: "a" });
    expect(keys(s.shown)).toEqual(["b", "c"]);
  });

  it("the exit ends before the server's list arrives: the pair stays off the screen, then is forgotten", () => {
    let s = run(start(), { type: "resolve", key: "c" }, { type: "left", key: "c" });
    expect(keys(s.shown)).toEqual(["a", "b"]);
    expect([...s.gone]).toEqual(["c"]);
    // A list from before the change still has it: not shown again, not counted as new.
    s = run(s, { type: "sync", pairs: ["a", "b", "c"].map(p) });
    expect(keys(s.shown)).toEqual(["a", "b"]);
    expect(s.arrived.size).toBe(0);
    s = run(s, { type: "sync", pairs: ["a", "b"].map(p) });
    expect(keys(s.shown)).toEqual(["a", "b"]);
    expect(s.gone.size).toBe(0);
    expect(s.leaving.size).toBe(0);
  });

  it("one archive that clears two pairs: both leave, each with its own label", () => {
    const s = run(start(), { type: "sync", pairs: ["c"].map(p) });
    expect(s.leaving.get("a")).toEqual({ n: 1, of: 3 });
    expect(s.leaving.get("b")).toEqual({ n: 2, of: 3 });
    expect(keys(openPairs(s))).toEqual(["c"]);
  });

  it("a refused answer changes nothing: no resolve is sent, the same list comes back", () => {
    const before = start();
    const s = run(before, { type: "sync", pairs: ["a", "b", "c"].map(p) });
    expect(keys(openPairs(s))).toEqual(["a", "b", "c"]);
    expect(s.leaving.size).toBe(0);
  });

  it("a pair that appears later (the server was at its cap) rises in", () => {
    const s = run(start(), { type: "resolve", key: "a" }, { type: "sync", pairs: ["b", "c", "d"].map(p) });
    expect([...s.arrived]).toEqual(["d"]);
    expect(keys(s.shown)).toEqual(["a", "b", "c", "d"]);
  });

  it("the last pair answered leaves an empty list and a count of what was done", () => {
    const s = run(initialPairList([p("a")]), { type: "resolve", key: "a" }, { type: "sync", pairs: [] }, { type: "left", key: "a" });
    expect(s.shown).toEqual([]);
    expect(s.resolved).toBe(1);
  });

  it("an end for a pair that isn't leaving is ignored", () => {
    const s = start();
    expect(run(s, { type: "left", key: "a" })).toBe(s);
  });
});

describe("labels and notes", () => {
  test.each([
    [{ n: 1, of: 3 }, false, "Pair 1 of 3"],
    [{ n: 2, of: 50 }, true, "Pair 2 of 50+"],
  ] as const)("%o, more %s", (slot, more, text) => {
    expect(pairLabel(slot, more)).toBe(text);
  });

  it("says what happened", () => {
    expect(archivedNote("Quillon Software Inc.")).toBe("Archived Quillon Software Inc.");
    expect(archivedNote("Quillon Software")).toBe("Archived Quillon Software.");
    expect(separateNote("Quillon Software", "Quillon Software Inc.")).toBe("Kept Quillon Software and Quillon Software Inc. as separate companies.");
  });
});
