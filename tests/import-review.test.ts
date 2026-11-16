import { describe, expect, it, test } from "vitest";
import { decisionsFrom } from "@/components/csv-importer-smart/use-smart-import";
import {
  choiceEffects,
  chosenOption,
  CONTAINED_WHY,
  groupCaption,
  groupOptions,
  groupOutcome,
  groupsLeft,
  kindOf,
  mappingChanges,
  revertSmartMapping,
  mergeGroups,
  nameIn,
  openChanged,
  unconfirmedNote,
  type ReviewGroup,
  type ReviewSource,
} from "@/lib/import-review";
import type { ImportMapping } from "@/lib/validation";

// The import's duplicate review as plain data (lib/import-review.ts): no database, no browser.

const r = (row: number, name: string, website: string | null = null) => ({ row, name, website });
const initech = { id: "c-initech", name: "Initech", website: "initech.com", archived: false };
const group = (rows: ReturnType<typeof r>[], existing: (typeof initech)[] = []): ReviewGroup => ({ key: "k", reasons: ["Same name"], existing, rows });
const skips = (...rows: number[]) => new Set(rows);

describe("mergeGroups: one row, one place", () => {
  it("joins an exact group and a look-alike pair that share a row", () => {
    const sources: ReviewSource[] = [
      { reason: "Same name", existing: [], rows: [r(5, "Avum"), r(7, "Avum")] },
      { reason: CONTAINED_WHY, existing: [], rows: [r(5, "Avum"), r(6, "Avum Space")] },
      { reason: "Same website", existing: [], rows: [r(2, "Lumenfield Labs"), r(9, "Lumenfield")] },
    ];
    expect(mergeGroups(sources)).toEqual([
      { key: "r2-9", reasons: ["Same website"], existing: [], rows: [r(2, "Lumenfield Labs"), r(9, "Lumenfield")] },
      { key: "r5-6-7", reasons: ["Same name", CONTAINED_WHY], existing: [], rows: [r(5, "Avum"), r(6, "Avum Space"), r(7, "Avum")] },
    ]);
  });

  it("joins through a company already in Coppice, and lists each company once", () => {
    const sources: ReviewSource[] = [
      { reason: "Same name", existing: [initech], rows: [r(11, "Initech")] },
      { reason: CONTAINED_WHY, existing: [initech], rows: [r(14, "Initech Labs")] },
      { reason: CONTAINED_WHY, existing: [initech], rows: [r(11, "Initech")] },
    ];
    expect(mergeGroups(sources)).toEqual([{ key: "r11-14_cc-initech", reasons: ["Same name", CONTAINED_WHY], existing: [initech], rows: [r(11, "Initech"), r(14, "Initech Labs")] }]);
  });

  it("keeps groups that share nothing apart, in row order, and drops empty sources", () => {
    const merged = mergeGroups([
      { reason: "Same name", existing: [], rows: [r(8, "B"), r(9, "B")] },
      { reason: "x", existing: [initech], rows: [] },
      { reason: "Same name", existing: [], rows: [r(3, "A"), r(4, "A")] },
    ]);
    expect(merged.map((g) => g.key)).toEqual(["r3-4", "r8-9"]);
  });

  it("gives the same key for the same members whatever the order", () => {
    const a = mergeGroups([{ reason: "Same name", existing: [], rows: [r(4, "A"), r(3, "A")] }]);
    const b = mergeGroups([{ reason: "Other", existing: [], rows: [r(3, "A"), r(4, "A")] }]);
    expect(a[0].key).toBe(b[0].key);
  });

  it("has nothing to merge when nothing was flagged", () => {
    expect(mergeGroups([])).toEqual([]);
  });
});

describe("kindOf: two entries are decided at once, more row by row", () => {
  test.for([
    [[r(2, "A"), r(3, "A")], [], "pair"],
    [[r(2, "A")], [initech], "existing"],
    [[r(2, "A"), r(3, "A"), r(4, "A")], [], "rows"],
    [[r(2, "A"), r(3, "A")], [initech], "rows"],
    [[r(2, "A")], [initech, { ...initech, id: "c2" }], "rows"],
  ] as const)("%j with %j existing is %s", ([rows, existing, kind]) => {
    expect(kindOf(group([...rows], [...existing]))).toBe(kind);
  });
});

