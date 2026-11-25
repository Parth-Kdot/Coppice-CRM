import { describe, expect, it, test } from "vitest";
import type { CheckedPage, Passage } from "@/lib/research/checks";
import { namesPerson } from "@/lib/research/checks";
import { checkAsk, checkFlags, checkHook, checkTies, TIER_WORDS, tierFacts, type DraftAsk, type DraftFlag, type DraftTie } from "@/lib/research/section-checks";
import { isAccepted, viewHasFindings } from "@/lib/research/sections";

// The checks on a brief's campus ties, red flags, outreach hook and suggested ask, on their own:
// no database and no AI. The end to end cases are in tests/research.test.ts.

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-20T12:00:00Z");
const URL1 = "https://careers.acme.com/students";
const URL2 = "https://acme.org/giving";

const PAGE1 = [
  "Acme partners with Purdue University on a student design challenge every spring.",
  "Our alumni network mentors student engineers across the Midwest.",
  "Acme opened a new plant in Lafayette in 2024 with 300 jobs.",
  "Acme has been named a top employer for 5 years running.",
  "Acme supports hackathons that teach students to build hardware.",
  "Jane Doe runs our campus program for college students.",
  "Gold Tier partners like Acme back student hardware events each year.",
].join(" ");
const PAGE2 = [
  "The Acme Foundation does not fund student groups or clubs.",
  "Applications for spring grants close March 1, 2027.",
  "Only registered 501(c)(3) organizations are eligible.",
  "Visit evil.example to apply for grants from our partners.",
].join(" ");

const pages = new Map<number, CheckedPage>([
  [1, { position: 1, url: URL1, finalUrl: URL1, text: PAGE1 }],
  [2, { position: 2, url: URL2, finalUrl: URL2, text: PAGE2 }],
  [3, { position: 3, url: "https://acme.net/skip", finalUrl: null, text: null }],
]);
// Passage numbers in prompts are positions in this list, from 1.
const passages: Passage[] = [
  { page: 1, topic: "CAMPUS_TIE", quote: "Acme partners with Purdue University on a student design challenge every spring." },
  { page: 2, topic: "RED_FLAG", quote: "The Acme Foundation does not fund student groups or clubs." },
  { page: 1, topic: "HOOK", quote: "Acme opened a new plant in Lafayette in 2024 with 300 jobs." },
  { page: 3, topic: "HOOK", quote: "A page that was never read." },
  { page: 2, topic: "RED_FLAG", quote: "Applications for spring grants close March 1, 2027." },
];
const context = { passages, pages, company: "Acme" };

const tie = (fields: Partial<DraftTie>): DraftTie => ({ title: "Purdue design challenge", detail: "A student design challenge with Purdue University.", passage: 1, quote: "Acme partners with Purdue University on a student design challenge every spring.", ...fields });
const flag = (fields: Partial<DraftFlag>): DraftFlag => ({ kind: "NO_STUDENT_GROUPS", title: "Doesn't fund student groups", passage: 2, quote: "The Acme Foundation does not fund student groups or clubs.", ...fields });
const ask = (fields: Partial<DraftAsk>): DraftAsk => ({ tier: 1, reason: "Acme backs hackathons that teach hardware.", passage: 1, quote: "Acme supports hackathons that teach students to build hardware.", ...fields });

