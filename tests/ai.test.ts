import { globSync, readFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import { z } from "zod";
import { updateAiSettings } from "@/app/(app)/[workspaceId]/settings/actions";
import { generate, ROUTES } from "@/lib/ai/client";
import { AI_ERROR_MESSAGES, aiUsage, DAILY_DRAFTS_PER_PERSON, draftsToday, isRetryableAiError, releaseAi, reserveAi, runAi } from "@/lib/ai/run";
import { clamped, clampText, droppedItems, keptItems, toGeminiSchema } from "@/lib/ai/schema";
import { dbNow } from "@/lib/claims";
import { prisma, withTenant, type Tenant } from "@/lib/db";
import { form, redirectTo } from "./helpers/form";
import { answer, apiError, calls, fakeGemini, reply } from "./helpers/gemini";
import { asUser, signedOut } from "./helpers/next-request";
import { resetAndSeed } from "./helpers/seed";

vi.mock("next/headers", () => import("./helpers/next-request"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// The tests never call the real Gemini API (tests/helpers/gemini.ts).
const A: Tenant = { userId: "ownerA", workspaceId: "a" };
const OFFICER_A: Tenant = { userId: "officerA", workspaceId: "a" };
const B: Tenant = { userId: "ownerB", workspaceId: "b" };

const Pitch = z.object({
  subject: z.string().max(120).describe("Email subject line"),
  tone: z.enum(["direct", "warm"]),
  points: z.array(z.string().max(200)).min(1).max(3),
});
const request = { feature: "DRAFT" as const, system: "You write short emails.", prompt: "Draft one.", schema: Pitch };
const GOOD = { subject: "Sponsor our hackathon", tone: "warm", points: ["600 students"] };

beforeEach(async () => {
  await resetAndSeed();
  process.env.GEMINI_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("toGeminiSchema", () => {
  const ALLOWED = new Set(["type", "format", "title", "description", "enum", "items", "prefixItems", "minItems", "maxItems", "minimum", "maximum", "anyOf", "properties", "additionalProperties", "required"]);

  // Every key Gemini will see must be one it documents, and every enum value a string or number.
  function walk(node: unknown, path = "$"): string[] {
    if (Array.isArray(node)) return node.flatMap((n, i) => walk(n, `${path}[${i}]`));
    if (node === null || typeof node !== "object") return [];
    return Object.entries(node).flatMap(([key, value]) => {
      const problems = ALLOWED.has(key) ? [] : [`${path}.${key}`];
      if (key === "enum") problems.push(...(value as unknown[]).filter((v) => typeof v !== "string" && typeof v !== "number").map(() => `${path}.enum`));
      if (key === "properties") return [...problems, ...Object.entries(value as object).flatMap(([k, v]) => walk(v, `${path}.${k}`))];
      return [...problems, ...walk(value, `${path}.${key}`)];
    });
  }

  it("keeps only what Gemini accepts, and closes every object", () => {
    const schema = z.object({
      subject: z.string().max(120).describe("Subject"),
      kind: z.literal("first"),
      flag: z.literal(true),
      score: z.number().int(),
      when: z.iso.datetime(),
      email: z.email(),
      tags: z.array(z.string()).min(1).max(2),
      maybe: z.string().nullable(),
      either: z.union([z.string(), z.number()]),
      nested: z.object({ a: z.string() }),
    });
    const out = toGeminiSchema(schema);
    expect(walk(out)).toEqual([]);
    expect(out).not.toHaveProperty("$schema");
    expect(out.additionalProperties).toBe(false);
    const props = out.properties as Record<string, Record<string, unknown>>;
    expect(props.subject).toEqual({ type: "string", description: "Subject" });
    expect(props.kind).toEqual({ type: "string", enum: ["first"] });
    expect(props.flag).toEqual({ type: "boolean" });
    expect(props.score).toEqual({ type: "integer" });
    expect(props.when).toMatchObject({ type: "string", format: "date-time" });
    expect(props.email).toEqual({ type: "string" });
    expect(props.tags).toMatchObject({ type: "array", minItems: 1, maxItems: 2 });
    expect(props.nested).toMatchObject({ type: "object", additionalProperties: false });
    expect(props.either).toEqual({ anyOf: [{ type: "string" }, { type: "number" }] });
  });

  it("turns oneOf into anyOf, and drops enum values that aren't strings or numbers", () => {
    const out = toGeminiSchema(
      z.object({
        exclusive: z.xor([z.string(), z.number()]),
        mixed: z.literal(["yes", true]),
        flags: z.literal([true, false]),
      }),
    );
    const props = out.properties as Record<string, Record<string, unknown>>;
    expect(props.exclusive).toEqual({ anyOf: [{ type: "string" }, { type: "number" }] });
    expect(props.mixed.enum).toEqual(["yes"]);
    expect(props.flags).not.toHaveProperty("enum");
    expect(walk(out)).toEqual([]);
  });

  it("leaves out list caps over 50, which Gemini refuses, and keeps smaller ones", () => {
    const out = toGeminiSchema(z.object({ many: z.array(z.string()).min(1).max(150), few: z.array(z.string()).max(50) }));
    const props = out.properties as Record<string, Record<string, unknown>>;
    expect(props.many).toEqual({ type: "array", items: { type: "string" }, minItems: 1 });
    expect(props.few).toMatchObject({ maxItems: 50 });
  });

  it("matches the exact shape for the test schema", () => {
    expect(toGeminiSchema(Pitch)).toEqual({
      type: "object",
      properties: {
        subject: { type: "string", description: "Email subject line" },
        tone: { type: "string", enum: ["direct", "warm"] },
        points: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
      },
      required: ["subject", "tone", "points"],
      additionalProperties: false,
    });
  });
});

describe("generate (the Gemini client)", () => {
  it("sends the right request and returns the checked reply with token counts", async () => {
    fakeGemini(answer(JSON.stringify(GOOD)));
    const result = await generate(request);
    expect(result).toEqual({
      ok: true,
      data: GOOD,
      model: "gemini-3.6-flash",
      usage: { promptTokens: 120, outputTokens: 40, thinkingTokens: 15 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("models/gemini-3.6-flash:generateContent");
    const config = calls[0].body;
    expect(config).toMatchObject({
      contents: [{ role: "user", parts: [{ text: "Draft one." }] }],
      systemInstruction: { parts: [{ text: "You write short emails." }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: toGeminiSchema(Pitch),
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingLevel: "LOW" },
      },
    });
    // Knobs these models ignore or reject are never sent.
    const generation = config.generationConfig as Record<string, unknown>;
    for (const key of ["temperature", "topP", "topK", "candidateCount"]) expect(generation).not.toHaveProperty(key);
    expect(generation.thinkingConfig).not.toHaveProperty("thinkingBudget");
  });

  it("routes each feature to its model, each Gemini one with a fallback, and drafting with a last resort", async () => {
    // Groq routes (Smart import's row pass) have one model and no fallback (tests/smart-import.test.ts).
    const models = Object.fromEntries(
      Object.entries(ROUTES).map(([f, r]) => [f, r.provider === "groq" ? [r.model] : [r.model, r.fallback.model, r.lastResort?.model]]),
    );
    expect(models).toEqual({
      FACT_EXTRACTION: ["gemini-3.6-flash", "gemini-3.8-flash", undefined],
      DRAFT: ["gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite"],
      CLAIM_CHECK: ["gemini-3.5-flash-lite", "gemini-3.6-flash", undefined],
      IMPORT_MAPPING: ["gemini-3.5-flash-lite", "gemini-3.6-flash", undefined],
      IMPORT_LOOKALIKES: ["gemini-3.5-flash-lite", "gemini-3.6-flash", undefined],
      IMPORT_ROWS: ["openai/gpt-oss-120b"],
      RESEARCH_READ: ["gemini-3.6-flash", "gemini-3.8-flash", undefined],
      RESEARCH_BRIEF: ["gemini-3.5-flash-lite", "gemini-3.6-flash", undefined],
      COPILOT: ["openai/gpt-oss-120b"],
      SCORECARD_EXPLAIN: ["gemini-3.5-flash-lite", "gemini-3.6-flash", undefined],
      TEMPLATE_LAB: ["gemini-3.6-flash", "gemini-3.8-flash", undefined],
      CAPSULE_CARDS: ["openai/gpt-oss-120b"],
      ARCHIVE_ASK: ["openai/gpt-oss-120b"],
    });
    fakeGemini(answer(JSON.stringify(GOOD)));
    await generate({ ...request, feature: "CLAIM_CHECK" });
    expect(calls[0].url).toContain("models/gemini-3.5-flash-lite:generateContent");
    expect(calls[0].body.generationConfig).not.toHaveProperty("thinkingConfig");
  });

  test.for([
    ["not JSON", answer("Sure! Here's your email"), "invalid_output"],
    ["the wrong shape", answer(JSON.stringify({ subject: "x" })), "invalid_output"],
    ["a field over its limit", answer(JSON.stringify({ ...GOOD, subject: "x".repeat(121) })), "invalid_output"],
    ["an invented enum value", answer(JSON.stringify({ ...GOOD, tone: "pushy" })), "invalid_output"],
    ["a cut-off answer", answer('{"subject": "Spon', "MAX_TOKENS"), "truncated"],
    ["a safety stop", answer("", "SAFETY"), "blocked"],
    ["a blocked prompt", reply({ promptFeedback: { blockReason: "SAFETY" } }), "blocked"],
  ] as const)("reports %s as %s", async ([, response, error]) => {
    fakeGemini(response);
    expect(await generate(request)).toMatchObject({ ok: false, error, model: "gemini-3.6-flash" });
  });

  // No candidate at all (and no blocked prompt) is the service failing, not a refusal: it moves on
  // to the next model like a 503, and is reported as unavailable when every model does it.
  test.for([
    ["no candidates", () => reply({ candidates: [] })],
    ["an empty reply", () => reply({})],
    ["an OTHER stop", () => answer("", "OTHER")],
  ] as const)("treats %s as unavailable and moves on to the next model", async ([, response]) => {
    fakeGemini(response(), answer(JSON.stringify(GOOD)));
    expect(await generate(request)).toMatchObject({ ok: true, model: "gemini-3.8-flash" });
    // Fact extraction has two models; a 200 with nothing in it isn't retried on the same model.
    fakeGemini(response(), response());
    expect(await generate({ ...request, feature: "FACT_EXTRACTION" })).toMatchObject({ ok: false, error: "unavailable", model: "gemini-3.8-flash" });
    expect(calls).toHaveLength(2);
  });

  const limited = () => apiError(429, "Resource exhausted", "RESOURCE_EXHAUSTED");
  test.for([
    ["a rate limit on every model, trying each once", [limited(), limited(), limited()], "rate_limited", 3],
    ["an invalid key", [apiError(400, "API key not valid. Please pass a valid API key.", "INVALID_ARGUMENT")], "bad_key", 1],
    ["a forbidden key", [apiError(403, "Permission denied", "PERMISSION_DENIED")], "bad_key", 1],
    ["another bad request, without retrying or falling back", [apiError(400, "Invalid JSON payload", "INVALID_ARGUMENT")], "rejected", 1],
  ] as const)("reports %s", async ([, responses, error, attempts]) => {
    fakeGemini(...responses);
    expect(await generate(request)).toMatchObject({ ok: false, error, usage: null });
    expect(calls).toHaveLength(attempts);
  });

  const busy = () => apiError(503, "This model is currently experiencing high demand.", "UNAVAILABLE");

  it("goes straight to the fallback model when the main one is overloaded, and says which answered", async () => {
    fakeGemini(busy(), answer(JSON.stringify(GOOD)));
    expect(await generate(request)).toMatchObject({ ok: true, data: GOOD, model: "gemini-3.8-flash" });
    expect(calls.map((c) => c.url.match(/models\/([^:]+)/)?.[1])).toEqual(["gemini-3.6-flash", "gemini-3.8-flash"]);
    // The fallback gets the same request, thinking level included.
    expect(calls[1].body.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: "LOW" } });
  });

  // Recorded case: 3.8 Flash answered 503 "high demand" in 3 s on every call while 3.6 Flash
  // answered. The overload moves on at once, never waiting out the first
  // try's timer (20 s for drafting), and the result says which model failed first and how.
  const highDemand = () => apiError(503, "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.", "UNAVAILABLE");
  it("an overloaded model's 503 moves to the next model at once, and the failed try is reported", async () => {
    fakeGemini(highDemand(), answer(JSON.stringify(GOOD)));
    const started = performance.now();
    const result = await generate(request);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(result).toMatchObject({ ok: true, model: "gemini-3.8-flash", fellBack: [{ model: "gemini-3.6-flash", error: "unavailable" }] });
    expect(calls).toHaveLength(2);
    // A call the main model answers has no failed tries.
    fakeGemini(answer(JSON.stringify(GOOD)));
    expect(await generate(request)).not.toHaveProperty("fellBack");
  });

  it("3.6 Flash goes first for drafting, extraction and research reading, at the thinking levels they were proven at", () => {
    const levels = (feature: "DRAFT" | "FACT_EXTRACTION" | "RESEARCH_READ") => {
      const r = ROUTES[feature];
      if (r.provider === "groq") throw new Error("not Gemini");
      return [r, r.fallback, r.lastResort].filter(Boolean).map((m) => [m?.model, m?.thinkingLevel]);
    };
    expect(levels("DRAFT")).toEqual([
      ["gemini-3.6-flash", "LOW"],
      ["gemini-3.8-flash", "LOW"],
      // Flash-Lite drafting stays at LOW thinking: at its default it skipped the placeholders.
      ["gemini-3.5-flash-lite", "LOW"],
    ]);
    expect(levels("FACT_EXTRACTION")).toEqual([
      ["gemini-3.6-flash", "MEDIUM"],
      ["gemini-3.8-flash", "MEDIUM"],
    ]);
    expect(levels("RESEARCH_READ")).toEqual([
      ["gemini-3.6-flash", "MEDIUM"],
      ["gemini-3.8-flash", "MEDIUM"],
    ]);
    // A hanging 3.8 in the middle of drafting's line gets a short try of its own.
    const draft = ROUTES.DRAFT;
    expect(draft.provider === "groq" ? null : draft.fallback.tryMs).toBeLessThanOrEqual(15_000);
  });

  it("drafting with both Flash models overloaded reports both failed tries before Flash-Lite answered", async () => {
    fakeGemini(highDemand(), highDemand(), answer(JSON.stringify(GOOD)));
    expect(await generate(request)).toMatchObject({
      ok: true,
      model: "gemini-3.5-flash-lite",
      fellBack: [
        { model: "gemini-3.6-flash", error: "unavailable" },
        { model: "gemini-3.8-flash", error: "unavailable" },
      ],
    });
    expect(calls.map((c) => c.body.generationConfig)).toMatchObject([1, 2, 3].map(() => ({ thinkingConfig: { thinkingLevel: "LOW" } })));
  });

  // Fact extraction has no last resort, so its fallback is the last in line and gets the retry.
  const extraction = { ...request, feature: "FACT_EXTRACTION" as const };
  const modelsCalled = () => calls.map((c) => c.url.match(/models\/([^:]+)/)?.[1]);

  it("retries the last model in line once, then gives up", async () => {
    fakeGemini(busy(), busy(), busy());
    expect(await generate(extraction)).toMatchObject({ ok: false, error: "unavailable", model: "gemini-3.8-flash" });
    expect(calls).toHaveLength(3);
  });

  it("moves to the next model on a rate limit, since free-tier quotas are per model", async () => {
    fakeGemini(limited(), answer(JSON.stringify(GOOD)));
    expect(await generate(request)).toMatchObject({ ok: true, model: "gemini-3.8-flash" });
  });

  it("drafts with Flash-Lite when both Flash models fail, thinking at a low level", async () => {
    fakeGemini(busy(), limited(), answer(JSON.stringify(GOOD)));
    expect(await generate(request)).toMatchObject({ ok: true, data: GOOD, model: "gemini-3.5-flash-lite" });
    expect(modelsCalled()).toEqual(["gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite"]);
    expect(calls[2].body.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: "LOW" } });
  });

  it("tries drafting's first two models once each and retries Flash-Lite once", async () => {
    const internal = () => apiError(500, "Internal", "INTERNAL");
    fakeGemini(internal(), internal(), internal(), answer(JSON.stringify(GOOD)));
    expect(await generate(request)).toMatchObject({ ok: true, model: "gemini-3.5-flash-lite" });
    expect(modelsCalled()).toEqual(["gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.5-flash-lite"]);
  });

  // A slow attempt is cut off (AbortError); a slow main model goes to the fallback.
  const aborted = () => new DOMException("The operation was aborted.", "AbortError");

  it("falls back when the main model is too slow", async () => {
    fakeGemini(aborted(), answer(JSON.stringify(GOOD)));
    expect(await generate(request)).toMatchObject({ ok: true, model: "gemini-3.8-flash" });
  });

  it("reports a timeout when the fallback is too slow as well", async () => {
    fakeGemini(aborted(), aborted(), aborted());
    expect(await generate(extraction)).toMatchObject({ ok: false, error: "timeout", model: "gemini-3.8-flash" });
    expect(calls).toHaveLength(3);
  });

  it("reports a network failure as unavailable, after trying the fallback (connections aren't retried)", async () => {
    fakeGemini(new TypeError("fetch failed"), new TypeError("fetch failed"));
    expect(await generate({ ...request, feature: "CLAIM_CHECK" })).toMatchObject({ ok: false, error: "unavailable", model: "gemini-3.6-flash" });
    expect(calls).toHaveLength(2);
    // The Claim Checker's fallback thinks at a low level.
    expect(calls[1].body.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: "LOW" } });
  });

  it("never calls out without a key", async () => {
    delete process.env.GEMINI_API_KEY;
    fakeGemini();
    expect(await generate(request)).toEqual({ ok: false, error: "not_configured", model: "gemini-3.6-flash", usage: null });
    expect(calls).toHaveLength(0);
  });

  it("reports a finished answer with no text as unusable", async () => {
    fakeGemini(reply({ candidates: [{ content: { role: "model", parts: [] }, finishReason: "STOP" }] }));
    expect(await generate(request)).toMatchObject({ ok: false, error: "invalid_output" });
  });

  it("treats missing token counts as unknown", async () => {
    fakeGemini(reply({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(GOOD) }] }, finishReason: "STOP" }] }));
    expect(await generate(request)).toMatchObject({ ok: true, usage: { promptTokens: null, outputTokens: null, thinkingTokens: null } });
  });
});

