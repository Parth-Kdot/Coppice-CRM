import { GoogleGenAI, ThinkingLevel, type GenerateContentResponse } from "@google/genai";
import Groq from "groq-sdk";
import type { z } from "zod";
import type { AiFeature } from "@/generated/prisma/enums";
import { toGeminiSchema, toGroqSchema } from "@/lib/ai/schema";

// The only file that talks to the Gemini and Groq APIs (a test enforces this). Everything else calls
// runAi() in lib/ai/run.ts, which checks the workspace's switch and limits first and logs the call.
//
// Free tier, so: prompts must never contain recruiter or member names (they may be used to improve
// Google's products); no model is retried after a rate limit; and every reply is re-checked with the
// same Zod schema the model was asked to follow, because the model is never trusted.
// The one exception to the names rule is Smart import's row pass, which reads free-text cells that
// can hold names: it goes to Groq instead (owner decision), never to Gemini. Smart import's column
// suggestions send Gemini each header as text only when it is plain spreadsheet words ("Last
// contacted"), otherwise its shape ("[header: 2 words]"); the company names and industries from the
// columns headed plainly as such ("Company", "Industry"), unless a cell reads as a note; and only
// the shape of every other cell (lib/smart-import/columns.ts).
// Research briefs (owner decision, recorded here): the reading call gets the text of public pages an
// owner approved, which can name people (a page's "Jane Doe leads campus outreach"); emails and
// phone numbers are masked. Code then drops every passage and item that names a person or holds a
// masked contact detail (lib/research/checks.ts namesPerson), so no name reaches the writing call
// or the brief. Smart import's look-alike call gets company names cleaned the same way as the
// column step: a cell that reads as a note is cut to the name before it, or left out.

