import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { registrationProblem } from "@/lib/mcp/oauth-limits";
import { isBlockedAddress } from "@/lib/research/addresses";
import { defaultDeps, raceAbort, readLimited, type FetchDeps, type TransportResponse } from "@/lib/research/fetch";
import { checkUrl } from "@/lib/research/urls";

// The network side of Client ID Metadata Documents (lib/auth.ts, cimd()). An assistant that
// identifies itself with a URL makes the Coppice server fetch that URL, and anyone can start one
// (the authorize endpoint looks the client up before it asks for a sign-in). So the danger is the
// same as in lib/research/fetch.ts: server-side request forgery, a URL or DNS answer that makes
// the server call something on a private network. The plugin checks the document's text and
// leaves the network to the app: its transport must resolve the name once, refuse special-use
// addresses, connect to the address it approved and never follow a redirect. This is that
// transport, built from the research fetcher's parts:
//   1. the URL passes checkUrl() and is https (no user:password, standard port only, no IP
//      literal, no local names) and the request is a GET;
//   2. the name is resolved once, and the fetch is refused if there is no answer or ANY answer is
//      private, loopback, link-local, CGNAT, unique-local, IPv4-mapped, multicast, reserved or a
//      metadata address (lib/research/addresses.ts);
//   3. one connection, pinned to the first checked address, with TLS checked against the
//      hostname, its own agent and no proxy from the environment (nodeTransport);
//   4. a redirect is never followed: any reply that is not a 200 or a 304 goes back as a bare
//      status, so the plugin answers "returned HTTP 302" and the target is never requested;
//   5. time and size are limited, the body is read as a stream and cut off at the limit, and a
//      compressed body is refused;
//   6. the freshness the plugin sees is decided here, not by the origin (see below).
// It does not reuse fetchResearchPage or safeFetch: they follow redirects, and a followed hop comes
// back as a fresh Response with redirected set to false, which would hide the redirect from the
// plugin's own check. They also need an approved-host list and robots.txt, which do not apply here.
//
// How long a checked document is reused. The plugin keeps a document it has checked in memory for
// as long as the reply's cache headers allow, and fetches it again on the next request that names
// it once that time is over. A document that says no-store, private or max-age=0 would therefore
// cost one fetch for every request that names it, and the token endpoint answers anyone without a
// sign-in. The Client ID Metadata Document draft tells servers to respect a document's cache
// headers and lets them set their own lower and upper bounds. This transport does that: it reads
// what the origin declared, takes off the Age, and keeps the result between CACHE_FLOOR_SECONDS
// and CACHE_CEILING_SECONDS (cacheLifetimeSeconds). Then it hands the plugin one cache header it
// wrote itself, max-age with that number, and none of the origin's cache-control, expires, date,
// age or vary. So a no-store document that answers is fetched at most once every five minutes on an
// instance, and a changed document is picked up within five minutes at the latest. The floor only
// applies to a document that answers: the plugin keeps nothing for a fetch that failed, so a
// document that has started to fail is fetched again on every request that names it, held back
// only by the plugin's one-second wait for one client and its limit per site. Only the content type
// and the validators (etag and last-modified) are passed on as they came, so the plugin's
// revalidation still sends If-None-Match when it can. A 304 gets the same header when it carries
// cache-control or expires, and none when it carries neither, which keeps the header the plugin
// stored from the last check. Every other status goes back with no headers at all.
//
// Anything wrong is thrown, never returned: the plugin turns every throw into 400 invalid_client,
// and nothing here can throw from inside a socket listener, so a malformed reply can't take the
// process down (the packaged Node transport could, for a status outside 200 to 599).
//
// Coppice's own rules for what a client may be called (lib/mcp/oauth-limits.ts) run here on the
// document too, since the plugin applies them only to registration. A document may not use a name
// that reads as Coppice, carry control characters or a very long name, name a jwks_uri or a
// backchannel logout address (the server would later call them), or ask for a client secret.

