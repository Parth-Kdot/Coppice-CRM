import { createServer as createHttpServer, type IncomingHttpHeaders, type Server } from "node:http";
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer } from "node:net";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test, vi } from "vitest";
import ConsentPage from "@/app/(auth)/oauth/consent/page";
import { disconnectAssistant } from "@/app/(app)/[workspaceId]/settings/assistant-actions";
import { GET as authServerMetadataRoute } from "@/app/.well-known/oauth-authorization-server/[[...path]]/route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CACHE_CEILING_SECONDS, CACHE_FLOOR_SECONDS, CIMD_LIMITS, cacheLifetimeSeconds, createCimdFetch, metadataUrlProblem } from "@/lib/mcp/cimd-fetch";
import { NEW_CLIENT_FETCHES_PER_MINUTE, guardClientLookup, resetNewClientFetches } from "@/lib/mcp/cimd-gate";
import { appUrl, mcpResourceUrl } from "@/lib/mcp/config";
import { NOT_CONNECTED, endGrantsWithoutConsent, listConnections } from "@/lib/mcp/connections";
import { nodeTransport, type FetchDeps } from "@/lib/research/fetch";
import { form } from "./helpers/form";
import { asUser } from "./helpers/next-request";
import {
  authorize,
  consent,
  deleteOAuthClients,
  exchangeCode,
  fromNewIp,
  mcpClient,
  mcpPost,
  pkce,
  REDIRECT_URI,
  refresh,
  registerClient,
  restoreFetch,
  routeAppFetches,
} from "./helpers/oauth";
import { fakeNet, PUBLIC_IP, type FakeNet, type FakeReply } from "./helpers/research";
import { resetAndSeed } from "./helpers/seed";
import { signedInHeaders } from "./helpers/session";

// Client ID Metadata Documents: an assistant names itself with the URL of a JSON document, and
// Coppice fetches it (lib/auth.ts, cimd(); the network side is lib/mcp/cimd-fetch.ts). Nothing here
// touches the internet. The fetch goes through the app's real transport code with a fake network
// (tests/helpers/research.ts) or, where real sockets matter, with a server on 127.0.0.1 that the
// connection is pointed at after the address checks have run on a public-looking answer. Every
// OAuth step is a request to Better Auth's own endpoints.

vi.mock("next/headers", () => import("./helpers/next-request"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// Allow and Deny are client code; the page's text is what is checked here.
vi.mock("@/components/oauth-consent", () => ({ ConsentButtons: () => null }));

// lib/auth.ts holds the real transport; each test points it at the network it wants.
const net = vi.hoisted(() => ({ fetch: null as null | ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response) }));
vi.mock("@/lib/mcp/cimd-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp/cimd-fetch")>();
  return {
    ...actual,
    cimdFetch: (input: RequestInfo | URL, init?: RequestInit) => {
      if (!net.fetch) throw new Error("This test set up no network.");
      return net.fetch(input, init);
    },
  };
});

const ALL = "openid offline_access coppice:read coppice:write";
const JSON_TYPE = { "content-type": "application/json" };
// Short limits so timeout tests take milliseconds; the size cap is the real one.
const FAST = { ...CIMD_LIMITS, connectMs: 50, requestMs: 80 };

// A new client id per test: the plugin keeps documents and fetch times per URL in memory, and
// budgets per site, so tests must not share them.
let counter = 0;
const nextUrl = (path = "client.json") => `https://assistant-${++counter}.example/${path}`;

const metadata = (clientId: string, extra: Record<string, unknown> = {}) => ({
  client_id: clientId,
  client_name: "Doc Assistant",
  redirect_uris: [REDIRECT_URI],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  ...extra,
});
const jsonReply = (doc: unknown, headers: Record<string, string> = {}): FakeReply => ({ headers: { ...JSON_TYPE, ...headers }, chunks: [JSON.stringify(doc)] });

// Serves these documents from a fake network and points the app's transport at it.
function serve(pages: Record<string, FakeReply>, dns: Record<string, string[] | Error> = {}, limits = CIMD_LIMITS): FakeNet {
  const fake = fakeNet(pages, dns);
  net.fetch = createCimdFetch(fake.deps, limits);
  return fake;
}

// Opens the authorize URL as a signed-in person without following it. Returns the raw answer.
async function startAuthorize(clientId: string, { userId = "ownerA", redirectUri = REDIRECT_URI, scope = ALL }: { userId?: string; redirectUri?: string; scope?: string } = {}) {
  const { challenge } = pkce();
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state: "state-1",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: mcpResourceUrl(),
  });
  const headers = await signedInHeaders(userId);
  const response = await auth.handler(
    new Request(new URL(`/api/auth/oauth2/authorize?${query}`, appUrl()), { headers: { ...Object.fromEntries(headers), ...fromNewIp() }, redirect: "manual" }),
  );
  const text = await response.text();
  let body: Record<string, string> = {};
  try {
    body = JSON.parse(text);
  } catch {
    // A redirect has no body.
  }
  return { status: response.status, location: response.headers.get("location"), body };
}

const clientRows = (clientId: string) => prisma.oauthClient.count({ where: { clientId } });

// What the plugin answers when a document is refused: 400 and nothing saved.
async function expectRefused(clientId: string, error = "invalid_client", description?: RegExp) {
  const answer = await startAuthorize(clientId);
  expect(answer.status).toBe(400);
  expect(answer.body.error).toBe(error);
  if (description) expect(answer.body.error_description).toMatch(description);
  expect(await clientRows(clientId)).toBe(0);
  return answer;
}

// A person allows a client that names itself with a document, and gets tokens: the whole flow.
async function connectDocument(clientId: string, userId = "ownerA", scope = ALL) {
  const { verifier, challenge } = pkce();
  const { location, headers } = await authorize(clientId, userId, { scope, challenge });
  const back = location.pathname === "/oauth/consent" ? await consent(location, headers, true) : location;
  const code = back.searchParams.get("code");
  if (!code) throw new Error(`no code in ${back}`);
  const token = await exchangeCode(clientId, code, verifier);
  if (token.status !== 200) throw new Error(`token exchange failed: ${JSON.stringify(token.body)}`);
  return { clientId, accessToken: token.body.access_token, refreshToken: token.body.refresh_token, body: token.body };
}

const rowsFor = async (userId: string, clientId: string) => ({
  consents: await prisma.oauthConsent.count({ where: { userId, clientId } }),
  accessTokens: await prisma.oauthAccessToken.count({ where: { userId, clientId } }),
  refreshTokens: await prisma.oauthRefreshToken.count({ where: { userId, clientId } }),
});

// Each test starts a minute later on the clock the plugin reads, so its per-minute fetch budgets
// (which the budget tests below do check) never carry over from an earlier test.
let shift = 0;
beforeAll(async () => {
  routeAppFetches();
  await resetAndSeed();
  await deleteOAuthClients();
});
beforeEach(async () => {
  shift += 61_000;
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + shift });
  net.fetch = null;
  resetNewClientFetches();
  await deleteOAuthClients();
  await prisma.workspace.updateMany({ data: { mcpEnabled: true } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(async () => {
  restoreFetch();
  await deleteOAuthClients();
  await prisma.$disconnect();
});

// ----- The transport, on its own -----

const call = (fake: FakeNet, url: string, init: RequestInit = {}, limits = FAST) =>
  createCimdFetch(fake.deps, limits)(url, { headers: { Accept: "application/json" }, redirect: "error", ...init });

describe("the transport refuses addresses it must never connect to", () => {
  test.each([
    ["an http address", "http://assistant.example/client.json"],
    ["a user name and password", "https://user:secret@assistant.example/client.json"],
    ["a non-standard port", "https://assistant.example:8443/client.json"],
    ["an IPv4 literal", "https://127.0.0.1/client.json"],
    ["an IPv6 literal", "https://[2606:4700::1111]/client.json"],
    ["a numeric IPv4 spelling", "https://2130706433/client.json"],
    ["localhost", "https://localhost/client.json"],
    ["a .internal name", "https://metadata.internal/client.json"],
    ["a name with no dot", "https://intranet/client.json"],
    ["an address over 2000 characters", `https://assistant.example/${"a".repeat(2100)}`],
    ["a scheme that isn't web", "ftp://assistant.example/client.json"],
  ])("%s", async (_name, url) => {
    const fake = fakeNet({});
    await expect(call(fake, url)).rejects.toThrow();
    expect(fake.requests).toEqual([]);
  });

  test.each(["HEAD", "POST", "PUT"])("a %s request", async (method) => {
    const fake = fakeNet({});
    await expect(call(fake, "https://assistant.example/client.json", { method })).rejects.toThrow(/GET/);
    expect(fake.requests).toEqual([]);
  });
});

describe("the transport checks every address a name resolves to, and never connects to a bad one", () => {
  test.each([
    ["a private address", ["10.0.0.5"]],
    ["loopback", ["127.0.0.1"]],
    ["the cloud metadata address", ["169.254.169.254"]],
    ["Alibaba's metadata address", ["100.100.100.200"]],
    ["AWS's IPv6 metadata address", ["fd00:ec2::254"]],
    ["an IPv4-mapped loopback", ["::ffff:127.0.0.1"]],
    ["Azure's platform address", ["168.63.129.16"]],
    ["one public and one private answer", [PUBLIC_IP, "10.0.0.5"]],
    ["one private and one public answer", ["192.168.1.1", PUBLIC_IP]],
  ])("%s", async (_name, answers) => {
    const fake = fakeNet({}, { "assistant.example": answers });
    await expect(call(fake, "https://assistant.example/client.json")).rejects.toThrow(/private or reserved/);
    expect(fake.requests).toEqual([]);
  });

  it("no answer at all", async () => {
    const fake = fakeNet({}, { "assistant.example": [] });
    await expect(call(fake, "https://assistant.example/client.json")).rejects.toThrow(/did not resolve/);
    expect(fake.requests).toEqual([]);
  });

  it("a name that does not resolve", async () => {
    const fake = fakeNet({}, { "assistant.example": new Error("ENOTFOUND") });
    await expect(call(fake, "https://assistant.example/client.json")).rejects.toThrow("ENOTFOUND");
    expect(fake.requests).toEqual([]);
  });

  it("looks the name up once and connects to the address it checked, with the hostname kept", async () => {
    const lookup = vi.fn(async () => [{ address: PUBLIC_IP, family: 4 as const }]);
    const url = nextUrl();
    const fake = fakeNet({ [url]: jsonReply(metadata(url)) });
    const response = await createCimdFetch({ lookup, transport: fake.deps.transport }, FAST)(url, { headers: { Accept: "application/json" } });
    expect(response.status).toBe(200);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0].address).toEqual({ address: PUBLIC_IP, family: 4 });
    expect(fake.requests[0].url.hostname).toBe(new URL(url).hostname);
  });
});