describe("a pair of rows in the file", () => {
  const avum = group([r(5, "Avum", "avum.example.com"), r(6, "Avum Space", "avumspace.example.com")]);

  it("asks which to keep, in the person's words", () => {
    expect(groupOptions(avum).map((o) => o.label)).toEqual(["Keep Avum only", "Keep Avum Space only", "Keep both, they're different companies", "Skip both"]);
  });

  test.for([
    ["first", [6]],
    ["second", [5]],
    ["both", []],
    ["neither", [5, 6]],
  ] as const)("%s skips %j, and the skips read back as the same answer", ([value, skipped]) => {
    const effects = choiceEffects(avum, value);
    expect(effects.filter((e) => e.skip).map((e) => e.row)).toEqual(skipped);
    expect(effects.map((e) => e.row)).toEqual([5, 6]);
    expect(chosenOption(avum, new Set(skipped))).toBe(value);
  });

  it("ignores skips of rows outside the group", () => {
    expect(chosenOption(avum, skips(6, 40))).toBe("first");
  });

  it("names rows by number when they share a name", () => {
    const twins = group([r(5, "Avum"), r(7, "avum ")]);
    expect(nameIn(twins, 5)).toBe("Avum (row 5)");
    expect(groupOptions(twins)[1].label).toBe("Keep avum (row 7) only");
    expect(nameIn(group([r(5, " "), r(6, "B")]), 5)).toBe("Row 5");
  });

  test.for([
    [[], "Both are imported as separate companies.", "Avum and Avum Space will both be imported."],
    [[6], "Avum is imported. Avum Space is skipped.", "Avum will be imported. Avum Space will be skipped."],
    [[5, 6], "Neither is imported.", "Avum and Avum Space will be skipped."],
  ] as const)("skipping %j says %j, and once confirmed %j", ([skipped, caption, outcome]) => {
    expect(groupCaption(avum, new Set(skipped))).toBe(caption);
    expect(groupOutcome(avum, new Set(skipped))).toBe(outcome);
  });
});

describe("a row that matches a company already in Coppice", () => {
  const match = group([r(11, "Initech", "initech.com")], [initech]);

  it("offers skipping or adding it as a separate company", () => {
    expect(groupOptions(match)).toEqual([
      { value: "skip", label: "Skip, it's already in Coppice", skip: [11] },
      { value: "separate", label: "Add it as a separate company", skip: [] },
    ]);
    expect(chosenOption(match, skips(11))).toBe("skip");
    expect(chosenOption(match, skips())).toBe("separate");
  });

  it("says what happens", () => {
    expect(groupCaption(match, skips(11))).toBe("Nothing is added. Initech stays as it is.");
    expect(groupCaption(match, skips())).toBe("Initech is added as its own company, next to Initech.");
    expect(groupOutcome(match, skips(11))).toBe("Initech will be skipped, it's already in Coppice.");
    expect(groupOutcome(match, skips())).toBe("Initech will be added as a separate company.");
  });
});

describe("one row and two saved companies", () => {
  const quillon = group([r(8, "Quillon Software Co")], [{ ...initech, id: "c2", name: "Quillon Software Inc." }, { ...initech, id: "c1", name: "Quillon Software" }]);

  it("speaks of the one row, not of \"them\"", () => {
    expect(groupCaption(quillon, skips(8))).toBe("Nothing is added. Quillon Software Inc. and Quillon Software stay as they are.");
    expect(groupCaption(quillon, skips())).toBe("Quillon Software Co is added as its own company, next to Quillon Software Inc. and Quillon Software.");
    expect(groupOutcome(quillon, skips(8))).toBe("Quillon Software Co will be skipped, it's already in Coppice.");
  });

  it("gets the same key whatever order the saved companies came in", () => {
    const [a] = mergeGroups([{ reason: "Same name", existing: quillon.existing, rows: quillon.rows }]);
    const [b] = mergeGroups([{ reason: "Same name", existing: [...quillon.existing].reverse(), rows: quillon.rows }]);
    expect(a.key).toBe("r8_cc1-c2");
    expect(b.key).toBe(a.key);
  });
});

describe("three or more entries", () => {
  const three = group([r(5, "Avum"), r(6, "Avum Space"), r(7, "Avum")]);

  it("has no single answer, and says the mix", () => {
    expect(groupOptions(three)).toEqual([]);
    expect(chosenOption(three, skips(7))).toBeNull();
    expect(choiceEffects(three, "both")).toEqual([]);
    expect(groupCaption(three, skips(7))).toBe("Avum (row 5) and Avum Space are imported. Avum (row 7) is skipped.");
    expect(groupCaption(three, skips())).toBe("All of them are imported as separate companies.");
    expect(groupCaption(three, skips(5, 6, 7))).toBe("None of them is imported.");
    expect(groupOutcome(three, skips())).toBe("Avum (row 5), Avum Space and Avum (row 7) will all be imported.");
  });
});

