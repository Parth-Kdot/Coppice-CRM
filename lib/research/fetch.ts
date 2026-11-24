import { promises as dns, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isBlockedAddress } from "@/lib/research/addresses";
import { robotsAllows } from "@/lib/research/robots";
import { checkUrl, isApprovedHost, type SkipReason } from "@/lib/research/urls";

// The safe page fetcher for research briefs. The danger is server-side request forgery: a URL (or
// a redirect, or a DNS answer) that makes our server fetch something on a private network, such as
// a cloud metadata address. So, for every request and every redirect hop:
//   1. the URL passes checkUrl() (http/https, no user:password, standard port only, no IP literal,
//      no local names, not LinkedIn or a people-search site) and its host is on the approved list;
//   2. we resolve the name ourselves and refuse if ANY address is private, loopback, link-local,
//      CGNAT, unique-local, IPv4-mapped, multicast, reserved or a metadata address;
//   3. we connect to the address we checked (the request's DNS lookup is pinned to it), so a DNS
//      answer that changes between the check and the connection can't swap it; TLS still checks
//      the certificate against the hostname (SNI and Host stay the hostname);
//   4. robots.txt is honored (fetched through this same path), redirects are capped, and time,
//      size (counted while streaming) and content type are limited.
// Nothing here runs scripts: the body is returned as text and lib/research/html.ts strips it.
//
// It never uses a proxy from the environment: each request gets its own Agent, and Node's
// HTTPS_PROXY support (NODE_USE_ENV_PROXY) only applies to the global agents. DNS lookup and the
// connection are injectable so tests run fully offline.

export const USER_AGENT = "CoppiceResearch/1.0";

export const LIMITS = {
  maxRedirects: 3,
  maxBytes: 2 * 1024 * 1024,
  // RFC 9309 lets crawlers stop reading robots.txt after 500 KiB.
  robotsMaxBytes: 500 * 1024,
  connectMs: 5_000,
  requestMs: 10_000,
  // One page, its robots.txt and its redirects together.
  pageMs: 15_000,
};
export type Limits = typeof LIMITS;

export type Resolved = { address: string; family: 4 | 6 };

export type TransportRequest = {
  url: URL;
  // The checked address to connect to.
  address: Resolved;
  headers: Record<string, string>;
  signal: AbortSignal;
  connectTimeoutMs: number;
};
export type TransportResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
  // Stops reading and drops the connection.
  close: () => void;
};

export type FetchDeps = {
  lookup: (hostname: string) => Promise<Resolved[]>;
  transport: (request: TransportRequest) => Promise<TransportResponse>;
};

// ----- The real DNS and connection -----

async function systemLookup(hostname: string): Promise<Resolved[]> {
  const rows = await dns.lookup(hostname, { all: true, verbatim: true });
  return rows.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
}

// A DNS lookup that always answers with the address we already checked.
function pinnedLookup(address: Resolved) {
  return (
    _hostname: string,
    options: { all?: boolean },
    callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ) => {
    if (options?.all) callback(null, [{ address: address.address, family: address.family }]);
    else callback(null, address.address, address.family);
  };
}

export function nodeTransport({ url, address, headers, signal, connectTimeoutMs }: TransportRequest): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const secure = url.protocol === "https:";
    const options = {
      protocol: url.protocol,
      hostname: url.hostname,
      // safeFetch only ever passes default ports (checkUrl refuses others); tests use a local one.
      port: url.port ? Number(url.port) : secure ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers,
      // Its own agent: no connection pool shared with other requests, and no proxy.
      agent: secure ? new https.Agent({ keepAlive: false }) : new http.Agent({ keepAlive: false }),
      lookup: pinnedLookup(address),
      signal,
    };
    // TLS: SNI and the certificate check use the hostname, not the pinned address.
    const request = secure ? https.request({ ...options, servername: url.hostname }) : http.request(options);
    const connectTimer = setTimeout(() => request.destroy(Object.assign(new Error("connect timeout"), { name: "TimeoutError" })), connectTimeoutMs);
    request.on("socket", (socket) => socket.once(secure ? "secureConnect" : "connect", () => clearTimeout(connectTimer)));
    request.on("response", (response) => {
      clearTimeout(connectTimer);
      resolve({ status: response.statusCode ?? 0, headers: response.headers, body: response, close: () => response.destroy() });
    });
    request.on("error", (error) => {
      clearTimeout(connectTimer);
      reject(error);
    });
    request.end();
  });
}

