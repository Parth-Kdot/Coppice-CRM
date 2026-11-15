import { createServer as createHttpServer, type IncomingHttpHeaders, type Server } from "node:http";
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer } from "node:net";
import { APIError } from "better-auth/api";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test, vi } from "vitest";
import ConsentPage from "@/app/(auth)/oauth/consent/page";
import { disconnectAssistant } from "@/app/(app)/[workspaceId]/settings/assistant-actions";
import { GET as authServerMetadataRoute } from "@/app/.well-known/oauth-authorization-server/[[...path]]/route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CACHE_CEILING_SECONDS, CACHE_FLOOR_SECONDS, CIMD_LIMITS, cacheLifetimeSeconds, createCimdFetch, metadataUrlProblem } from "@/lib/mcp/cimd-fetch";
import {
  CONNECTED_FETCHES_PER_MINUTE,
  FAILING_CONNECTED_FETCHES_PER_MINUTE,
  MAX_DOCUMENT_CLIENTS_PER_ACCOUNT,
  MAX_FAILING_MARKS,
  NEW_CLIENT_FETCHES_PER_MINUTE,
  NEW_CLIENT_FETCHES_PER_SITE_PER_MINUTE,
  allowDocumentFetch,
  cimdBudgetSnapshot,
  clearFailingMark,
  createConsentWithinCap,
  resetCimdBudgets,
} from "@/lib/mcp/cimd-budget";
import { NEW_CLIENT_REQUESTS_PER_MINUTE, guardClientLookup, resetNewClientRequests } from "@/lib/mcp/cimd-gate";
import { appUrl, mcpResourceUrl } from "@/lib/mcp/config";
import { consentRefusalText } from "@/lib/mcp/consent-refusal";
import { withRetryAfter } from "@/lib/mcp/retry-after";
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
  getAccessToken,
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