// Which model each feature uses: one place to change. Thinking is set by level only; the other
// sampling knobs (temperature, topP, candidateCount) are ignored by these models.
//
// Free-tier capacity swings minute to minute (we've seen a model hang 45 s while another answered in
// 6 s), and each model has its own quota (on 2026-10-26 3.6 Flash was out while 3.5 Flash-Lite
// answered every call). So each feature gets one short try on its main model (`firstTryMs`), then
// moves to a `fallback` model when the main one is overloaded, slow or out of quota, and drafting
// has a `lastResort` after that. An overloaded model's 503 ("high demand") is never retried on the
// same model while another is left in line: the call moves on as soon as it arrives, without
// waiting out the try's timer. The last model in line gets one retry; everything shares the
// overall deadline. AiRun records whichever model actually answered, and when it wasn't the first,
// which model failed before it, how, and after how long (lib/ai/run.ts).
//
// On 2026-11-07 Gemini 3.8 Flash answered nothing on the owner's free key (503 "high demand" in
// 3 s, or a hang through the proxy) while 3.6 Flash answered in about 1 s and 3.5 Flash-Lite in
// 0.7 s, so every drafting, extraction and research-reading call waited out 3.8's first try. 3.6
// Flash, with the thinking levels it was proven at, now goes first, and 3.8 is the fallback.
// `tryMs` caps one try on a model that isn't first or last in line, so a hanging middle model
// can't eat the drafting call's deadline.
type Model = { model: string; thinkingLevel?: ThinkingLevel; tryMs?: number };
// `overallMs` shortens the whole call's deadline for a feature that is only a convenience (Smart
// import's column suggestions and look-alikes): the person shouldn't wait the full 100 s for it.
type GeminiRoute = Model & { provider?: "gemini"; firstTryMs: number; fallback: Model; lastResort?: Model; overallMs?: number };
// Groq (Smart import's row pass, which reads cells that can hold names): one model, one try. Its
// free tier allows about 30 requests and 8,000 tokens a minute, so a 429 is reported to the person
// to wait and continue; it is never retried, and there is no fallback model.
// `maxTokens` caps the reply, which also caps how much one call can count toward the minute's
// token quota.
type GroqRoute = { provider: "groq"; model: string; reasoningEffort: "low" | "medium" | "high"; timeoutMs: number; maxTokens: number };
export type Route = GeminiRoute | GroqRoute;
export type Provider = "gemini" | "groq";
export const ROUTES: Record<AiFeature, Route> = {
  // Long input and more thinking, so a longer first try (3.6 Flash read the 2-page live packet in
  // 23.5 s at MEDIUM).
  FACT_EXTRACTION: {
    model: "gemini-3.6-flash",
    thinkingLevel: ThinkingLevel.MEDIUM,
    firstTryMs: 50_000,
    fallback: { model: "gemini-3.8-flash", thinkingLevel: ThinkingLevel.MEDIUM },
  },
  // The officer is waiting with nothing else to do, so drafting tries a third model before giving
  // up. Flash-Lite's drafts pass the same rules and Claim Checker as any other.
  DRAFT: {
    model: "gemini-3.6-flash",
    thinkingLevel: ThinkingLevel.LOW,
    firstTryMs: 20_000,
    fallback: { model: "gemini-3.8-flash", thinkingLevel: ThinkingLevel.LOW, tryMs: 15_000 },
    // At its default (minimal) thinking it sometimes skipped the placeholders and line breaks;
    // LOW followed them, at the same speed (tested 2026-10-26). It must stay at LOW.
    lastResort: { model: "gemini-3.5-flash-lite", thinkingLevel: ThinkingLevel.LOW },
  },
  // Flash-Lite's default (minimal) thinking is right for a quick check.
  CLAIM_CHECK: {
    model: "gemini-3.5-flash-lite",
    firstTryMs: 15_000,
    fallback: { model: "gemini-3.6-flash", thinkingLevel: ThinkingLevel.LOW },
  },
  // Smart import: which column is which, from the headers and a few sample rows (mostly cell shapes).
  IMPORT_MAPPING: {
    model: "gemini-3.5-flash-lite",
    firstTryMs: 15_000,
    fallback: { model: "gemini-3.6-flash", thinkingLevel: ThinkingLevel.LOW },
    overallMs: 30_000,
  },
  // Smart import: which company names in a sheet look like each other or like existing companies.
  IMPORT_LOOKALIKES: {
    model: "gemini-3.5-flash-lite",
    firstTryMs: 15_000,
    fallback: { model: "gemini-3.6-flash", thinkingLevel: ThinkingLevel.LOW },
    overallMs: 30_000,
  },
  // Smart import: free-text cells, which can contain names, so Groq (owner decision). Low reasoning
  // keeps a chunk of rows well inside the free tier's tokens per minute. A 15-row answer is about
  // 1,500 tokens, so 3,000 leaves room without letting one call take most of a minute's quota.
  IMPORT_ROWS: { provider: "groq", model: "openai/gpt-oss-120b", reasoningEffort: "low", timeoutMs: 45_000, maxTokens: 3000 },
  // Research briefs (lib/research/brief.ts): reading up to six fetched pages is long input, like
  // fact extraction (3.6 Flash took 38 s live at MEDIUM); writing the brief from the passages read
  // is short, so Flash-Lite goes first.
  RESEARCH_READ: {
    model: "gemini-3.6-flash",
    thinkingLevel: ThinkingLevel.MEDIUM,
    firstTryMs: 50_000,
    fallback: { model: "gemini-3.8-flash", thinkingLevel: ThinkingLevel.MEDIUM },
  },
  RESEARCH_BRIEF: {
    model: "gemini-3.5-flash-lite",
    thinkingLevel: ThinkingLevel.LOW,
    firstTryMs: 20_000,
    fallback: { model: "gemini-3.6-flash", thinkingLevel: ThinkingLevel.LOW },
  },
  // Ask Coppice (lib/copilot): one short call per question that turns it into an intent. The
  // question and the names of companies just shown can hold names, so Groq (never Gemini), the same
  // model Smart import's row pass proved live with strict json_schema. The reply is small JSON, so
  // 700 tokens leave room for low reasoning without letting one call take a minute's free quota.
  COPILOT: { provider: "groq", model: "openai/gpt-oss-120b", reasoningEffort: "low", timeoutMs: 30_000, maxTokens: 700 },
};

export const providerOf = (feature: AiFeature): Provider => ROUTES[feature].provider ?? "gemini";

export type AiErrorCode =
  | "not_configured"
  | "bad_key"
  | "rate_limited"
  | "timeout"
  | "blocked"
  | "truncated"
  | "invalid_output"
  | "rejected"
  | "unavailable";

export type Usage = { promptTokens: number | null; outputTokens: number | null; thinkingTokens: number | null };

// A model that failed before the one that answered (or before the last one tried), for AiRun.
export type FailedTry = { model: string; error: AiErrorCode; ms: number };

export type GenerateResult<T> =
  | { ok: true; data: T; model: string; usage: Usage; fellBack?: FailedTry[] }
  | { ok: false; error: AiErrorCode; model: string; usage: Usage | null; fellBack?: FailedTry[] };

export type GenerateRequest<S extends z.ZodType> = {
  feature: AiFeature;
  // Instructions: who the model is and the rules it must follow.
  system: string;
  // The task, with any data wrapped and labelled as data (never as instructions).
  prompt: string;
  schema: S;
  // A shorter deadline for this one call, in ms: the claim check that follows a Draft click gets
  // one quick try on its main model, since the drafts are already saved and "Check with AI" is
  // there if it doesn't answer in time.
  deadlineMs?: number;
  // false: no fallback model, only the main one (with the deadline above).
  fallback?: false;
};

