import { describe, expect, it, test } from "vitest";
import { toGroqSchema } from "@/lib/ai/schema";
import {
  checkFilter,
  checkIntent,
  CODE_REPLIES,
  DEFAULT_FILTER,
  followUpOk,
  matchIndustry,
  MAX_ACTION_COMPANIES,
  questionProblem,
  recheckStored,
  replyProblem,
  type CheckContext,
} from "@/lib/copilot/intent";
import { copilotFilterSchema, copilotIntentSchema, type CopilotIntent } from "@/lib/validation";

// What code does with the model's intent, one rule at a time. Pure: no database, no AI.
const TODAY = "2026-11-13";
const SHOWN = ["co-1", "co-2", "co-3", "co-4", "co-5", "co-6", "co-7", "co-8", "co-9", "co-10"];
const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({
  question: "who is overdue in tech?",
  shownIds: new Set(SHOWN),
  industries: ["Technology", "Finance", "Financial Services", "Health & Biotech"],
  today: TODAY,
  guideIds: ["claims", "release", "queue"],
  ...over,
});
const intent = (over: Partial<CopilotIntent> = {}): CopilotIntent => ({
  view: "none",
  reply: "Okay.",
  filter: null,
  company: null,
  minutes: null,
  guideTopics: [],
  actions: [],
  ...over,
});
const action = (over: Partial<CopilotIntent["actions"][number]> = {}): CopilotIntent["actions"][number] => ({
  type: "CLAIM",
  companyIds: ["co-1"],
  stage: null,
  followUpOn: null,
  ...over,
});

describe("the reply sentence", () => {
  test.for([
    ["a plain sentence", "Here are the overdue companies in tech.", "who is overdue in tech?", false],
    ["a number the question had", "A plan for 30 minutes.", "plan my 30 minutes", false],
    ["a number the question did not have", "You have 7 overdue companies.", "who is overdue?", true],
    ["a longer number than the question's", "Here are 300 companies.", "show 30 companies", true],
    ["the question's number inside a bigger one", "About 130 minutes.", "plan 30 minutes", true],
    ["a year", "Follow up in 2027.", "when should I follow up", true],
    ["fullwidth digits", "You have ７ left.", "who is overdue?", true],
    ["Arabic-Indic digits", "You have ٧ left.", "who is overdue?", true],
    ["a link", "Details at https://example.com/page.", "how do I import?", true],
    ["a www address", "See www.coppice.example for more.", "how do I import?", true],
    ["a bare domain", "Ask acme.com about it.", "how do I import?", true],
    ["a domain with a path", "Try example.dev/help.", "how do I import?", true],
    ["an email address", "Write to dana@purdue.edu.", "how do I import?", true],
    ["a sentence with a dot and no link", "Claims last two weeks. Release gives one up early.", "how do claims work?", false],
    ["an abbreviation", "e.g. Acme Inc. and others.", "show acme", false],
  ] as const)("%s", ([, reply, question, replaced]) => {
    expect(replyProblem(reply, question)).toBe(replaced);
    const checked = checkIntent(intent({ view: "companies", reply, filter: DEFAULT_FILTER }), ctx({ question }));
    expect(checked.intent.reply).toBe(replaced ? CODE_REPLIES.companies : reply);
  });

  it("is replaced when empty, with the sentence for the view it ended up with", () => {
    expect(checkIntent(intent({ view: "plan", reply: "   ", minutes: 30 }), ctx()).intent.reply).toBe(CODE_REPLIES.plan);
    expect(checkIntent(intent({ view: "none", reply: "" }), ctx()).intent.reply).toBe(CODE_REPLIES.none);
  });

  it("loses control characters and extra spaces, and is otherwise kept as written", () => {
    const checked = checkIntent(intent({ view: "none", reply: "Not   here\u0000 \n or <b>there</b>." }), ctx());
    expect(checked.intent.reply).toBe("Not here or <b>there</b>.");
  });

  it("the sentences that stand in for a reply pass their own check", () => {
    for (const sentence of Object.values(CODE_REPLIES)) expect(replyProblem(sentence, "")).toBe(false);
  });
});