export const CIMD_LIMITS = {
  // The plugin refuses a document over 5 KB as well; this stops reading at the same point.
  maxBytes: 5 * 1024,
  connectMs: 3_000,
  requestMs: 5_000,
};
export type CimdLimits = typeof CIMD_LIMITS;

// The shortest and longest time, in seconds, that a checked document is reused. The ceiling is
// also what a reply with no freshness information at all gets.
export const CACHE_FLOOR_SECONDS = 300;
export const CACHE_CEILING_SECONDS = 3600;

const USER_AGENT = "Coppice/1.0";
const URL_MAX = 512;
// The reply headers passed on as they came: the content type and the validators the plugin sends
// back with its next request. Freshness is written by cacheLifetimeSeconds instead.
const PASS_THROUGH = ["content-type", "etag", "last-modified"];
const FORWARDED_REQUEST_HEADERS = ["if-none-match", "if-modified-since"];

// What can be said about a metadata document URL without looking anything up. Also used by
// lib/auth.ts as the plugin's pre-fetch gate, which must stay free of DNS.
export function metadataUrlProblem(url: string): string | null {
  if (url.length > URL_MAX) return "the address is too long";
  const checked = checkUrl(url);
  if (!checked.ok) return `the address was refused (${checked.reason})`;
  if (checked.url.protocol !== "https:") return "only https addresses are used";
  return null;
}

function header(headers: TransportResponse["headers"], name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

// A header that may arrive more than once, joined the way HTTP joins a list, so that a repeated
// directive can be seen as repeated.
function listHeader(headers: TransportResponse["headers"], name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value.join(", ") : value;
}

// A freshness number as HTTP writes it: digits only, and small enough to be exact.
function wholeSeconds(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value.trim())) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

export type CacheHeaders = { cacheControl?: string; expires?: string; age?: string; vary?: string };

// How many seconds a checked document is reused, from the cache headers of its reply.
// 1. What the origin declared: a valid s-maxage, else a valid max-age, else the Expires date minus
//    now when it parses, else CACHE_CEILING_SECONDS when it said nothing usable. A repeated or
//    invalid s-maxage or max-age, no-store, private, no-cache and a Vary of * all count as 0.
// 2. A valid Age is taken off.
// 3. The result is held between CACHE_FLOOR_SECONDS and CACHE_CEILING_SECONDS.
export function cacheLifetimeSeconds(headers: CacheHeaders, nowMs = Date.now()): number {
  const directives = new Map<string, string | true>();
  const repeated = new Set<string>();
  for (const part of (headers.cacheControl ?? "").split(",")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    const name = rawName?.trim().toLowerCase();
    if (!name) continue;
    if (directives.has(name)) repeated.add(name);
    const value = rawValue.join("=").trim().replace(/^"|"$/g, "");
    directives.set(name, value || true);
  }
  const clamp = (seconds: number) => Math.min(CACHE_CEILING_SECONDS, Math.max(CACHE_FLOOR_SECONDS, Math.floor(seconds)));
  const varyAll = (headers.vary ?? "").split(",").some((field) => field.trim() === "*");
  if (directives.has("no-store") || directives.has("private") || directives.has("no-cache") || varyAll) return clamp(0);

  // s-maxage wins over max-age. When the one that applies is invalid or repeated, the origin
  // declared nothing usable: that counts as 0, and max-age is not tried instead.
  const applies = directives.has("s-maxage") ? "s-maxage" : directives.has("max-age") ? "max-age" : null;
  let declared: number;
  if (applies) {
    const value = directives.get(applies);
    declared = (repeated.has(applies) || typeof value !== "string" ? null : wholeSeconds(value)) ?? 0;
  } else {
    const expires = headers.expires ? Date.parse(headers.expires) : Number.NaN;
    declared = Number.isFinite(expires) ? Math.max(0, (expires - nowMs) / 1000) : CACHE_CEILING_SECONDS;
  }
  return clamp(declared - (wholeSeconds(headers.age) ?? 0));
}

function cacheHeadersOf(headers: TransportResponse["headers"]): CacheHeaders {
  return { cacheControl: listHeader(headers, "cache-control"), expires: header(headers, "expires"), age: header(headers, "age"), vary: listHeader(headers, "vary") };
}

