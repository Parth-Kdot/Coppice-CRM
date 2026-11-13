import { afterAll, beforeEach, describe, expect, it, test } from "vitest";
import { prisma } from "@/lib/db";
import { buildFactTable, factKeys, hasOutreach, MAX_TEMPLATES, TOO_EARLY, type Fact } from "@/lib/scorecard/facts";
import { factsHash } from "@/lib/scorecard/hash";
import { workspaceStats } from "@/lib/stats";
import { scorecard, type OutreachRow } from "@/lib/stats-math";
import { OWNER, OTHER_ORG, seedStatsFixture } from "./helpers/stats-fixture";
import { resetAndSeed } from "./helpers/seed";

// The fact table behind "Explain these numbers", against the stats fixture whose every number was
// worked out by hand (tests/helpers/stats-fixture.ts), and against small scorecards built here for
// the verdict and the cap on templates.

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-01T12:00:00Z");

const textOf = (facts: Fact[]) => Object.fromEntries(facts.map((f) => [f.key, f.text]));

beforeEach(resetAndSeed);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the fact table of the hand-computed fixture", () => {
  beforeEach(seedStatsFixture);

  it("holds each template's numbers as the page formats them, most sends first", async () => {
    const table = buildFactTable(await workspaceStats(OWNER, "none"));
    const text = textOf(table.facts);
    expect(table.names).toEqual({ t1: "Alumni angle", t2: "Cold intro", t3: "Career fair", t4: "Spring ask" });

    // [template, name, standing, sent, counted, replies, maturing, rate, range, status]
    const rows = [
      ["t1", "Alumni angle", "in use", "28", "25", "15", "3", "60%", "41% to 77%", "rated"],
      ["t2", "Cold intro", "retired", "25", "25", "2", "0", "8%", "2% to 25%", "rated"],
      ["t3", "Career fair", "in use", "8", "8", "4", "0", "50%", "22% to 78%", "too few sends yet"],
    ];
    for (const [k, name, standing, sent, counted, replies, maturing, rate, range, status] of rows) {
      expect({
        name: text[`${k}.name`],
        inUse: text[`${k}.inUse`],
        sent: text[`${k}.sent`],
        counted: text[`${k}.counted`],
        replies: text[`${k}.replies`],
        maturing: text[`${k}.maturing`],
        rate: text[`${k}.rate`],
        range: text[`${k}.range`],
        status: text[`${k}.status`],
      }).toEqual({ name, inUse: standing, sent, counted, replies, maturing, rate, range, status });
    }
    // A template nobody sent has no rate and no range to state.
    expect(text["t4.name"]).toBe("Spring ask");
    expect([text["t4.sent"], text["t4.counted"], text["t4.status"]]).toEqual(["0", "0", "no sends yet"]);
    expect(text).not.toHaveProperty("t4.rate");
    expect(text).not.toHaveProperty("t4.range");
  });

  it("holds the values behind the text, so the hash can tell a changed number", async () => {
    const table = buildFactTable(await workspaceStats(OWNER, "none"));
    const value = Object.fromEntries(table.facts.map((f) => [f.key, f.value]));
    expect(value["t1.sent"]).toBe(28);
    expect(value["t1.rate"]).toBe(0.6);
    expect(value["t1.range"]).toBe("0.4074 to 0.766");
    expect(value["t1.status"]).toBe("rated");
    expect(value["t2.range"]).toBe("0.0222 to 0.2497");
  });

  it("holds the no-template line, AI against hand-written, the three touches and the gaps", async () => {
    const text = textOf(buildFactTable(await workspaceStats(OWNER, "none")).facts);
    expect(text).toMatchObject({
      "noTemplate.sent": "11",
      "noTemplate.counted": "9",
      "noTemplate.replies": "3",
      "noTemplate.maturing": "2",
      "noTemplate.rate": "33%",
      "noTemplate.range": "12% to 65%",
      "noTemplate.status": "too few sends yet",

      "ai.sent": "4",
      "ai.counted": "4",
      "ai.replies": "2",
      "ai.rate": "50%",
      "ai.range": "15% to 85%",
      "ai.status": "too few sends yet",
      "hand.sent": "66",
      "hand.counted": "61",
      "hand.replies": "22",
      "hand.maturing": "5",
      "hand.rate": "36%",
      "hand.range": "25% to 49%",
      "hand.status": "rated",
      // The ranges overlap, so neither kind leads.
      "authorship.lead": "no clear lead yet",

      "touch1.sent": "52",
      "touch1.counted": "52",
      "touch1.replies": "18",
      "touch1.rate": "35%",
      "touch1.range": "23% to 48%",
      "touch1.status": "rated",
      "touch2.sent": "18",
      "touch2.counted": "13",
      "touch2.replies": "6",
      "touch2.maturing": "5",
      "touch2.rate": "46%",
      "touch2.range": "23% to 71%",
      "touch2.status": "too few sends yet",
      "touch3.sent": "2",
      "touch3.counted": "2",
      "touch3.replies": "0",
      "touch3.rate": "0%",
      "touch3.range": "0% to 66%",

      "gaps.noTemplate": "11",
      "gaps.repliedUnmarked": "2",
      "gaps.maturing": "5",

      "rule.minSends": "20",
      "rule.maturityDays": "14",
    });
  });

  it("names no best or worst when only one template in use is rated, and no retired one did better", async () => {
    const text = textOf(buildFactTable(await workspaceStats(OWNER, "none")).facts);
    // Alumni angle is the only rated template still in use, and Cold intro (retired) did worse.
    expect(text).toMatchObject({ "verdict.best": TOO_EARLY, "verdict.worst": TOO_EARLY, "verdict.rated": "1" });
    expect(text).not.toHaveProperty("verdict.retiredBetter");
  });

  it("describes every fact in plain words, with a unique key", async () => {
    const { facts } = buildFactTable(await workspaceStats(OWNER, "none"));
    expect(new Set(facts.map((f) => f.key)).size).toBe(facts.length);
    for (const fact of facts) {
      expect(fact.what.length).toBeGreaterThan(5);
      expect(fact.text).not.toBe("");
    }
    expect(factKeys(buildFactTable(await workspaceStats(OWNER, "none"))).has("t1.rate")).toBe(true);
  });

  it("is the same whoever asks and whatever the split the page was showing", async () => {
    const a = buildFactTable(await workspaceStats(OWNER, "none"));
    const b = buildFactTable(await workspaceStats(OWNER, "industry"));
    expect(b).toEqual(a);
  });

  it("is empty for another workspace: no outreach to explain", async () => {
    const theirs = await workspaceStats(OTHER_ORG, "none");
    expect(hasOutreach(theirs)).toBe(false);
    expect(hasOutreach(await workspaceStats(OWNER, "none"))).toBe(true);
  });
});