describe("the transport never follows a redirect", () => {
  test.each([301, 302, 307, 308])("%i to the metadata address, and to a public address", async (status) => {
    for (const location of ["http://169.254.169.254/latest/meta-data/", "https://elsewhere.example/client.json"]) {
      const url = nextUrl();
      const fake = serve({ [url]: { status, headers: { location } } });
      const response = await createCimdFetch(fake.deps, FAST)(url, { headers: { Accept: "application/json" }, redirect: "error" });
      expect(response.status).toBe(status);
      expect(response.redirected).toBe(false);
      expect(response.headers.get("location")).toBeNull();
      expect(await response.text()).toBe("");
      // One request, to the first address only.
      expect(fake.requests.map((r) => r.url.href)).toEqual([url]);
    }
  });

  // The transport writes the freshness itself (max-age=60 is under the five minute floor).
  it("a 304 passes through with its validators and Coppice's own cache header", async () => {
    const url = nextUrl();
    const fake = serve({ [url]: { status: 304, headers: { etag: '"v1"', "cache-control": "max-age=60", "set-cookie": "a=b", location: "http://10.0.0.1/" } } });
    const response = await createCimdFetch(fake.deps, FAST)(url, { headers: { "If-None-Match": '"v1"' } });
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe('"v1"');
    expect(response.headers.get("cache-control")).toBe(`max-age=${CACHE_FLOOR_SECONDS}`);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("what the transport sends and passes on", () => {
  it("sends only a generic identity and the plugin's validators", async () => {
    const url = nextUrl();
    const fake = serve({ [url]: jsonReply(metadata(url)) });
    await createCimdFetch(fake.deps, FAST)(url, {
      headers: { Accept: "text/html", Authorization: "Bearer secret", Cookie: "session=secret", "X-Forwarded-For": "1.2.3.4", "If-None-Match": '"v1"', "If-Modified-Since": "Mon, 01 Jan 2024 00:00:00 GMT" },
    });
    expect(fake.requests[0].headers).toEqual({
      Accept: "application/json",
      "User-Agent": "Coppice/1.0",
      "Accept-Encoding": "identity",
      "if-none-match": '"v1"',
      "if-modified-since": "Mon, 01 Jan 2024 00:00:00 GMT",
    });
    expect(fake.requests[0].connectTimeoutMs).toBe(FAST.connectMs);
  });

  it("passes on only the headers the plugin reads, and no status text", async () => {
    const url = nextUrl();
    const fake = serve({
      [url]: jsonReply(metadata(url), { etag: '"v1"', "cache-control": "max-age=60", "last-modified": "Mon, 01 Jan 2024 00:00:00 GMT", vary: "accept", "set-cookie": "a=b", "x-secret": "1", location: "http://10.0.0.1/" }),
    });
    const response = await createCimdFetch(fake.deps, FAST)(url);
    expect(response.status).toBe(200);
    expect(response.statusText).toBe("");
    // The origin's vary is not passed on; its cache-control is replaced by the transport's own.
    expect([...response.headers.keys()].sort()).toEqual(["cache-control", "content-type", "etag", "last-modified"]);
    expect(response.headers.get("cache-control")).toBe(`max-age=${CACHE_FLOOR_SECONDS}`);
    expect(await response.json()).toEqual(metadata(url));
  });
});

describe("the transport refuses replies it can't use safely", () => {
  test.each([600, 700, 99, 0, 1000])("a status of %i is an error, not a crash", async (status) => {
    const url = nextUrl();
    const fake = serve({ [url]: { status, chunks: ["{}"] } });
    await expect(createCimdFetch(fake.deps, FAST)(url)).rejects.toThrow(/unusable status/);
  });

  test.each([404, 429, 500, 503])("a %i goes back as a bare status", async (status) => {
    const url = nextUrl();
    const fake = serve({ [url]: { status, headers: JSON_TYPE, chunks: ['{"client_id":"x"}'] } });
    const response = await createCimdFetch(fake.deps, FAST)(url);
    expect(response.status).toBe(status);
    expect(await response.text()).toBe("");
  });

  it("a declared length over 5 KB, without reading the body", async () => {
    const url = nextUrl();
    const fake = serve({ [url]: { headers: { ...JSON_TYPE, "content-length": "6000" }, chunks: ["x".repeat(6000)] } });
    await expect(createCimdFetch(fake.deps, FAST)(url)).rejects.toThrow(/too large/);
    expect(fake.chunksRead()).toBe(0);
  });

  it("a body over 5 KB with no declared length, and the reading stops", async () => {
    const url = nextUrl();
    const chunks = Array.from({ length: 40 }, () => "x".repeat(1024));
    const fake = serve({ [url]: { headers: JSON_TYPE, chunks } });
    await expect(createCimdFetch(fake.deps, FAST)(url)).rejects.toThrow(/too_large/);
    expect(fake.chunksRead()).toBeLessThan(10);
  });

  test.each(["gzip", "br", "deflate"])("%s content encoding", async (encoding) => {
    const url = nextUrl();
    const fake = serve({ [url]: { headers: { ...JSON_TYPE, "content-encoding": encoding }, chunks: ["{}"] } });
    await expect(createCimdFetch(fake.deps, FAST)(url)).rejects.toThrow(/compressed/);
    expect(fake.chunksRead()).toBe(0);
  });

  it("a stream that stalls times out within the limit", async () => {
    const url = nextUrl();
    const fake = serve({ [url]: { headers: JSON_TYPE, chunks: ['{"client_id"', null] } });
    const started = performance.now();
    await expect(createCimdFetch(fake.deps, FAST)(url)).rejects.toThrow();
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("a server that accepts the connection and says nothing times out within the limit", async () => {
    const url = nextUrl();
    const fake = serve({ [url]: { hang: true } });
    const started = performance.now();
    await expect(createCimdFetch(fake.deps, FAST)(url)).rejects.toThrow();
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("a request that was aborted by its caller", async () => {
    const url = nextUrl();
    const fake = serve({ [url]: { hang: true } });
    await expect(createCimdFetch(fake.deps, FAST)(url, { signal: AbortSignal.abort() })).rejects.toThrow();
  });

  // The plugin decodes a body without checking it, so anything Coppice can't read as a UTF-8 JSON
  // object is refused here, where the document rules run, instead of being passed on.
  it.each([
    ["HTML", "<html>no</html>"],
    ["an empty body", ""],
    ["a JSON array", "[]"],
    ["a JSON string", '"Coppice Official"'],
    ["JSON null", "null"],
  ])("a body that is %s is refused, not passed to the plugin", async (_name, body) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = nextUrl();
    const fake = serve({ [url]: { headers: JSON_TYPE, chunks: [body] } });
    await expect(createCimdFetch(fake.deps, FAST)(url)).rejects.toThrow(/UTF-8 JSON object/);
  });
});

describe("Coppice's own rules on a document", () => {
  test.each([
    ["a name that reads as Coppice", { client_name: "Coppice Official" }, /Coppice/],
    ["a look-alike of Coppice", { client_name: "C0ppice Helper" }, /Coppice/],
    ["a name with a right-to-left override", { client_name: "Safe\u202Eesu" }, /control or formatting/],
    ["a name with a zero-width character", { client_name: "Doc\u200BAssistant" }, /control or formatting/],
    ["a name of 101 characters", { client_name: "a".repeat(101) }, /at most 100/],
    ["a jwks_uri", { jwks_uri: "https://assistant.example/jwks.json" }, /jwks_uri/],
    ["a backchannel_logout_uri", { backchannel_logout_uri: "https://assistant.example/logout" }, /backchannel_logout_uri/],
    ["private_key_jwt authentication", { token_endpoint_auth_method: "private_key_jwt" }, /must be none/],
    ["client_secret_basic authentication", { token_endpoint_auth_method: "client_secret_basic" }, /must be none/],
  ])("refuses %s, and logs one line naming the site", async (_name, extra, problem) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = nextUrl();
    const fake = serve({ [url]: jsonReply(metadata(url, extra)) });
    await expect(createCimdFetch(fake.deps, FAST)(url)).rejects.toThrow(problem);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(new URL(url).hostname);
    expect(String(warn.mock.calls[0][0])).not.toContain("client.json");
  });

  it("accepts a document with no authentication method named", async () => {
    const url = nextUrl();
    const doc: Record<string, unknown> = metadata(url);
    delete doc.token_endpoint_auth_method;
    const fake = serve({ [url]: jsonReply(doc) });
    expect((await createCimdFetch(fake.deps, FAST)(url)).status).toBe(200);
  });
});

// The plugin decodes a document without checking for invalid UTF-8: the bad byte becomes U+FFFD,
// the text parses, and a field it strips (here "x") is gone. If Coppice's own rules skipped a
// body it couldn't decode, one stray byte would let a document use any name or key address.
describe("a document with a byte that is not UTF-8 gets no way round Coppice's rules", () => {
  // The document as JSON with one extra string field whose value holds a single invalid byte.
  const withBadByte = (doc: Record<string, unknown>, byte = 0xff): FakeReply => ({
    headers: JSON_TYPE,
    chunks: [Buffer.concat([Buffer.from(`${JSON.stringify(doc).slice(0, -1)},"x":"`), Buffer.from([byte]), Buffer.from('"}')])],
  });

  test.each([
    ["a name that reads as Coppice", { client_name: "Coppice Official" }, 0xff],
    ["a look-alike of Coppice", { client_name: "C0ppice Helper" }, 0xc3],
    ["a right-to-left override in the name", { client_name: "Safe\u202Eesu" }, 0x80],
    ["a name of 101 characters", { client_name: "a".repeat(101) }, 0xff],
    ["private_key_jwt with a jwks_uri", { token_endpoint_auth_method: "private_key_jwt", jwks_uri: "https://assistant.example/jwks.json" }, 0xc3],
    ["a backchannel_logout_uri", { backchannel_logout_uri: "https://assistant.example/logout" }, 0xff],
    ["client_secret_basic authentication", { token_endpoint_auth_method: "client_secret_basic" }, 0xff],
  ])("the transport refuses %s with an invalid byte in another field", async (_name, extra, byte) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = nextUrl();
    const fake = serve({ [url]: withBadByte(metadata(url, extra), byte) });
    await expect(createCimdFetch(fake.deps, FAST)(url)).rejects.toThrow(/UTF-8 JSON object/);
  });

  it("the transport refuses an invalid byte inside the name itself", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = nextUrl();
    const head = Buffer.from(`{"client_id":${JSON.stringify(url)},"redirect_uris":[${JSON.stringify(REDIRECT_URI)}],"client_name":"Doc `);
    const fake = serve({ [url]: { headers: JSON_TYPE, chunks: [Buffer.concat([head, Buffer.from([0xff]), Buffer.from('"}')])] } });
    await expect(createCimdFetch(fake.deps, FAST)(url)).rejects.toThrow(/UTF-8 JSON object/);
  });

  it("the transport still passes a document that is valid UTF-8, with accents and emoji", async () => {
    const url = nextUrl();
    const fake = serve({ [url]: jsonReply(metadata(url, { client_name: "Assistant Étoile 🌱" })) });
    expect((await createCimdFetch(fake.deps, FAST)(url)).status).toBe(200);
  });

  it.each([
    ["a name that reads as Coppice", { client_name: "Coppice Official" }],
    ["private_key_jwt with a jwks_uri", { token_endpoint_auth_method: "private_key_jwt", jwks_uri: "https://assistant.example/jwks.json" }],
    ["a bidi override in the name", { client_name: "Safe\u202Eesu" }],
  ])("through the endpoints, %s plus an invalid byte saves no client", async (_name, extra) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = nextUrl();
    serve({ [url]: withBadByte(metadata(url, extra)) });
    await expectRefused(url);
  });
});

describe("metadataUrlProblem, the plugin's pre-fetch gate", () => {
  test.each([
    ["https://assistant.example/oauth/client.json", null],
    ["https://vscode.dev/oauth/client-metadata.json", null],
    ["http://assistant.example/client.json", "only https"],
    ["https://assistant.example:8443/client.json", "refused"],
    ["https://127.0.0.1/client.json", "refused"],
    ["https://localhost/client.json", "refused"],
    [`https://assistant.example/${"a".repeat(500)}`, "too long"],
    ["not a url", "refused"],
  ])("%s", (url, problem) => {
    const result = metadataUrlProblem(url);
    if (problem === null) expect(result).toBeNull();
    else expect(result).toContain(problem);
  });
});

// ----- Through Better Auth's endpoints, with a fake network -----

describe("a document is refused before anything is saved", () => {
  it("a different client_id inside the document", async () => {
    const url = nextUrl();
    serve({ [url]: jsonReply(metadata("https://other.example/client.json")) });
    await expectRefused(url, "invalid_client", /does not match the metadata document URL/);
  });

  it.each([
    ["a 302 to the metadata address", { status: 302, headers: { location: "http://169.254.169.254/latest/" } }, /returned HTTP 302/],
    ["a 301 to a public address", { status: 301, headers: { location: "https://elsewhere.example/client.json" } }, /returned HTTP 301/],
    ["a 404", { status: 404 }, /returned HTTP 404/],
    ["a reply that is not marked as JSON", { headers: { "content-type": "text/html" }, chunks: ['{"client_id":"x"}'] }, /must be JSON/],
    ["a body that is not JSON", { headers: JSON_TYPE, chunks: ["{not json"] }, /Failed to fetch/],
    ["an empty body", { headers: JSON_TYPE, chunks: [""] }, /Failed to fetch/],
    ["a document of 6 KB", { headers: { ...JSON_TYPE, "content-length": "6144" }, chunks: ["x".repeat(6144)] }, undefined],
    ["a 6 KB body with no declared length", { headers: JSON_TYPE, chunks: ["x".repeat(6144)] }, undefined],
    ["a status of 600", { status: 600 }, undefined],
  ] satisfies [string, FakeReply, RegExp | undefined][])("%s", async (_name, reply, description) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = nextUrl();
    const fake = serve({ [url]: reply });
    await expectRefused(url, "invalid_client", description);
    // Redirects were never followed: the one request was to the document's own address.
    expect(fake.requests.map((r) => r.url.href)).toEqual([url]);
  });

  it.each([
    ["a name that reads as Coppice", { client_name: "Coppice Official" }],
    ["a name with a bidi override", { client_name: "Safe\u202Eesu" }],
    ["a name of 101 characters", { client_name: "a".repeat(101) }],
    ["a jwks_uri", { jwks_uri: "https://assistant.example/jwks.json" }],
    ["private_key_jwt authentication", { token_endpoint_auth_method: "private_key_jwt" }],
    ["skip_consent", { skip_consent: true }],
  ])("%s", async (_name, extra) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = nextUrl();
    serve({ [url]: jsonReply(metadata(url, extra)) });
    await expectRefused(url);
  });

  it("the client_credentials grant", async () => {
    const url = nextUrl();
    serve({ [url]: jsonReply(metadata(url, { grant_types: ["client_credentials"] })) });
    await expectRefused(url, "invalid_client_metadata");
  });

  it("a scope Coppice doesn't have", async () => {
    const url = nextUrl();
    serve({ [url]: jsonReply(metadata(url, { scope: "coppice:read admin:all" })) });
    await expectRefused(url, "invalid_scope");
  });

  test.each([
    ["10.0.0.5"],
    ["127.0.0.1"],
    ["169.254.169.254"],
    ["100.100.100.200"],
    ["fd00:ec2::254"],
    ["::ffff:127.0.0.1"],
  ])("a name that resolves to %s makes no connection", async (address) => {
    const url = nextUrl();
    const host = new URL(url).hostname;
    const fake = serve({ [url]: jsonReply(metadata(url)) }, { [host]: [address] });
    await expectRefused(url);
    expect(fake.requests).toEqual([]);
  });

  it("a name that resolves to a public and a private address makes no connection", async () => {
    const url = nextUrl();
    const fake = serve({ [url]: jsonReply(metadata(url)) }, { [new URL(url).hostname]: [PUBLIC_IP, "10.0.0.5"] });
    await expectRefused(url);
    expect(fake.requests).toEqual([]);
  });

  it.each([
    ["https://127.0.0.1/client.json"],
    ["https://assistant.example:8443/client.json"],
    ["https://localhost/client.json"],
  ])("the address %s is refused before any lookup", async (clientId) => {
    const fake = serve({});
    const answer = await startAuthorize(clientId);
    // Refused by the plugin's own address check and ours, with no lookup and no connection.
    expect(answer.status).toBe(400);
    expect(answer.location).toBeNull();
    expect(fake.requests).toEqual([]);
    expect(await clientRows(clientId)).toBe(0);
  });
});

describe("an http address is not a document address", () => {
  it("is an unknown client: Better Auth's error page, no lookup, no connection, nothing saved", async () => {
    const fake = serve({});
    const clientId = "http://assistant.example/client.json";
    const answer = await startAuthorize(clientId);
    expect(answer.status).toBe(302);
    expect(answer.location).toContain("/api/auth/error?error=invalid_client");
    expect(fake.requests).toEqual([]);
    expect(await clientRows(clientId)).toBe(0);
  });
});

describe("redirect addresses are bound to the document's own site", () => {
  it("refuses a document at one site that lists a callback on another", async () => {
    const url = nextUrl();
    serve({ [url]: jsonReply(metadata(url, { redirect_uris: ["https://evil.example/cb"] })) });
    await expectRefused(url, "invalid_client", /redirect_uris/);
  });

  it("accepts a callback on its own site", async () => {
    const url = nextUrl();
    const callback = `${new URL(url).origin}/callback`;
    serve({ [url]: jsonReply(metadata(url, { redirect_uris: [callback] })) });
    const answer = await startAuthorize(url, { redirectUri: callback });
    expect(answer.status).toBe(302);
    expect(answer.location).toContain("/oauth/consent");
  });

  it("accepts a callback on the person's own computer", async () => {
    const url = nextUrl();
    serve({ [url]: jsonReply(metadata(url, { redirect_uris: ["http://127.0.0.1:43123/callback", "http://localhost:43123/callback"] })) });
    const answer = await startAuthorize(url);
    expect(answer.status).toBe(302);
  });

  it("refuses an authorize request whose redirect isn't one the document lists", async () => {
    const url = nextUrl();
    serve({ [url]: jsonReply(metadata(url)) });
    const answer = await startAuthorize(url, { redirectUri: "http://127.0.0.1:50000/elsewhere" });
    // Better Auth's own error page, never the unlisted address, and no code.
    expect(answer.status).toBe(302);
    expect(answer.location).toContain("/api/auth/error?error=invalid_redirect");
    expect(answer.location).not.toContain("127.0.0.1:50000");
  });
});

describe("fetch budgets", () => {
  it("a site is fetched at most ten times a minute, then refused at once with 429", async () => {
    const fake = serve({});
    const origin = `https://budget-${++counter}.example`;
    for (let i = 0; i < 10; i++) {
      const answer = await startAuthorize(`${origin}/c${i}.json`);
      expect(answer.body.error).toBe("invalid_client");
    }
    expect(fake.requests).toHaveLength(10);
    const over = await startAuthorize(`${origin}/c10.json`);
    expect(over.status).toBe(429);
    expect(over.body.error).toBe("temporarily_unavailable");
    expect(fake.requests).toHaveLength(10);
    // Another site is not held back by it.
    expect((await startAuthorize(`https://budget-${++counter}.example/c.json`)).status).toBe(400);
    // A minute later the site may be fetched again.
    vi.setSystemTime(Date.now() + 61_000);
    expect((await startAuthorize(`${origin}/c10.json`)).status).toBe(400);
    expect(fake.requests).toHaveLength(12);
  });

  it("a failed fetch isn't repeated for the same client within a second", async () => {
    const url = nextUrl();
    const fake = serve({});
    expect((await startAuthorize(url)).status).toBe(400);
    const again = await startAuthorize(url);
    expect(again.status).toBe(429);
    expect(again.body.error).toBe("temporarily_unavailable");
    expect(fake.requests).toHaveLength(1);
    vi.setSystemTime(Date.now() + 2_000);
    expect((await startAuthorize(url)).status).toBe(400);
    expect(fake.requests).toHaveLength(2);
  });
});

// ----- Who may start a fetch (lib/mcp/cimd-gate.ts) -----

// Requests from outside, the way an anonymous sender makes them (also used by the tests below).
const junkUrl = () => `https://junk-${++counter}.attacker.example/c.json`;

// Opens the authorize URL with no session at all, from an address of its own.
async function anonymousAuthorize(clientId: string) {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: ALL,
    code_challenge: "x".repeat(43),
    code_challenge_method: "S256",
  });
  const response = await auth.handler(new Request(new URL(`/api/auth/oauth2/authorize?${query}`, appUrl()), { headers: fromNewIp(), redirect: "manual" }));
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, string>, headers: response.headers };
}

