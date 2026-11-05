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
// can hold names: it goes to Groq instead (owner decision), never to Gemini.

// Which model each feature uses: one place to change. Thinking is set by level only; the other
// sampling knobs (temperature, topP, candidateCount) are ignored by these models.
//
// Free-tier capacity swings minute to minute (we've seen a model hang 45 s while another answered in
// 6 s), and each model has its own quota (on 2026-10-26 3.6 Flash was out while 3.5 Flash-Lite
// answered every call). So each feature gets one short try on its main model (`firstTryMs`), then
// moves to a `fallback` model when the main one is overloaded, slow or out of quota, and drafting
// has a `lastResort` after that. The last model in line gets one retry; everything shares the
// overall deadline. AiRun records whichever model actually answered.
type Model = { model: string; thinkingLevel?: ThinkingLevel };
type GeminiRoute = Model & { provider?: "gemini"; firstTryMs: number; fallback: Model; lastResort?: Model };
// Groq (Smart import's row pass, which reads cells that can hold names): one model, one try. Its
// free tier allows about 30 requests and 8,000 tokens a minute, so a 429 is reported to the person
// to wait and continue; it is never retried, and there is no fallback model.
type GroqRoute = { provider: "groq"; model: string; reasoningEffort: "low" | "medium" | "high"; timeoutMs: number };
export type Route = GeminiRoute | GroqRoute;
export type Provider = "gemini" | "groq";
export const ROUTES: Record<AiFeature, Route> = {
  // Long input and more thinking, so a longer first try.
  FACT_EXTRACTION: {
    model: "gemini-3.8-flash",
    thinkingLevel: ThinkingLevel.MEDIUM,
    firstTryMs: 50_000,
    fallback: { model: "gemini-3.6-flash", thinkingLevel: ThinkingLevel.MEDIUM },
  },
  // The officer is waiting with nothing else to do, so drafting tries a third model before giving
  // up. Flash-Lite's drafts pass the same rules and Claim Checker as any other.
  DRAFT: {
    model: "gemini-3.8-flash",
    thinkingLevel: ThinkingLevel.LOW,
    firstTryMs: 20_000,
    fallback: { model: "gemini-3.6-flash", thinkingLevel: ThinkingLevel.LOW },
    // At its default (minimal) thinking it sometimes skipped the placeholders and line breaks;
    // LOW followed them, at the same speed (tested 2026-10-26).
    lastResort: { model: "gemini-3.5-flash-lite", thinkingLevel: ThinkingLevel.LOW },
  },
  // Flash-Lite's default (minimal) thinking is right for a quick check.
  CLAIM_CHECK: {
    model: "gemini-3.5-flash-lite",
    firstTryMs: 15_000,
    fallback: { model: "gemini-3.6-flash", thinkingLevel: ThinkingLevel.LOW },
  },
  // Smart import: which column is which, from headers and a few masked sample rows.
  IMPORT_MAPPING: {
    model: "gemini-3.5-flash-lite",
    firstTryMs: 20_000,
    fallback: { model: "gemini-3.6-flash", thinkingLevel: ThinkingLevel.LOW },
  },
  // Smart import: which company names in a sheet look like each other or like existing companies.
  IMPORT_LOOKALIKES: {
    model: "gemini-3.5-flash-lite",
    firstTryMs: 20_000,
    fallback: { model: "gemini-3.6-flash", thinkingLevel: ThinkingLevel.LOW },
  },
  // Smart import: free-text cells, which can contain names, so Groq (owner decision). Low reasoning
  // keeps a chunk of rows well inside the free tier's tokens per minute.
  IMPORT_ROWS: { provider: "groq", model: "openai/gpt-oss-120b", reasoningEffort: "low", timeoutMs: 45_000 },
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

export type GenerateResult<T> =
  | { ok: true; data: T; model: string; usage: Usage }
  | { ok: false; error: AiErrorCode; model: string; usage: Usage | null };

export type GenerateRequest<S extends z.ZodType> = {
  feature: AiFeature;
  // Instructions: who the model is and the rules it must follow.
  system: string;
  // The task, with any data wrapped and labelled as data (never as instructions).
  prompt: string;
  schema: S;
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
  const signal = AbortSignal.timeout(OVERALL_TIMEOUT_MS);
  const line: [Model, { attempts: number; timeoutMs: number }][] = [
    [route, { attempts: 1, timeoutMs: route.firstTryMs }],
    [route.fallback, { attempts: route.lastResort ? 1 : 2, timeoutMs: ATTEMPT_TIMEOUT_MS }],
  ];
  if (route.lastResort) line.push([route.lastResort, { attempts: 2, timeoutMs: ATTEMPT_TIMEOUT_MS }]);

  let result!: GenerateResult<z.output<S>>;
  for (const [model, tries] of line) {
    result = await callModel(model, tries, request, signal);
    // Only a busy, slow or out-of-quota model is worth moving away from; a bad key, a refused
    // request or a blocked prompt would fail the same way on the next model.
    if (result.ok || !MOVE_ON.includes(result.error)) return result;
  }
  return result;
}

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
  if (finish !== "STOP") return { ok: false, error: "blocked", model, usage };

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
      max_completion_tokens: MAX_OUTPUT_TOKENS,
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
  if (choice?.finish_reason !== "stop") return { ok: false, error: "blocked", model, usage };

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