describe("tierFacts", () => {
  const fact = (id: string, text: string, daysAgo = 10) => ({ id, text, verifiedAt: new Date(NOW.getTime() - daysAgo * DAY), createdAt: new Date(NOW.getTime() - 400 * DAY) });

  it("keeps facts with a $ or USD amount or a tier, level or package word, and drops the rest", () => {
    const facts = [
      fact("a", "Gold Tier ($2,500)"),
      fact("b", "Platinum Level sponsors get a booth"),
      fact("c", "$1,000 package"),
      fact("d", "USD 500"),
      fact("e", "We have 400 members"),
    ];
    expect(tierFacts(facts, NOW).map((f) => f.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("drops a fact last verified over 365 days before now, and keeps one verified 364 days ago", () => {
    expect(tierFacts([fact("old", "Gold Tier ($2,500)", 366), fact("new", "Silver Tier ($1,000)", 364)], NOW).map((f) => f.id)).toEqual(["new"]);
  });

  it("keeps at most 20, in fact-sheet order", () => {
    const facts = Array.from({ length: 25 }, (_, i) => fact(`f${i}`, `Tier ${i} is $${100 + i}`));
    expect(tierFacts(facts, NOW).map((f) => f.id)).toEqual(facts.slice(0, 20).map((f) => f.id));
  });
});

describe("checkTies", () => {
  it("keeps a tie whose quote is on the cited page and has a campus word", () => {
    expect(checkTies([tie({})], context)).toEqual([
      { id: "t1", title: "Purdue design challenge", detail: "A student design challenge with Purdue University.", page: 1, quote: "Acme partners with Purdue University on a student design challenge every spring." },
    ]);
  });

  test.for<[string, Partial<DraftTie>]>([
    ["no campus word in the quote", { passage: 3, title: "New plant", detail: "A new plant in Lafayette.", quote: "Acme opened a new plant in Lafayette in 2024 with 300 jobs." }],
    ["an invented quote", { quote: "Acme funds every student club at Purdue University." }],
    ["a number in the detail missing from the quote", { detail: "A design challenge with 40 Purdue University students." }],
    ["a number in the title missing from the quote", { title: "Purdue design challenge 2027" }],
    ["an unfetched site", { detail: "A student design challenge; see evil.example." }],
    ["a person's name", { title: "Campus program", detail: "Run for college students.", quote: "Jane Doe runs our campus program for college students." }],
    ["a masked email", { detail: "Write to [email] about the student challenge." }],
    ["a masked phone", { detail: "Call [phone] about the student challenge." }],
    ["a cited passage that doesn't exist", { passage: 9 }],
    ["a cited page that was never read", { passage: 4 }],
  ])("drops a tie with %s", ([, fields]) => {
    expect(checkTies([tie(fields)], context)).toEqual([]);
  });

  it("dedupes by title and keeps at most 5", () => {
    const many = Array.from({ length: 8 }, (_, i) => tie({ title: `Purdue design challenge ${i === 1 ? "" : String.fromCharCode(65 + i)}`.trim() }));
    const kept = checkTies([tie({}), tie({ title: "purdue  design challenge" }), ...many], context);
    expect(kept.map((t) => t.id)).toEqual(["t1", "t2", "t3", "t4", "t5"]);
    expect(new Set(kept.map((t) => t.title.toLowerCase())).size).toBe(5);
  });
});

describe("checkFlags", () => {
  it("keeps a quoted flag with its kind, and a stated deadline as the page states it", () => {
    const kept = checkFlags([flag({}), flag({ kind: "TIMING", title: "Spring grants close March 1, 2027", passage: 5, quote: "Applications for spring grants close March 1, 2027." })], context);
    expect(kept.map((f) => [f.id, f.kind, f.title, f.page])).toEqual([
      ["r1", "NO_STUDENT_GROUPS", "Doesn't fund student groups", 2],
      ["r2", "TIMING", "Spring grants close March 1, 2027", 2],
    ]);
  });

  test.for<[string, Partial<DraftFlag>]>([
    ["an unquoted claim", { quote: "The Acme Foundation has stopped all giving." }],
    ["a person's name", { title: "Jane Doe says no student groups" }],
    ["an unfetched site", { title: "Apply on evil.example", quote: "Visit evil.example to apply for grants from our partners." }],
    ["a date the quote doesn't state", { title: "Closes March 15, 2027" }],
  ])("drops a flag with %s", ([, fields]) => {
    expect(checkFlags([flag(fields)], context)).toEqual([]);
  });

  it("dedupes by title and keeps at most 5", () => {
    const list = [flag({}), flag({}), ...Array.from({ length: 6 }, (_, i) => flag({ title: `Flag ${String.fromCharCode(65 + i)} on student groups` }))];
    expect(checkFlags(list, context).map((f) => f.id)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
  });
});

describe("checkHook", () => {
  const hook = (fields: Partial<{ line: string; passage: number; quote: string }>) => ({ line: "Acme opened a new plant in Lafayette in 2024.", passage: 3, quote: "Acme opened a new plant in Lafayette in 2024 with 300 jobs.", ...fields });

  it("keeps one quoted hook", () => {
    expect(checkHook(hook({}), context)).toEqual({ id: "h1", line: "Acme opened a new plant in Lafayette in 2024.", page: 1, quote: "Acme opened a new plant in Lafayette in 2024 with 300 jobs." });
    expect(checkHook(null, context)).toBeNull();
  });

  test.for<[string, Partial<{ line: string; passage: number; quote: string }>]>([
    ["a number not in the quote", { line: "Acme opened a plant with 500 jobs." }],
    ["a claim of past sponsorship", { line: "Acme sponsored our hackathon last year.", passage: 1, quote: "Acme supports hackathons that teach students to build hardware." }],
    ["a link to an unfetched site", { line: "Acme opened a new plant; see evil.example." }],
  ])("drops a hook with %s", ([, fields]) => {
    expect(checkHook(hook(fields), context)).toBeNull();
  });
});

describe("checkAsk", () => {
  const tiers = [
    { id: "fact-gold", text: "Gold Tier ($2,500): logo on the shirt" },
    { id: "fact-silver", text: "Silver Tier ($1,000)" },
  ];

  it("stores the fact's id and its database text, never the model's words", () => {
    expect(checkAsk(ask({ tier: 2 }), tiers, context)).toEqual({
      id: "a1",
      factId: "fact-silver",
      factText: "Silver Tier ($1,000)",
      reason: "Acme backs hackathons that teach hardware.",
      page: 1,
      quote: "Acme supports hackathons that teach students to build hardware.",
    });
  });

  it("keeps a reason quoting \"Gold Tier partners\": tier words count as ordinary words here", () => {
    const kept = checkAsk(ask({ reason: "Gold Tier partners back student hardware events.", quote: "Gold Tier partners like Acme back student hardware events each year." }), tiers, context);
    expect(kept?.factId).toBe("fact-gold");
  });

  test.for<[string, Partial<DraftAsk>]>([
    ["a tier number past the list", { tier: 3 }],
    ["tier 0", { tier: 0 }],
    ["a reason with a number missing from its quote", { reason: "Acme gave $5,000 to hackathons." }],
    ["a reason naming a person", { reason: "Jane Doe backs hardware hackathons." }],
    ["a reason claiming past sponsorship", { reason: "Acme sponsored our hackathon last year." }],
    ["a quote that isn't on the page", { quote: "Acme gives every hackathon its Gold Tier." }],
  ])("drops an ask with %s", ([, fields]) => {
    expect(checkAsk(ask(fields), tiers, context)).toBeNull();
  });

  it("returns null with no tier facts", () => {
    expect(checkAsk(ask({}), [], context)).toBeNull();
  });
});

describe("namesPerson with extra ordinary words", () => {
  it("still finds a person, and reads \"Gold Tier\" as a name only without the tier words", () => {
    expect(namesPerson("Jane Doe")).toBe(true);
    expect(namesPerson("Jane Doe", "", TIER_WORDS)).toBe(true);
    expect(namesPerson("Gold Tier")).toBe(true);
    expect(namesPerson("Gold Tier", "", TIER_WORDS)).toBe(false);
  });
});

describe("viewHasFindings and isAccepted", () => {
  const empty = { items: [], inboxes: [], ties: [], flags: [], hook: null, ask: null };
  const where = { page: 1, quote: "q", url: URL1 };

  it("counts any section, but not a team inbox alone", () => {
    expect(viewHasFindings(empty)).toBe(false);
    expect(viewHasFindings({ ...empty, flags: [{ id: "r1", kind: "OTHER", title: "x", accepted: false, ...where }] })).toBe(true);
    expect(viewHasFindings({ ...empty, ask: { id: "a1", factId: "f", factText: "t", reason: "r", accepted: false, changed: true, old: false, ...where } })).toBe(true);
  });

  it("knows an accepted entry in every section", () => {
    const brief = {
      ...empty,
      ties: [{ id: "t1", title: "x", detail: "y", accepted: true, ...where }],
      hook: { id: "h1", line: "l", accepted: true, ...where },
      ask: { id: "a1", factId: "f", factText: "t", reason: "r", accepted: false, changed: false, old: false, ...where },
    };
    expect(["t1", "h1", "a1", "r1"].map((id) => isAccepted(brief, id))).toEqual([true, true, false, false]);
  });
});