describe("company ids and names", () => {
  it("keeps an id that was in the shown list", () => {
    const checked = checkIntent(intent({ view: "company", company: { id: "co-3", name: null } }), ctx());
    expect(checked).toMatchObject({ usable: true, intent: { view: "company", company: { id: "co-3", name: null } } });
  });

  it("drops an id that was not shown and falls back to the name for code to look up", () => {
    const checked = checkIntent(intent({ view: "company", company: { id: "invented", name: "Acme" } }), ctx());
    expect(checked.intent.company).toEqual({ id: null, name: "Acme" });
    expect(checked.usable).toBe(true);
  });

  it("makes the answer unusable when neither an id nor a name is left", () => {
    for (const company of [null, { id: "invented", name: null }, { id: null, name: "   " }, { id: "co-99", name: "" }]) {
      const checked = checkIntent(intent({ view: "company", company }), ctx());
      expect(checked.usable).toBe(false);
      expect(checked.intent).toMatchObject({ view: "none", company: null, actions: [] });
    }
  });

  it("an id is never trusted from outside the shown list, even for an id that looks real", () => {
    const checked = checkIntent(intent({ view: "company", company: { id: "cmabc123def456ghi789jkl012", name: null } }), ctx({ shownIds: new Set() }));
    expect(checked.usable).toBe(false);
  });

  it("only a company view keeps a company, only a list keeps a filter", () => {
    const checked = checkIntent(intent({ view: "stats", company: { id: "co-1", name: "Acme" }, filter: DEFAULT_FILTER, minutes: 30, guideTopics: ["claims"] }), ctx());
    expect(checked.intent).toMatchObject({ view: "stats", company: null, filter: null, minutes: null, guideTopics: [] });
  });
});