describe("the review's progress", () => {
  test.for([
    [0, "That was the last group."],
    [1, "1 group left."],
    [3, "3 groups left."],
  ] as const)("%i left: %s", ([n, text]) => {
    expect(groupsLeft(n)).toBe(text);
  });

  const a = { ...group([r(2, "A"), r(3, "A")]), key: "a" };
  const b = { ...group([r(4, "B")], [initech]), key: "b" };

  it("says how the groups not confirmed are imported", () => {
    const suggested = skips(3, 4);
    expect(unconfirmedNote([a, b], new Set(["a", "b"]), suggested, suggested)).toBeNull();
    expect(unconfirmedNote([a, b], new Set(), suggested, suggested)).toBe("2 groups not reviewed yet use their suggested choice.");
    expect(unconfirmedNote([a, b], new Set(["a"]), suggested, suggested)).toBe("1 group not reviewed yet uses its suggested choice.");
    // A changed answer that wasn't confirmed is still what gets imported.
    expect(unconfirmedNote([a, b], new Set(["a"]), skips(3), suggested)).toBe("1 group not confirmed yet uses the choice shown in it.");
    // A change in a confirmed group doesn't count.
    expect(unconfirmedNote([a, b], new Set(["a"]), skips(4), suggested)).toBe("1 group not reviewed yet uses its suggested choice.");
  });

  it("knows when an open group no longer shows its suggested choice, for the summary's button", () => {
    const suggested = skips(3, 4);
    expect(openChanged([a, b], new Set(), suggested, suggested)).toBe(false);
    expect(openChanged([a, b], new Set(), skips(3), suggested)).toBe(true);
    expect(openChanged([a, b], new Set(["b"]), skips(3), suggested)).toBe(false);
  });
});

describe("mappingChanges: what turning Smart import on changed", () => {
  const headers = ["Company", "Industry", "Site", "Status notes", " "];
  const before: ImportMapping = { name: 0, industry: 1, website: 2, notes: null, contactName: null, contactEmail: null };

  it("names each changed field and its new column", () => {
    expect(mappingChanges(before, { ...before, notes: 3 }, headers)).toEqual(['Smart import set Notes to "Status notes"']);
    expect(mappingChanges(before, { ...before, website: null, contactName: 4 }, headers)).toEqual([
      'Smart import set Website to "Not in this file"',
      'Smart import set Contact name to "Column 5"',
    ]);
    expect(mappingChanges(before, { ...before }, headers)).toEqual([]);
  });
});

describe("decisionsFrom: a do-not-contact row's acceptance follows the skips", () => {
  const edits = { 4: { stage: { keep: true, value: "CONTACTED" as const } } };

  it("sends an imported do-not-contact row as accepted, and a skipped one not at all", () => {
    const imported = decisionsFrom([4, 9], { skips: skips(), edits, doNotContact: skips(9) });
    expect(imported).toEqual([
      { row: 4, stage: "CONTACTED", lastContactedOn: null, followUpOn: null, contact: null, note: null, dncAccepted: false },
      { row: 9, stage: null, lastContactedOn: null, followUpOn: null, contact: null, note: null, dncAccepted: true },
    ]);
    expect(decisionsFrom([4, 9], { skips: skips(9), edits, doNotContact: skips(9) }).map((d) => d.row)).toEqual([4]);
    expect(decisionsFrom([4, 9], { skips: skips(4, 9), edits, doNotContact: skips(9) })).toEqual([]);
  });

  it("leaves out a reading the person left out", () => {
    expect(decisionsFrom([4], { skips: skips(), edits: { 4: { stage: { keep: false, value: "CONTACTED" } } }, doNotContact: skips() })).toEqual([]);
  });
});

describe("revertSmartMapping: turning Smart import off or Undo", () => {
  // Before Smart import: Notes on column 3. Smart import took Notes off (it reads column 3 with AI)
  // and set Contact name to column 4.
  const before: ImportMapping = { name: 0, industry: 1, website: 2, notes: 3, contactName: null, contactEmail: null };
  const after: ImportMapping = { ...before, notes: null, contactName: 4 };

  it("puts back every field Smart import changed when nothing was changed by hand", () => {
    expect(revertSmartMapping(after, before, after)).toEqual(before);
  });

  it("keeps a field the person changed by hand after Smart import", () => {
    const current = { ...after, contactName: 5 };
    expect(revertSmartMapping(current, before, after)).toEqual({ ...before, contactName: 5 });
  });

  it("keeps a hand change to a field Smart import never touched", () => {
    const current = { ...after, industry: null };
    expect(revertSmartMapping(current, before, after)).toEqual({ ...before, industry: null });
  });

  it("doesn't put a column back where another field now uses it", () => {
    // The person moved column 3 to Contact name by hand, so Notes can't take it back.
    const current = { ...after, contactName: 3 };
    expect(revertSmartMapping(current, before, after)).toEqual({ ...after, contactName: 3 });
  });
});
