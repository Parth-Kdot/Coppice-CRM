import { describe, expect, test } from "vitest";
import { groupByPage, type Groupable } from "@/app/(app)/[workspaceId]/facts/fact-groups";

const pdf = (id: string, pageNumber: number | null, fileName = "packet.pdf"): Groupable => ({ id, fromPdf: true, pageNumber, fileName });
const hand = (id: string): Groupable => ({ id, fromPdf: false, pageNumber: null, fileName: null });
const shape = (groups: ReturnType<typeof groupByPage>) => groups.map((g) => [g.title, g.facts.map((f) => f.id)]);

describe("groupByPage", () => {
  test("pages in order, page unknown after them, hand-written facts last", () => {
    const facts = [hand("h1"), pdf("a", 3), pdf("b", null), pdf("c", 1), pdf("d", 3), hand("h2"), pdf("e", 12)];
    expect(shape(groupByPage(facts, false))).toEqual([
      ["Page 1", ["c"]],
      ["Page 3", ["a", "d"]],
      ["Page 12", ["e"]],
      ["Page unknown", ["b"]],
      ["Added by hand", ["h1", "h2"]],
    ]);
  });

  test("keeps the order facts arrive in within a group", () => {
    expect(shape(groupByPage([pdf("z", 2), pdf("y", 2), pdf("x", 2)], false))).toEqual([["Page 2", ["z", "y", "x"]]]);
  });

  test("with more than one packet, the same page of each file is its own group, named with the file", () => {
    const facts = [pdf("a", 2, "new.pdf"), pdf("b", 2, "old.pdf"), pdf("c", 1, "old.pdf"), pdf("d", null, "new.pdf")];
    expect(shape(groupByPage(facts, true))).toEqual([
      ["Page 1 of old.pdf", ["c"]],
      ["Page 2 of new.pdf", ["a"]],
      ["Page 2 of old.pdf", ["b"]],
      ["Page unknown of new.pdf", ["d"]],
    ]);
  });

  test.each([
    ["no facts", [], []],
    ["a page 0 or below counts as unknown", [pdf("a", 0), pdf("b", -2)], [["Page unknown", ["a", "b"]]]],
    ["a fact from a deleted file", [{ id: "a", fromPdf: true, pageNumber: 4, fileName: null }], [["Page 4", ["a"]]]],
  ] as const)("%s", (_name, facts, expected) => {
    expect(shape(groupByPage([...facts], false))).toEqual(expected);
  });

  test("a deleted file is named as such when files are shown", () => {
    expect(shape(groupByPage([{ id: "a", fromPdf: true, pageNumber: 4, fileName: null }], true))).toEqual([["Page 4 of a deleted file", ["a"]]]);
  });
});