describe("actions", () => {
  it("drops an invented id, keeps the known ones in the same action, and says so", () => {
    const checked = checkIntent(intent({ actions: [action({ companyIds: ["co-1", "invented", "co-2"] })] }), ctx());
    expect(checked.intent.actions).toEqual([action({ companyIds: ["co-1", "co-2"] })]);
    expect(checked.notes).toEqual(["Some suggested actions were left out because they didn't pass Coppice's checks."]);
  });

  it("drops an action none of whose ids were shown", () => {
    const checked = checkIntent(intent({ actions: [action({ companyIds: ["invented"] }), action({ type: "RELEASE", companyIds: ["co-2"] })] }), ctx());
    expect(checked.intent.actions).toEqual([action({ type: "RELEASE", companyIds: ["co-2"] })]);
  });

  it("refuses every id when nothing was shown (the first question of a conversation)", () => {
    const checked = checkIntent(intent({ actions: [action()] }), ctx({ shownIds: new Set() }));
    expect(checked.intent.actions).toEqual([]);
    expect(checked.usable).toBe(true);
  });

  it("keeps at most 10 companies across all actions, cutting the one that crosses the line", () => {
    const checked = checkIntent(
      intent({ actions: [action({ companyIds: SHOWN.slice(0, 7) }), action({ type: "RELEASE", companyIds: SHOWN.slice(5, 10) }), action({ type: "LOG", companyIds: ["co-1"] })] }),
      ctx(),
    );
    expect(checked.intent.actions.flatMap((a) => a.companyIds)).toHaveLength(MAX_ACTION_COMPANIES);
    expect(checked.intent.actions.map((a) => a.companyIds.length)).toEqual([7, 3]);
    expect(checked.notes).toHaveLength(1);
  });

  it("counts a company named twice in one action once", () => {
    const checked = checkIntent(intent({ actions: [action({ companyIds: ["co-1", "co-1", "co-1"] })] }), ctx());
    expect(checked.intent.actions[0].companyIds).toEqual(["co-1"]);
  });

  test.for([
    ["MOVE_STAGE with a stage", action({ type: "MOVE_STAGE", stage: "REPLIED" }), true],
    ["MOVE_STAGE without one", action({ type: "MOVE_STAGE", stage: null }), false],
    ["SET_FOLLOW_UP with a good date", action({ type: "SET_FOLLOW_UP", followUpOn: "2026-11-20" }), true],
    ["SET_FOLLOW_UP with no date", action({ type: "SET_FOLLOW_UP", followUpOn: null }), false],
    ["SET_FOLLOW_UP with a date that isn't one", action({ type: "SET_FOLLOW_UP", followUpOn: "next friday" }), false],
    ["SET_FOLLOW_UP in the past", action({ type: "SET_FOLLOW_UP", followUpOn: "2026-11-12" }), false],
    ["SET_FOLLOW_UP too far out", action({ type: "SET_FOLLOW_UP", followUpOn: "2027-11-15" }), false],
    ["SET_FOLLOW_UP on a day that doesn't exist", action({ type: "SET_FOLLOW_UP", followUpOn: "2026-11-31" }), false],
    ["CLAIM", action({ type: "CLAIM" }), true],
    ["LOG", action({ type: "LOG" }), true],
  ] as const)("%s", ([, proposed, kept]) => {
    expect(checkIntent(intent({ actions: [proposed] }), ctx()).intent.actions).toHaveLength(kept ? 1 : 0);
  });

  it("carries a stage only on MOVE_STAGE and a date only on SET_FOLLOW_UP", () => {
    const checked = checkIntent(
      intent({ actions: [action({ type: "CLAIM", stage: "DECLINED", followUpOn: "2026-11-20" }), action({ type: "MOVE_STAGE", stage: "REPLIED", followUpOn: "2026-11-20", companyIds: ["co-2"] })] }),
      ctx(),
    );
    expect(checked.intent.actions).toEqual([action({ type: "CLAIM" }), action({ type: "MOVE_STAGE", stage: "REPLIED", companyIds: ["co-2"] })]);
  });

  test.for([
    ["today", TODAY, true],
    ["a year from today", "2027-11-13", true],
    ["a day past a year", "2027-11-14", false],
    ["yesterday", "2026-11-12", false],
    ["a leap day that exists", "2028-02-29", false],
    ["null", null, false],
  ] as const)("follow-up range: %s", ([, date, ok]) => {
    expect(followUpOk(date, TODAY)).toBe(ok);
  });

  it("the range follows the database's today, which can move", () => {
    expect(followUpOk("2026-11-13", "2026-11-14")).toBe(false);
    expect(followUpOk("2028-02-29", "2027-03-01")).toBe(true);
  });
});

describe("filters", () => {
  const filter = { ...DEFAULT_FILTER, due: "overdue" as const };

  test.for([
    ["an exact industry", "Technology", "Technology"],
    ["another case", "technology", "Technology"],
    ["extra spaces", "  Financial   Services ", "Financial Services"],
    ["the start of one long name", "Health & Bio", "Health & Biotech"],
    ["a name cut short with an ellipsis", "Financial Serv…", "Financial Services"],
    ["a start shared by two", "Fin", null],
    ["a made-up industry", "Underwater Basket Weaving", null],
    ["two letters", "Te", null],
    ["a word inside one", "Biotech", null],
    ["empty", "", null],
    ["null", null, null],
  ] as const)("industry: %s", ([, given, expected]) => {
    expect(matchIndustry(given, ctx().industries)).toBe(expected);
  });

  it("drops an industry the workspace doesn't use and says so, but keeps the rest of the filter", () => {
    const checked = checkIntent(intent({ view: "companies", filter: { ...filter, industry: "Mining" } }), ctx());
    expect(checked.intent.filter).toMatchObject({ industry: null, due: "overdue" });
    expect(checked.notes).toEqual(["Coppice couldn't match that industry, so the list isn't filtered by it."]);
  });

  it("says nothing when the industry was left empty", () => {
    expect(checkIntent(intent({ view: "companies", filter: { ...filter, industry: "  " } }), ctx()).notes).toEqual([]);
    expect(checkIntent(intent({ view: "companies", filter: { ...filter, industry: "technology" } }), ctx()).intent.filter?.industry).toBe("Technology");
  });

  it("runs the default filter when a list came with none", () => {
    expect(checkIntent(intent({ view: "companies", filter: null }), ctx()).intent.filter).toEqual(DEFAULT_FILTER);
  });

  it("cleans search text: trimmed, one line, cut to 100, empty is none", () => {
    const checked = checkFilter({ ...DEFAULT_FILTER, nameOrSite: "  ac\nme\u0000 ", notesMention: "x".repeat(300) }, ctx());
    expect(checked.filter.nameOrSite).toBe("ac me");
    expect(checked.filter.notesMention).toHaveLength(100);
    expect(checkFilter({ ...DEFAULT_FILTER, nameOrSite: "   " }, ctx()).filter.nameOrSite).toBeNull();
  });

  it("lists each stage once", () => {
    expect(checkFilter({ ...DEFAULT_FILTER, stages: ["CONTACTED", "REPLIED", "CONTACTED"] }, ctx()).filter.stages).toEqual(["CONTACTED", "REPLIED"]);
  });
});

