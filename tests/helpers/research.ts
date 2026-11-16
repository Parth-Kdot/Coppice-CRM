import type { FetchDeps, Limits, Resolved, TransportRequest, TransportResponse } from "@/lib/research/fetch";
import { LIMITS } from "@/lib/research/fetch";

// A fake internet for the research fetcher: DNS answers and HTTP replies come from tables, so the
// tests never open a socket. Every request the fake received is recorded.

export const PUBLIC_IP = "93.184.215.14";

export type FakeReply = {
  status?: number;
  headers?: Record<string, string>;
  // The body in chunks; a chunk of `null` never arrives (a stalled stream).
  chunks?: (string | Uint8Array | null)[];
  // The reply itself never arrives (a server that accepts the connection and says nothing).
  hang?: boolean;
};

export const html = (body: string, headers: Record<string, string> = {}): FakeReply => ({
  headers: { "content-type": "text/html; charset=utf-8", ...headers },
  chunks: [body],
});
export const redirect = (location: string, status = 302): FakeReply => ({ status, headers: { location } });
export const robots = (text: string): FakeReply => ({ headers: { "content-type": "text/plain" }, chunks: [text] });

export type FakeNet = { deps: FetchDeps; requests: TransportRequest[]; chunksRead: () => number };

// `dns` maps a hostname to its addresses (default: one public address); `pages` maps a full URL
// to its reply. A robots.txt that isn't listed answers 404, which allows everything.
export function fakeNet(pages: Record<string, FakeReply>, dns: Record<string, string[] | Error> = {}): FakeNet {
  const requests: TransportRequest[] = [];
  let chunksRead = 0;
  const deps: FetchDeps = {
    lookup: async (hostname) => {
      const answer = dns[hostname] ?? [PUBLIC_IP];
      if (answer instanceof Error) throw answer;
      return answer.map((address): Resolved => ({ address, family: address.includes(":") ? 6 : 4 }));
    },
    transport: async (request) => {
      requests.push(request);
      const reply = pages[request.url.href] ?? (request.url.pathname === "/robots.txt" ? { status: 404 } : { status: 404 });
      if (reply.hang) return new Promise<TransportResponse>(() => {});
      let closed = false;
      async function* body() {
        for (const chunk of reply.chunks ?? []) {
          if (closed) return;
          if (chunk === null) await new Promise(() => {});
          chunksRead++;
          yield typeof chunk === "string" ? new TextEncoder().encode(chunk) : (chunk as Uint8Array);
        }
      }
      return {
        status: reply.status ?? 200,
        headers: Object.fromEntries(Object.entries(reply.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
        body: body(),
        close: () => {
          closed = true;
        },
      };
    },
  };
  return { deps, requests, chunksRead: () => chunksRead };
}

// Short limits so timeout tests take milliseconds.
export const FAST: Limits = { ...LIMITS, connectMs: 50, requestMs: 80, pageMs: 150 };
