import { createHash, randomBytes } from "node:crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { appUrl, mcpResourceUrl } from "@/lib/mcp/config";
import { handleMcpRequest } from "@/lib/mcp/handler";
import { signedInHeaders } from "./session";

// Real OAuth tokens for MCP tests, got the way an assistant gets them: register a client, open the
// authorize URL as a signed-in person, allow it on the consent step, and swap the code for a
// token. Every step is a request to Better Auth's own endpoints (auth.handler); nothing is forged.
//
// The MCP route checks tokens against our JWKS by fetching <site>/api/auth/jwks, as it does in
// production. Tests have no server listening, so routeAppFetches() hands requests for the app's own
// address straight to auth.handler. Everything else still goes to the real fetch.

// Parsed JSON from a response or tool result; tests read deep into it.
type Json = ReturnType<typeof JSON.parse>;

const realFetch = globalThis.fetch;
export function routeAppFetches() {
  const base = new URL(appUrl()).origin;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin === base) return auth.handler(request);
    return realFetch(input, init);
  }) as typeof fetch;
}
export function restoreFetch() {
  globalThis.fetch = realFetch;
}

const url = (path: string) => new URL(path, appUrl()).toString();

// Better Auth rate-limits the OAuth endpoints per client IP (5 registrations a minute, for one).
// Each test request comes from its own made-up address, so the limits never trip by accident.
const octet = () => Math.floor(Math.random() * 254) + 1;
export const fromNewIp = () => ({ "x-forwarded-for": `10.${octet()}.${octet()}.${octet()}` });
export const REDIRECT_URI = "http://127.0.0.1:43123/callback";

// Clients registered through open registration have no owner, so deleting users doesn't remove them.
export async function deleteOAuthClients() {
  await prisma.oauthClient.deleteMany();
}

export async function registerClient(fields: Record<string, unknown> = {}) {
  const response = await auth.handler(
    new Request(url("/api/auth/oauth2/register"), {
      method: "POST",
      headers: { "content-type": "application/json", ...fromNewIp() },
      body: JSON.stringify({
        client_name: "Test Assistant",
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        ...fields,
      }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// Opens the authorize URL as `userId`. Returns where Better Auth sent the browser.
export async function authorize(clientId: string, userId: string, opts: { scope: string; resource?: string; challenge: string }) {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: opts.scope,
    state: "state-1",
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
    resource: opts.resource ?? mcpResourceUrl(),
  });
  const headers = await signedInHeaders(userId);
  const response = await auth.handler(
    new Request(url(`/api/auth/oauth2/authorize?${query}`), { headers: { ...Object.fromEntries(headers), ...fromNewIp() }, redirect: "manual" }),
  );
  const location = response.headers.get("location");
  if (!location) throw new Error(`authorize did not redirect (${response.status}): ${await response.text()}`);
  return { location: new URL(location, appUrl()), headers };
}

// The consent page's Allow / Deny, as authClient.oauth2.consent sends it.
export async function consent(location: URL, headers: Headers, accept: boolean) {
  const response = await auth.handler(
    new Request(url("/api/auth/oauth2/consent"), {
      method: "POST",
      headers: { ...Object.fromEntries(headers), "content-type": "application/json", accept: "application/json", ...fromNewIp() },
      body: JSON.stringify({ accept, oauth_query: location.search.slice(1) }),
    }),
  );
  const body = (await response.json()) as { redirect_uri?: string; url?: string };
  const next = body.redirect_uri ?? body.url;
  if (!next) throw new Error(`consent gave no redirect (${response.status}): ${JSON.stringify(body)}`);
  return new URL(next);
}

export async function exchangeCode(clientId: string, code: string, verifier: string, resource = mcpResourceUrl()) {
  const response = await auth.handler(
    new Request(url("/api/auth/oauth2/token"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...fromNewIp() },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: verifier, resource }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, string> };
}

export async function refresh(clientId: string, refreshToken: string) {
  const response = await auth.handler(
    new Request(url("/api/auth/oauth2/token"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...fromNewIp() },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, resource: mcpResourceUrl() }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, string> };
}

// The whole flow for one person: a new client, consent given, a token for the MCP URL.
export async function getAccessToken(userId: string, { scope = "openid offline_access coppice:read coppice:write", resource }: { scope?: string; resource?: string } = {}) {
  const client = await registerClient();
  const clientId = client.body.client_id as string;
  const { verifier, challenge } = pkce();
  const { location, headers } = await authorize(clientId, userId, { scope, resource, challenge });
  // A new client always stops at the consent page first.
  if (location.pathname !== "/oauth/consent") throw new Error(`expected the consent page, got ${location}`);
  const back = await consent(location, headers, true);
  const code = back.searchParams.get("code");
  if (!code) throw new Error(`no code in ${back}`);
  const token = await exchangeCode(clientId, code, verifier, resource);
  if (token.status !== 200) throw new Error(`token exchange failed: ${JSON.stringify(token.body)}`);
  return { clientId, accessToken: token.body.access_token, refreshToken: token.body.refresh_token, expiresIn: Number(token.body.expires_in) };
}

export { pkce };

// ----- Calling the MCP endpoint -----

let nextId = 1;
export async function mcpPost(body: unknown, token?: string, extraHeaders: Record<string, string> = {}) {
  const response = await handleMcpRequest(
    new Request(mcpResourceUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    }),
  );
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, headers: response.headers, json: json as Json };
}

// The 2025 handshake: initialize, then the call. The stateless fallback answers each POST alone, so
// a legacy client can call a tool right after initializing, with no session id.
export async function legacyToolCall(token: string, name: string, args: Record<string, unknown> = {}) {
  const init = await mcpPost(
    { jsonrpc: "2.0", id: nextId++, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
    token,
  );
  const call = await mcpPost({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }, token, {
    "mcp-protocol-version": "2025-06-18",
  });
  return { init, call };
}

// The current MCP protocol revision, which the server answers directly (lib/mcp/handler.ts).
export const MODERN_PROTOCOL = "2026-07-28";

// The official MCP client, talking to the route handler directly. By default it is pinned to the
// current protocol (2026-07-28, server/discover): the SDK's own default is the legacy 2025 era,
// which `era: "sdk-default"` keeps for the test that covers older clients.
export async function mcpClient(token: string, { era = "modern" }: { era?: "modern" | "sdk-default" } = {}) {
  const { Client, StreamableHTTPClientTransport } = await import("@modelcontextprotocol/client");
  const client = new Client(
    { name: "coppice-test", version: "1.0.0" },
    era === "modern" ? { versionNegotiation: { mode: { pin: MODERN_PROTOCOL } } } : undefined,
  );
  const transport = new StreamableHTTPClientTransport(new URL(mcpResourceUrl()), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: (input, init) => handleMcpRequest(new Request(input, init)),
  });
  await client.connect(transport);
  return client;
}

// The text of a tool result, parsed when it is JSON.
export function resultText(result: { content?: unknown; isError?: boolean }) {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? "";
}
export const resultJson = (result: { content?: unknown }) => JSON.parse(resultText(result)) as Json;

// A legacy reply arrives as one server-sent event; this pulls the JSON-RPC message out of it.
export function sseMessage(body: unknown) {
  if (typeof body !== "string") return body as Json;
  const data = body.split("\n").find((line) => line.startsWith("data: "));
  return data ? (JSON.parse(data.slice(6)) as Json) : null;
}