describe("plan minutes and guide topics", () => {
  test.for([
    [null, 30],
    [30, 30],
    [5, 10],
    [0, 10],
    [-20, 10],
    [500, 120],
    [47.6, 48],
    [Number.NaN, 30],
  ] as const)("minutes %s becomes %s", ([given, expected]) => {
    expect(checkIntent(intent({ view: "plan", minutes: given }), ctx()).intent.minutes).toBe(expected);
  });

  it("keeps guide topics that exist, each once, at most 3", () => {
    const checked = checkIntent(intent({ view: "guide", guideTopics: ["claims", "nope", "claims", " release ", "queue", "claims"] }), ctx({ guideIds: ["claims", "release", "queue", "stages"] }));
    expect(checked.intent.guideTopics).toEqual(["claims", "release", "queue"]);
    expect(checkIntent(intent({ view: "guide", guideTopics: ["a", "claims", "b", "queue", "release", "stages"] }), ctx({ guideIds: ["claims", "release", "queue", "stages"] })).intent.guideTopics).toEqual(["claims", "queue", "release"]);
  });

  it("makes a guide answer unusable when no topic exists", () => {
    const checked = checkIntent(intent({ view: "guide", guideTopics: ["invented", "also-made-up"] }), ctx());
    expect(checked).toMatchObject({ usable: false, intent: { view: "none", guideTopics: [] } });
  });
});

describe("view none", () => {
  it("keeps only its reply (an answer to something off topic, or that Coppice can't do)", () => {
    const checked = checkIntent(intent({ view: "none", reply: "Coppice can't send email.", filter: DEFAULT_FILTER, minutes: 30, guideTopics: ["claims"] }), ctx());
    expect(checked).toMatchObject({ usable: true, intent: { view: "none", reply: "Coppice can't send email.", filter: null, company: null, minutes: null, guideTopics: [], actions: [] } });
  });
});

describe("a stored intent read back later", () => {
  it("drops a follow-up date that has since passed, and keeps its companies", () => {
    const stored = checkIntent(intent({ actions: [action({ type: "SET_FOLLOW_UP", followUpOn: "2026-11-14" }), action({ companyIds: ["co-2"] })] }), ctx()).intent;
    const later = recheckStored(stored, { question: "move them", industries: [], today: "2026-11-15", guideIds: [] });
    expect(later.intent.actions).toEqual([action({ companyIds: ["co-2"] })]);
  });

  it("checks the industry against the workspace as it is now", () => {
    const stored = checkIntent(intent({ view: "companies", filter: { ...DEFAULT_FILTER, industry: "Technology" } }), ctx()).intent;
    expect(recheckStored(stored, { question: "q", industries: ["Technology"], today: TODAY, guideIds: [] }).intent.filter?.industry).toBe("Technology");
    expect(recheckStored(stored, { question: "q", industries: ["Finance"], today: TODAY, guideIds: [] }).intent.filter?.industry).toBeNull();
  });

  it("keeps a company id it stored (that company was in a shown list when it was stored)", () => {
    const stored = checkIntent(intent({ view: "company", company: { id: "co-4", name: null } }), ctx()).intent;
    expect(recheckStored(stored, { question: "q", industries: [], today: TODAY, guideIds: [] })).toMatchObject({ usable: true, intent: { company: { id: "co-4" } } });
  });

  it("is steady: checking a checked intent changes nothing", () => {
    const first = checkIntent(
      intent({ view: "companies", reply: "Here are 7 companies.", filter: { ...DEFAULT_FILTER, industry: "tech", stages: ["CONTACTED"] }, actions: [action({ type: "SET_FOLLOW_UP", followUpOn: "2026-11-20", companyIds: ["co-1", "co-2"] })] }),
      ctx({ question: "who is overdue in tech?" }),
    ).intent;
    expect(recheckStored(first, { question: "who is overdue in tech?", industries: ctx().industries, today: TODAY, guideIds: [] }).intent).toEqual(first);
  });
});