describe("runAi (the gate every AI call goes through)", () => {
  const turnOn = (limit = 300) => prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: true, aiMonthlyLimit: limit } });
  const runs = (tenant: Tenant = A) =>
    withTenant(tenant, (tx) => tx.aiRun.findMany({ select: { userId: true, feature: true, model: true, status: true, error: true, promptTokens: true, outputTokens: true, thinkingTokens: true } }));
  // Past calls, written straight to the log, `ageDays` days ago.
  async function pastRuns(tenant: Tenant, count: number, feature: "DRAFT" | "CLAIM_CHECK" = "DRAFT", ageDays = 0) {
    const at = new Date((await dbNow()).getTime() - ageDays * 24 * 60 * 60 * 1000);
    await withTenant(tenant, (tx) =>
      tx.aiRun.createMany({
        data: Array.from({ length: count }, () => ({
          workspaceId: tenant.workspaceId,
          userId: tenant.userId,
          feature,
          model: "gemini-3.8-flash",
          status: "SUCCEEDED" as const,
          latencyMs: 1,
          createdAt: at,
        })),
      }),
    );
  }

  it("is off until an owner turns it on, and then logs each call", async () => {
    fakeGemini(answer(JSON.stringify(GOOD)));
    expect(await runAi(A, request)).toEqual({ ok: false, error: "AI is turned off for this workspace. An owner can turn it on in Settings." });
    expect(calls).toHaveLength(0);
    expect(await runs()).toEqual([]);

    await turnOn();
    expect(await runAi(A, request)).toEqual({ ok: true, data: GOOD, model: "gemini-3.6-flash" });
    expect(await runs()).toEqual([
      { userId: "ownerA", feature: "DRAFT", model: "gemini-3.6-flash", status: "SUCCEEDED", error: null, promptTokens: 120, outputTokens: 40, thinkingTokens: 15 },
    ]);
  });

  it("a call a fallback answered is SUCCEEDED, with a note of the model that failed first", async () => {
    await turnOn();
    fakeGemini(apiError(503, "This model is currently experiencing high demand.", "UNAVAILABLE"), answer(JSON.stringify(GOOD)));
    expect(await runAi(A, request)).toEqual({ ok: true, data: GOOD, model: "gemini-3.8-flash" });
    const [run] = await runs();
    expect(run).toMatchObject({ feature: "DRAFT", model: "gemini-3.8-flash", status: "SUCCEEDED" });
    expect(run.error).toMatch(/^fallback after gemini-3\.6-flash unavailable \d+ms$/);
    // It still counts as one of this person's drafts.
    expect(await draftsToday(A)).toBe(1);
  });

  it("logs a failed call with a short code and shows a plain message", async () => {
    await turnOn();
    // Every drafting model is out of quota.
    fakeGemini(...[1, 2, 3].map(() => apiError(429, "Resource exhausted", "RESOURCE_EXHAUSTED")));
    expect(await runAi(A, request)).toEqual({ ok: false, error: AI_ERROR_MESSAGES.rate_limited });
    expect(await runs()).toMatchObject([{ status: "FAILED", error: "rate_limited", promptTokens: null }]);
  });

  it("refuses without a key, before anything else", async () => {
    await turnOn();
    delete process.env.GEMINI_API_KEY;
    expect(await runAi(A, request)).toEqual({ ok: false, error: AI_ERROR_MESSAGES.not_configured });
    expect(await runs()).toEqual([]);
  });

  it("stops at the workspace's limit for the last 30 days, ignoring older calls", async () => {
    await turnOn(3);
    await pastRuns(A, 2, "CLAIM_CHECK");
    await pastRuns(A, 5, "CLAIM_CHECK", 31);
    fakeGemini(answer(JSON.stringify(GOOD)));
    expect((await runAi(A, request)).ok).toBe(true);
    expect(await runAi(A, request)).toEqual({
      ok: false,
      error: "This workspace has used its 3 AI calls for the last 30 days. An owner can raise the limit in Settings.",
    });
    expect(await aiUsage(A)).toEqual({ enabled: true, limit: 3, used: 3 });
  });

  it("a limit of 0 pauses AI without switching it off", async () => {
    await turnOn(0);
    fakeGemini();
    expect((await runAi(A, request)).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it(`stops one person at ${DAILY_DRAFTS_PER_PERSON} drafts a day, but not other people or other features`, async () => {
    await turnOn(5000);
    await pastRuns(OFFICER_A, DAILY_DRAFTS_PER_PERSON);
    await pastRuns(OFFICER_A, 3, "DRAFT", 2);
    fakeGemini(answer(JSON.stringify(GOOD)), answer(JSON.stringify(GOOD)));
    expect(await runAi(OFFICER_A, request)).toEqual({
      ok: false,
      error: `You've made ${DAILY_DRAFTS_PER_PERSON} drafts in the last 24 hours. Try again tomorrow.`,
    });
    expect((await runAi(OFFICER_A, { ...request, feature: "CLAIM_CHECK" })).ok).toBe(true);
    expect((await runAi(A, request)).ok).toBe(true);
  });

  it("counts only this workspace's calls", async () => {
    await turnOn(1);
    await prisma.workspace.update({ where: { id: "b" }, data: { aiEnabled: true } });
    await pastRuns(B, 10);
    fakeGemini(answer(JSON.stringify(GOOD)));
    expect((await runAi(A, request)).ok).toBe(true);
    expect((await aiUsage(B)).used).toBe(10);
    expect(await runs(B)).toHaveLength(10);
  });
});

describe("Settings: the AI switch and limit", () => {
  const save = (user: string, fields: Record<string, string>) =>
    asUser(user, () => updateAiSettings(null, form({ workspaceId: "a", limit: "300", ...fields })));
  const settings = () => prisma.workspace.findUniqueOrThrow({ where: { id: "a" }, select: { aiEnabled: true, aiMonthlyLimit: true } });

  it("starts off, with a limit of 300", async () => {
    expect(await settings()).toEqual({ aiEnabled: false, aiMonthlyLimit: 300 });
  });

  it("lets an owner turn AI on, set the limit, and turn it off again", async () => {
    expect(await save("ownerA", { enabled: "on", limit: "50" })).toEqual({ ok: true, data: undefined });
    expect(await settings()).toEqual({ aiEnabled: true, aiMonthlyLimit: 50 });
    expect(await save("ownerA", { limit: "50" })).toEqual({ ok: true, data: undefined });
    expect((await settings()).aiEnabled).toBe(false);
  });

  it("refuses an officer, another workspace, and a signed-out visitor", async () => {
    expect(await save("officerA", { enabled: "on" })).toEqual({ ok: false, error: "Only the workspace owner can do that." });
    expect(await save("ownerB", { enabled: "on" })).toEqual({ ok: false, error: expect.any(String) });
    await expect(signedOut(() => updateAiSettings(null, form({ workspaceId: "a", enabled: "on", limit: "1" })))).rejects.toEqual(
      redirectTo("/signin"),
    );
    expect(await settings()).toEqual({ aiEnabled: false, aiMonthlyLimit: 300 });
  });

  test.for([
    ["-1", "Use 0 to 5000."],
    ["5001", "Use 0 to 5000."],
    ["2.5", "Use a whole number."],
    ["lots", expect.any(String)],
  ] as const)("refuses a limit of %s", async ([limit, error]) => {
    expect(await save("ownerA", { enabled: "on", limit })).toEqual({ ok: false, error });
    expect(await settings()).toEqual({ aiEnabled: false, aiMonthlyLimit: 300 });
  });
});

describe("AI drafts and row-level security", () => {
  it("a draft can't point at another workspace's contact", async () => {
    await prisma.$transaction([]);
    await withTenant(B, (tx) => tx.company.create({ data: { id: "co-b", workspaceId: "b", name: "B Co", nameKey: "b co" } }));
    await withTenant(B, (tx) => tx.contact.create({ data: { id: "ct-b", workspaceId: "b", companyId: "co-b", name: "Pat" } }));
    await withTenant(A, (tx) => tx.company.create({ data: { id: "co-a", workspaceId: "a", name: "A Co", nameKey: "a co" } }));
    const draft = (contactId: string | null) =>
      withTenant(A, (tx) =>
        tx.aiDraft.create({
          data: { workspaceId: "a", companyId: "co-a", contactId, createdById: "ownerA", kind: "FIRST_TOUCH", angle: "direct", subject: "s", body: "b", model: "m" },
        }),
      );
    await expect(draft("ct-b")).rejects.toThrow(/row-level security/);
    await expect(draft(null)).resolves.toMatchObject({ contactId: null });
  });
});

describe("source guard", () => {
  it("only lib/ai/client.ts talks to Gemini", () => {
    const files = globSync("{app,lib,components}/**/*.{ts,tsx}").filter((f) => readFileSync(f, "utf8").includes("@google/genai"));
    expect(files).toEqual(["lib/ai/client.ts"]);
  });

  it("only lib/ai/client.ts talks to Groq", () => {
    const files = globSync("{app,lib,components}/**/*.{ts,tsx}").filter((f) => readFileSync(f, "utf8").includes("groq-sdk"));
    expect(files).toEqual(["lib/ai/client.ts"]);
  });
});

// ----- Malformed or unusable AI replies (recorded-style replies) -----

describe("generate: deadlines and replies that aren't refusals", () => {
  it("reports a 401 as a bad key, without trying another model", async () => {
    fakeGemini(apiError(401, "Request had invalid authentication credentials.", "UNAUTHENTICATED"));
    expect(await generate(request)).toMatchObject({ ok: false, error: "bad_key" });
    expect(calls).toHaveLength(1);
  });

  test.for(["RECITATION", "PROHIBITED_CONTENT", "SPII", "BLOCKLIST"])("a %s stop is a refusal (blocked), not retried", async (finish) => {
    fakeGemini(answer("", finish));
    expect(await generate(request)).toMatchObject({ ok: false, error: "blocked", model: "gemini-3.6-flash" });
    expect(calls).toHaveLength(1);
  });

  it("500 on the main model, then a good answer from the fallback, for fact extraction and the claim check", async () => {
    for (const [feature, fallback] of [
      ["FACT_EXTRACTION", "gemini-3.8-flash"],
      ["CLAIM_CHECK", "gemini-3.6-flash"],
    ] as const) {
      fakeGemini(apiError(500, "Internal", "INTERNAL"), answer(JSON.stringify(GOOD)));
      expect(await generate({ ...request, feature })).toMatchObject({ ok: true, model: fallback });
    }
  });

  it("gives Smart import's two Gemini steps a 30-second deadline overall", () => {
    for (const feature of ["IMPORT_MAPPING", "IMPORT_LOOKALIKES"] as const) {
      const route = ROUTES[feature];
      expect(route.provider === "groq" ? null : route.overallMs).toBe(30_000);
    }
  });

  // A model that never answers: the request waits until its signal is aborted.
  function hangingGemini() {
    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
            init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
          }),
      ),
    );
  }

  it("a call with its own short deadline and no fallback makes one try and stops on time", async () => {
    hangingGemini();
    const started = Date.now();
    expect(await generate({ ...request, feature: "CLAIM_CHECK", deadlineMs: 200, fallback: false })).toMatchObject({ ok: false, error: "timeout", model: "gemini-3.5-flash-lite" });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(calls).toHaveLength(1);
  });

  it("past the deadline, the next model in line isn't called", async () => {
    hangingGemini();
    expect(await generate({ ...request, feature: "CLAIM_CHECK", deadlineMs: 200 })).toMatchObject({ ok: false, error: "timeout" });
    expect(calls).toHaveLength(1);
  });
});

