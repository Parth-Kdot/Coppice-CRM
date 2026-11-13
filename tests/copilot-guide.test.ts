import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, test } from "vitest";
import { AI_WINDOW_DAYS, DAILY_BRIEFS_PER_PERSON, DAILY_COPILOT_PER_PERSON, DAILY_DRAFTS_PER_PERSON } from "@/lib/ai/run";
import { TRUST } from "@/components/landing/copy";
import { PDF_MAX_PAGES } from "@/lib/ai/pdf-limits";
import { DEFAULT_AI_LIMIT, DEFAULT_CLAIM_WINDOW_DAYS, GUIDE, GUIDE_IDS, guideIndex, guideSections } from "@/lib/copilot/guide";
import { prisma } from "@/lib/db";
import { AI_LIMIT_MAX, BRIEF_SOURCES_MAX, CLAIM_WINDOW_MAX_DAYS, CLAIM_WINDOW_MIN_DAYS, IMPORT_MAX_ROWS, NOTE_MAX, SMART_MAX_ROWS, SMART_STAGES } from "@/lib/limits";
import { MCP_LIMITS } from "@/lib/mcp/rate-limit";
import { basicsSteps } from "@/lib/onboarding-steps";
import { FRESH_CAP, QUEUE_CAP, QUEUE_SIZE } from "@/lib/queue";
import { MATURITY_DAYS, MIN_SENDS } from "@/lib/stats-math";
import { TERMINAL_STAGES } from "@/lib/stages";
import { resetAndSeed } from "./helpers/seed";

// Coppice's own product guide (lib/copilot/guide.ts), which Ask Coppice answers from word for word.
const text = (id: string) => GUIDE.find((t) => t.id === id)!.body.join("\n");

describe("the guide's shape", () => {
  it("has about 14 topics with distinct ids, titles and summaries", () => {
    expect(GUIDE).toHaveLength(14);
    expect(new Set(GUIDE.map((t) => t.id)).size).toBe(14);
    expect(new Set(GUIDE.map((t) => t.title)).size).toBe(14);
    expect(GUIDE_IDS).toEqual(GUIDE.map((t) => t.id));
  });

  it("covers the topics Ask Coppice was asked to explain", () => {
    expect(GUIDE_IDS).toEqual([
      "claims",
      "release",
      "logging",
      "queue",
      "stages",
      "duplicates",
      "import",
      "templates-stats",
      "drafts",
      "research",
      "assistants",
      "roles",
      "ai-limits",
      "tours",
    ]);
  });

  test.for(GUIDE.map((t) => [t.id, t] as const))("%s: a one-line summary and two to five short paragraphs", ([, topic]) => {
    expect(topic.summary).not.toMatch(/\n/);
    expect(topic.summary.length).toBeLessThanOrEqual(45);
    expect(topic.title.length).toBeLessThanOrEqual(45);
    expect(topic.body.length).toBeGreaterThanOrEqual(2);
    expect(topic.body.length).toBeLessThanOrEqual(5);
    for (const paragraph of topic.body) {
      expect(paragraph.length).toBeGreaterThan(40);
      expect(paragraph.length).toBeLessThan(700);
    }
  });

  it("shows the model only the index: ids, titles and one line each", () => {
    expect(guideIndex()).toEqual(GUIDE.map(({ id, title, summary }) => ({ id, title, summary })));
    expect(Object.keys(guideIndex()[0])).toEqual(["id", "title", "summary"]);
  });
});