const send = async (path: string, init: { method?: string; headers?: Record<string, string>; body?: BodyInit }) =>
  auth.handler(new Request(new URL(`/api/auth/${path}`, appUrl()), { method: "POST", ...init, headers: { ...fromNewIp(), ...init.headers } }));
const formBody = (fields: Record<string, string>) => ({ headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });
const jwtNaming = (clientId: string) =>
  `${Buffer.from('{"alg":"ES256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ iss: clientId, sub: clientId })).toString("base64url")}.c2ln`;


describe("a client nobody has connected can only start a fetch at authorize, and only a few a minute", () => {
  it("junk addresses sent without signing in can't stop a connected assistant from refreshing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const good = nextUrl();
    // no-store: Coppice reuses the document for the floor of five minutes, and then the plugin has to ask the site again.
    const fake = serve({ [good]: jsonReply(metadata(good), { "cache-control": "no-store" }) });
    const connected = await connectDocument(good);
    // The document is stale, so the refresh below needs a fetch; the share is a fresh minute.
    vi.setSystemTime(Date.now() + (CACHE_FLOOR_SECONDS + 1) * 1000);
    const fetchesAfterConnecting = fake.requests.length;

    const statuses: Record<number, number> = {};
    for (let i = 0; i < 70; i++) {
      const { status } = await anonymousAuthorize(junkUrl());
      statuses[status] = (statuses[status] ?? 0) + 1;
    }
    // Only the share set aside for new addresses reached the plugin; the rest never took a slot.
    const left = NEW_CLIENT_FETCHES_PER_MINUTE;
    expect(statuses[400]).toBe(left);
    expect(statuses[429]).toBe(70 - left);
    expect(fake.requests.length - fetchesAfterConnecting).toBe(left);

    const renewed = await refresh(good, connected.refreshToken);
    expect(renewed.status).toBe(200);
    expect(renewed.body.access_token).toBeTruthy();
    // The refresh did fetch the document again, and was not held back.
    expect(fake.requests.length - fetchesAfterConnecting).toBe(left + 1);
  });

  it("the share for new addresses is a minute's worth, then 429 with a retry time, then it opens again", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    serve({});
    for (let i = 0; i < NEW_CLIENT_FETCHES_PER_MINUTE; i++) expect((await anonymousAuthorize(junkUrl())).status).toBe(400);
    const over = await anonymousAuthorize(junkUrl());
    expect(over.status).toBe(429);
    expect(over.body.error).toBe("temporarily_unavailable");
    expect(over.headers.get("retry-after")).toBe("60");
    vi.setSystemTime(Date.now() + 61_000);
    expect((await anonymousAuthorize(junkUrl())).status).toBe(400);
  });

  it("assistants that already connected, and registered ones, are not held back when the share is used up", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const known = nextUrl();
    serve({ [known]: jsonReply(metadata(known)) });
    await connectDocument(known);
    const registered = (await registerClient()).body.client_id as string;
    for (let i = 0; i < NEW_CLIENT_FETCHES_PER_MINUTE + 5; i++) await anonymousAuthorize(junkUrl());
    expect((await anonymousAuthorize(junkUrl())).status).toBe(429);
    // A person opening the authorize link for a connected assistant, signed in or not.
    expect((await startAuthorize(known)).status).toBe(302);
    expect((await anonymousAuthorize(known)).status).toBe(302);
    expect((await startAuthorize(registered)).status).toBe(302);
  });

  it("addresses Coppice would never fetch are refused at once and use none of the share", async () => {
    const fake = serve({});
    for (const id of ["https://127.0.0.1/c.json", "https://localhost/c.json", "https://intranet/c.json", "https://assistant.example:8443/c.json", `https://assistant.example/${"a".repeat(600)}`, "https://assistant.example/a/../c.json", "https://assistant.example/c.json#frag"]) {
      for (let i = 0; i < 3; i++) {
        const answer = await anonymousAuthorize(id);
        expect(answer.status).toBe(400);
        expect(answer.body.error).toBe("invalid_client");
      }
    }
    expect(fake.requests).toEqual([]);
    // The whole share is still there for a real address.
    const url = nextUrl();
    serve({ [url]: jsonReply(metadata(url)) });
    expect((await startAuthorize(url)).status).toBe(302);
  });

  it("a person connecting a new assistant for the first time still gets the consent page", async () => {
    const url = nextUrl();
    serve({ [url]: jsonReply(metadata(url)) });
    const { location } = await authorize(url, "ownerA", { scope: ALL, challenge: pkce().challenge });
    expect(location.pathname).toBe("/oauth/consent");
    expect(await clientRows(url)).toBe(1);
  });

  it("the token endpoint, with the id in a form, Basic or an assertion, answers invalid_client with no fetch", async () => {
    const fake = serve({});
    const id = junkUrl();
    const tokenForm = { grant_type: "refresh_token", refresh_token: "nope", client_id: id };
    const asForm = await send("oauth2/token", formBody(tokenForm));
    const withBasic = await send("oauth2/token", { ...formBody({ grant_type: "refresh_token", refresh_token: "nope" }), headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${encodeURIComponent(id)}:secret`).toString("base64")}` } });
    const withAssertion = await send("oauth2/token", formBody({ grant_type: "refresh_token", refresh_token: "nope", client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: jwtNaming(id) }));
    for (const response of [asForm, withBasic, withAssertion]) {
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect((await response.json()).error).toBe("invalid_client");
    }
    expect(withBasic.status).toBe(401);
    expect(withBasic.headers.get("www-authenticate")).toBe("Basic");
    expect(fake.requests).toEqual([]);
    expect(await clientRows(id)).toBe(0);
  });

  it.each(["oauth2/revoke", "oauth2/introspect"])("%s answers invalid_client with no fetch", async (path) => {
    const fake = serve({});
    const id = junkUrl();
    const response = await send(path, formBody({ token: "nope", client_id: id }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_client");
    expect(fake.requests).toEqual([]);
  });

  it("end-session, from a signed-out caller, starts no fetch", async () => {
    const fake = serve({});
    const id = junkUrl();
    const byClient = await auth.handler(new Request(new URL(`/api/auth/oauth2/end-session?client_id=${encodeURIComponent(id)}`, appUrl()), { headers: fromNewIp() }));
    const hint = `${Buffer.from('{"alg":"ES256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ aud: id })).toString("base64url")}.c2ln`;
    const byHint = await auth.handler(new Request(new URL(`/api/auth/oauth2/end-session?id_token_hint=${hint}`, appUrl()), { headers: fromNewIp() }));
    for (const response of [byClient, byHint]) expect((await response.json()).error).toBe("invalid_client");
    expect(fake.requests).toEqual([]);
  });

  it("public-client, for a signed-in account, starts no fetch either", async () => {
    const fake = serve({});
    const headers = await signedInHeaders("ownerA");
    const response = await auth.handler(
      new Request(new URL(`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(junkUrl())}`, appUrl()), { headers: { ...Object.fromEntries(headers), ...fromNewIp() } }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_client");
    expect(fake.requests).toEqual([]);
  });

  it("the token, revoke and introspect endpoints are untouched for a connected assistant", async () => {
    const url = nextUrl();
    serve({ [url]: jsonReply(metadata(url)) });
    const connected = await connectDocument(url);
    const renewed = await refresh(url, connected.refreshToken);
    expect(renewed.status).toBe(200);
    const revoked = await send("oauth2/revoke", formBody({ token: renewed.body.refresh_token, client_id: url, token_type_hint: "refresh_token" }));
    expect(revoked.status).toBe(200);
    // The revoked token is dead.
    expect((await refresh(url, renewed.body.refresh_token)).status).toBe(400);
  });
});

// ----- A client is connected once somebody allowed it -----

// The transport's replies for one document that is served with the validators of a real site: a
// 200 with the document, and a 304 for a request that sends the matching If-None-Match.
function conditionalNet(url: string, headers: Record<string, string>, etag = '"v1"') {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const body = JSON.stringify(metadata(url));
  const empty = (async function* () {})();
  const deps: FetchDeps = {
    lookup: async () => [{ address: PUBLIC_IP, family: 4 }],
    transport: async (request) => {
      requests.push({ url: request.url.href, headers: request.headers });
      if (request.headers["if-none-match"] === etag) return { status: 304, headers: { etag }, body: empty, close: () => {} };
      return {
        status: 200,
        headers: { ...JSON_TYPE, etag, ...headers },
        body: (async function* () {
          yield new TextEncoder().encode(body);
        })(),
        close: () => {},
      };
    },
  };
  return { deps, requests };
}

// The requests a fake network has seen, for these addresses.
const seenFor = (fake: FakeNet, urls: string[]) => fake.requests.filter((r) => urls.includes(r.url.href)).length;

describe("only a client somebody allowed is left alone by the gate", () => {
  const forgotten = async (clientId: string) => (await prisma.oauthConsent.count({ where: { clientId } })) === 0;

  // An anonymous authorize saves a row for a valid document and nobody has allowed it.
  async function rowNobodyAllowed(url: string) {
    expect((await anonymousAuthorize(url)).status).toBe(302);
    expect(await clientRows(url)).toBe(1);
    expect(await forgotten(url)).toBe(true);
  }

  it("the scenario that drained the budget: documents nobody allowed, then anonymous requests naming them, then a real refresh", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const good = nextUrl();
    const evil = Array.from({ length: 18 }, () => `https://junk-${++counter}.attacker.example/c.json`);
    const pages: Record<string, FakeReply> = { [good]: jsonReply(metadata(good), { "cache-control": "no-store" }) };
    for (const e of evil) pages[e] = jsonReply(metadata(e), { "cache-control": "no-store" });
    const fake = serve(pages);
    const connected = await connectDocument(good);

    // Minute 1: valid documents on other hosts, asked for without signing in. Rows are saved, nobody allows them.
    vi.setSystemTime(Date.now() + 61_000);
    for (const e of evil) expect((await anonymousAuthorize(e)).status).toBe(302);
    expect(await prisma.oauthClient.count({ where: { clientId: { in: evil } } })).toBe(18);
    expect(await prisma.oauthConsent.count({ where: { clientId: { in: evil } } })).toBe(0);
    const firstMinute = seenFor(fake, evil);
    expect(firstMinute).toBeLessThanOrEqual(NEW_CLIENT_FETCHES_PER_MINUTE);

    // Minute 2: 72 authorizes and 72 token requests name those ids.
    vi.setSystemTime(Date.now() + 61_000);
    const tokenAnswers: string[] = [];
    for (let i = 0; i < 72; i++) {
      const id = evil[i % evil.length];
      await anonymousAuthorize(id);
      const answer = await send("oauth2/token", formBody({ grant_type: "refresh_token", refresh_token: "nope", client_id: id }));
      tokenAnswers.push((await answer.json()).error);
    }
    // The token requests were answered with no fetch at all, and the junk ids cost no more than the share.
    expect(new Set(tokenAnswers)).toEqual(new Set(["invalid_client"]));
    expect(seenFor(fake, evil) - firstMinute).toBeLessThanOrEqual(NEW_CLIENT_FETCHES_PER_MINUTE);

    // The real client's document has gone stale by now. Its refresh needs a fetch, and gets one.
    vi.setSystemTime(Date.now() + 183_000);
    const before = seenFor(fake, [good]);
    const renewed = await refresh(good, connected.refreshToken);
    expect(renewed.status).toBe(200);
    expect(seenFor(fake, [good]) - before).toBe(1);
  });

  it("a row nobody allowed: token, revoke, introspect and end-session answer invalid_client with no fetch", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = nextUrl();
    const fake = serve({ [url]: jsonReply(metadata(url)) });
    await rowNobodyAllowed(url);
    const fetched = fake.requests.length;

    const asForm = await send("oauth2/token", formBody({ grant_type: "refresh_token", refresh_token: "nope", client_id: url }));
    const withBasic = await send("oauth2/token", {
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${encodeURIComponent(url)}:`).toString("base64")}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "nope" }),
    });
    const revoke = await send("oauth2/revoke", formBody({ token: "nope", client_id: url }));
    const introspect = await send("oauth2/introspect", formBody({ token: "nope", client_id: url }));
    const endSession = await auth.handler(new Request(new URL(`/api/auth/oauth2/end-session?client_id=${encodeURIComponent(url)}`, appUrl()), { headers: fromNewIp() }));
    for (const response of [asForm, withBasic, revoke, introspect, endSession]) {
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect((await response.json()).error).toBe("invalid_client");
    }
    expect(asForm.status).toBe(400);
    expect(withBasic.status).toBe(401);
    expect(withBasic.headers.get("www-authenticate")).toBe("Basic");
    expect(fake.requests).toHaveLength(fetched);
  });

  // The share is 30 slots a minute. One row nobody allowed takes the first when it is made, and
  // other addresses take all but `slots` of the rest. The request under test must take exactly
  // those, and then the next one is told to wait.
  async function takesSlots(slots: number, request: (url: string, ctx: { location: URL; headers: Headers }) => Promise<Response>) {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = nextUrl();
    serve({ [url]: jsonReply(metadata(url)) });
    const { location, headers } = await authorize(url, "ownerA", { scope: ALL, challenge: pkce().challenge });
    // authorize took one slot.
    for (let i = 0; i < NEW_CLIENT_FETCHES_PER_MINUTE - 1 - slots; i++) await anonymousAuthorize(junkUrl());
    const allowed = await request(url, { location, headers });
    expect(await allowed.clone().text()).not.toContain("temporarily_unavailable");
    expect(await allowed.clone().text()).not.toContain("client not found");
    expect(allowed.status).not.toBe(429);
    const refused = await request(url, { location, headers });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("60");
    expect(await clientRows(url)).toBe(1);
  }

  const asOwner = async () => ({ ...Object.fromEntries(await signedInHeaders("ownerA")), ...fromNewIp() });

  it("consent still works for it, and takes a slot", async () => {
    await takesSlots(1, async (_url, { location }) =>
      auth.handler(
        new Request(new URL("/api/auth/oauth2/consent", appUrl()), {
          method: "POST",
          headers: { ...(await asOwner()), "content-type": "application/json", accept: "application/json" },
          // Deny: the page is answered and no consent row is saved.
          body: JSON.stringify({ accept: false, oauth_query: location.search.slice(1) }),
        }),
      ),
    );
    expect(await prisma.oauthConsent.count()).toBe(0);
  });

  // The plugin runs authorize again from inside continue, through the same hook, so one continue takes two slots.
  it("continue still works for it, and takes two slots", async () => {
    await takesSlots(2, async (_url, { location }) =>
      auth.handler(
        new Request(new URL("/api/auth/oauth2/continue", appUrl()), {
          method: "POST",
          headers: { ...(await asOwner()), "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ postLogin: true, oauth_query: location.search.slice(1) }),
        }),
      ),
    );
  });

  it("public-client still works for it, and takes a slot", async () => {
    await takesSlots(1, async (url) =>
      auth.handler(new Request(new URL(`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(url)}`, appUrl()), { headers: await asOwner() })),
    );
  });

  it("an address with no row is refused on the four lookup endpoints that are not authorize, with no fetch", async () => {
    const fake = serve({});
    const id = junkUrl();
    const oauthQuery = `client_id=${encodeURIComponent(id)}`;
    const json = { headers: { "content-type": "application/json" } };
    const answers = [
      await auth.handler(new Request(new URL(`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(id)}`, appUrl()), { headers: await asOwner() })),
      await send("oauth2/public-client-prelogin", { ...json, body: JSON.stringify({ client_id: id, oauth_query: oauthQuery }) }),
      await send("oauth2/consent", { ...json, body: JSON.stringify({ accept: false, oauth_query: oauthQuery }) }),
      await send("oauth2/continue", { ...json, body: JSON.stringify({ postLogin: true, oauth_query: oauthQuery }) }),
    ];
    for (const response of answers) expect((await response.json()).error).toBe("invalid_client");
    expect(fake.requests).toEqual([]);
    expect(await clientRows(id)).toBe(0);
  });

  it("public-client-prelogin is let through for it and takes a slot", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = nextUrl();
    serve({ [url]: jsonReply(metadata(url)) });
    await rowNobodyAllowed(url);
    for (let i = 0; i < NEW_CLIENT_FETCHES_PER_MINUTE - 2; i++) await anonymousAuthorize(junkUrl());
    // Coppice leaves the plugin's own pre-login lookup switched off, so what it answers is the plugin's refusal, not the gate's.
    const lookup = () => send("oauth2/public-client-prelogin", { headers: { "content-type": "application/json" }, body: JSON.stringify({ client_id: url, oauth_query: "x" }) });
    const first = await lookup();
    expect(first.status).not.toBe(429);
    expect((await first.text()).includes("client not found")).toBe(false);
    expect((await lookup()).status).toBe(429);
  });

  it("five first connects in one minute all succeed, then the share runs out with a retry time and opens a minute later", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const urls = Array.from({ length: 5 }, () => nextUrl());
    serve(Object.fromEntries(urls.map((u) => [u, jsonReply(metadata(u))])));
    for (const url of urls) {
      // What a person's browser does: open authorize, come back from sign-in through continue, ask for the client's details on the consent page, and allow it.
      const { verifier, challenge } = pkce();
      const { location, headers } = await authorize(url, "ownerA", { scope: ALL, challenge });
      expect(location.pathname).toBe("/oauth/consent");
      const onward = await auth.handler(
        new Request(new URL("/api/auth/oauth2/continue", appUrl()), {
          method: "POST",
          headers: { ...Object.fromEntries(headers), "content-type": "application/json", accept: "application/json", ...fromNewIp() },
          body: JSON.stringify({ postLogin: true, oauth_query: location.search.slice(1) }),
        }),
      );
      expect(onward.status).toBe(200);
      const details = await auth.handler(new Request(new URL(`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(url)}`, appUrl()), { headers: { ...Object.fromEntries(headers), ...fromNewIp() } }));
      expect(details.status).toBe(200);
      const code = (await consent(location, headers, true)).searchParams.get("code") as string;
      expect((await exchangeCode(url, code, verifier)).status).toBe(200);
    }
    // Each took five slots (authorize 1, continue 2, the details 1, the consent 1). The rest of the share is still there, and then it is used up.
    let answered = 0;
    while ((await anonymousAuthorize(junkUrl())).status !== 429) answered++;
    expect(answered).toBe(NEW_CLIENT_FETCHES_PER_MINUTE - 5 * 5);
    const over = await anonymousAuthorize(junkUrl());
    expect(over.status).toBe(429);
    expect(over.headers.get("retry-after")).toBe("60");
    vi.setSystemTime(Date.now() + 61_000);
    expect((await anonymousAuthorize(junkUrl())).status).toBe(400);
  });

  it("after Disconnect the client is treated as not connected, and connecting again works", async () => {
    const url = nextUrl();
    const fake = serve({ [url]: jsonReply(metadata(url)) });
    const first = await connectDocument(url);
    expect((await asUser("ownerA", () => disconnectAssistant(null, form({ workspaceId: "a", clientId: url })))).ok).toBe(true);
    expect(await forgotten(url)).toBe(true);
    const fetched = fake.requests.length;

    const refused = await refresh(url, first.refreshToken);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("invalid_client");
    expect(fake.requests).toHaveLength(fetched);

    // The row is still there, so authorize is let through and the person can allow it again.
    const again = await connectDocument(url);
    expect(again.accessToken).toBeTruthy();
    expect((await refresh(url, again.refreshToken)).status).toBe(200);
  });

  // The plugin reads the user part of a Basic header with URLSearchParams, which leaves a bad
  // escape as it is, and drops a leading byte order mark. The gate has to see the same address.
  const basic = (user: string) => `Basic ${Buffer.from(`${user}:secret`).toString("base64")}`;
  const hostFor = () => `junk-${++counter}.attacker.example`;
  const disguised: [string, (host: string) => string][] = [
    ["a bad escape at the end", (host) => `https%3A//${host}/c.json%zz`],
    ["a lone percent sign", (host) => `https%3A//${host}/c.json%`],
    ["an escape that is not UTF-8", (host) => `https%3A//${host}/c.json%C0`],
    ["an escape that is not UTF-8, in the middle", (host) => `https%3A//${host}/%C0/c.json`],
    ["a leading byte order mark", (host) => `\uFEFFhttps%3A//${host}/c.json`],
    ["the scheme in capitals", (host) => `HTTPS%3A//${host}/c.json%zz`],
    ["plus signs", (host) => `https%3A//${host}/c+c.json%zz`],
  ];
  const BASIC_PATHS = ["oauth2/token", "oauth2/revoke", "oauth2/introspect"];

  describe.each(BASIC_PATHS)("%s with a Basic user that hides an address", (path) => {
    test.each(disguised)("%s is refused with no fetch", async (_name, build) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const fake = serve({});
      const id = build(hostFor());
      const fields: Record<string, string> = path === "oauth2/token" ? { grant_type: "refresh_token", refresh_token: "nope" } : { token: "nope" };
      const response = await send(path, { headers: { "content-type": "application/x-www-form-urlencoded", authorization: basic(id) }, body: new URLSearchParams(fields) });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Basic");
      const body = await response.json();
      expect(body.error).toBe("invalid_client");
      expect(body.error_description).toBe("client not found");
      expect(fake.requests).toEqual([]);
      expect(await prisma.oauthClient.count({ where: { clientId: { contains: "attacker.example" } } })).toBe(0);
    });
  });

  it("128 anonymous token requests with bad escapes in the Basic user can't reach the budget or stop a refresh", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const good = nextUrl();
    const fake = serve({ [good]: jsonReply(metadata(good), { "cache-control": "no-store" }) });
    const connected = await connectDocument(good);
    vi.setSystemTime(Date.now() + (CACHE_FLOOR_SECONDS + 1) * 1000);
    const fetched = fake.requests.length;
    for (let i = 0; i < 128; i++) {
      const response = await send("oauth2/token", {
        headers: { "content-type": "application/x-www-form-urlencoded", authorization: basic(`https%3A//${hostFor()}/c.json%zz`) },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "nope" }),
      });
      expect(response.status).toBe(401);
    }
    expect(fake.requests).toHaveLength(fetched);
    expect((await refresh(good, connected.refreshToken)).status).toBe(200);
  });

  describe("a Basic user that mentions https is refused on the connected-only paths unless it names a connected client", () => {
    const guard = (user: string, path = "/oauth2/token") =>
      guardClientLookup(path, { request: new Request("https://coppice.test/api/auth" + path, { method: "POST", headers: { authorization: basic(user) } }) });

    test.each(["https", "HTTPS", "xhttps:", "ht%74ps", "ht%74ps%zz", "a b https", "https:", "https:///", "https%3A%2F%2F"])("%s", async (user) => {
      await expect(guard(user)).rejects.toMatchObject({ body: { error: "invalid_client" }, headers: { "WWW-Authenticate": "Basic" } });
    });

    it("lets a user through that mentions nothing of the kind", async () => {
      await expect(guard("assistant-registered-1")).resolves.toBeUndefined();
    });

    it("lets a connected client through when its address is form-encoded", async () => {
      const url = nextUrl();
      serve({ [url]: jsonReply(metadata(url)) });
      await connectDocument(url);
      await expect(guard(encodeURIComponent(url))).resolves.toBeUndefined();
      await expect(guard(encodeURIComponent(url).replace(/%3A/g, "%3a"))).resolves.toBeUndefined();
      // Written plainly, the first colon ends the user part, so the plugin would read "https".
      await expect(guard(url)).rejects.toMatchObject({ body: { error: "invalid_client" } });
      // The plugin answers it itself: a public client may not send a secret.
      const response = await send("oauth2/token", {
        headers: { "content-type": "application/x-www-form-urlencoded", authorization: basic(encodeURIComponent(url)) },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "nope" }),
      });
      expect((await response.json()).error_description).not.toBe("client not found");
    });

    it("does not apply to the paths that let a new assistant start", async () => {
      await expect(guard("https", "/oauth2/consent")).resolves.toBeUndefined();
    });
  });
});

