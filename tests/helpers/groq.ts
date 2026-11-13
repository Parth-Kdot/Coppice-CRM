import { reply } from "./gemini";

// Recorded-style Groq replies for tests. They go through the same fake fetch as Gemini's
// (fakeGemini in tests/helpers/gemini.ts queues replies for both, in call order), so the real
// groq-sdk builds the request and parses the response, with no network.

// A chat completion the way Groq's OpenAI-compatible API sends it.
export const groqAnswer = (content: unknown, finishReason = "stop") =>
  reply({
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1_790_000_000,
    model: "openai/gpt-oss-120b",
    choices: [{ index: 0, message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason: finishReason }],
    usage: { prompt_tokens: 900, completion_tokens: 300, total_tokens: 1200, completion_tokens_details: { reasoning_tokens: 120 } },
  });

// An error the way Groq sends one. A 429 carries retry-after, which the app must not act on by
// retrying.
// A 400 json_validate_failed carries the reply it could not validate as `failed_generation`.
export const groqError = (status: number, message: string, code = "rate_limit_exceeded", failedGeneration?: string) =>
  new Response(JSON.stringify({ error: { message, type: status === 429 ? "tokens" : "invalid_request_error", code, ...(failedGeneration === undefined ? {} : { failed_generation: failedGeneration }) } }), {
    status,
    headers: { "content-type": "application/json", ...(status === 429 ? { "retry-after": "7" } : {}) },
  });