describe("the verdict facts", () => {
  const rows = (templateId: string, n: number, replies: number, days = 40): OutreachRow[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `${templateId}-${i}`,
      companyId: `${templateId}-c${i}`,
      templateId,
      channel: "EMAIL" as const,
      sentAt: new Date(NOW.getTime() - days * DAY),
      gotReply: i < replies,
      aiDrafted: false,
      industry: null,
    }));
  const card = (templates: { id: string; name: string; archived?: boolean }[], outreach: OutreachRow[]) =>
    scorecard({ now: NOW, rows: outreach, templates: templates.map((t) => ({ archived: false, ...t })), repliedCompanyIds: [] });

  it("names the best and the worst template in use, as code decided", () => {
    const table = buildFactTable(
      card(
        [
          { id: "a", name: "Strong opener" },
          { id: "b", name: "Weak opener" },
          { id: "c", name: "Middle opener" },
        ],
        [...rows("a", 40, 36), ...rows("b", 40, 4), ...rows("c", 40, 16)],
      ),
    );
    const text = textOf(table.facts);
    expect(text).toMatchObject({ "verdict.best": "Strong opener", "verdict.worst": "Weak opener", "verdict.rated": "3" });
  });

  it("notes a retired template that did better than every one in use", () => {
    const table = buildFactTable(
      card(
        [
          { id: "a", name: "New pitch" },
          { id: "b", name: "Old pitch", archived: true },
        ],
        [...rows("a", 40, 8), ...rows("b", 40, 28)],
      ),
    );
    const text = textOf(table.facts);
    expect(text["verdict.retiredBetter"]).toBe("Old pitch (70%)");
    // Only one template is in use, so nothing in use is named.
    expect(text["verdict.best"]).toBe(TOO_EARLY);
    // Equal sends are ordered by name: t1 is the new pitch, t2 the retired one.
    expect([text["t1.name"], text["t1.inUse"], text["t2.name"], text["t2.inUse"]]).toEqual(["New pitch", "in use", "Old pitch", "retired"]);
  });

  it("says too early to tell when nothing is rated, and when the ranges overlap", () => {
    const empty = textOf(buildFactTable(card([{ id: "a", name: "Only" }], rows("a", 5, 2, 3))).facts);
    expect(empty).toMatchObject({ "verdict.best": TOO_EARLY, "verdict.worst": TOO_EARLY, "verdict.rated": "0" });
    const close = textOf(
      buildFactTable(
        card(
          [
            { id: "a", name: "One" },
            { id: "b", name: "Two" },
          ],
          [...rows("a", 20, 8), ...rows("b", 20, 10)],
        ),
      ).facts,
    );
    expect(close).toMatchObject({ "verdict.best": TOO_EARLY, "verdict.worst": TOO_EARLY, "verdict.rated": "2" });
  });

  it("explains at most the eight templates with the most sends, most first, ties by name", () => {
    const templates = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, name: `Template ${String.fromCharCode(65 + i)}` }));
    // Template A..J send 1..10 times, except that G and H both send 4.
    const sends = [1, 2, 3, 4, 5, 6, 4, 4, 9, 10];
    const outreach = templates.flatMap((t, i) => rows(t.id, sends[i], 0));
    const table = buildFactTable(card(templates, outreach));
    expect(Object.keys(table.names)).toHaveLength(MAX_TEMPLATES);
    expect(Object.values(table.names)).toEqual([
      "Template J",
      "Template I",
      "Template F",
      "Template E",
      // Three templates sent 4: D, G and H, by name.
      "Template D",
      "Template G",
      "Template H",
      "Template C",
    ]);
    expect(table.facts.filter((f) => /^t\d+\.name$/.test(f.key))).toHaveLength(MAX_TEMPLATES);
  });
});