describe("the schema the model is held to", () => {
  const good: CopilotIntent = intent({ view: "companies", reply: "Here.", filter: DEFAULT_FILTER });

  it("accepts a good intent", () => {
    expect(copilotIntentSchema.safeParse(good).success).toBe(true);
  });

  test.for([
    ["a view that doesn't exist", { ...good, view: "everything" }],
    ["a missing key", { view: "none", reply: "x", filter: null, company: null, minutes: null, guideTopics: [] }],
    ["an action type that doesn't exist", { ...good, actions: [{ type: "DELETE", companyIds: [], stage: null, followUpOn: null }] }],
    ["a stage that doesn't exist", { ...good, filter: { ...DEFAULT_FILTER, stages: ["WON"] } }],
    ["a sort that doesn't exist", { ...good, filter: { ...DEFAULT_FILTER, sort: "random" } }],
    ["minutes as text", { ...good, minutes: "30" }],
    ["a filter key missing", { ...good, filter: { stages: [] } }],
    ["not an object", "Sure, here you go"],
  ] as const)("refuses %s", ([, value]) => {
    expect(copilotIntentSchema.safeParse(value).success).toBe(false);
  });

  it("cuts a long reply instead of refusing the whole answer", () => {
    const parsed = copilotIntentSchema.parse({ ...good, reply: `${"word ".repeat(100)}end` });
    expect(parsed.reply.length).toBeLessThanOrEqual(240);
    expect(copilotFilterSchema.parse({ ...DEFAULT_FILTER, nameOrSite: "x".repeat(500) }).nameOrSite).toHaveLength(100);
  });

  it("is a strict Groq schema: every key required, every object closed, nullable as anyOf, no limits sent", () => {
    const schema = toGroqSchema(copilotIntentSchema);
    const objects: Record<string, unknown>[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node === null || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.type === "object") objects.push(n);
      Object.values(n).forEach(walk);
    };
    walk(schema);
    expect(objects.length).toBe(4);
    for (const object of objects) {
      expect(object.additionalProperties).toBe(false);
      expect(object.required).toEqual(Object.keys(object.properties as object));
    }
    const text = JSON.stringify(schema);
    expect(text).not.toMatch(/maxLength|minLength|maxItems|"minimum"|"maximum"/);
    // A nullable number is written as anyOf (the form Smart import's schema was proven live with),
    // never as a list of types.
    expect((schema as { properties: Record<string, unknown> }).properties.minutes).toMatchObject({ anyOf: [{ type: "integer" }, { type: "null" }] });
    expect(text).not.toMatch(/"type":\[/);
  });
});

describe("the question", () => {
  test.for([
    ["a question", "who is overdue?", null],
    ["500 characters", "x".repeat(500), null],
    ["501 characters", "x".repeat(501), "A question can be at most 500 characters."],
    ["only spaces", "   ", "Ask a question."],
    ["empty", "", "Ask a question."],
    ["a NUL character", "who\0is", "This text has a character Coppice can't save."],
  ] as const)("%s", ([, question, problem]) => {
    expect(questionProblem(question)).toBe(problem);
  });
});