export const defaultDeps: FetchDeps = { lookup: systemLookup, transport: nodeTransport };

// ----- Fetching -----

type FetchResult =
  | { ok: true; finalUrl: string; contentType: string; body: string }
  | { ok: false; reason: SkipReason; status?: number };

type FetchOptions = {
  approvedHosts: string[];
  deps: FetchDeps;
  limits: Limits;
  signal: AbortSignal;
  maxBytes: number;
  // Content types accepted (null: any), e.g. ["text/html", "text/plain"].
  contentTypes: string[] | null;
  // Asked before each request, the first and every redirect: a reason to skip it, or null.
  beforeRequest?: (url: URL) => Promise<SkipReason | null>;
};

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

// Resolves when the promise does, or rejects as soon as the signal aborts, whichever is first.
// The abort listener is always removed, so nothing is left behind.
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => {});
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

const header = (headers: TransportResponse["headers"], name: string) => {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
};

// Reads the body, stopping (and dropping the connection) the moment it passes maxBytes.
async function readLimited(response: TransportResponse, maxBytes: number, signal: AbortSignal): Promise<{ ok: true; bytes: Buffer } | { ok: false; reason: SkipReason }> {
  const iterator = response.body[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await raceAbort(iterator.next(), signal);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) return { ok: false, reason: "too_large" };
      chunks.push(next.value);
    }
  } catch {
    return { ok: false, reason: signal.aborted ? "timeout" : "network" };
  } finally {
    response.close();
  }
  return { ok: true, bytes: Buffer.concat(chunks) };
}

function decode(bytes: Buffer, contentType: string): string {
  const charset = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// The checks before each request, the first and every redirect hop: the host is approved, every
// address it resolves to is public, and robots.txt (via beforeRequest) allows it. Returns the
// checked addresses to connect to.
async function checkHop(url: URL, options: FetchOptions): Promise<{ ok: true; addresses: Resolved[] } | { ok: false; reason: SkipReason }> {
  const { deps, signal } = options;
  if (!isApprovedHost(url.hostname, options.approvedHosts)) return { ok: false, reason: "not_approved" };
  let addresses: Resolved[];
  try {
    addresses = await raceAbort(deps.lookup(url.hostname), signal);
  } catch {
    return { ok: false, reason: signal.aborted ? "timeout" : "dns" };
  }
  if (addresses.length === 0) return { ok: false, reason: "dns" };
  // All of them, not just the first: a name that answers with one public and one private
  // address could be connected to either.
  if (addresses.some((a) => isBlockedAddress(a.address))) return { ok: false, reason: "private_address" };
  // robots.txt last, so a refusal above names the real reason.
  const skip = options.beforeRequest ? await options.beforeRequest(url) : null;
  if (skip) return { ok: false, reason: skip };
  return { ok: true, addresses };
}

// One URL, following at most limits.maxRedirects redirects, every hop checked from scratch.
async function safeFetch(start: string, options: FetchOptions): Promise<FetchResult> {
  const { deps, limits, signal } = options;
  const first = checkUrl(start);
  if (!first.ok) return first;
  let url = first.url;

  for (let hop = 0; ; hop++) {
    const checked = await checkHop(url, options);
    if (!checked.ok) return checked;
    const { addresses } = checked;

    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(limits.requestMs)]);
    let response: TransportResponse;
    try {
      response = await raceAbort(
        deps.transport({
          url,
          address: addresses[0],
          headers: {
            "User-Agent": USER_AGENT,
            Accept: options.contentTypes ? `${options.contentTypes.join(", ")};q=0.9` : "*/*",
            // Compressed bodies would need inflating under the size limit; plain is simpler.
            "Accept-Encoding": "identity",
          },
          signal: requestSignal,
          connectTimeoutMs: limits.connectMs,
        }),
        requestSignal,
      );
    } catch {
      return { ok: false, reason: requestSignal.aborted ? "timeout" : "network" };
    }

    if (REDIRECTS.has(response.status)) {
      response.close();
      const location = header(response.headers, "location");
      if (!location) return { ok: false, reason: "bad_redirect" };
      if (hop >= limits.maxRedirects) return { ok: false, reason: "too_many_redirects" };
      let target: URL;
      try {
        target = new URL(location, url);
      } catch {
        return { ok: false, reason: "bad_redirect" };
      }
      const next = checkUrl(target);
      if (!next.ok) return next;
      url = next.url;
      continue;
    }
    const refused = refuseBody(response, options);
    if (refused) {
      response.close();
      return refused;
    }
    const contentType = header(response.headers, "content-type") ?? "";
    const read = await readLimited(response, options.maxBytes, requestSignal);
    if (!read.ok) return read;
    return { ok: true, finalUrl: url.href, contentType: mimeOf(contentType), body: decode(read.bytes, contentType) };
  }
}