// The options lib/auth.ts gives cimd(); the real plugin is still the one that runs.
const pluginOptions = vi.hoisted(() => ({ options: null as null | Record<string, unknown> }));
vi.mock("@better-auth/cimd", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@better-auth/cimd")>();
  return {
    ...actual,
    cimd: (options: Parameters<typeof actual.cimd>[0]) => {
      pluginOptions.options = options as unknown as Record<string, unknown>;
      return actual.cimd(options);
    },
  };
});
// Lets a test hold Allows at the insert of their consent rows, before the real function runs
// (lib/auth.ts calls createConsentWithinCap through this wrapper). A hold keeps back the Allow for one
// client until it is released. A barrier keeps every Allow back until the given number have arrived,
// then lets them all go at once, so that concurrent Allows really do overlap.
const insert = vi.hoisted(() => ({
  hold: null as null | { clientId: string; reached: () => void; wait: Promise<void>; used: boolean },
  barrier: null as null | { size: number; waiting: (() => void)[] },
}));
vi.mock("@/lib/mcp/cimd-budget", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp/cimd-budget")>();
  return {
    ...actual,
    createConsentWithinCap: async (args: Parameters<typeof actual.createConsentWithinCap>[0]) => {
      const hold = insert.hold;
      if (hold && !hold.used && (args.data as { clientId?: unknown }).clientId === hold.clientId) {
        hold.used = true;
        hold.reached();
        await hold.wait;
      }
      const barrier = insert.barrier;
      if (barrier) {
        await new Promise<void>((resolve) => {
          barrier.waiting.push(resolve);
          if (barrier.waiting.length >= barrier.size) for (const go of barrier.waiting.splice(0)) go();
        });
      }
      return actual.createConsentWithinCap(args);
    },
  };
});
// The gate runs as written unless a test switches it off, to try the fetch point on its own.
const gate = vi.hoisted(() => ({ off: false }));
vi.mock("@/lib/mcp/cimd-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp/cimd-gate")>();
  return { ...actual, guardClientLookup: (...args: Parameters<typeof actual.guardClientLookup>) => (gate.off ? Promise.resolve() : actual.guardClientLookup(...args)) };
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
  gate.off = false;
  insert.hold = null;
  insert.barrier = null;
  resetNewClientRequests();
  resetCimdBudgets();
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

  // Postgres can't store U+0000, and the plugin saves fields Coppice does not check (software_version,
  // software_id, contacts) as they are, so such a document would fail later as a raw 500.
  test.each([
    ["software_version", { software_version: "1\u0000" }],
    ["software_id", { software_id: "a\u0000b" }],
    ["a contacts entry", { contacts: ["a\u0000@assistant.example"] }],
    ["a value nested in an object inside an array", { extra: { list: [{ deep: ["fine", "x\u0000"] }] } }],
    ["a key", { "bad\u0000key": "value" }],
    ["a key nested in an object", { extra: { "bad\u0000key": 1 } }],
  ])("refuses a NUL character in %s, and logs one line naming the site", async (_name, extra) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = nextUrl();
    const fake = serve({ [url]: jsonReply(metadata(url, extra)) });
    await expect(createCimdFetch(fake.deps, FAST)(url)).rejects.toThrow(/NUL character/);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(new URL(url).hostname);
  });

  it("accepts a document with software_version, software_id, contacts and nested values that hold no NUL character", async () => {
    const url = nextUrl();
    const fake = serve({ [url]: jsonReply(metadata(url, { software_version: "1.2.3", software_id: "abc", contacts: ["a@assistant.example"], extra: { list: [{ deep: ["fine"] }] } })) });
    expect((await createCimdFetch(fake.deps, FAST)(url)).status).toBe(200);
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

  it("a NUL character in a field Coppice does not check answers 400 invalid_client to an anonymous authorize, saves no client row and logs one warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = nextUrl();
    serve({ [url]: jsonReply(metadata(url, { software_version: "1\u0000" })) });
    const answer = await anonymousAuthorize(url);
    expect(answer.status).toBe(400);
    expect(answer.body.error).toBe("invalid_client");
    expect(await clientRows(url)).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("NUL character");
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
  // The plugin's own per site limit (now a ceiling of 1000 that auth.handler can't reach) is replaced
  // by the per site rule at the fetch point and a check of the numbers lib/auth.ts gives the plugin.
  it("a sixth new assistant on one site inside a minute is refused with 429 and no fetch, and another site still works", async () => {
    const fake = serve({});
    const origin = `https://budget-${++counter}.example`;
    for (let i = 0; i < 5; i++) {
      const answer = await startAuthorize(`${origin}/c${i}.json`);
      expect(answer.body.error).toBe("invalid_client");
    }
    expect(fake.requests).toHaveLength(5);
    const over = await startAuthorize(`${origin}/c5.json`);
    expect(over.status).toBe(429);
    expect(over.body.error).toBe("temporarily_unavailable");
    expect(fake.requests).toHaveLength(5);
    // Another site is not held back by it.
    expect((await startAuthorize(`https://budget-${++counter}.example/c.json`)).status).toBe(400);
    expect(fake.requests).toHaveLength(6);
    // A minute later the site may be fetched again.
    vi.setSystemTime(Date.now() + 61_000);
    expect((await startAuthorize(`${origin}/c5.json`)).status).toBe(400);
    expect(fake.requests).toHaveLength(7);
  });

  it("lib/auth.ts gives the plugin ceilings that ordinary traffic can't reach, a one minute retry wait and a cache of 2000", () => {
    expect(pluginOptions.options).toMatchObject({
      metadataFetchPolicy: { minimumFetchInterval: 60, maximumFetchesPerMinute: 1000, maximumFetchesPerOriginPerMinute: 1000, maximumConcurrentFetches: 64, maximumConcurrentFetchesPerOrigin: 64 },
      maxCacheEntries: 2000,
    });
  });

  it("a failed fetch isn't repeated for the same client within a minute", async () => {
    const url = nextUrl();
    const fake = serve({});
    const start = Date.now();
    expect((await startAuthorize(url)).status).toBe(400);
    const again = await startAuthorize(url);
    expect(again.status).toBe(429);
    expect(again.body.error).toBe("temporarily_unavailable");
    expect(fake.requests).toHaveLength(1);
    vi.setSystemTime(start + 2_000);
    expect((await startAuthorize(url)).status).toBe(429);
    expect(fake.requests).toHaveLength(1);
    vi.setSystemTime(start + 59_000);
    expect((await startAuthorize(url)).status).toBe(429);
    expect(fake.requests).toHaveLength(1);
    vi.setSystemTime(start + 61_000);
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

// The same request as anonymousAuthorize, as the raw response.
async function anonymousAuthorizeRaw(clientId: string) {
  const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT_URI, scope: ALL, code_challenge: "x".repeat(43), code_challenge_method: "S256" });
  return auth.handler(new Request(new URL(`/api/auth/oauth2/authorize?${query}`, appUrl()), { headers: fromNewIp(), redirect: "manual" }));
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

  // The gate counts the requests it lets through for clients that are not connected: 150 a minute.
  // These calls take gate slots for a row nobody allowed and start no fetch, so the fetch point's
  // own count is left alone.
  async function spendGateSlots(count: number, clientId: string) {
    for (let i = 0; i < count; i++) await guardClientLookup("/oauth2/public-client", { query: { client_id: clientId } });
  }

  // The gate's share is NEW_CLIENT_REQUESTS_PER_MINUTE slots a minute. One row nobody allowed takes the
  // first when it is made, and fillers take all but `slots` of the rest. The request under test
  // must take exactly those, and then the next one is told to wait.
  async function takesSlots(slots: number, request: (url: string, ctx: { location: URL; headers: Headers }) => Promise<Response>) {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = nextUrl();
    serve({ [url]: jsonReply(metadata(url)) });
    const { location, headers } = await authorize(url, "ownerA", { scope: ALL, challenge: pkce().challenge });
    // authorize took one slot.
    await spendGateSlots(NEW_CLIENT_REQUESTS_PER_MINUTE - 1 - slots, url);
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
    await spendGateSlots(NEW_CLIENT_REQUESTS_PER_MINUTE - 2, url);
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
    // Each took five gate slots (authorize 1, continue 2, the details 1, the consent 1) and one fetch.
    // The fetch point's share of 30 is what runs out first: 25 are left, and then it is used up.
    let answered = 0;
    while ((await anonymousAuthorize(junkUrl())).status !== 429) answered++;
    expect(answered).toBe(NEW_CLIENT_FETCHES_PER_MINUTE - 5);
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

  it("12 no-store documents allowed by two accounts (one account may allow 10), and 200 anonymous token requests naming them", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const urls = Array.from({ length: 12 }, () => nextUrl());
    const fake = serve(Object.fromEntries(urls.map((u) => [u, jsonReply(metadata(u), { "cache-control": "no-store" })])));
    const connected = [];
    for (const [i, url] of urls.entries()) connected.push(await connectDocument(url, i < 6 ? "ownerA" : "officerA"));
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

// ----- The budgets at the fetch point (lib/mcp/cimd-budget.ts), counters only -----

describe("the fetch budgets, as counters", () => {
  let clock = 0;
  const now = () => clock;
  const allowed = new Set<string>();
  const reader = async (id: string) => allowed.has(id);
  const take = (id: string) => allowDocumentFetch(id, reader, now);
  const site = (n: number) => `https://counter-site-${n}.example`;
  const doc = (n: number, i = 0) => `${site(n)}/c${i}.json`;
  const refusal = async (id: string) => {
    const error = await take(id).then(
      () => null,
      (e: unknown) => e as { statusCode: number; body: Record<string, string>; headers: Record<string, string> },
    );
    expect(error).not.toBeNull();
    return error as { statusCode: number; body: Record<string, string>; headers: Record<string, string> };
  };

  beforeEach(() => {
    clock = 10_000_000;
    allowed.clear();
    resetCimdBudgets();
  });

  it("gives 30 slots a minute to clients nobody allowed, then refuses with 429 and a retry time, and takes nothing when it refuses", async () => {
    for (let i = 0; i < NEW_CLIENT_FETCHES_PER_MINUTE; i++) expect(await take(doc(i))).toBe(true);
    const error = await refusal(doc(99));
    expect(error.statusCode).toBe(429);
    expect(error.body).toEqual({ error: "temporarily_unavailable", error_description: "too many new assistants are connecting, try again in a minute" });
    expect(error.headers).toEqual({ "Retry-After": "60" });
    await refusal(doc(98));
    expect(cimdBudgetSnapshot(now())).toEqual({ newClients: 30, connected: 0, failingConnected: 0, marked: 0 });
  });

  it("allows 5 a minute for one site inside those 30, and another site is not held back", async () => {
    for (let i = 0; i < NEW_CLIENT_FETCHES_PER_SITE_PER_MINUTE; i++) expect(await take(doc(1, i))).toBe(true);
    const error = await refusal(doc(1, 5));
    expect(error.body.error_description).toBe("too many new assistants are connecting, try again in a minute");
    expect(await take(doc(2))).toBe(true);
    // The refusal took no slot: the 30 still hold 24 more for other sites.
    expect(cimdBudgetSnapshot(now()).newClients).toBe(6);
  });

  it("slides by the minute and resets", async () => {
    for (let i = 0; i < 5; i++) await take(doc(1, i));
    clock += 30_000;
    for (let i = 0; i < 5; i++) await take(doc(2, i));
    await refusal(doc(1, 9));
    // The first five are 60 s old and drop out, the later five do not.
    clock += 30_000;
    expect(cimdBudgetSnapshot(now()).newClients).toBe(5);
    expect(await take(doc(1, 9))).toBe(true);
    await refusal(doc(2, 9));
    resetCimdBudgets();
    expect(cimdBudgetSnapshot(now())).toEqual({ newClients: 0, connected: 0, failingConnected: 0, marked: 0 });
    expect(await take(doc(2, 9))).toBe(true);
  });

  it("gives 120 slots to allowed clients that were stored or not fetched yet, with its own message", async () => {
    for (let i = 0; i < CONNECTED_FETCHES_PER_MINUTE; i++) {
      allowed.add(doc(i));
      expect(await take(doc(i))).toBe(true);
      clearFailingMark(doc(i));
    }
    allowed.add(doc(500));
    const error = await refusal(doc(500));
    expect(error.statusCode).toBe(429);
    expect(error.body.error_description).toBe("too many assistants are refreshing, try again in a minute");
    expect(error.headers).toEqual({ "Retry-After": "60" });
  });

  it("holds an allowed client whose last fetch did not store its document to 20 slots, and clearing the mark sends it back", async () => {
    const ids = Array.from({ length: FAILING_CONNECTED_FETCHES_PER_MINUTE + 1 }, (_, i) => doc(i));
    for (const id of ids) allowed.add(id);
    // The first fetch of each is healthy. None is cleared, so each is failing from here on.
    for (const id of ids) expect(await take(id)).toBe(true);
    expect(cimdBudgetSnapshot(now())).toMatchObject({ connected: 21, failingConnected: 0, marked: 21 });
    clock += 61_000;
    for (const id of ids.slice(0, FAILING_CONNECTED_FETCHES_PER_MINUTE)) expect(await take(id)).toBe(true);
    expect(cimdBudgetSnapshot(now())).toMatchObject({ connected: 0, failingConnected: 20 });
    await refusal(ids[FAILING_CONNECTED_FETCHES_PER_MINUTE]);
    // A document that was stored (what onClientRefreshed reports) leaves the failing bucket.
    clearFailingMark(ids[0]);
    expect(await take(ids[0])).toBe(true);
    expect(cimdBudgetSnapshot(now())).toMatchObject({ connected: 1, failingConnected: 20 });
  });

  it("keeps the three counters apart", async () => {
    // Use up the 30 for clients nobody allowed.
    for (let i = 0; i < NEW_CLIENT_FETCHES_PER_MINUTE; i++) await take(doc(i));
    // Allowed clients are not touched by that.
    const healthy = doc(100);
    const failing = doc(101);
    allowed.add(healthy);
    allowed.add(failing);
    expect(await take(healthy)).toBe(true);
    clearFailingMark(healthy);
    expect(await take(failing)).toBe(true);
    expect(await take(failing)).toBe(true);
    // Use up the 20 for failing ones: the healthy 120 still answer.
    for (let i = 0; i < FAILING_CONNECTED_FETCHES_PER_MINUTE; i++) {
      const id = doc(200 + i);
      allowed.add(id);
      await take(id);
      await take(id).catch(() => {});
    }
    expect(cimdBudgetSnapshot(now()).failingConnected).toBe(FAILING_CONNECTED_FETCHES_PER_MINUTE);
    const another = doc(300);
    allowed.add(another);
    expect(await take(another)).toBe(true);
    expect(await take(healthy)).toBe(true);
    // And the other way round: the new-client counter is still full.
    await refusal(doc(400));
  });

  it("remembers at most 2000 marked clients and forgets the oldest first", async () => {
    const first = doc(0);
    allowed.add(first);
    expect(await take(first)).toBe(true);
    for (let i = 1; i <= MAX_FAILING_MARKS; i++) {
      // 100 a minute stays inside the budget of 120.
      if (i % 100 === 0) clock += 61_000;
      allowed.add(doc(i));
      await take(doc(i));
    }
    expect(cimdBudgetSnapshot(now()).marked).toBe(MAX_FAILING_MARKS);
    // The oldest mark was dropped, so the first client counts as healthy again.
    clock += 61_000;
    expect(await take(first)).toBe(true);
    expect(cimdBudgetSnapshot(now())).toMatchObject({ connected: 1, failingConnected: 0 });
  });

  it("refuses an address Coppice would never fetch without asking the database or taking a slot", async () => {
    const read = vi.fn(async () => true);
    for (const id of ["http://assistant.example/c.json", "https://127.0.0.1/c.json", `https://assistant.example/${"a".repeat(600)}`]) {
      expect(await allowDocumentFetch(id, read, now)).toBe(false);
    }
    expect(read).not.toHaveBeenCalled();
    expect(cimdBudgetSnapshot(now())).toEqual({ newClients: 0, connected: 0, failingConnected: 0, marked: 0 });
  });

  it("answers 429 with a retry time when the database read fails, and takes no slot", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = await allowDocumentFetch(doc(1), async () => Promise.reject(new Error("connection lost")), now).then(
      () => null,
      (e: unknown) => e as { statusCode: number; body: Record<string, string>; headers: Record<string, string> },
    );
    expect(error?.statusCode).toBe(429);
    expect(error?.body.error).toBe("temporarily_unavailable");
    expect(error?.headers).toEqual({ "Retry-After": "60" });
    expect(cimdBudgetSnapshot(now())).toEqual({ newClients: 0, connected: 0, failingConnected: 0, marked: 0 });
  });
});

// ----- The budgets at the fetch point, through the real handler -----

// What each kind of request below needs, and what it looks like to the caller.
const basicFor = (user: string, secret = "secret") => `Basic ${Buffer.from(`${user}:${secret}`).toString("base64")}`;
const ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const refreshForm = { grant_type: "refresh_token", refresh_token: "nope" };
const answerOf = async (response: Response) => ({ status: response.status, body: (await response.clone().json().catch(() => ({}))) as Record<string, string>, headers: response.headers });

// An access token for a client, signed by Coppice's own key, the way a real one is: its azp names the client.
async function accessTokenFor(clientId: string, userId = "ownerA") {
  const at = Math.floor(Date.now() / 1000);
  const { token } = await auth.api.signJWT({
    body: {
      payload: {
        sub: userId,
        azp: clientId,
        client_id: clientId,
        scope: ALL,
        aud: [mcpResourceUrl(), new URL("/api/auth/oauth2/userinfo", appUrl()).toString()],
        iss: new URL("/api/auth", appUrl()).toString(),
        iat: at,
        exp: at + 3600,
      },
    },
  });
  return token;
}

const userinfoWith = async (token: string) =>
  auth.handler(new Request(new URL("/api/auth/oauth2/userinfo", appUrl()), { headers: { authorization: `Bearer ${token}`, ...fromNewIp() } }));
const endSessionFor = async (clientId: string) =>
  auth.handler(new Request(new URL(`/api/auth/oauth2/end-session?client_id=${encodeURIComponent(clientId)}`, appUrl()), { headers: fromNewIp() }));

// A registered confidential client, which may call introspect.
async function introspector() {
  const registered = await registerClient({ client_name: "Introspector", token_endpoint_auth_method: "client_secret_basic" });
  const { client_id: id, client_secret: secret } = registered.body as { client_id: string; client_secret: string };
  return async (token: string) =>
    send("oauth2/introspect", { headers: { "content-type": "application/x-www-form-urlencoded", authorization: basicFor(encodeURIComponent(id), encodeURIComponent(secret)) }, body: new URLSearchParams({ token }) });
}

describe("the fetch point on its own, with the gate switched off", () => {
  const refusedByBudget = (a: { status: number; body: Record<string, string> }) =>
    (a.status === 429 && a.body.error === "temporarily_unavailable") || ([400, 401].includes(a.status) && a.body.error === "invalid_client");

  it("200 anonymous requests naming new ids on every endpoint cause at most 30 fetches in a minute, and a connected assistant still refreshes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const good = nextUrl();
    const fake = serve({ [good]: jsonReply(metadata(good), { "cache-control": "no-store" }) });
    const connected = await connectDocument(good);
    gate.off = true;
    // The document has gone stale, so the refresh below needs a fetch.
    vi.setSystemTime(Date.now() + (CACHE_FLOOR_SECONDS + 1) * 1000);
    resetCimdBudgets();
    const fetchesBefore = fake.requests.length;
    const introspectAs = await introspector();
    const fresh = (kind: string) => `https://${kind}-${++counter}.attacker.example/c.json`;

    type Kind = { name: string; send: (id: string) => Promise<Response>; once: (a: { status: number; body: Record<string, string> }) => boolean };
    const kinds: Kind[] = [
      { name: "authorize", send: async (id) => (await anonymousAuthorizeRaw(id)), once: refusedByBudget },
      { name: "tokenform", send: (id) => send("oauth2/token", formBody({ ...refreshForm, client_id: id })), once: refusedByBudget },
      {
        name: "tokenbasic",
        send: (id) => send("oauth2/token", { headers: { "content-type": "application/x-www-form-urlencoded", authorization: basicFor(encodeURIComponent(id)) }, body: new URLSearchParams(refreshForm) }),
        once: refusedByBudget,
      },
      { name: "tokenassertion", send: (id) => send("oauth2/token", formBody({ ...refreshForm, client_assertion_type: ASSERTION_TYPE, client_assertion: jwtNaming(id) })), once: refusedByBudget },
      { name: "revoke", send: (id) => send("oauth2/revoke", formBody({ token: "nope", client_id: id })), once: refusedByBudget },
      {
        name: "introspectassertion",
        send: (id) => send("oauth2/introspect", formBody({ token: "nope", client_assertion_type: ASSERTION_TYPE, client_assertion: jwtNaming(id) })),
        once: (a) => a.status === 429 || a.status === 400,
      },
      { name: "introspectazp", send: async (id) => introspectAs(await accessTokenFor(id)), once: (a) => a.status === 200 && (a.body as unknown as { active: boolean }).active === false },
      { name: "userinfo", send: async (id) => userinfoWith(await accessTokenFor(id)), once: (a) => a.status === 401 && a.body.error === "invalid_token" },
      { name: "endsession", send: (id) => endSessionFor(id), once: (a) => a.status === 500 && a.body.error === "server_error" },
    ];

    let exhausted = -1;
    let callsWhenExhausted = 0;
    const hostsFetched = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const kind = kinds[i % kinds.length];
      const answer = await answerOf(await kind.send(fresh(kind.name)));
      if (exhausted >= 0) expect(kind.once(answer), `${kind.name} after the budget was used: ${answer.status} ${JSON.stringify(answer.body)}`).toBe(true);
      if (exhausted < 0 && cimdBudgetSnapshot().newClients >= NEW_CLIENT_FETCHES_PER_MINUTE) {
        exhausted = i;
        callsWhenExhausted = fake.requests.length;
      }
    }
    for (const r of fake.requests) hostsFetched.add(r.url.hostname.split("-")[0]);
    expect(exhausted).toBeGreaterThan(0);
    const junkCalls = fake.requests.length - fetchesBefore;
    expect(junkCalls).toBeLessThanOrEqual(NEW_CLIENT_FETCHES_PER_MINUTE);
    // No fetch after the budget was used up, and none was taken without one.
    expect(fake.requests.length).toBe(callsWhenExhausted);
    expect(junkCalls).toBe(cimdBudgetSnapshot().newClients);
    // Every kind of request reached the fetch point at least once.
    for (const kind of kinds) expect(hostsFetched.has(kind.name), `${kind.name} reached a fetch`).toBe(true);

    const renewed = await refresh(good, connected.refreshToken);
    expect(renewed.status).toBe(200);
    expect(seenFor(fake, [good])).toBe(2);
    expect(cimdBudgetSnapshot().connected).toBe(1);
  }, 60_000);
});

// ----- The gate's small fixes -----

describe("the gate reads a payload the way jose does, and refuses claims it can't read", () => {
  const jwtFrom = (payload: string | Buffer) => `${Buffer.from('{"alg":"ES256"}').toString("base64url")}.${Buffer.from(payload).toString("base64url")}.c2ln`;
  const withBom = (claims: Record<string, unknown>) => jwtFrom(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(claims))]));
  const noMoreFetches = async (fake: FakeNet, id: string) => {
    expect(fake.requests).toEqual([]);
    expect(await clientRows(id)).toBe(0);
    expect(cimdBudgetSnapshot()).toEqual({ newClients: 0, connected: 0, failingConnected: 0, marked: 0 });
  };

  it.each([
    ["token", "client_assertion"],
    ["revoke", "client_assertion"],
    ["introspect", "client_assertion"],
  ])("a client_assertion with a byte order mark in its payload, on %s, is refused early", async (path) => {
    const fake = serve({});
    const id = junkUrl();
    const fields: Record<string, string> = path === "token" ? refreshForm : { token: "nope" };
    const response = await send(`oauth2/${path}`, formBody({ ...fields, client_assertion_type: ASSERTION_TYPE, client_assertion: withBom({ iss: id, sub: id }) }));
    expect([400, 401]).toContain(response.status);
    expect((await response.json()).error).toBe("invalid_client");
    await noMoreFetches(fake, id);
  });

  it("an id_token_hint with a byte order mark in its payload, on end-session, is refused early", async () => {
    const fake = serve({});
    const id = junkUrl();
    const response = await auth.handler(new Request(new URL(`/api/auth/oauth2/end-session?id_token_hint=${withBom({ aud: id, azp: id })}`, appUrl()), { headers: fromNewIp() }));
    expect((await response.json()).error).toBe("invalid_client");
    await noMoreFetches(fake, id);
  });

  const guard = (path: string, body: Record<string, unknown>, query: Record<string, unknown> = {}) => guardClientLookup(path, { body, query });

  // With a decode that kept the byte order mark, these claims would not parse and the request would be
  // refused as unreadable. Read the way jose reads them, they name a connected client and pass.
  it("lets a client_assertion or id_token_hint with a byte order mark through when it names a connected client", async () => {
    const good = nextUrl();
    serve({ [good]: jsonReply(metadata(good)) });
    await connectDocument(good);
    const assertion = withBom({ iss: good, sub: good });
    for (const path of ["/oauth2/token", "/oauth2/revoke", "/oauth2/introspect"]) {
      await expect(guard(path, { client_assertion: assertion })).resolves.toBeUndefined();
    }
    await expect(guard("/oauth2/end-session", {}, { id_token_hint: withBom({ aud: good, azp: good }) })).resolves.toBeUndefined();
    // And the same claims naming a client nobody connected are still refused.
    await expect(guard("/oauth2/token", { client_assertion: withBom({ iss: junkUrl(), sub: junkUrl() }) })).rejects.toMatchObject({ body: { error: "invalid_client" } });
  });

  const unreadable: [string, string][] = [
    ["no dots at all", "garbage"],
    ["a payload that is not base64url", "a.@@@@.c"],
    ["a payload that is not JSON", jwtFrom("not json")],
    ["a payload that is a JSON array", jwtFrom("[]")],
    ["a payload that is a JSON string", jwtFrom('"text"')],
    ["a payload that is JSON null", jwtFrom("null")],
  ];

  describe.each(["/oauth2/token", "/oauth2/revoke", "/oauth2/introspect"])("%s", (path) => {
    test.each(unreadable)("a client_assertion with %s is refused before the plugin sees it", async (_name, assertion) => {
      await expect(guard(path, { client_id: "assistant-registered-1", client_assertion: assertion })).rejects.toMatchObject({ body: { error: "invalid_client" } });
    });
  });

  test.each(unreadable)("an id_token_hint with %s is refused on end-session", async (_name, hint) => {
    await expect(guard("/oauth2/end-session", {}, { id_token_hint: hint })).rejects.toMatchObject({ body: { error: "invalid_client" } });
  });

  it("leaves a readable claim set with no client in it, an empty value, and the other paths alone", async () => {
    await expect(guard("/oauth2/token", { client_assertion: jwtFrom(JSON.stringify({ exp: 1 })) })).resolves.toBeUndefined();
    await expect(guard("/oauth2/token", { client_id: "assistant-registered-1", client_assertion: "" })).resolves.toBeUndefined();
    await expect(guard("/oauth2/end-session", {}, { id_token_hint: jwtFrom(JSON.stringify({ aud: ["assistant-registered-1"] })) })).resolves.toBeUndefined();
    await expect(guard("/oauth2/consent", { client_assertion: "garbage" })).resolves.toBeUndefined();
    await expect(guard("/oauth2/authorize", {}, { id_token_hint: "garbage" })).resolves.toBeUndefined();
  });

  it("lets 150 requests a minute through for clients nobody allowed, and then answers 429 with a retry time", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = nextUrl();
    serve({ [url]: jsonReply(metadata(url)) });
    expect((await anonymousAuthorize(url)).status).toBe(302);
    for (let i = 0; i < NEW_CLIENT_REQUESTS_PER_MINUTE - 1; i++) await guardClientLookup("/oauth2/public-client", { query: { client_id: url } });
    await expect(guardClientLookup("/oauth2/public-client", { query: { client_id: url } })).rejects.toMatchObject({
      statusCode: 429,
      body: { error: "temporarily_unavailable" },
      headers: { "Retry-After": "60" },
    });
    vi.setSystemTime(Date.now() + 61_000);
    await expect(guardClientLookup("/oauth2/public-client", { query: { client_id: url } })).resolves.toBeUndefined();
  });
});

