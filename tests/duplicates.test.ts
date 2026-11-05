import { describe, expect, test } from "vitest";
import { containedName, domainKey, groupLookAlikes, lookalikePairs, matchReasons, nameKey, orderedPair } from "@/lib/duplicates";

describe("nameKey: names that mean the same company match", () => {
  test.for([
    ["amazon", "Amazon"],
    ["Amazon", "Amazon, Inc."],
    ["Acme Corp", " acme corp "],
    ["Acme Corp", "ACME Corporation"],
    ["Acme", "Acme L.L.C."],
    ["Acme", "Acme Co., Inc."],
    ["Acme", "Acme Ltd"],
    ["Coca-Cola", "The Coca-Cola Company"],
    ["Johnson & Johnson", "Johnson and Johnson"],
    ["Café Nero", "Cafe Nero"],
  ] as const)("%j matches %j", ([a, b]) => {
    expect(nameKey(a)).toBe(nameKey(b));
  });

  test.for([
    ["Amazon", "Amazon Web Services"],
    ["Acme", "Acme Labs"],
    ["Apple", "Pineapple"],
  ] as const)("%j does not match %j", ([a, b]) => {
    expect(nameKey(a)).not.toBe(nameKey(b));
  });

  test.for(["Inc", "Co", "The"])("a name that is only %j isn't stripped to nothing", (name) => {
    expect(nameKey(name)).toBe(name.toLowerCase());
  });

  test("a name made only of punctuation falls back to itself instead of an empty key", () => {
    expect(nameKey(" ?!? ")).toBe("?!?");
    expect(nameKey("?!?")).not.toBe(nameKey("..."));
  });
});

describe("domainKey: websites on the same domain match", () => {
  test.for([
    ["https://www.acme.com/", "acme.com"],
    ["ACME.COM", "acme.com"],
    ["http://acme.com/about?x=1", "acme.com"],
    ["www.acme.com", "acme.com"],
    ["  acme.com  ", "acme.com"],
  ] as const)("%j is %j", ([input, expected]) => {
    expect(domainKey(input)).toBe(expected);
  });

  test("a subdomain is its own domain (careers.acme.com isn't acme.com)", () => {
    expect(domainKey("careers.acme.com")).toBe("careers.acme.com");
  });

  test.for(["", "   ", "not a url", "localhost", null, undefined])("%j has no domain, so it never matches", (input) => {
    expect(domainKey(input)).toBeNull();
  });
});

describe("matchReasons", () => {
  const acme = { nameKey: "acme", domainKey: "acme.com" };
  test("same name and website gives both reasons", () => {
    expect(matchReasons(acme, { nameKey: "acme", domainKey: "acme.com" })).toEqual(["name", "website"]);
  });
  test("different names on the same website match on website", () => {
    expect(matchReasons(acme, { nameKey: "acme labs", domainKey: "acme.com" })).toEqual(["website"]);
  });
  test("two companies without websites don't match on website", () => {
    expect(matchReasons({ nameKey: "a", domainKey: null }, { nameKey: "b", domainKey: null })).toEqual([]);
  });
});

describe("groupLookAlikes", () => {
  const item = (id: string, name: string, website: string | null = null) => ({ id, nameKey: nameKey(name), domainKey: domainKey(website) });

  test("joins look-alikes transitively and says what joined them", () => {
    const groups = groupLookAlikes([
      item("a", "Acme"),
      item("b", "ACME, Inc.", "acme.com"),
      item("c", "Acme Labs", "https://www.acme.com"),
      item("d", "Globex"),
      item("e", "Initech", "initech.com"),
      item("f", "Initrode", "initech.com"),
    ]);
    expect(groups.map((g) => [g.members.map((m) => m.id), g.matchedOn])).toEqual([
      [["a", "b", "c"], ["name", "website"]],
      [["e", "f"], ["website"]],
    ]);
  });

  test("leaves out companies with nothing in common, and blank websites never match", () => {
    expect(groupLookAlikes([item("a", "Acme"), item("b", "Globex"), item("c", "Initech", "")])).toEqual([]);
  });
});

test("orderedPair always puts the smaller id first", () => {
  expect(orderedPair("b", "a")).toEqual(["a", "b"]);
  expect(orderedPair("a", "b")).toEqual(["a", "b"]);
});

describe("lookalikePairs (Smart import's look-alikes)", () => {
  const item = (key: string, name: string, isRow = true, website: string | null = null) => ({ key, name, isRow, nameKey: nameKey(name), domainKey: domainKey(website) });

  test("flags a name inside another, at least 4 letters and whole words", () => {
    expect(containedName("Lilly", "Eli Lilly")).toBe(true);
    expect(containedName("Co", "Acme Co Labs")).toBe(false);
    expect(containedName("Lill", "Eli Lilly")).toBe(false);
    expect(containedName("Acme Inc", "Acme")).toBe(false);
  });

  test("keeps code pairs and AI pairs naming two real items, at least one a row, never exact matches", () => {
    const items = [item("r2", "Eli Lilly"), item("r3", "CAT"), item("r4", "Acme", true, "acme.com"), item("c1", "Lilly", false), item("c2", "Caterpillar", false), item("c3", "Acme Labs", false, "acme.com")];
    const pairs = lookalikePairs(
      items,
      [
        { a: "r3", b: "c2", reason: "ticker" },
        { a: "r99", b: "c1", reason: "made up" },
        { a: "c1", b: "c2", reason: "both saved" },
        { a: "r3", b: "r3", reason: "itself" },
        { a: "r2", b: "c2", reason: " " },
      ],
      100,
    );
    expect(pairs.map((p) => [p.members.map((m) => m.key).join("+"), p.reason, p.why])).toEqual([
      ["r2+c1", "contained", '"Eli Lilly" and "Lilly" share a name'],
      ["r3+c2", "ai", "AI: ticker"],
    ]);
  });

  test("stops at the cap", () => {
    const items = [item("r2", "Lilly"), item("c1", "Eli Lilly", false), item("c2", "Lilly Labs", false)];
    expect(lookalikePairs(items, [], 1)).toHaveLength(1);
  });
});