const mimeOf = (contentType: string) => contentType.split(";")[0].trim().toLowerCase();

// Why a final (non-redirect) reply's body won't be read, or null to read it: not a 2xx, a content
// type that isn't allowed, a compressed body, or a declared length over the limit.
function refuseBody(response: TransportResponse, options: FetchOptions): Extract<FetchResult, { ok: false }> | null {
  if (response.status < 200 || response.status > 299) return { ok: false, reason: "http_status", status: response.status };
  const mime = mimeOf(header(response.headers, "content-type") ?? "");
  if (options.contentTypes && !options.contentTypes.includes(mime)) return { ok: false, reason: "content_type" };
  const encoding = (header(response.headers, "content-encoding") ?? "identity").trim().toLowerCase();
  if (encoding !== "identity" && encoding !== "") return { ok: false, reason: "content_type" };
  const declared = Number(header(response.headers, "content-length"));
  if (Number.isFinite(declared) && declared > options.maxBytes) return { ok: false, reason: "too_large" };
  return null;
}

// ----- A research page, with robots.txt -----

const PAGE_TYPES = ["text/html", "application/xhtml+xml", "text/plain"];

// robots.txt answers per site for one brief, so each is fetched once.
export type RobotsCache = Map<string, Promise<string | null | "unreachable">>;

// The robots.txt for this URL's site: its text, null when there is none (any 4xx: allowed, as
// RFC 9309 says), or "unreachable" (server error, timeout, blocked: treated as disallowed).
function robotsFor(url: URL, options: Omit<FetchOptions, "maxBytes" | "contentTypes" | "beforeRequest">, cache: RobotsCache) {
  const origin = url.origin;
  let entry = cache.get(origin);
  if (!entry) {
    entry = safeFetch(`${origin}/robots.txt`, { ...options, maxBytes: options.limits.robotsMaxBytes, contentTypes: null }).then((result) => {
      if (result.ok) return result.body;
      if (result.reason === "http_status" && result.status !== undefined && result.status >= 400 && result.status < 500) return null;
      return "unreachable";
    });
    cache.set(origin, entry);
  }
  return entry;
}

export type PageFetch = { ok: true; finalUrl: string; contentType: string; body: string } | { ok: false; reason: SkipReason };

// Fetches one approved page: robots.txt is checked for the URL and for every redirect target.
export async function fetchResearchPage(
  url: string,
  { approvedHosts, deps = defaultDeps, limits = LIMITS, robots = new Map() }: { approvedHosts: string[]; deps?: FetchDeps; limits?: Limits; robots?: RobotsCache },
): Promise<PageFetch> {
  const signal = AbortSignal.timeout(limits.pageMs);
  const base = { approvedHosts, deps, limits, signal };
  const result = await safeFetch(url, {
    ...base,
    maxBytes: limits.maxBytes,
    contentTypes: PAGE_TYPES,
    beforeRequest: async (target) => {
      const rules = await robotsFor(target, base, robots);
      if (rules === "unreachable") return "robots_unreachable";
      if (rules !== null && !robotsAllows(rules, `${target.pathname}${target.search}`, USER_AGENT)) return "robots";
      return null;
    },
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  return result;
}