// ----- How long a checked document is reused (lib/mcp/cimd-fetch.ts) -----

describe("the freshness the transport hands the plugin", () => {
  const NOW = Date.parse("2026-03-01T12:00:00Z");
  const inMinutes = (minutes: number) => new Date(NOW + minutes * 60_000).toUTCString();

  test.each([
    ["no-store", { cacheControl: "no-store" }, CACHE_FLOOR_SECONDS],
    ["no-store with a max-age", { cacheControl: "max-age=3000, no-store" }, CACHE_FLOOR_SECONDS],
    ["private", { cacheControl: "private, max-age=3000" }, CACHE_FLOOR_SECONDS],
    ["no-cache", { cacheControl: "no-cache" }, CACHE_FLOOR_SECONDS],
    ["vary *", { cacheControl: "max-age=3000", vary: "*" }, CACHE_FLOOR_SECONDS],
    ["vary of one field", { cacheControl: "max-age=600", vary: "Accept" }, 600],
    ["max-age=0", { cacheControl: "max-age=0" }, CACHE_FLOOR_SECONDS],
    ["max-age=10", { cacheControl: "public, max-age=10" }, CACHE_FLOOR_SECONDS],
    ["max-age=600", { cacheControl: "max-age=600" }, 600],
    ["a quoted max-age", { cacheControl: 'max-age="900"' }, 900],
    ["max-age=7200", { cacheControl: "max-age=7200" }, CACHE_CEILING_SECONDS],
    ["s-maxage over a longer max-age", { cacheControl: "max-age=3000, s-maxage=900" }, 900],
    ["s-maxage over a shorter max-age", { cacheControl: "max-age=400, s-maxage=1800" }, 1800],
    ["a duplicated max-age", { cacheControl: "max-age=3000, max-age=3000" }, CACHE_FLOOR_SECONDS],
    ["a max-age that is not a number", { cacheControl: "max-age=soon" }, CACHE_FLOOR_SECONDS],
    ["a negative max-age", { cacheControl: "max-age=-5" }, CACHE_FLOOR_SECONDS],
    ["a max-age with no value", { cacheControl: "max-age" }, CACHE_FLOOR_SECONDS],
    ["an invalid s-maxage next to a good max-age", { cacheControl: "s-maxage=x, max-age=3000" }, CACHE_FLOOR_SECONDS],
    ["an Expires in the past", { expires: inMinutes(-5) }, CACHE_FLOOR_SECONDS],
    ["an Expires in 20 minutes", { expires: inMinutes(20) }, 1200],
    ["an Expires in a day", { expires: inMinutes(24 * 60) }, CACHE_CEILING_SECONDS],
    ["max-age over Expires", { cacheControl: "max-age=700", expires: inMinutes(50) }, 700],
    ["an Expires that is not a date", { expires: "never" }, CACHE_CEILING_SECONDS],
    ["an Age larger than the max-age", { cacheControl: "max-age=600", age: "900" }, CACHE_FLOOR_SECONDS],
    ["an Age taken off the max-age", { cacheControl: "max-age=1200", age: "400" }, 800],
    ["an Age that is not a number", { cacheControl: "max-age=1200", age: "old" }, 1200],
    ["nothing at all", {}, CACHE_CEILING_SECONDS],
  ] satisfies [string, Parameters<typeof cacheLifetimeSeconds>[0], number][])("%s", (_name, headers, seconds) => {
    expect(cacheLifetimeSeconds(headers, NOW)).toBe(seconds);
  });

  it("floor and ceiling are five and sixty minutes", () => {
    expect([CACHE_FLOOR_SECONDS, CACHE_CEILING_SECONDS]).toEqual([300, 3600]);
  });

  async function reply(status: number, headers: Record<string, string>) {
    const url = nextUrl();
    const fake = serve({ [url]: { status, headers: status === 200 ? { ...JSON_TYPE, ...headers } : headers, chunks: status === 200 ? [JSON.stringify(metadata(url))] : [] } });
    return createCimdFetch(fake.deps, FAST)(url, { headers: { "If-None-Match": '"v1"' } });
  }

  it("a 200 carries the content type and validators as they came, and one cache header of Coppice's own", async () => {
    const response = await reply(200, {
      etag: '"v1"',
      "last-modified": "Mon, 01 Jan 2024 00:00:00 GMT",
      "cache-control": "no-store, private",
      expires: "Thu, 01 Jan 1970 00:00:00 GMT",
      date: new Date().toUTCString(),
      age: "5",
      vary: "*",
    });
    expect(Object.fromEntries(response.headers)).toEqual({
      "content-type": "application/json",
      etag: '"v1"',
      "last-modified": "Mon, 01 Jan 2024 00:00:00 GMT",
      "cache-control": `max-age=${CACHE_FLOOR_SECONDS}`,
    });
  });

  it("a 200 with a long max-age is kept for the origin's time", async () => {
    expect((await reply(200, { "cache-control": "max-age=1200" })).headers.get("cache-control")).toBe("max-age=1200");
    expect((await reply(200, {})).headers.get("cache-control")).toBe(`max-age=${CACHE_CEILING_SECONDS}`);
  });

  test.each([
    ["a max-age under the floor", { etag: '"v1"', "cache-control": "max-age=30" }, `max-age=${CACHE_FLOOR_SECONDS}`],
    ["no-store", { "cache-control": "no-store" }, `max-age=${CACHE_FLOOR_SECONDS}`],
    ["a max-age of 20 minutes", { "cache-control": "max-age=1200", date: new Date().toUTCString() }, "max-age=1200"],
    ["a max-age of 7200", { "cache-control": "max-age=7200" }, `max-age=${CACHE_CEILING_SECONDS}`],
    ["neither cache-control nor expires", { etag: '"v1"', age: "20", vary: "*", date: new Date().toUTCString() }, null],
    ["nothing at all", {}, null],
  ])("a 304 with %s", async (_name, headers, expected) => {
    const response = await reply(304, headers);
    expect(response.status).toBe(304);
    expect(response.headers.get("cache-control")).toBe(expected);
    for (const name of ["expires", "date", "age", "vary"]) expect(response.headers.get(name)).toBeNull();
  });

  it("a 304 with an Expires in 20 minutes", async () => {
    const response = await reply(304, { expires: new Date(Date.now() + 20 * 60_000).toUTCString() });
    // The date is written to the second, so a part of a second is lost.
    expect(response.headers.get("cache-control")).toMatch(/^max-age=(1199|1200)$/);
  });

  test.each([302, 404, 429, 500])("a %i carries no headers at all", async (status) => {
    const response = await reply(status, { "cache-control": "max-age=999", etag: '"v1"', location: "https://elsewhere.example/" });
    expect(response.status).toBe(status);
    expect([...response.headers.keys()]).toEqual([]);
  });

  it("a connected assistant with a no-store document is fetched once for twenty lookups, and once more after the floor", async () => {
    const url = nextUrl();
    const fake = conditionalNet(url, { "cache-control": "no-store" });
    net.fetch = createCimdFetch(fake.deps, FAST);
    const connected = await connectDocument(url);
    expect(fake.requests).toHaveLength(1);

    // Twenty lookups inside five minutes: ten authorize links and ten refreshes.
    let refreshToken = connected.refreshToken;
    for (let i = 0; i < 10; i++) {
      vi.setSystemTime(Date.now() + 20_000);
      expect((await startAuthorize(url)).status).toBe(302);
      const renewed = await refresh(url, refreshToken);
      expect(renewed.status).toBe(200);
      refreshToken = renewed.body.refresh_token;
    }
    expect(fake.requests).toHaveLength(1);

    // Past the floor the plugin asks again, with the validator it kept, and the 304 keeps the document.
    vi.setSystemTime(Date.now() + CACHE_FLOOR_SECONDS * 1000);
    expect((await refresh(url, refreshToken)).status).toBe(200);
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[0].headers["if-none-match"]).toBeUndefined();
    expect(fake.requests[1].headers["if-none-match"]).toBe('"v1"');
    // And that answer is reused for the next five minutes again.
    for (let i = 0; i < 5; i++) expect((await startAuthorize(url)).status).toBe(302);
    expect(fake.requests).toHaveLength(2);
  });

  it("one account that allows 12 no-store documents, and 200 anonymous token requests naming them", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const urls = Array.from({ length: 12 }, () => nextUrl());
    const fake = serve(Object.fromEntries(urls.map((u) => [u, jsonReply(metadata(u), { "cache-control": "no-store" })])));
    const connected = [];
    for (const url of urls) connected.push(await connectDocument(url));
    expect(fake.requests).toHaveLength(12);

    // Inside a minute: the documents are still fresh, so nothing is fetched.
    for (let i = 0; i < 200; i++) {
      const answer = await send("oauth2/token", formBody({ grant_type: "refresh_token", refresh_token: "nope", client_id: urls[i % 12] }));
      expect((await answer.json()).error).toBe("invalid_grant");
    }
    expect(fake.requests).toHaveLength(12);
    expect((await refresh(urls[0], connected[0].refreshToken)).status).toBe(200);

    // After the floor each document may be asked for once, however many requests name it.
    vi.setSystemTime(Date.now() + (CACHE_FLOOR_SECONDS + 1) * 1000);
    for (let i = 0; i < 200; i++) await send("oauth2/token", formBody({ grant_type: "refresh_token", refresh_token: "nope", client_id: urls[i % 12] }));
    expect(fake.requests.length - 12).toBeLessThanOrEqual(12);
    for (const url of urls) expect(seenFor(fake, [url])).toBeLessThanOrEqual(2);
    expect((await refresh(urls[1], connected[1].refreshToken)).status).toBe(200);
  });
});

