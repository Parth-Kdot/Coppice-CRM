import { globSync, readFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import { z } from "zod";
import { updateAiSettings } from "@/app/(app)/[workspaceId]/settings/actions";
import { generate, ROUTES } from "@/lib/ai/client";
import { AI_ERROR_MESSAGES, aiUsage, DAILY_DRAFTS_PER_PERSON, runAi } from "@/lib/ai/run";
import { toGeminiSchema } from "@/lib/ai/schema";
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
      model: "gemini-3.8-flash",
      usage: { promptTokens: 120, outputTokens: 40, thinkingTokens: 15 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("models/gemini-3.8-flash:generateContent");
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

  it("routes each feature to its model, each with a fallback, and drafting with a last resort", async () => {
    const models = Object.fromEntries(Object.entries(ROUTES).map(([f, r]) => [f, [r.model, r.fallback.model, r.lastResort?.model]]));
    expect(models).toEqual({
      FACT_EXTRACTION: ["gemini-3.8-flash", "gemini-3.6-flash", undefined],
      DRAFT: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"],
      CLAIM_CHECK: ["gemini-3.5-flash-lite", "gemini-3.6-flash", undefined],
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
    ["no answer at all", reply({ candidates: [] }), "blocked"],
  ] as const)("reports %s as %s", async ([, response, error]) => {
    fakeGemini(response);
    expect(await generate(request)).toMatchObject({ ok: false, error, model: "gemini-3.8-flash" });
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
    expect(await generate(request)).toMatchObject({ ok: true, data: GOOD, model: "gemini-3.6-flash" });
    expect(calls.map((c) => c.url.match(/models\/([^:]+)/)?.[1])).toEqual(["gemini-3.8-flash", "gemini-3.6-flash"]);
    // The fallback gets the same request, thinking level included.
    expect(calls[1].body.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: "LOW" } });
  });

  // Fact extraction has no last resort, so its fallback is the last in line and gets the retry.
  const extraction = { ...request, feature: "FACT_EXTRACTION" as const };
  const modelsCalled = () => calls.map((c) => c.url.match(/models\/([^:]+)/)?.[1]);

  it("retries the last model in line once, then gives up", async () => {
    fakeGemini(busy(), busy(), busy());
    expect(await generate(extraction)).toMatchObject({ ok: false, error: "unavailable", model: "gemini-3.6-flash" });
    expect(calls).toHaveLength(3);
  });

  it("moves to the next model on a rate limit, since free-tier quotas are per model", async () => {
    fakeGemini(limited(), answer(JSON.stringify(GOOD)));
    expect(await generate(request)).toMatchObject({ ok: true, model: "gemini-3.6-flash" });
  });

  it("drafts with Flash-Lite when both Flash models fail, thinking at a low level", async () => {
    fakeGemini(busy(), limited(), answer(JSON.stringify(GOOD)));
    expect(await generate(request)).toMatchObject({ ok: true, data: GOOD, model: "gemini-3.5-flash-lite" });
    expect(modelsCalled()).toEqual(["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"]);
    expect(calls[2].body.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: "LOW" } });
  });

  it("tries drafting's first two models once each and retries Flash-Lite once", async () => {
    const internal = () => apiError(500, "Internal", "INTERNAL");
    fakeGemini(internal(), internal(), internal(), answer(JSON.stringify(GOOD)));
    expect(await generate(request)).toMatchObject({ ok: true, model: "gemini-3.5-flash-lite" });
    expect(modelsCalled()).toEqual(["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.5-flash-lite"]);
  });

  // A slow attempt is cut off (AbortError); a slow main model goes to the fallback.
  const aborted = () => new DOMException("The operation was aborted.", "AbortError");

  it("falls back when the main model is too slow", async () => {
    fakeGemini(aborted(), answer(JSON.stringify(GOOD)));
    expect(await generate(request)).toMatchObject({ ok: true, model: "gemini-3.6-flash" });
  });

  it("reports a timeout when the fallback is too slow as well", async () => {
    fakeGemini(aborted(), aborted(), aborted());
    expect(await generate(extraction)).toMatchObject({ ok: false, error: "timeout", model: "gemini-3.6-flash" });
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
    expect(await generate(request)).toEqual({ ok: false, error: "not_configured", model: "gemini-3.8-flash", usage: null });
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
    expect(await runAi(A, request)).toEqual({ ok: true, data: GOOD, model: "gemini-3.8-flash" });
    expect(await runs()).toEqual([
      { userId: "ownerA", feature: "DRAFT", model: "gemini-3.8-flash", status: "SUCCEEDED", error: null, promptTokens: 120, outputTokens: 40, thinkingTokens: 15 },
    ]);
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
});