// Thinking tokens count against this, so it's generous; replies are short JSON.
const MAX_OUTPUT_TOKENS = 8192;
// Per attempt after the first try; the whole call is capped by OVERALL_TIMEOUT_MS.
const ATTEMPT_TIMEOUT_MS = 45_000;
const OVERALL_TIMEOUT_MS = 100_000;

// Without an argument, whether Gemini (the main AI provider) has a key.
export const isConfigured = (provider: Provider = "gemini") => Boolean(provider === "groq" ? process.env.GROQ_API_KEY : process.env.GEMINI_API_KEY);

const usageOf = (response: GenerateContentResponse): Usage => ({
  promptTokens: response.usageMetadata?.promptTokenCount ?? null,
  outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
  thinkingTokens: response.usageMetadata?.thoughtsTokenCount ?? null,
});

// What went wrong with a thrown error, in our own words. Timeouts surface as AbortError; HTTP
// errors as the SDK's ApiError with a numeric status (checked by name so tests needn't build one).
function errorCode(error: unknown): AiErrorCode {
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  const status = (error as { status?: unknown }).status;
  if (error instanceof Error && error.name === "ApiError" && typeof status === "number") {
    if (status === 429) return "rate_limited";
    if (status === 401 || status === 403 || (status === 400 && /API_KEY_INVALID|API key not valid/i.test(error.message))) return "bad_key";
    // Any other 4xx: the request itself was refused, so neither a retry nor the fallback helps.
    if (status >= 400 && status < 500) return "rejected";
  }
  return "unavailable";
}

export async function generate<S extends z.ZodType>(request: GenerateRequest<S>): Promise<GenerateResult<z.output<S>>> {
  const route = ROUTES[request.feature];
  if (route.provider === "groq") return callGroq(route, request);
  // Without a key the SDK would quietly try Google Cloud credentials and fail seconds later.
  if (!isConfigured()) return { ok: false, error: "not_configured", model: route.model, usage: null };

  // One deadline for the whole call, every model included. Only the last model in line is retried.
  const overall = Math.min(OVERALL_TIMEOUT_MS, route.overallMs ?? OVERALL_TIMEOUT_MS, request.deadlineMs ?? OVERALL_TIMEOUT_MS);
  const signal = AbortSignal.timeout(overall);
  // With no fallback, the one model gets the whole deadline.
  const firstTry = request.fallback === false ? overall : Math.min(route.firstTryMs, overall);
  const line: [Model, { attempts: number; timeoutMs: number }][] = [[route, { attempts: 1, timeoutMs: firstTry }]];
  if (request.fallback !== false) {
    line.push([route.fallback, { attempts: route.lastResort ? 1 : 2, timeoutMs: ATTEMPT_TIMEOUT_MS }]);
    if (route.lastResort) line.push([route.lastResort, { attempts: 2, timeoutMs: ATTEMPT_TIMEOUT_MS }]);
  }

  // A model in the middle of the line gets its own shorter try, if it has one.
  if (line.length === 3 && line[1][0].tryMs) line[1][1].timeoutMs = Math.min(line[1][0].tryMs, ATTEMPT_TIMEOUT_MS);

  const failed: FailedTry[] = [];
  const noted = (r: GenerateResult<z.output<S>>): GenerateResult<z.output<S>> => (failed.length ? { ...r, fellBack: failed } : r);
  let result!: GenerateResult<z.output<S>>;
  for (const [i, [model, tries]] of line.entries()) {
    // Past the deadline, the next model would only time out at once.
    if (signal.aborted) return noted({ ok: false, error: "timeout", model: model.model, usage: null });
    const started = performance.now();
    result = await callModel(model, tries, request, signal);
    // Only a busy, slow or out-of-quota model is worth moving away from; a bad key, a refused
    // request or a blocked prompt would fail the same way on the next model.
    if (result.ok || !MOVE_ON.includes(result.error)) return noted(result);
    if (i < line.length - 1) {
      const tried = { model: model.model, error: result.error, ms: Math.round(performance.now() - started) };
      failed.push(tried);
      // In the server log as well, for calls that end FAILED too (their AiRun row keeps only the
      // code). The feature, model, code and time only: never the prompt, the reply or the key.
      console.warn(`[ai] ${request.feature}: ${tried.model} ${tried.error} after ${tried.ms} ms, moving to ${line[i + 1][0].model}`);
    }
  }
  return noted(result);
}

// Why a reply that didn't finish normally is no use. Only a safety or policy stop is a refusal;
// no candidate at all, or an "OTHER" stop, is the service failing, which another model may not.
const REFUSALS = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "LANGUAGE"]);
export const finishError = (finish: string | undefined): AiErrorCode => (finish && REFUSALS.has(finish) ? "blocked" : "unavailable");

// Free-tier quotas are per model, so a rate limit sends the call on too.
const MOVE_ON: AiErrorCode[] = ["unavailable", "timeout", "rate_limited"];