// ----- What a refused or failed fetch costs, and who can still get through -----

describe("what the fetch point protects", () => {
  const noStore = { "cache-control": "no-store" };
  const stale = (seconds = CACHE_FLOOR_SECONDS + 1) => vi.setSystemTime(Date.now() + seconds * 1000);
  const refreshWith = (clientId: string, refreshToken: string) =>
    send("oauth2/token", formBody({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, resource: mcpResourceUrl() }));

  it("ten junk ids a minute on the same site as a connected assistant, for five minutes, don't stop its next re-read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const site = `https://shared-${++counter}.example`;
    const good = `${site}/assistant.json`;
    const fake = serve({ [good]: jsonReply(metadata(good), noStore) });
    const connected = await connectDocument(good);
    for (let minute = 0; minute < 5; minute++) {
      vi.setSystemTime(Date.now() + 61_000);
      const before = fake.requests.length;
      for (let i = 0; i < 10; i++) await anonymousAuthorize(`${site}/junk-${minute}-${i}.json`);
      // At most five of the ten are fetched, and the real assistant's site is not used up.
      expect(fake.requests.length - before).toBeLessThanOrEqual(NEW_CLIENT_FETCHES_PER_SITE_PER_MINUTE);
    }
    // 305 seconds have passed, so the document's five minutes are over and the re-read needs a fetch.
    const renewed = await refresh(good, connected.refreshToken);
    expect(renewed.status).toBe(200);
    expect(seenFor(fake, [good])).toBe(2);
  });

  it("a connected document that starts answering 500 is fetched at most once a minute, and another assistant still refreshes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = nextUrl();
    const other = nextUrl();
    const pages: Record<string, FakeReply> = { [bad]: jsonReply(metadata(bad), noStore), [other]: jsonReply(metadata(other), noStore) };
    const fake = serve(pages);
    await connectDocument(bad);
    const otherConnection = await connectDocument(other);
    pages[bad] = { status: 500 };
    stale();
    const perMinute: number[] = [];
    for (let minute = 0; minute < 5; minute++) {
      const before = seenFor(fake, [bad]);
      for (let i = 0; i < 60; i++) await send("oauth2/token", formBody({ ...refreshForm, client_id: bad }));
      perMinute.push(seenFor(fake, [bad]) - before);
      vi.setSystemTime(Date.now() + 61_000);
    }
    expect(perMinute.every((n) => n <= 1)).toBe(true);
    expect(perMinute.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(4);
    expect((await refresh(other, otherConnection.refreshToken)).status).toBe(200);
  }, 60_000);

  describe("allowed documents that all start failing", () => {
    const stored = (id: string) => ({ id: crypto.randomUUID(), clientId: id, createdAt: new Date(), updatedAt: new Date() });

    it("125 of them, each named once a minute for four minutes: at most 20 fetches a minute, and a real assistant refreshes every time", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      const failing = Array.from({ length: 125 }, () => `https://failing-${++counter}.attacker.example/c.json`);
      const real = Array.from({ length: 6 }, () => nextUrl());
      const pages: Record<string, FakeReply> = {};
      for (const id of real) pages[id] = jsonReply(metadata(id), noStore);
      for (const id of failing) pages[id] = { status: 500 };
      const fake = serve(pages);
      const connections = [];
      for (const id of real) connections.push(await connectDocument(id));
      // Set-up: the rows and the consents are written directly, for a person who allowed them all.
      await prisma.oauthClient.createMany({
        data: failing.map((id) => ({
          ...stored(id),
          clientDiscoveryId: "cimd",
          name: "Failing Assistant",
          redirectUris: [REDIRECT_URI],
          tokenEndpointAuthMethod: "none",
          grantTypes: ["authorization_code", "refresh_token"],
          responseTypes: ["code"],
          scopes: ALL.split(" "),
        })),
      });
      await prisma.oauthConsent.createMany({ data: failing.map((id) => ({ ...stored(id), userId: "ownerA", scopes: ALL.split(" ") })) });
      stale();

      const callsTo = (ids: string[]) => seenFor(fake, ids);
      const failedBefore = new Set<string>();
      const nameAll = async () => {
        for (const id of failing) await send("oauth2/token", formBody({ ...refreshForm, client_id: id }));
      };
      // Minute 0: the first fetch of each, and a real assistant that refreshes first.
      expect((await refresh(real[0], connections[0].refreshToken)).status).toBe(200);
      await nameAll();
      for (const r of fake.requests) if (failing.includes(r.url.href)) failedBefore.add(r.url.href);
      expect(failedBefore.size).toBeGreaterThan(100);

      const afterFirstFailure: number[] = [];
      for (let minute = 1; minute <= 4; minute++) {
        vi.setSystemTime(Date.now() + 61_000);
        const before = fake.requests.length;
        await nameAll();
        const calls = fake.requests.slice(before).filter((r) => failing.includes(r.url.href));
        afterFirstFailure.push(calls.filter((r) => failedBefore.has(r.url.href)).length);
        for (const r of calls) failedBefore.add(r.url.href);
        // A different connected assistant whose copy has run out gets its fetch and answers 200.
        expect((await refresh(real[minute], connections[minute].refreshToken)).status).toBe(200);
        expect(cimdBudgetSnapshot().failingConnected).toBeLessThanOrEqual(FAILING_CONNECTED_FETCHES_PER_MINUTE);
      }
      expect(Math.max(...afterFirstFailure)).toBeLessThanOrEqual(FAILING_CONNECTED_FETCHES_PER_MINUTE);
      expect(Math.max(...afterFirstFailure)).toBeGreaterThan(0);
      expect(callsTo(failing)).toBeLessThanOrEqual(125 + 4 * 26);
    }, 120_000);

    it("a document that recovers leaves the failing bucket on its next successful fetch", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      const url = nextUrl();
      const pages: Record<string, FakeReply> = { [url]: jsonReply(metadata(url), noStore) };
      const fake = serve(pages);
      const connected = await connectDocument(url);
      const empty = { newClients: 0, connected: 0, failingConnected: 0, marked: 0 };
      // The connect used one slot for a client nobody had allowed yet. Start from nothing.
      resetCimdBudgets();
      pages[url] = { status: 500 };
      stale();
      expect((await refresh(url, connected.refreshToken)).status).toBe(400);
      expect(cimdBudgetSnapshot()).toEqual({ ...empty, connected: 1, marked: 1 });
      // It answers again. The retry comes from the failing bucket and clears the mark.
      pages[url] = jsonReply(metadata(url), noStore);
      vi.setSystemTime(Date.now() + 61_000);
      const renewed = await refresh(url, connected.refreshToken);
      expect(renewed.status).toBe(200);
      expect(cimdBudgetSnapshot()).toEqual({ ...empty, failingConnected: 1 });
      // The next time it has to be fetched it is an ordinary allowed client again.
      stale();
      expect((await refresh(url, renewed.body.refresh_token)).status).toBe(200);
      expect(cimdBudgetSnapshot()).toEqual({ ...empty, connected: 1 });
      expect(seenFor(fake, [url])).toBe(4);
    });
  });

  it("a 304 from a revalidation clears the mark too, so a document that keeps answering never counts as failing", async () => {
    const url = nextUrl();
    const fake = conditionalNet(url, noStore);
    net.fetch = createCimdFetch(fake.deps, FAST);
    const connected = await connectDocument(url);
    resetCimdBudgets();
    stale();
    const first = await refresh(url, connected.refreshToken);
    expect(first.status).toBe(200);
    // The second request carried the validator and was answered 304.
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[1].headers["if-none-match"]).toBe('"v1"');
    expect(cimdBudgetSnapshot()).toEqual({ newClients: 0, connected: 1, failingConnected: 0, marked: 0 });
    stale();
    expect((await refresh(url, first.body.refresh_token)).status).toBe(200);
    expect(cimdBudgetSnapshot()).toEqual({ newClients: 0, connected: 1, failingConnected: 0, marked: 0 });
  });

  it("30 documents that hang until the timeout, started together, don't stop a connected assistant from refreshing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const good = nextUrl();
    const hanging = Array.from({ length: 30 }, () => `https://hang-${++counter}.attacker.example/c.json`);
    const pages: Record<string, FakeReply> = { [good]: jsonReply(metadata(good), noStore) };
    for (const id of hanging) pages[id] = { hang: true };
    const fake = serve(pages, {}, { ...CIMD_LIMITS, connectMs: 50, requestMs: 700 });
    const connected = await connectDocument(good);
    stale();
    const started = hanging.map((id) => anonymousAuthorize(id));
    // Real timers: wait until the fake network shows all 30 in flight.
    for (let waited = 0; seenFor(fake, hanging) < 30 && waited < 2000; waited += 5) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(seenFor(fake, hanging)).toBe(30);
    const renewed = await refresh(good, connected.refreshToken);
    expect(renewed.status).toBe(200);
    for (const answer of await Promise.all(started)) expect(answer.status).toBe(400);
  }, 30_000);

  it("after Disconnect, the old access token at userinfo and introspect costs the budget for new assistants, never the connected one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = nextUrl();
    serve({ [url]: jsonReply(metadata(url), noStore) });
    const connected = await connectDocument(url);
    const introspectAs = await introspector();
    expect((await asUser("ownerA", () => disconnectAssistant(null, form({ workspaceId: "a", clientId: url })))).ok).toBe(true);
    resetCimdBudgets();
    stale();
    // The token itself is still a valid signed token: what is checked here is who pays for the lookup.
    await userinfoWith(connected.accessToken);
    expect(cimdBudgetSnapshot()).toEqual({ newClients: 1, connected: 0, failingConnected: 0, marked: 0 });
    stale();
    // The counters look back one minute, so only this second lookup shows.
    await introspectAs(connected.accessToken);
    expect(cimdBudgetSnapshot()).toEqual({ newClients: 1, connected: 0, failingConnected: 0, marked: 0 });
  });

  describe("a first connect", () => {
    it.each([
      ["a plain document", {}],
      ["a no-store document", { "cache-control": "no-store" }],
      ["a max-age=0 document", { "cache-control": "max-age=0" }],
    ])("costs one fetch for %s, not one for each step", async (_name, headers) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const url = nextUrl();
      const fake = serve({ [url]: jsonReply(metadata(url), headers) });
      // What a person's browser does: authorize, come back from sign-in through continue, ask for the details on the consent page, allow, and the assistant asks for a token.
      const { verifier, challenge } = pkce();
      const { location, headers: session } = await authorize(url, "ownerA", { scope: ALL, challenge });
      const onward = await auth.handler(
        new Request(new URL("/api/auth/oauth2/continue", appUrl()), {
          method: "POST",
          headers: { ...Object.fromEntries(session), "content-type": "application/json", accept: "application/json", ...fromNewIp() },
          body: JSON.stringify({ postLogin: true, oauth_query: location.search.slice(1) }),
        }),
      );
      expect(onward.status).toBe(200);
      const details = await auth.handler(new Request(new URL(`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(url)}`, appUrl()), { headers: { ...Object.fromEntries(session), ...fromNewIp() } }));
      expect(details.status).toBe(200);
      const code = (await consent(location, session, true)).searchParams.get("code") as string;
      expect((await exchangeCode(url, code, verifier)).status).toBe(200);
      expect(fake.requests).toHaveLength(1);
      expect(cimdBudgetSnapshot().newClients).toBe(1);
    });

    it("can be tried again after a minute when the first fetch failed", async () => {
      const url = nextUrl();
      const pages: Record<string, FakeReply> = { [url]: { status: 500 } };
      const fake = serve(pages);
      expect((await startAuthorize(url)).status).toBe(400);
      pages[url] = jsonReply(metadata(url));
      vi.setSystemTime(Date.now() + 30_000);
      expect((await startAuthorize(url)).status).toBe(429);
      vi.setSystemTime(Date.now() + 31_000);
      const answer = await startAuthorize(url);
      expect(answer.status).toBe(302);
      expect(answer.location).toContain("/oauth/consent");
      expect(fake.requests).toHaveLength(2);
    });
  });

  describe("a failing database inside the fetch point", () => {
    it("answers 429 with a retry time on token and authorize, and the plugin's own 500 on end-session", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const good = nextUrl();
      const fake = serve({ [good]: jsonReply(metadata(good), noStore) });
      const connected = await connectDocument(good);
      const armed = () => vi.spyOn(prisma.oauthConsent, "count").mockRejectedValueOnce(new Error("the database went away"));

      stale();
      armed();
      const token = await refreshWith(good, connected.refreshToken);
      expect(token.status).toBe(429);
      expect(token.headers.get("retry-after")).toBe("60");
      expect((await token.json()).error).toBe("temporarily_unavailable");

      // The refusal counts as a failed fetch, so the id waits a minute.
      vi.setSystemTime(Date.now() + 61_000);
      armed();
      const authorizeAnswer = await anonymousAuthorize(good);
      expect(authorizeAnswer.status).toBe(429);
      expect(authorizeAnswer.headers.get("retry-after")).toBe("60");
      expect(authorizeAnswer.body.error).toBe("temporarily_unavailable");

      vi.setSystemTime(Date.now() + 61_000);
      armed();
      const logout = await endSessionFor(good);
      expect(logout.status).toBe(500);
      expect(await logout.json()).toMatchObject({ error: "server_error" });
      // Nothing was fetched for any of them, and the error that was logged is the name of the error only.
      expect(seenFor(fake, [good])).toBe(1);
      for (const call of error.mock.calls) expect(JSON.stringify(call)).not.toContain("the database went away");
    });
  });
});