describe("house style", () => {
  const everything = GUIDE.flatMap((t) => [t.title, t.summary, ...t.body]);

  test.for([
    ["an em dash", /—/],
    ["an en dash", /–/],
    ["an arrow", /[→←↔⇒⇐↦➜➔]/],
    ["a plus sign", /\+/],
    ["an equals sign", /=/],
    ["an ampersand", /&/],
    ["a question mark (the guide states, it doesn't ask)", /\?/],
    ["an exclamation mark", /!/],
    ["a curly apostrophe or quote", /[‘’“”]/],
    ["a double space", / {2}/],
    ["an emoji", /\p{Extended_Pictographic}/u],
    ["'not X, it's Y' phrasing", /\bnot\b[^.]{0,60}, (?:it's|it is|but)\b/i],
  ] as const)("has no %s", ([, pattern]) => {
    for (const line of everything) expect(line).not.toMatch(pattern);
  });

  it("calls the product Coppice and never the app or the tool", () => {
    expect(everything.join(" ")).toContain("Coppice");
    expect(everything.join(" ")).not.toMatch(/\bCRM\b/);
  });
});

describe("numbers come from the constants the code uses", () => {
  it("claims: the window and its range", () => {
    expect(text("claims")).toContain(`${DEFAULT_CLAIM_WINDOW_DAYS} days in a new workspace`);
    expect(text("claims")).toContain(`from ${CLAIM_WINDOW_MIN_DAYS} day to ${CLAIM_WINDOW_MAX_DAYS} days`);
  });

  it("logging: the note limit", () => {
    expect(text("logging")).toContain(`up to ${NOTE_MAX} characters`);
  });

  it("queue: page sizes and caps", () => {
    expect(text("queue")).toContain(`first ${QUEUE_SIZE}`);
    expect(text("queue")).toContain(`up to ${QUEUE_CAP}`);
    expect(text("queue")).toContain(`up to ${FRESH_CAP}`);
  });

  it("import: row limit and Smart import's row limit", () => {
    expect(text("import")).toContain(`up to ${IMPORT_MAX_ROWS} rows and 3 MB`);
    expect(text("import")).toContain(`up to ${SMART_MAX_ROWS} rows`);
  });

  it("stats: the maturity and the minimum sends", () => {
    expect(text("templates-stats")).toContain(`${MATURITY_DAYS} days old`);
    expect(text("templates-stats")).toContain(`after ${MIN_SENDS} counted sends`);
  });

  it("drafts, research and Ask Coppice: the daily limits, and the packet limits", () => {
    expect(text("drafts")).toContain(`${DAILY_DRAFTS_PER_PERSON} drafts in 24 hours`);
    expect(text("drafts")).toContain(`3.5 MB and ${PDF_MAX_PAGES} pages`);
    expect(text("research")).toContain(`${DAILY_BRIEFS_PER_PERSON} briefs in 24 hours`);
    expect(text("research")).toContain(`up to ${BRIEF_SOURCES_MAX} for a brief`);
    expect(text("ai-limits")).toContain(`${DAILY_DRAFTS_PER_PERSON} drafts, ${DAILY_BRIEFS_PER_PERSON} research briefs and ${DAILY_COPILOT_PER_PERSON} questions to Ask Coppice`);
  });

  it("AI limits: says Ask Coppice sends the industry names, as the landing page and Settings do", () => {
    const wording = "your question, your last few questions in that conversation, the names of companies it just showed you and the industry names your workspace uses";
    expect(text("ai-limits")).toContain(wording);
    const landing = TRUST.privacy.find((p) => p.title === "What does go to the provider")!.body;
    expect(landing).toContain("the names of companies it just showed you, and the industry names your workspace uses");
    // Settings is a page, so its source is read.
    const settings = readFileSync("app/(app)/[workspaceId]/settings/page.tsx", "utf8").replace(/\s+/g, " ");
    expect(settings).toContain("the names of companies it just showed you, and the industry names your workspace uses");
  });

  it("AI limits: the workspace's default and range, and the window", () => {
    expect(text("ai-limits")).toContain(`${DEFAULT_AI_LIMIT} AI calls in ${AI_WINDOW_DAYS} days`);
    expect(text("ai-limits")).toContain(`from 0 to ${AI_LIMIT_MAX}`);
  });

  it("assistants: the per-minute limits", () => {
    expect(text("assistants")).toContain(`${MCP_LIMITS.read} reads and ${MCP_LIMITS.action} changes a minute`);
  });

  it("tours: the number of cards for officers and owners, counted from the tour itself", () => {
    const officers = basicsSteps({ role: "member", empty: false, basicsRole: null }).length;
    const owners = basicsSteps({ role: "owner", empty: false, basicsRole: null }).length;
    expect(owners).toBe(officers + 1);
    expect(text("tours")).toContain(`Officers get ${officers} cards and owners get ${owners}`);
  });
});

describe("statements that depend on code written elsewhere", () => {
  it("a new workspace's claim window and AI limit are the schema's defaults", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    expect(Number(/claimWindowDays\s+Int\s+@default\((\d+)\)/.exec(schema)?.[1])).toBe(DEFAULT_CLAIM_WINDOW_DAYS);
    expect(Number(/aiMonthlyLimit\s+Int\s+@default\((\d+)\)/.exec(schema)?.[1])).toBe(DEFAULT_AI_LIMIT);
  });

  it("a new workspace's claim window really is 14 days, and its AI limit 300", async () => {
    await resetAndSeed();
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: "a" }, select: { claimWindowDays: true, aiMonthlyLimit: true } });
    expect(workspace).toEqual({ claimWindowDays: DEFAULT_CLAIM_WINDOW_DAYS, aiMonthlyLimit: DEFAULT_AI_LIMIT });
  });

  it("the auth config gives new workspaces the same claim window", () => {
    expect(readFileSync("lib/auth.ts", "utf8")).toMatch(new RegExp(`claimWindowDays: \\{[^}]*defaultValue: ${DEFAULT_CLAIM_WINDOW_DAYS}\\b`));
  });

  it("Smart import never sets Committed or Declined", () => {
    for (const stage of TERMINAL_STAGES) expect(SMART_STAGES as readonly string[]).not.toContain(stage);
    expect(text("import")).toContain("never sets Committed or Declined");
  });
});

describe("guideSections", () => {
  it("returns topics in the order asked, each once, skipping ids that don't exist", () => {
    expect(guideSections(["queue", "nope", "claims", "queue"]).map((t) => t.id)).toEqual(["queue", "claims"]);
    expect(guideSections([])).toEqual([]);
    expect(guideSections(["invented"])).toEqual([]);
  });

  it("returns the written topic itself, word for word", () => {
    expect(guideSections(["claims"])[0]).toBe(GUIDE[0]);
  });
});

beforeEach(async () => {});
afterAll(async () => {
  await prisma.$disconnect();
});