// ----- With real sockets on loopback -----

// A metadata server on 127.0.0.1. The app's own transport (nodeTransport) connects to it for real,
// after the name has been looked up as a public address, so redirects, headers and sockets are the
// ones production code uses; only where the connection ends up is changed.
let server: Server;
let serverPort = 0;
const hits: { path: string; headers: IncomingHttpHeaders }[] = [];
const documents = new Map<string, { status?: number; headers?: Record<string, string>; body: string }>();
let rawServer: TcpServer;
let rawPort = 0;

function toLocal(port: () => number): FetchDeps {
  return {
    lookup: async () => [{ address: PUBLIC_IP, family: 4 }],
    transport: (request) =>
      nodeTransport({
        ...request,
        url: new URL(`http://127.0.0.1:${port()}${request.url.pathname}${request.url.search}`),
        address: { address: "127.0.0.1", family: 4 },
      }),
  };
}

beforeAll(async () => {
  server = createHttpServer((req, res) => {
    const path = req.url ?? "/";
    hits.push({ path, headers: req.headers });
    const doc = documents.get(path.split("?")[0]);
    if (!doc) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(doc.status ?? 200, doc.headers ?? { "content-type": "application/json" }).end(doc.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  serverPort = (server.address() as AddressInfo).port;
  // A server that answers with a status HTTP does not have: "HTTP/1.1 600 Nope".
  rawServer = createTcpServer((socket) => {
    socket.on("error", () => {});
    socket.once("data", () => socket.end("HTTP/1.1 600 Nope\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"));
  });
  await new Promise<void>((resolve) => rawServer.listen(0, "127.0.0.1", resolve));
  rawPort = (rawServer.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => rawServer.close(resolve));
});

// A document served from the loopback server at a path of its own, named by a https URL on a
// fresh site. `longPath` makes the client id longer than the 64 characters of a generated id.
function localDocument(extra: Record<string, unknown> = {}, { longPath = false }: { longPath?: boolean } = {}) {
  const path = `/${longPath ? "oauth/assistants/metadata/documents/" : ""}t${counter + 1}/client.json`;
  const url = `https://local-${++counter}.example${path}`;
  documents.set(path, { body: JSON.stringify(metadata(url, extra)), headers: { ...JSON_TYPE, "cache-control": "max-age=600", etag: '"v1"', date: new Date().toUTCString() } });
  net.fetch = createCimdFetch(toLocal(() => serverPort));
  return { url, path };
}

describe("a real socket", () => {
  it("a status outside 200 to 599 is a refusal, the process goes on, and the next client works", async () => {
    // Node's own client does read the status (the packaged transport made a Response from it and threw).
    const direct = await nodeTransport({
      url: new URL(`http://127.0.0.1:${rawPort}/`),
      address: { address: "127.0.0.1", family: 4 },
      headers: {},
      signal: AbortSignal.timeout(2000),
      connectTimeoutMs: 1000,
    });
    expect(direct.status).toBe(600);
    direct.close();

    const bad = nextUrl();
    net.fetch = createCimdFetch(toLocal(() => rawPort));
    await expectRefused(bad);

    const good = localDocument();
    expect((await startAuthorize(good.url)).status).toBe(302);
    expect(await clientRows(good.url)).toBe(1);
  });

  it("sends a generic request: its own identity, no cookies, no compression", async () => {
    hits.length = 0;
    const { url, path } = localDocument();
    expect((await startAuthorize(url)).status).toBe(302);
    expect(hits.map((h) => h.path)).toEqual([path]);
    const sent = hits[0].headers;
    expect(sent["user-agent"]).toBe("Coppice/1.0");
    expect(sent.accept).toBe("application/json");
    expect(sent["accept-encoding"]).toBe("identity");
    expect(sent.cookie).toBeUndefined();
    expect(sent.authorization).toBeUndefined();
  });

  it("a server that answers with a redirect is not followed", async () => {
    hits.length = 0;
    const path = `/redirect-${++counter}/client.json`;
    documents.set(path, { status: 302, headers: { location: `http://127.0.0.1:${serverPort}/secret` }, body: "" });
    documents.set("/secret", { body: "{}" });
    net.fetch = createCimdFetch(toLocal(() => serverPort));
    await expectRefused(`https://local-${++counter}.example${path}`, "invalid_client", /returned HTTP 302/);
    expect(hits.map((h) => h.path)).toEqual([path]);
    documents.delete("/secret");
  });
});

describe("a full connection with a metadata document", () => {
  it("authorize, consent, token, the official client, refresh, and one fetch in all", async () => {
    hits.length = 0;
    const { url, path } = localDocument();
    const { verifier, challenge } = pkce();

    const { location, headers } = await authorize(url, "ownerA", { scope: ALL, challenge });
    expect(location.pathname).toBe("/oauth/consent");
    const back = await consent(location, headers, true);
    const code = back.searchParams.get("code") as string;
    expect(code).toBeTruthy();

    const token = await exchangeCode(url, code, verifier);
    expect(token.status).toBe(200);
    expect(token.body.access_token).toBeTruthy();
    expect(token.body.refresh_token).toBeTruthy();
    // The token is for this client and this person, bound to the MCP URL.
    const claims = JSON.parse(Buffer.from(token.body.access_token.split(".")[1], "base64url").toString());
    expect(claims).toMatchObject({ azp: url, sub: "ownerA" });
    expect(claims.aud).toContain(mcpResourceUrl());

    const row = await prisma.oauthClient.findFirstOrThrow({ where: { clientId: url } });
    expect(row).toMatchObject({ clientDiscoveryId: "cimd", tokenEndpointAuthMethod: "none", clientSecret: null, name: "Doc Assistant", redirectUris: [REDIRECT_URI] });

    const client = await mcpClient(token.body.access_token);
    expect((await client.listTools()).tools).toHaveLength(8);

    const renewed = await refresh(url, token.body.refresh_token);
    expect(renewed.status).toBe(200);
    expect(renewed.body.access_token).toBeTruthy();

    // A second sign-in within the cache time makes no new fetch either.
    const second = await authorize(url, "officerA", { scope: ALL, challenge: pkce().challenge });
    expect(second.location.pathname).toBe("/oauth/consent");
    expect(hits.filter((h) => h.path === path)).toHaveLength(1);
  });

  it("both discovery documents say that metadata documents are supported", async () => {
    const openid = await auth.handler(new Request(new URL("/api/auth/.well-known/openid-configuration", appUrl())));
    expect((await openid.json()).client_id_metadata_document_supported).toBe(true);
    const server = await authServerMetadataRoute(new Request(new URL("/.well-known/oauth-authorization-server/api/auth", appUrl())), {
      params: Promise.resolve({ path: ["api", "auth"] }),
    });
    expect(server.status).toBe(200);
    expect((await server.json()).client_id_metadata_document_supported).toBe(true);
  });

  it("registration still works next to it", async () => {
    const { status, body } = await registerClient({ client_name: "Registered Assistant" });
    expect(status).toBe(201);
    expect(body.client_id).toEqual(expect.any(String));
  });

  it("a session token is still refused at the MCP endpoint", async () => {
    const { url } = localDocument();
    await connectDocument(url);
    const { token } = await auth.api.signJWT({
      body: { payload: { sub: "ownerA", iss: new URL("/api/auth", appUrl()).toString(), aud: mcpResourceUrl(), scope: "coppice:read coppice:write" } },
    });
    const { status, json } = await mcpPost({ jsonrpc: "2.0", id: 1, method: "tools/list" }, token);
    expect(status).toBe(401);
    expect(json.error.message).toBe("invalid access token");
  });

  it("a site that refuses connections is a clean refusal", async () => {
    // A site that is down answers an unknown address, never a crash, and saves nothing.
    net.fetch = createCimdFetch({ lookup: async () => [{ address: PUBLIC_IP, family: 4 }], transport: async () => Promise.reject(new Error("ECONNREFUSED")) });
    await expectRefused(nextUrl());
  });
});

describe("how a metadata-document assistant appears to its owner", () => {
  async function consentMarkup(clientId: string, userId = "ownerA") {
    const { location } = await authorize(clientId, userId, { scope: ALL, challenge: pkce().challenge });
    expect(location.pathname).toBe("/oauth/consent");
    // The signed query exactly as sent: repeated keys stay repeated.
    const search: Record<string, string | string[]> = {};
    for (const key of new Set(location.searchParams.keys())) search[key] = location.searchParams.getAll(key);
    const element = await asUser(userId, async () => ConsentPage({ searchParams: Promise.resolve(search) } as Parameters<typeof ConsentPage>[0]));
    return renderToStaticMarkup(element);
  }

  it("the consent page names the document's site and says what that does and doesn't prove", async () => {
    const { url } = localDocument({ client_name: "Doc Assistant" });
    const markup = await consentMarkup(url);
    const host = new URL(url).host;
    expect(markup).toContain("Its details come from");
    expect(markup).toContain(`<bdi>${host}</bdi>`);
    expect(markup).toContain("Doc Assistant");
    expect(markup).toContain("an app on this computer (127.0.0.1:43123)");
    expect(markup).toContain("is written by the app itself");
    expect(markup).not.toContain("any app can call itself");
    // The document's own images are never loaded.
    expect(markup).not.toContain("<img");
  });

  it("a registered assistant gets no such line, and the plain warning", async () => {
    const client = await registerClient({ client_name: "Registered Assistant" });
    const markup = await consentMarkup(client.body.client_id as string);
    expect(markup).not.toContain("Its details come from");
    expect(markup).toContain("any app can call itself");
  });

  it("Settings lists it with the document's name, where it returns to and its site", async () => {
    const { url } = localDocument({ client_name: "Doc Assistant" }, { longPath: true });
    expect(url.length).toBeGreaterThan(64);
    await connectDocument(url);
    const [connection] = await listConnections("ownerA");
    expect(connection).toMatchObject({
      clientId: url,
      name: "Doc Assistant",
      returnsTo: "an app on this computer",
      identifiedBy: new URL(url).host,
      canWrite: true,
    });
  });

  it("Disconnect works for a client id longer than 64 characters, and the assistant is then locked out", async () => {
    const { url } = localDocument({}, { longPath: true });
    expect(url.length).toBeGreaterThan(64);
    const { accessToken, refreshToken } = await connectDocument(url);
    expect(await rowsFor("ownerA", url)).toMatchObject({ consents: 1 });
    expect((await mcpPost({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, accessToken, { "mcp-protocol-version": "2025-06-18" })).status).toBe(200);

    const result = await asUser("ownerA", () => disconnectAssistant(null, form({ workspaceId: "a", clientId: url })));
    expect(result).toEqual({ ok: true, data: undefined });
    expect(await rowsFor("ownerA", url)).toEqual({ consents: 0, accessTokens: 0, refreshTokens: 0 });

    const refused = await mcpPost({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, accessToken, { "mcp-protocol-version": "2025-06-18" });
    expect(refused.status).toBe(401);
    expect(refused.json.error.message).toMatch(/revoked/);
    // With the only consent gone nobody has connected this client, so the gate answers before the plugin looks at the token.
    const renewed = await refresh(url, refreshToken);
    expect(renewed.status).toBe(400);
    expect(renewed.body.error).toBe("invalid_client");
    expect(await listConnections("ownerA")).toEqual([]);

    // Nothing is left to disconnect the second time.
    expect(await asUser("ownerA", () => disconnectAssistant(null, form({ workspaceId: "a", clientId: url })))).toEqual({ ok: false, error: NOT_CONNECTED });
  });

  it("Disconnect leaves another person's connection to the same document alone", async () => {
    const { url } = localDocument();
    const owner = await connectDocument(url, "ownerA");
    const officer = await connectDocument(url, "officerA");
    await asUser("ownerA", () => disconnectAssistant(null, form({ workspaceId: "a", clientId: url })));
    expect((await rowsFor("officerA", url)).consents).toBe(1);
    expect((await refresh(url, officer.refreshToken)).status).toBe(200);
    expect((await refresh(url, owner.refreshToken)).body.error).toBe("invalid_grant");
  });

  it("Better Auth's own delete-consent also ends the tokens of a metadata-document client", async () => {
    const { url } = localDocument();
    const { refreshToken } = await connectDocument(url);
    const row = await prisma.oauthConsent.findFirstOrThrow({ where: { userId: "ownerA", clientId: url }, select: { id: true } });
    const headers = await signedInHeaders("ownerA");
    const response = await auth.handler(
      new Request(new URL("/api/auth/oauth2/delete-consent", appUrl()), {
        method: "POST",
        headers: { ...Object.fromEntries(headers), "content-type": "application/json", ...fromNewIp() },
        body: JSON.stringify({ id: row.id }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await rowsFor("ownerA", url)).toEqual({ consents: 0, accessTokens: 0, refreshTokens: 0 });
    // The only consent is gone, so the client is not connected and the gate answers invalid_client.
    expect((await refresh(url, refreshToken)).body.error).toBe("invalid_client");
    // And the clean-up is safe to run again.
    expect(await endGrantsWithoutConsent("ownerA", url)).toEqual({ accessTokens: 0, refreshTokens: 0 });
  });
});