// One model, a number of tries (a second try only for server errors and timeouts; a rate limit is
// never retried on the same model), and the reply checked against the request's schema.
async function callModel<S extends z.ZodType>(
  { model, thinkingLevel }: Model,
  { attempts, timeoutMs }: { attempts: number; timeoutMs: number },
  request: GenerateRequest<S>,
  signal: AbortSignal,
): Promise<GenerateResult<z.output<S>>> {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { timeout: timeoutMs, retryOptions: { attempts, httpStatusCodes: [500, 503, 504] } },
  });

  let response: GenerateContentResponse;
  try {
    response = await ai.models.generateContent({
      model,
      contents: request.prompt,
      config: {
        systemInstruction: request.system,
        responseMimeType: "application/json",
        responseJsonSchema: toGeminiSchema(request.schema),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
        abortSignal: signal,
      },
    });
  } catch (error) {
    return { ok: false, error: errorCode(error), model, usage: null };
  }

  const usage = usageOf(response);
  // A blocked prompt or reply is returned, not thrown.
  const finish = response.candidates?.[0]?.finishReason;
  if (response.promptFeedback?.blockReason) return { ok: false, error: "blocked", model, usage };
  if (finish === "MAX_TOKENS") return { ok: false, error: "truncated", model, usage };
  if (finish !== "STOP") return { ok: false, error: finishError(finish), model, usage };

  let json: unknown;
  try {
    json = JSON.parse(response.text ?? "");
  } catch {
    return { ok: false, error: "invalid_output", model, usage };
  }
  const parsed = request.schema.safeParse(json);
  if (!parsed.success) return { ok: false, error: "invalid_output", model, usage };
  return { ok: true, data: parsed.data, model, usage };
}

// ----- Groq -----

// What went wrong with a thrown Groq SDK error. The SDK's errors carry a numeric status; a reply
// that broke the JSON schema comes back as a 400 with code json_validate_failed.
function groqErrorCode(error: unknown): AiErrorCode {
  if (error instanceof Groq.APIConnectionTimeoutError || (error instanceof Error && error.name === "AbortError")) return "timeout";
  if (error instanceof Groq.APIUserAbortError) return "timeout";
  if (error instanceof Groq.APIError && typeof error.status === "number") {
    if (error.status === 429) return "rate_limited";
    if (error.status === 401 || error.status === 403) return "bad_key";
    if (error.status === 400 && /json_validate_failed/i.test(JSON.stringify(error.error ?? "") + error.message)) return "invalid_output";
    if (error.status >= 400 && error.status < 500) return "rejected";
  }
  return "unavailable";
}

// One try on one model (the SDK's own retries are off, so a 429 is never retried), structured
// output against the request's schema, and the reply checked again with Zod.
async function callGroq<S extends z.ZodType>(route: GroqRoute, request: GenerateRequest<S>): Promise<GenerateResult<z.output<S>>> {
  const model = route.model;
  if (!isConfigured("groq")) return { ok: false, error: "not_configured", model, usage: null };
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0, timeout: route.timeoutMs });

  let completion: Groq.Chat.ChatCompletion;
  try {
    completion = await groq.chat.completions.create({
      model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.prompt },
      ],
      response_format: { type: "json_schema", json_schema: { name: "result", schema: toGroqSchema(request.schema), strict: true } },
      reasoning_effort: route.reasoningEffort,
      include_reasoning: false,
      max_completion_tokens: route.maxTokens,
    });
  } catch (error) {
    return { ok: false, error: groqErrorCode(error), model, usage: null };
  }

  const details = completion.usage as { completion_tokens_details?: { reasoning_tokens?: number } } | undefined;
  const usage: Usage = {
    promptTokens: completion.usage?.prompt_tokens ?? null,
    outputTokens: completion.usage?.completion_tokens ?? null,
    thinkingTokens: details?.completion_tokens_details?.reasoning_tokens ?? null,
  };
  const choice = completion.choices?.[0];
  if (choice?.finish_reason === "length") return { ok: false, error: "truncated", model, usage };
  // Groq's types leave it out, but its API sends "content_filter" when a reply was filtered.
  if ((choice?.finish_reason as string | undefined) === "content_filter") return { ok: false, error: "blocked", model, usage };
  // No choice, or a stop for any other reason (a tool call it wasn't offered): the service failed.
  if (choice?.finish_reason !== "stop") return { ok: false, error: "unavailable", model, usage };

  let json: unknown;
  try {
    json = JSON.parse(choice.message.content ?? "");
  } catch {
    return { ok: false, error: "invalid_output", model, usage };
  }
  const parsed = request.schema.safeParse(json);
  if (!parsed.success) return { ok: false, error: "invalid_output", model, usage };
  return { ok: true, data: parsed.data, model, usage };
}
