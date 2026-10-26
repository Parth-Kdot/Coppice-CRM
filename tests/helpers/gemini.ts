import { vi } from "vitest";

// A fake Gemini API for tests: the SDK's HTTP calls go to a fake fetch that returns recorded-style
// replies, so the real SDK still builds the request and parses the response, with no network.

export type Call = { url: string; body: Record<string, unknown> };
// Every request the fake received in the current test.
export const calls: Call[] = [];

// A Gemini reply the way the REST API sends it.
export const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
export const answer = (text: string, finishReason = "STOP", extra: Record<string, unknown> = {}) =>
  reply({
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason }],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40, thoughtsTokenCount: 15, totalTokenCount: 175 },
    ...extra,
  });
export const apiError = (status: number, message: string, statusText = "ERROR") =>
  reply({ error: { code: status, message, status: statusText } }, status);

// Each test queues the replies the fake hands out, in order. Call vi.unstubAllGlobals() after.
export function fakeGemini(...replies: (Response | Error)[]) {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      const next = replies.shift();
      if (!next) throw new Error("unexpected extra call");
      if (next instanceof Error) throw next;
      return next;
    }),
  );
}