describe("schemas that repair a reply instead of throwing it away", () => {
  it("clamps text at a space near the limit", () => {
    expect(clampText("short", 10)).toBe("short");
    expect(clampText("a few plain words that run on", 16)).toBe("a few plain");
    expect(clampText("x".repeat(30), 10)).toBe("x".repeat(10));
  });

  it("keeps the items that pass on their own, up to the limit, and clamps a clamped field", () => {
    const schema = z.object({ list: keptItems(z.object({ n: z.number(), label: clamped(5), text: z.string().max(3) }), 2) });
    const parsed = schema.parse({
      list: [{ n: 1, label: "too long a label", text: "ok" }, { n: 2, label: "x", text: "far too long" }, { n: 3, label: "y", text: "ok" }, { n: 4, label: "z", text: "ok" }],
    });
    expect(parsed.list).toEqual([
      { n: 1, label: "too", text: "ok" },
      { n: 3, label: "y", text: "ok" },
    ]);
    // What the model is sent still names the limits (Gemini drops the ones it doesn't take).
    expect(JSON.stringify(z.toJSONSchema(schema, { io: "input" }))).toContain('"maxItems":2');
    expect(toGeminiSchema(schema)).toMatchObject({ properties: { list: { type: "array", maxItems: 2 } } });
    expect(droppedItems(parsed.list)).toBe(1);
  });

  it("refuses a list whose every item is broken, so a broken reply never reads as an empty answer", () => {
    const schema = z.object({ list: keptItems(z.object({ n: z.number() }), 5) });
    expect(schema.safeParse({ list: [{ n: "one" }, { m: 2 }] }).success).toBe(false);
    expect(schema.safeParse({ list: [null] }).success).toBe(false);
    // A list that is really empty is still an answer.
    const empty = schema.parse({ list: [] });
    expect(empty.list).toEqual([]);
    expect(droppedItems(empty.list)).toBe(0);
    expect(droppedItems(schema.parse({ list: [{ n: 1 }] }).list)).toBe(0);
  });
});