// ----- The account cap, the wait after a refusal, and what people and assistants see -----

// The route handlers, which add what the plugin's own answers lack.
const route = () => import("@/app/api/auth/[...all]/route");
const appRequest = (path: string, init: RequestInit = {}) => new Request(new URL(path, appUrl()), { ...init, headers: { ...fromNewIp(), ...init.headers } });
const tokenRequest = (clientId: string, refreshToken: string) =>
  appRequest("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, resource: mcpResourceUrl() }),
  });

describe("at most 10 assistants that came from a metadata document, for one account", () => {
  const SENTENCE = "You have connected 10 assistants this way. Disconnect one in Settings first.";
  // The consent step as a browser sends it, with the status and body kept.
  const consentResponse = (location: URL, headers: Headers, accept = true) =>
    auth.handler(
      new Request(new URL("/api/auth/oauth2/consent", appUrl()), {
        method: "POST",
        headers: { ...Object.fromEntries(headers), "content-type": "application/json", accept: "application/json", ...fromNewIp() },
        body: JSON.stringify({ accept, oauth_query: location.search.slice(1) }),
      }),
    );
  async function consentAnswer(location: URL, headers: Headers, accept = true) {
    const response = await consentResponse(location, headers, accept);
    return { status: response.status, body: (await response.json()) as Record<string, string> };
  }

  it("lets a 10th be allowed, refuses the 11th with the sentence and stores nothing, still allows a registered one, and a Disconnect frees a place", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(MAX_DOCUMENT_CLIENTS_PER_ACCOUNT).toBe(10);
    const urls = Array.from({ length: 11 }, () => nextUrl());
    serve(Object.fromEntries(urls.map((u) => [u, jsonReply(metadata(u))])));
    for (const url of urls.slice(0, 10)) await connectDocument(url, "ownerA");
    expect(await prisma.oauthConsent.count({ where: { userId: "ownerA", oauthclient: { clientDiscoveryId: "cimd" } } })).toBe(10);

    const { location, headers } = await authorize(urls[10], "ownerA", { scope: ALL, challenge: pkce().challenge });
    const refused = await consentAnswer(location, headers);
    expect(refused.status).toBe(400);
    expect(refused.body).toEqual({ error: "invalid_request", error_description: SENTENCE });
    expect(await prisma.oauthConsent.count({ where: { clientId: urls[10] } })).toBe(0);
    // Denying is not refused.
    expect((await consentAnswer(location, headers, false)).status).toBe(200);
    // Allowing one of the ten again (a new consent screen for it) is not counted as an 11th: it answers 200 with a code.
    const again = await consentLink(urls[1], "ownerA", true);
    const allowedAgain = await consentAnswer(again.location, again.headers);
    expect(allowedAgain.status).toBe(200);
    expect(codeIn(allowedAgain.body)).toBeTruthy();
    expect(await prisma.oauthConsent.count({ where: { userId: "ownerA", oauthclient: { clientDiscoveryId: "cimd" } } })).toBe(10);
    expect(await prisma.oauthConsent.count({ where: { clientId: urls[10] } })).toBe(0);
    // Somebody else is not held to this person's count.
    expect((await connectDocument(urls[10], "officerA")).accessToken).toBeTruthy();
    // A registered assistant is not counted or limited.
    expect((await getAccessToken("ownerA")).accessToken).toBeTruthy();
    expect(await prisma.oauthConsent.count({ where: { clientId: urls[10], userId: "ownerA" } })).toBe(0);

    // After Disconnect of one, the next document assistant can be allowed.
    expect((await asUser("ownerA", () => disconnectAssistant(null, form({ workspaceId: "a", clientId: urls[0] })))).ok).toBe(true);
    expect((await connectDocument(urls[10], "ownerA")).accessToken).toBeTruthy();
  }, 60_000);

  // A consent screen link for a client, even when the person already holds it (prompt=consent).
  async function consentLink(clientId: string, userId = "ownerA", promptConsent = false) {
    const query = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: ALL,
      state: "state-1",
      code_challenge: pkce().challenge,
      code_challenge_method: "S256",
      resource: mcpResourceUrl(),
      ...(promptConsent ? { prompt: "consent" } : {}),
    });
    const headers = await signedInHeaders(userId);
    const response = await auth.handler(new Request(new URL(`/api/auth/oauth2/authorize?${query}`, appUrl()), { headers: { ...Object.fromEntries(headers), ...fromNewIp() }, redirect: "manual" }));
    const location = new URL(response.headers.get("location") as string, appUrl());
    expect(location.pathname).toBe("/oauth/consent");
    return { location, headers };
  }
  const documentConsents = (userId = "ownerA") => prisma.oauthConsent.count({ where: { userId, oauthclient: { clientDiscoveryId: "cimd" } } });
  const distinctDocuments = async (userId = "ownerA") =>
    (await prisma.oauthConsent.findMany({ where: { userId, oauthclient: { clientDiscoveryId: "cimd" } }, select: { clientId: true }, distinct: ["clientId"] })).length;
  // The authorization code in an answer that sends the person back to the assistant, or null.
  const codeIn = (body: Record<string, string>) => {
    const target = body.url ?? body.redirect_uri;
    return target ? new URL(target, appUrl()).searchParams.get("code") : null;
  };

  it("Allows sent at the same moment at 9 held assistants: exactly one is allowed, the rest get the sentence, and the person holds 10", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const urls = Array.from({ length: 17 }, () => nextUrl());
    serve(Object.fromEntries(urls.map((u) => [u, jsonReply(metadata(u))])));
    for (const url of urls.slice(0, 9)) await connectDocument(url, "ownerA");
    const fresh = urls.slice(9);
    const links = [];
    for (const url of fresh) links.push(await authorize(url, "ownerA", { scope: ALL, challenge: pkce().challenge }));
    insert.barrier = { size: fresh.length, waiting: [] };
    const answers = await Promise.all(links.map((link) => consentAnswer(link.location, link.headers)));
    const allowed = answers.filter((a) => a.status === 200);
    const refused = answers.filter((a) => a.status === 400);
    expect(allowed).toHaveLength(1);
    expect(refused).toHaveLength(fresh.length - 1);
    for (const answer of refused) expect(answer.body).toEqual({ error: "invalid_request", error_description: SENTENCE });
    expect(await documentConsents()).toBe(10);
    expect(await distinctDocuments()).toBe(10);
    // A refused one has no consent and no code; the allowed one has a code.
    for (const [i, answer] of answers.entries()) {
      if (answer.status === 400) {
        expect(await prisma.oauthConsent.count({ where: { clientId: fresh[i] } })).toBe(0);
        expect(codeIn(answer.body)).toBeNull();
      } else {
        expect(codeIn(answer.body)).toBeTruthy();
        expect(await prisma.oauthConsent.count({ where: { clientId: fresh[i], userId: "ownerA" } })).toBe(1);
      }
    }
  }, 60_000);

  it("Allows sent together at 9 held leave at most 10 even when the endpoint fails after the insert with a plain error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const noStore = { "cache-control": "no-store" };
    const held = Array.from({ length: 9 }, () => nextUrl());
    const fresh = Array.from({ length: 6 }, () => nextUrl());
    const pages = Object.fromEntries([...held, ...fresh].map((u) => [u, jsonReply(metadata(u), noStore)]));
    serve(pages);
    for (const url of held) await connectDocument(url, "ownerA");
    const links = [];
    for (const url of fresh) links.push(await authorize(url, "ownerA", { scope: ALL, challenge: pkce().challenge }));
    // The cached copies expire (no-store is kept 5 minutes) and the documents have changed, so the
    // authorize step after the insert updates the client row. That update fails with a plain Error,
    // not an APIError, the way a database refusal does (a NUL character in a document did this before
    // such documents were refused). The consent row is already stored when it happens.
    vi.setSystemTime(Date.now() + 6 * 60_000);
    serve({ ...pages, ...Object.fromEntries(fresh.map((u) => [u, jsonReply(metadata(u, { client_name: "Doc Assistant Renamed" }), noStore)])) });
    const context = await auth.$context;
    const realUpdate = context.adapter.update.bind(context.adapter);
    const failed: string[] = [];
    vi.spyOn(context.adapter, "update").mockImplementation((async (args: { model: string; where: { field: string; value: unknown }[] }) => {
      if (args.model === "oauthClient") {
        failed.push(String(args.where.find((w) => w.field === "clientId")?.value ?? "?"));
        throw new Error("the update was refused");
      }
      return realUpdate(args as never);
    }) as never);

    insert.barrier = { size: fresh.length, waiting: [] };
    const answers = await Promise.all(links.map(async (link) => ({ response: await consentResponse(link.location, link.headers) })));
    const statuses = answers.map(({ response }) => response.status);
    const refused = await Promise.all(answers.filter(({ response }) => response.status === 400).map(({ response }) => response.json()));
    // Only the Allow that got past the cap reached the failing update, and it ended as a 500.
    expect(statuses.filter((status) => status === 500)).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(refused).toHaveLength(fresh.length - 1);
    for (const body of refused) expect(body).toEqual({ error: "invalid_request", error_description: SENTENCE });
    // A row was stored for at most one of the new documents: the one whose Allow answered 500.
    const stored = await prisma.oauthConsent.findMany({ where: { userId: "ownerA", clientId: { in: fresh } }, select: { clientId: true } });
    expect(stored.map((row) => row.clientId)).toEqual(failed);
    expect(await distinctDocuments()).toBe(10);
    expect(await documentConsents()).toBe(10);
  }, 60_000);

  describe("createConsentWithinCap on its own", () => {
    const args = (clientId: string, userId: string | undefined) => ({
      data: { id: `cap-consent-${++counter}`, clientId, userId, scopes: ["openid"], createdAt: new Date(), updatedAt: new Date() },
    });
    async function makeClient(discovery: string | null = "cimd") {
      const clientId = nextUrl();
      await prisma.oauthClient.create({ data: { id: `cap-client-${++counter}`, clientId, clientDiscoveryId: discovery } });
      return clientId;
    }
    async function holdDocuments(userId: string, count: number) {
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        const clientId = await makeClient();
        await createConsentWithinCap(args(clientId, userId));
        ids.push(clientId);
      }
      return ids;
    }
    const rejection = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error as InstanceType<typeof APIError>);
    function expectCapError(error: InstanceType<typeof APIError> | null) {
      expect(error).toBeInstanceOf(APIError);
      expect(error?.statusCode).toBe(400);
      expect(error?.body).toMatchObject({ error: "invalid_request", error_description: SENTENCE });
    }

    it("stores a consent for a registered client without the cap, even when the person holds 10 document assistants", async () => {
      await holdDocuments("ownerA", 10);
      const registered = await makeClient(null);
      await createConsentWithinCap(args(registered, "ownerA"));
      expect(await prisma.oauthConsent.count({ where: { userId: "ownerA", clientId: registered } })).toBe(1);
      expect(await documentConsents()).toBe(10);
    });

    it("stores a consent that has no userId as it is, even when somebody holds 10 document assistants", async () => {
      await holdDocuments("ownerA", 10);
      const clientId = await makeClient();
      await createConsentWithinCap(args(clientId, undefined));
      expect(await prisma.oauthConsent.count({ where: { clientId, userId: null } })).toBe(1);
    });

    it("refuses a new document client at 10 held with the APIError and stores nothing", async () => {
      await holdDocuments("ownerA", 10);
      const clientId = await makeClient();
      expectCapError(await rejection(createConsentWithinCap(args(clientId, "ownerA"))));
      expect(await prisma.oauthConsent.count({ where: { clientId } })).toBe(0);
      expect(await documentConsents()).toBe(10);
    });

    it("stores a 10th document client, then refuses the 11th", async () => {
      await holdDocuments("ownerA", 9);
      await createConsentWithinCap(args(await makeClient(), "ownerA"));
      expect(await documentConsents()).toBe(10);
      expectCapError(await rejection(createConsentWithinCap(args(await makeClient(), "ownerA"))));
      expect(await documentConsents()).toBe(10);
    });

    it("stores a second row for a client the person already holds at 10 held, and counts it once", async () => {
      const held = await holdDocuments("ownerA", 10);
      await createConsentWithinCap(args(held[3], "ownerA"));
      expect(await prisma.oauthConsent.count({ where: { userId: "ownerA", clientId: held[3] } })).toBe(2);
      expect(await documentConsents()).toBe(11);
      expect(await distinctDocuments()).toBe(10);
      // Still at the maximum for a new client.
      expectCapError(await rejection(createConsentWithinCap(args(await makeClient(), "ownerA"))));
    });

    it("does not hold another person to the first person's 10", async () => {
      await holdDocuments("ownerA", 10);
      const clientId = await makeClient();
      await createConsentWithinCap(args(clientId, "officerA"));
      expect(await prisma.oauthConsent.count({ where: { userId: "officerA", clientId } })).toBe(1);
      expect(await documentConsents("officerA")).toBe(1);
    });

    it("lets exactly one of two parallel calls for two new clients through at 9 held", async () => {
      await holdDocuments("ownerA", 9);
      const [first, second] = [await makeClient(), await makeClient()];
      insert.barrier = { size: 2, waiting: [] };
      const results = await Promise.allSettled([createConsentWithinCap(args(first, "ownerA")), createConsentWithinCap(args(second, "ownerA"))]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(rejected).toHaveLength(1);
      expectCapError(rejected[0].reason as InstanceType<typeof APIError>);
      expect(await documentConsents()).toBe(10);
      expect(await prisma.oauthConsent.count({ where: { userId: "ownerA", clientId: { in: [first, second] } } })).toBe(1);
    });

    it("lets exactly one of eight parallel calls for new clients through at 9 held", async () => {
      await holdDocuments("ownerA", 9);
      const fresh = await Promise.all(Array.from({ length: 8 }, () => makeClient()));
      insert.barrier = { size: 8, waiting: [] };
      const results = await Promise.allSettled(fresh.map((clientId) => createConsentWithinCap(args(clientId, "ownerA"))));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(7);
      expect(await documentConsents()).toBe(10);
    });
  });

  it("an Allow for an assistant that was disconnected meanwhile is refused when a new assistant took its place, and leaves 10", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const held = Array.from({ length: 10 }, () => nextUrl());
    const extra = nextUrl();
    serve(Object.fromEntries([...held, extra].map((u) => [u, jsonReply(metadata(u), { "cache-control": "max-age=3600" })])));
    for (const url of held) await connectDocument(url, "ownerA");
    expect(await documentConsents()).toBe(10);

    // A new consent screen for an assistant the person already holds (X), and one for a new assistant (Y).
    const x = held[0];
    const screenX = await consentLink(x, "ownerA", true);
    const screenY = await consentLink(extra);
    // The person disconnects X, which leaves 9. Then Allow X starts, and its insert waits.
    expect((await asUser("ownerA", () => disconnectAssistant(null, form({ workspaceId: "a", clientId: x })))).ok).toBe(true);
    expect(await documentConsents()).toBe(9);
    let release!: () => void;
    let reached!: () => void;
    const wait = new Promise<void>((resolve) => (release = resolve));
    const arrived = new Promise<void>((resolve) => (reached = resolve));
    insert.hold = { clientId: x, reached, wait, used: false };
    const allowX = consentAnswer(screenX.location, screenX.headers);
    await arrived;
    // While it waits, Y is allowed and takes the free place.
    const allowedY = await consentAnswer(screenY.location, screenY.headers);
    expect(allowedY.status).toBe(200);
    expect(codeIn(allowedY.body)).toBeTruthy();
    expect(await documentConsents()).toBe(10);
    release();

    const answer = await allowX;
    expect(answer.status).toBe(400);
    expect(answer.body).toEqual({ error: "invalid_request", error_description: SENTENCE });
    expect(codeIn(answer.body)).toBeNull();
    expect(await prisma.oauthConsent.count({ where: { userId: "ownerA", clientId: x } })).toBe(0);
    expect(await prisma.oauthConsent.count({ where: { userId: "ownerA", clientId: extra } })).toBe(1);
    expect(await documentConsents()).toBe(10);
    expect(insert.hold.used).toBe(true);
  }, 60_000);

  it("an Allow with no session is answered 401 by the endpoint's own session check, and stores nothing", async () => {
    const url = nextUrl();
    serve({ [url]: jsonReply(metadata(url)) });
    const { location } = await authorize(url, "ownerA", { scope: ALL, challenge: pkce().challenge });
    const answer = await consentAnswer(location, new Headers());
    expect(answer.status).toBe(401);
    expect(await prisma.oauthConsent.count({ where: { clientId: url } })).toBe(0);
  });

  it("reaches the person as the text on the consent buttons: the client's own error, read as the buttons read it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const urls = Array.from({ length: 11 }, () => nextUrl());
    serve(Object.fromEntries(urls.map((u) => [u, jsonReply(metadata(u))])));
    for (const url of urls.slice(0, 10)) await connectDocument(url, "ownerA");
    const { location, headers } = await authorize(urls[10], "ownerA", { scope: ALL, challenge: pkce().challenge });
    const { createAuthClient } = await import("better-auth/client");
    const client = createAuthClient({
      baseURL: new URL("/api/auth", appUrl()).toString(),
      fetchOptions: { customFetchImpl: async (input, init) => auth.handler(new Request(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), ...Object.fromEntries(headers), ...fromNewIp() } })) },
    });
    const { error } = await client.$fetch<unknown>("/oauth2/consent", { method: "POST", body: { accept: true, oauth_query: location.search.slice(1) } });
    expect(error).toMatchObject({ status: 400, error: "invalid_request", error_description: SENTENCE });
    expect(consentRefusalText(error)).toBe(SENTENCE);
  });

  it("shows the busy text for a 429, the sentence for the cap, and the expired text for anything else", () => {
    expect(consentRefusalText({ status: 429, error: "temporarily_unavailable" })).toBe("Coppice is busy connecting assistants right now. Wait a minute, then try again.");
    expect(consentRefusalText({ status: 400, error: "invalid_request", error_description: SENTENCE })).toBe(SENTENCE);
    expect(consentRefusalText({ status: 400, error: "invalid_request", error_description: "Scope not originally requested" })).toBe("This request has expired. Go back to your assistant and connect again.");
    expect(consentRefusalText({ status: 400, error: "invalid_signature" })).toBe("This request has expired. Go back to your assistant and connect again.");
    expect(consentRefusalText(null)).toBe("This request has expired. Go back to your assistant and connect again.");
  });
});