// The headers the plugin gets: the ones passed on as they came and, when asked, the one cache
// header Coppice writes.
function passedHeaders(headers: TransportResponse["headers"], withFreshness: boolean): Headers {
  const out = new Headers();
  for (const name of PASS_THROUGH) {
    const value = header(headers, name);
    if (value !== undefined) out.set(name, value);
  }
  if (withFreshness) out.set("cache-control", `max-age=${cacheLifetimeSeconds(cacheHeadersOf(headers))}`);
  return out;
}

// What Coppice's own rules say about a document, or null. This fails closed: the plugin decodes
// the same bytes without checking them (an invalid byte becomes U+FFFD and the document goes on
// to be accepted), so a body that is not valid UTF-8, not JSON, or not a JSON object is refused
// here instead of being left to the plugin. Otherwise one stray byte, or a field the plugin
// strips, would let a document skip every rule below.
function documentProblem(bytes: Buffer): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return "the document is not a UTF-8 JSON object.";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "the document is not a UTF-8 JSON object.";
  const problem = registrationProblem(parsed);
  if (problem) return problem;
  const method = (parsed as Record<string, unknown>).token_endpoint_auth_method;
  if (method !== undefined && method !== "none") return "token_endpoint_auth_method must be none.";
  return null;
}

export function createCimdFetch(deps: FetchDeps = defaultDeps, limits: CimdLimits = CIMD_LIMITS): ClientMetadataResourceFetch {
  return async (input, init) => {
    const request = new Request(input, init);
    if (request.method !== "GET") throw new Error("Only GET is allowed.");
    const checked = checkUrl(request.url);
    if (!checked.ok) throw new Error(`The address was refused (${checked.reason}).`);
    const { url } = checked;
    if (url.protocol !== "https:") throw new Error("Only https addresses are used.");

    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(limits.requestMs)]);

    // Resolved once. Every answer must be public: a name with one public and one private address
    // could be connected to either.
    const addresses = await raceAbort(deps.lookup(url.hostname), signal);
    if (addresses.length === 0) throw new Error("The name did not resolve.");
    if (addresses.some((a) => isBlockedAddress(a.address))) throw new Error("The name points at a private or reserved address.");

    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": USER_AGENT, "Accept-Encoding": "identity" };
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers[name] = value;
    }

    const response = await raceAbort(deps.transport({ url, address: addresses[0], headers, signal, connectTimeoutMs: limits.connectMs }), signal);
    try {
      // new Response throws for a status outside 200 to 599; check first, never pass a reason phrase.
      if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599) {
        throw new Error(`The server answered with an unusable status (${response.status}).`);
      }
      // A 304 answers the validators the plugin sent. It gets the freshness header only when the
      // reply said something about freshness; otherwise the plugin keeps the one it stored.
      if (response.status === 304) {
        const said = cacheHeadersOf(response.headers);
        return new Response(null, { status: 304, headers: passedHeaders(response.headers, said.cacheControl !== undefined || said.expires !== undefined) });
      }
      // Every redirect and every error goes back as a bare status. The redirect is never followed.
      if (response.status !== 200) return new Response(null, { status: response.status });

      const encoding = (header(response.headers, "content-encoding") ?? "identity").trim().toLowerCase();
      if (encoding !== "identity" && encoding !== "") throw new Error("The document is compressed.");
      const declared = Number(header(response.headers, "content-length"));
      if (Number.isFinite(declared) && declared > limits.maxBytes) throw new Error("The document is too large.");

      const read = await readLimited(response, limits.maxBytes, signal);
      if (!read.ok) throw new Error(`The document could not be read (${read.reason}).`);

      const problem = documentProblem(read.bytes);
      if (problem) {
        console.warn(`[cimd] refused the metadata document from ${url.hostname}: ${problem}`);
        throw new Error(problem);
      }
      return new Response(new Uint8Array(read.bytes), { status: 200, headers: passedHeaders(response.headers, true) });
    } finally {
      response.close();
    }
  };
}

export const cimdFetch = createCimdFetch();