describe("runAi: reserving each call before it is made", () => {
  const turnOn = (limit = 300) => prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: true, aiMonthlyLimit: limit } });
  const runs = () => withTenant(A, (tx) => tx.aiRun.findMany({ select: { userId: true, feature: true, status: true, error: true }, orderBy: { createdAt: "asc" } }));
  async function pastRuns(tenant: Tenant, count: number, fields: { feature?: "DRAFT" | "CLAIM_CHECK"; status?: "SUCCEEDED" | "FAILED"; error?: string | null } = {}) {
    await withTenant(tenant, (tx) =>
      tx.aiRun.createMany({
        data: Array.from({ length: count }, () => ({
          workspaceId: tenant.workspaceId,
          userId: tenant.userId,
          feature: fields.feature ?? "DRAFT",
          model: "gemini-3.8-flash",
          status: fields.status ?? "SUCCEEDED",
          error: fields.error ?? null,
          latencyMs: 1,
        })),
      }),
    );
  }

  it("three people at the same moment with one call left: exactly one is let through, and the limit holds", async () => {
    await turnOn(5);
    await pastRuns(A, 4, { feature: "CLAIM_CHECK" });
    await prisma.membership.create({ data: { id: "m-ownerB-a", workspaceId: "a", userId: "ownerB", role: "member", createdAt: new Date() } });
    fakeGemini(answer(JSON.stringify(GOOD)), answer(JSON.stringify(GOOD)), answer(JSON.stringify(GOOD)));
    const people: Tenant[] = [A, OFFICER_A, { userId: "ownerB", workspaceId: "a" }];
    const results = await Promise.all(people.map((t) => runAi(t, request)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const r of results.filter((r) => !r.ok)) expect(r).toEqual({ ok: false, error: expect.stringContaining("has used its 5 AI calls") });
    expect(calls).toHaveLength(1);
    expect((await aiUsage(A)).used).toBe(5);
  });

  it("writes the call as RUNNING while the model is answering, then SUCCEEDED", async () => {
    await turnOn();
    let during: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        during = await runs();
        return answer(JSON.stringify(GOOD));
      }),
    );
    expect((await runAi(A, request)).ok).toBe(true);
    expect(during).toEqual([{ userId: "ownerA", feature: "DRAFT", status: "RUNNING", error: null }]);
    expect(await runs()).toEqual([{ userId: "ownerA", feature: "DRAFT", status: "SUCCEEDED", error: null }]);
  });

  it("a reservation that is released (the call won't be made) doesn't count", async () => {
    await turnOn(1);
    const reserved = await reserveAi(A, "DRAFT");
    if (!reserved.ok) throw new Error(reserved.error);
    expect((await reserveAi(OFFICER_A, "DRAFT")).ok).toBe(false);
    await releaseAi(A, reserved.data);
    expect(await runs()).toEqual([]);
    expect((await reserveAi(OFFICER_A, "DRAFT")).ok).toBe(true);
  });

  it("a reply the caller's own check refuses is logged FAILED with that code, with the caller's message", async () => {
    await turnOn();
    fakeGemini(answer(JSON.stringify(GOOD)));
    expect(await runAi(A, request, { accept: () => "broke_rules", messages: { broke_rules: "The drafts broke the rules." } })).toEqual({
      ok: false,
      error: "The drafts broke the rules.",
    });
    expect(await runs()).toEqual([{ userId: "ownerA", feature: "DRAFT", status: "FAILED", error: "broke_rules" }]);
  });

  it("says a blocked request plainly, with no advice about a note the feature doesn't have; a feature can add its own", async () => {
    await turnOn();
    fakeGemini(reply({ promptFeedback: { blockReason: "SAFETY" } }), reply({ promptFeedback: { blockReason: "SAFETY" } }));
    const plain = await runAi(A, { ...request, feature: "CLAIM_CHECK" });
    expect(plain).toEqual({ ok: false, error: AI_ERROR_MESSAGES.blocked });
    expect(AI_ERROR_MESSAGES.blocked).not.toMatch(/note/);
    expect(await runAi(A, request, { messages: { blocked: "Try rewording your note." } })).toEqual({ ok: false, error: "Try rewording your note." });
  });

  it("a person's daily drafts don't count the AI service's own failures, but do count unusable replies", async () => {
    await turnOn(5000);
    await pastRuns(OFFICER_A, DAILY_DRAFTS_PER_PERSON, { status: "FAILED", error: "rate_limited" });
    await pastRuns(OFFICER_A, 5, { status: "FAILED", error: "unavailable" });
    await pastRuns(OFFICER_A, DAILY_DRAFTS_PER_PERSON - 2, { status: "FAILED", error: "broke_rules" });
    expect(await draftsToday(OFFICER_A)).toBe(DAILY_DRAFTS_PER_PERSON - 2);
    fakeGemini(answer(JSON.stringify(GOOD)), answer(JSON.stringify(GOOD)));
    expect((await runAi(OFFICER_A, request)).ok).toBe(true);
    expect(await draftsToday(OFFICER_A)).toBe(DAILY_DRAFTS_PER_PERSON - 1);
    expect((await runAi(OFFICER_A, request)).ok).toBe(true);
    expect(await runAi(OFFICER_A, request)).toEqual({ ok: false, error: `You've made ${DAILY_DRAFTS_PER_PERSON} drafts in the last 24 hours. Try again tomorrow.` });
  });

  it("knows which failures are worth trying again", () => {
    for (const code of ["rate_limited", "timeout", "unavailable", "truncated", "invalid_output"] as const) expect(isRetryableAiError(AI_ERROR_MESSAGES[code])).toBe(true);
    for (const code of ["bad_key", "rejected", "not_configured", "blocked"] as const) expect(isRetryableAiError(AI_ERROR_MESSAGES[code])).toBe(false);
    expect(isRetryableAiError("This workspace has used its 300 AI calls for the last 30 days. An owner can raise the limit in Settings.")).toBe(false);
  });
});
