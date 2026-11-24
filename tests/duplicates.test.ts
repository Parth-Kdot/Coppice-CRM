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

describe("domainKey on hosts many companies share (SHARED_HOSTS)", () => {
  test.for([
    ["https://www.linkedin.com/company/acme/", "linkedin.com/company/acme"],
    ["linkedin.com/company/Acme/about", "linkedin.com/company/acme"],
    ["https://uk.linkedin.com/company/acme", "linkedin.com/company/acme"],
    ["https://www.linkedin.com/in/jen-park", "linkedin.com/in/jen-park"],
    ["https://m.facebook.com/acmerobotics", "facebook.com/acmerobotics"],
    ["https://www.facebook.com/pages/acme", "facebook.com/pages/acme"],
    ["instagram.com/acme_bots/", "instagram.com/acme_bots"],
    ["https://x.com/acme", "x.com/acme"],
    ["https://twitter.com/acme?lang=en", "twitter.com/acme"],
    ["https://linktr.ee/acme", "linktr.ee/acme"],
    ["https://sites.google.com/view/acme-club/home", "sites.google.com/view/acme-club"],
    ["https://www.youtube.com/channel/UC123", "youtube.com/channel/uc123"],
    ["https://github.com/acme/robot", "github.com/acme"],
    ["https://medium.com/@acme", "medium.com/@acme"],
    ["https://acme.notion.site/Sponsors-123", "acme.notion.site"],
    ["https://acme.wixsite.com/club", "acme.wixsite.com"],
  ] as const)("%j is %j", ([input, expected]) => {
    expect(domainKey(input)).toBe(expected);
  });

  test.for(["https://www.linkedin.com/", "linkedin.com", "https://www.linkedin.com/company/", "https://facebook.com", "notion.site", "https://sites.google.com/view"])(
    "%j names no page, so it never matches",
    (input) => {
      expect(domainKey(input)).toBeNull();
    },
  );

  test("two companies' LinkedIn pages don't look alike, the same page does", () => {
    expect(domainKey("linkedin.com/company/acme")).not.toBe(domainKey("linkedin.com/company/globex"));
    expect(domainKey("https://www.linkedin.com/company/acme/")).toBe(domainKey("http://linkedin.com/company/ACME"));
  });

  test("a company's own domain that merely contains a shared host's name is its own", () => {
    expect(domainKey("notlinkedin.com/company/x")).toBe("notlinkedin.com");
    expect(domainKey("google.com.au")).toBe("google.com.au");
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

  test("compares rows with rows and with saved companies, never two saved companies", () => {
    const items = [item("r2", "Lilly Labs North"), item("r3", "Lilly Labs"), item("c1", "Acme", false), item("c2", "Acme Labs West", false)];
    expect(lookalikePairs(items, [], 100).map((p) => p.members.map((m) => m.key).join("+"))).toEqual(["r2+r3"]);
  });

  // The preview runs this against every saved company each time a file is picked or a column
  // changes, so it has to stay fast on a big workspace (2,000 rows, 20,000 companies).
  test.for([
    ["realistic names", 0],
    ["names over a small vocabulary", 400],
  ] as const)("is fast on a big workspace: %s", ([, vocab]) => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const words = Array.from({ length: vocab || 5000 }, (_, i) => `word${i}x`);
    const suffixes = ["Labs", "Group", "Media", "Software", "Partners", "Health", "Foods", "Energy"];
    const name = () =>
      vocab ? [0, 1, 2].map(() => words[Math.floor(rnd() * vocab)]).join(" ") : `${words[Math.floor(rnd() * words.length)]} ${suffixes[Math.floor(rnd() * suffixes.length)]}`;
    const items = [
      ...Array.from({ length: 2000 }, (_, i) => item(`r${i + 2}`, name())),
      ...Array.from({ length: 20000 }, (_, i) => item(`c${i}`, name(), false, `n${i}.example.com`)),
    ];
    const started = performance.now();
    const pairs = lookalikePairs(items, [], 100);
    expect(pairs.length).toBeLessThanOrEqual(100);
    expect(pairs.every((p) => p.members.some((m) => m.isRow))).toBe(true);
    // About 0.1 s here; the old pairwise check took 4.6 s on the small vocabulary.
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
