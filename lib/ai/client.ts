import { GoogleGenAI, ThinkingLevel, type GenerateContentResponse } from "@google/genai";
import type { z } from "zod";
import type { AiFeature } from "@/generated/prisma/enums";
import { toGeminiSchema } from "@/lib/ai/schema";

// The only file that talks to the Gemini API (a test enforces this). Everything else calls
// runAi() in lib/ai/run.ts, which checks the workspace's switch and limits first and logs the call.
//
// Free tier, so: prompts must never contain recruiter or member names (they may be used to improve
// Google's products); nothing here retries a rate limit; and every reply is re-checked with the
// same Zod schema the model was asked to follow, because the model is never trusted.

// Which model each feature uses: one place to change. Thinking is set by level only; the other
// sampling knobs (temperature, topP, candidateCount) are ignored by these models.
export const ROUTES: Record<AiFeature, { model: string; thinkingLevel?: ThinkingLevel }> = {
  FACT_EXTRACTION: { model: "gemini-3.8-flash", thinkingLevel: ThinkingLevel.MEDIUM },
  DRAFT: { model: "gemini-3.8-flash", thinkingLevel: ThinkingLevel.LOW },
  // Flash-Lite's default (minimal) thinking is right for a quick check.
  CLAIM_CHECK: { model: "gemini-3.5-flash-lite" },
};

export type AiErrorCode =
  | "not_configured"
  | "bad_key"
  | "rate_limited"
  | "timeout"
  | "blocked"
  | "truncated"
  | "invalid_output"
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
// Per attempt; the whole call (including one retry) is capped by OVERALL_TIMEOUT_MS.
const ATTEMPT_TIMEOUT_MS = 45_000;
const OVERALL_TIMEOUT_MS = 100_000;

export const isConfigured = () => Boolean(process.env.GEMINI_API_KEY);

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
  }
  return "unavailable";
}

export async function generate<S extends z.ZodType>(request: GenerateRequest<S>): Promise<GenerateResult<z.output<S>>> {
  const route = ROUTES[request.feature];
  const model = route.model;
  // Without a key the SDK would quietly try Google Cloud credentials and fail seconds later.
  if (!isConfigured()) return { ok: false, error: "not_configured", model, usage: null };

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    // One retry for server errors only; a rate limit is reported, not retried.
    httpOptions: { timeout: ATTEMPT_TIMEOUT_MS, retryOptions: { attempts: 2, httpStatusCodes: [500, 503, 504] } },
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
        ...(route.thinkingLevel ? { thinkingConfig: { thinkingLevel: route.thinkingLevel } } : {}),
        abortSignal: AbortSignal.timeout(OVERALL_TIMEOUT_MS),
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