describe("the hash of a fact table", () => {
  const facts = [
    { key: "t1.sent", value: 28 },
    { key: "t1.rate", value: 0.6 },
    { key: "verdict.best", value: "Alumni angle" },
  ];

  it("is the same for the same keys and values, whatever their order", () => {
    expect(factsHash(facts)).toBe(factsHash([...facts].reverse()));
    expect(factsHash(facts)).toMatch(/^[0-9a-f]{32}$/);
  });

  test.each([
    ["a number", [{ key: "t1.sent", value: 29 }, facts[1], facts[2]]],
    ["a word", [facts[0], facts[1], { key: "verdict.best", value: "Cold intro" }]],
    ["a key", [facts[0], { key: "t2.rate", value: 0.6 }, facts[2]]],
    ["a missing fact", [facts[0], facts[1]]],
    ["a number turned into text", [{ key: "t1.sent", value: "28" }, facts[1], facts[2]]],
  ])("changes with %s", (_name, other) => {
    expect(factsHash(other)).not.toBe(factsHash(facts));
  });

  it("ignores the label texts, which don't change what the numbers are", () => {
    const withText = facts.map((f) => ({ ...f, text: "x", what: "y" }));
    expect(factsHash(withText)).toBe(factsHash(facts));
  });

  it("changes when a reply is marked in the real fixture", async () => {
    await seedStatsFixture();
    const before = factsHash(buildFactTable(await workspaceStats(OWNER, "none")).facts);
    expect(factsHash(buildFactTable(await workspaceStats(OWNER, "none")).facts)).toBe(before);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', 'ownerA', true), set_config('app.workspace_id', 'a', true)`;
      await tx.outreach.updateMany({ where: { id: "o-2-good-12" }, data: { gotReply: true } });
    });
    expect(factsHash(buildFactTable(await workspaceStats(OWNER, "none")).facts)).not.toBe(before);
  });
});