describe("the wait after a refused or failed fetch", () => {
  const noStore = { "cache-control": "no-store" };
  const fill = async (connected: boolean, count: number) => {
    for (let i = 0; i < count; i++) await allowDocumentFetch(`https://fill-${++counter}.example/c.json`, async () => connected);
  };

  it("a full connected budget refuses a refresh with 429 and Retry-After 60, and the id waits a minute even when the budget frees at once", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { GET, POST } = await route();
    const good = nextUrl();
    const fake = serve({ [good]: jsonReply(metadata(good), noStore) });
    const connected = await connectDocument(good);
    vi.setSystemTime(Date.now() + (CACHE_FLOOR_SECONDS + 1) * 1000);
    resetCimdBudgets();
    await fill(true, CONNECTED_FETCHES_PER_MINUTE);
    const start = Date.now();

    const refused = await POST(tokenRequest(good, connected.refreshToken));
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("60");
    expect((await refused.json()).error_description).toBe("too many assistants are refreshing, try again in a minute");

    // The budget empties at once. The plugin still keeps the id out for a minute.
    resetCimdBudgets();
    vi.setSystemTime(start + 30_000);
    const plugins = await auth.handler(tokenRequest(good, connected.refreshToken));
    expect(plugins.status).toBe(429);
    // The plugin's own answer has no retry time. The route handler adds it, on POST and on GET.
    expect(plugins.headers.get("retry-after")).toBeNull();
    const viaRoute = await POST(tokenRequest(good, connected.refreshToken));
    expect(viaRoute.status).toBe(429);
    expect(viaRoute.headers.get("retry-after")).toBe("60");
    const query = new URLSearchParams({ response_type: "code", client_id: good, redirect_uri: REDIRECT_URI, scope: ALL, code_challenge: "x".repeat(43), code_challenge_method: "S256" });
    const getAnswer = await GET(appRequest(`/api/auth/oauth2/authorize?${query}`, { redirect: "manual" }));
    expect(getAnswer.status).toBe(429);
    expect(getAnswer.headers.get("retry-after")).toBe("60");
    expect(seenFor(fake, [good])).toBe(1);

    vi.setSystemTime(start + 61_000);
    const renewed = await POST(tokenRequest(good, connected.refreshToken));
    expect(renewed.status).toBe(200);
    expect(seenFor(fake, [good])).toBe(2);
  });

  it("leaves a retry time that is already there, and any 429 outside the OAuth paths, as it is", async () => {
    const tooMany = (headers: Record<string, string> = {}) => new Response("{}", { status: 429, headers });
    const oauth = (path = "/api/auth/oauth2/token") => appRequest(path, { method: "POST" });
    // A 429 under /oauth2/ with no retry time gets one, and keeps its body and other headers.
    const added = withRetryAfter(oauth(), tooMany({ "x-other": "kept" }));
    expect(added.headers.get("retry-after")).toBe("60");
    expect(added.headers.get("x-other")).toBe("kept");
    expect(await added.text()).toBe("{}");
    // One that has its own is not changed, and is not given a second value.
    expect(withRetryAfter(oauth(), tooMany({ "Retry-After": "5" })).headers.get("retry-after")).toBe("5");
    // Other statuses under /oauth2/ and 429s elsewhere are left alone.
    expect(withRetryAfter(oauth(), new Response("{}", { status: 400 })).headers.get("retry-after")).toBeNull();
    expect(withRetryAfter(oauth(), new Response("{}", { status: 200 })).headers.get("retry-after")).toBeNull();
    expect(withRetryAfter(oauth("/api/auth/sign-in/social"), tooMany()).headers.get("retry-after")).toBeNull();
    expect(withRetryAfter(oauth("/api/auth/oauth2"), tooMany()).headers.get("retry-after")).toBeNull();

    // A real 429 outside the OAuth paths: Better Auth's own limit on sign-in attempts from one address.
    const { POST } = await route();
    const ip = fromNewIp();
    const attempt = () =>
      POST(appRequest("/api/auth/sign-in/social", { method: "POST", headers: { ...ip, "content-type": "application/json" }, body: JSON.stringify({ provider: "google", callbackURL: "/" }) }));
    let limited: Response | null = null;
    for (let i = 0; i < 6 && !limited; i++) {
      const answer = await attempt();
      if (answer.status === 429) limited = answer;
    }
    expect(limited).not.toBeNull();
    expect(limited?.headers.get("retry-after")).toBeNull();
  });

  it("the CORS answer on the token endpoint exposes Retry-After", async () => {
    const { POST, OPTIONS } = await route();
    const answered = await POST(tokenRequest("assistant-registered-1", "nope"));
    expect(answered.headers.get("access-control-expose-headers")).toContain("Retry-After");
    expect(OPTIONS(appRequest("/api/auth/oauth2/token", { method: "OPTIONS" })).headers.get("access-control-expose-headers")).toContain("Retry-After");
  });

  it("the consent page with the fetch budget used up says Coppice is busy, not that the link expired", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = nextUrl();
    serve({ [url]: jsonReply(metadata(url), noStore) });
    const { location } = await authorize(url, "ownerA", { scope: ALL, challenge: pkce().challenge });
    const page = async () => {
      const search: Record<string, string | string[]> = {};
      for (const key of new Set(location.searchParams.keys())) search[key] = location.searchParams.getAll(key);
      return renderToStaticMarkup(await asUser("ownerA", async () => ConsentPage({ searchParams: Promise.resolve(search) } as Parameters<typeof ConsentPage>[0])));
    };
    expect(await page()).toContain("Doc Assistant");
    // The copy of the document has run out, and the 30 slots for new assistants are gone.
    vi.setSystemTime(Date.now() + (CACHE_FLOOR_SECONDS + 1) * 1000);
    await fill(false, NEW_CLIENT_FETCHES_PER_MINUTE);
    const busy = await page();
    expect(busy).toContain("Coppice is busy connecting assistants right now. Wait a minute, then reload this page.");
    expect(busy).not.toContain("This link has expired");
    expect(busy).not.toContain("Allow");
  });

  it("a link that is gone still says it has expired", async () => {
    const url = nextUrl();
    serve({ [url]: jsonReply(metadata(url)) });
    const { location } = await authorize(url, "ownerA", { scope: ALL, challenge: pkce().challenge });
    const search: Record<string, string | string[]> = {};
    for (const key of new Set(location.searchParams.keys())) search[key] = location.searchParams.getAll(key);
    search.client_id = "https://nobody.example/c.json";
    const markup = renderToStaticMarkup(await asUser("ownerA", async () => ConsentPage({ searchParams: Promise.resolve(search) } as Parameters<typeof ConsentPage>[0])));
    expect(markup).toContain("This link has expired");
  });
});
