import { APIError } from "better-auth/api";
import { prisma } from "@/lib/db";
import { isUnstorableText, metadataUrlProblem } from "@/lib/mcp/cimd-fetch";

// A first filter in front of the plugin's client lookups (lib/auth.ts, hooks.before). It is not what
// protects the fetch budgets. Those sit where the fetch happens (lib/mcp/cimd-budget.ts, called from
// the cimd option isMetadataDocumentUrlAllowed), because that place sees the exact client_id the
// plugin is about to fetch, whichever endpoint and field named it. This file reads a request the way
// the plugin does as far as is known, and anything it misses is still counted at the fetch point. Its
// job is to keep requests it can recognise as junk from reaching the plugin at all, so that the
// plugin's own ceilings and its per client state stay far from full.
//
// The plugin looks a client up by its client_id on many endpoints. For an https client_id it has no
// fresh copy of, a lookup is a fetch. /oauth2/authorize does this before it asks for a sign-in, so
// anyone can start one. The plugin also saves a client row as soon as a first fetch succeeds, before
// anybody has signed in or allowed anything, so a row alone proves nothing about an assistant.
//
// A client is connected when its oauthClient row exists and either it was not made from a metadata
// document (clientDiscoveryId is not "cimd") or at least one oauthConsent row names it, which means a
// person allowed it. Disconnect in Settings deletes the consent, so an assistant nobody has connected
// any more is not connected again. A code is only issued after a consent is stored, so a real
// assistant is connected before its first token request.
//
// What this does first, for every request on the nine paths in CLIENT_LOOKUP_PATHS and every
// client_id it names, an https address or not:
// - A client_id that holds U+0000 or an unpaired surrogate is answered 400 invalid_client, before
//   this file's own query and before the plugin's lookup. Postgres refuses U+0000 in a text value
//   (error 22021), so such an id used to end as a raw 500: in the query below for an https id, and
//   in the plugin's lookup for any other, a registered-style id included. An unpaired surrogate
//   causes no error, but it reaches the database as U+FFFD, so the lookup would ask for another id
//   than the one that was named. No client row can hold either, so no real client is refused. The
//   answer is 400 with no Basic challenge even when the id came in a Basic header: the request is
//   malformed, and nothing was checked against a client.
//
// What this does next, for every request on those paths that names an https client_id:
// - A connected client is never touched here.
// - The token, revoke, introspect and end-session endpoints answer invalid_client at once for a
//   client that is not connected, whether it has no row or a metadata document row nobody allowed.
//   The plugin is not called, so nothing is fetched.
// - The consent, continue, public-client and public-client-prelogin endpoints do the same for an
//   address with no row. For a metadata document row nobody has allowed yet they let the request
//   through, because the first connect needs them.
// - /oauth2/authorize lets a request through for any client that is not connected, with a row or
//   without. An address with no row that Coppice would never fetch (http, an IP address, a private
//   name, too long) is refused first, before it reaches the plugin.
// - Every request let through for a client that is not connected takes one slot from
//   NEW_CLIENT_REQUESTS_PER_MINUTE (150) for each such client it names, on every one of those paths.
//   The slots last a minute and are kept in memory by this instance. When none are left the answer is
//   429 temporarily_unavailable with Retry-After. One first connect uses five of these slots
//   (authorize, continue which counts twice because the plugin runs authorize again from inside it,
//   the consent page's lookup, and the consent) and one fetch at the fetch point. So 150 requests
//   match the fetch point's 30 fetches a minute for new assistants, and stay far under the plugin's
//   own ceilings of 1000 fetches a minute.
// - Which client a request names is read the way the plugin reads it, including the user part of a
//   Basic header (decoded as the plugin decodes it: a bad escape such as %zz stays as it is, a
//   leading byte order mark is dropped) and the payload of a client_assertion or id_token_hint
//   (decoded as jose decodes it). On the token, revoke, introspect and end-session paths, a Basic
//   user that mentions https in any letter case, in the raw text or after either way of decoding it,
//   is refused unless what the plugin makes of it is a connected client, and a client_assertion or
//   id_token_hint that is a string whose claims can't be read is refused with invalid_client.
//
// What this does not do:
// - It has no rule for the OAuth paths outside the nine, and none of them hands a caller's client_id
//   to the client lookup: userinfo takes the id from a token Coppice issued (see the next point),
//   end-session/confirm reads it from a cookie Coppice signed, registration ignores a client_id in
//   its body, client/rotate-keys answers 403 before it reads its assertion because key rotation is
//   off, and client management over HTTP is disabled (lib/auth.ts). If key rotation is ever
//   switched on, client/rotate-keys must join CLIENT_LOOKUP_PATHS.
// - It does not read the azp of an access token, so the lookups that userinfo and introspect make for
//   a token's azp are not filtered here; the fetch point counts them. The client calling introspect
//   is still filtered. There is no rule for userinfo.
// - A first fetch can't wait for a sign-in: the plugin signs the sign-in redirect itself and gives no
//   way to do that without resolving the client first. So no account is required, and a determined
//   sender can use all 30 fetches a minute that new assistants get. That delays new connections only.
// - The plugin still saves a row for every valid document it fetches, nobody allowed or not, at most
//   30 a minute per instance. Open registration already lets anyone save client rows, and no clean-up
//   job exists.
// - Its count is in memory, per instance, like the fetch point's.

export const NEW_CLIENT_REQUESTS_PER_MINUTE = 150;
const WINDOW_MS = 60_000;
const CIMD_DISCOVERY_ID = "cimd";

// Paths (relative to /api/auth) where the plugin resolves a client from what the request names.
export const CLIENT_LOOKUP_PATHS = new Set([
  "/oauth2/authorize",
  "/oauth2/token",
  "/oauth2/revoke",
  "/oauth2/introspect",
  "/oauth2/end-session",
  "/oauth2/public-client",
  "/oauth2/public-client-prelogin",
  "/oauth2/consent",
  "/oauth2/continue",
]);

// Paths where a client that is not connected is answered invalid_client at once, with no lookup.
const CONNECTED_ONLY_PATHS = new Set(["/oauth2/token", "/oauth2/revoke", "/oauth2/introspect", "/oauth2/end-session"]);

// Start times of the new-client requests this instance let through in the last minute. In memory.
const lookupStarts: number[] = [];

export function resetNewClientRequests() {
  lookupStarts.length = 0;
}

function takeNewClientRequests(count: number, now = Date.now()): boolean {
  while (lookupStarts.length > 0 && now - lookupStarts[0] >= WINDOW_MS) lookupStarts.shift();
  if (lookupStarts.length + count > NEW_CLIENT_REQUESTS_PER_MINUTE) return false;
  for (let i = 0; i < count; i++) lookupStarts.push(now);
  return true;
}

// The plugin refuses these shapes itself, but only after it has taken slots from its own limits.
const DOT_SEGMENT = /\/(?:\.|%2e)(?:\.|%2e)?(?:\/|$|#|\?)/i;
function unusableAddress(id: string): boolean {
  if (DOT_SEGMENT.test(id) || id.includes("#") || id.includes("\\") || !/^https:\/\/[^/?#]/i.test(id)) return true;
  return !id.slice("https://".length).includes("/") || metadataUrlProblem(id) !== null;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

// Decodes one form-url-encoded value the way the plugin does for the user part of a Basic header
// (decodeBasicCredentials in @better-auth/core): URLSearchParams, which turns a plus into a space
// and leaves a bad escape (%zz, a lone %, bytes that are not UTF-8) as it is. decodeURIComponent
// throws on those, so using it would let a sender hide an address behind a bad escape.
function formUrlDecode(value: string): string {
  return new URLSearchParams(`v=${value}`).get("v") ?? value;
}

// The same value decoded strictly, or as it came when that throws. Only used to spot "https" in
// a user part, never to decide which client a request names.
function strictDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

const MENTIONS_HTTPS = /https/i;

// The claims of a JWT, read without checking the signature, the way jose reads a payload: base64url,
// then TextDecoder (which drops a leading byte order mark, as Buffer's toString would not), then
// JSON. Only used to learn which client a request names; the plugin does the verifying. A value that
// is not a string has no claims to read and gives an empty object. A non-empty string whose payload
// is not a JSON object gives null.
function unverifiedClaims(jwt: unknown): Record<string, unknown> | null {
  if (typeof jwt !== "string" || jwt === "") return {};
  try {
    const payload = JSON.parse(new TextDecoder().decode(Buffer.from(jwt.split(".")[1] ?? "", "base64url")));
    return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type Source = { query?: unknown; body?: unknown; headers?: Headers | null; request?: Request | null };

// Every client_id a request names, wherever the plugin would look for one and whatever its shape,
// and the user parts of its Basic header as they were sent.
async function namedClientIds(source: Source): Promise<{ ids: string[]; basicUsers: string[]; unreadable: boolean }> {
  const basicUsers: string[] = [];
  let unreadable = false;
  const found = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value) found.add(value);
  };
  const read = (part: unknown) => {
    if (!part || typeof part !== "object") return;
    const fields = part as Record<string, unknown>;
    add(fields.client_id);
    // A client_assertion names its client in sub or iss; an id_token_hint in aud or azp.
    const assertion = unverifiedClaims(fields.client_assertion);
    const hint = unverifiedClaims(fields.id_token_hint);
    if (assertion === null || hint === null) unreadable = true;
    add(assertion?.sub);
    add(assertion?.iss);
    add(hint?.azp);
    const audience = hint?.aud;
    for (const aud of Array.isArray(audience) ? audience : [audience]) add(aud);
    // The signed query that consent and continue carry.
    if (typeof fields.oauth_query === "string") add(new URLSearchParams(fields.oauth_query).get("client_id"));
  };
  read(source.query);
  read(source.body);

  const authorization = source.request?.headers.get("authorization") ?? source.headers?.get("authorization") ?? "";
  if (/^Basic +/i.test(authorization)) {
    // TextDecoder, like the plugin: it drops a leading byte order mark, which Buffer would keep.
    const decoded = new TextDecoder().decode(Buffer.from(authorization.replace(/^Basic +/i, ""), "base64"));
    const user = decoded.split(":")[0] ?? "";
    basicUsers.push(user);
    add(user);
    add(formUrlDecode(user));
  }

  // The token endpoint reads form bodies itself, from the raw text.
  const type = source.request?.headers.get("content-type")?.toLowerCase() ?? "";
  if (source.request && type.includes("application/x-www-form-urlencoded")) {
    try {
      const params = new URLSearchParams(await source.request.clone().text());
      read(Object.fromEntries(params));
      for (const id of params.getAll("client_id")) add(id);
    } catch {
      // The body was read already; what the router parsed is in `body`.
    }
  }
  return { ids: [...found], basicUsers, unreadable };
}

// Throws the error the OAuth endpoints use when a request must not go on to the plugin, or
// returns. `path` is relative to /api/auth.
export async function guardClientLookup(path: string, source: Source): Promise<void> {
  if (!CLIENT_LOOKUP_PATHS.has(path)) return;
  const { ids, basicUsers, unreadable } = await namedClientIds(source);
  // An id the database can't be asked for. This comes before every lookup, here and in the plugin.
  if (ids.some(isUnstorableText)) {
    throw new APIError("BAD_REQUEST", { error: "invalid_client", error_description: "client_id contains a NUL character or an unpaired surrogate." });
  }
  // The rest of this file is about addresses Coppice might fetch.
  const named = ids.filter(isHttpsUrl);
  const connectedOnly = CONNECTED_ONLY_PATHS.has(path);
  const refuseClient = (): never => {
    const basic = /^Basic +/i.test(source.request?.headers.get("authorization") ?? "");
    throw new APIError(basic ? "UNAUTHORIZED" : "BAD_REQUEST", { error: "invalid_client", error_description: "client not found" }, basic ? { "WWW-Authenticate": "Basic" } : undefined);
  };
  // A client_assertion or id_token_hint whose claims can't be read: the plugin would fail it, but
  // on these paths it is not left to find out which client it names.
  if (connectedOnly && unreadable) refuseClient();
  // A Basic user part that mentions https in any letter case, under any decoding.
  const httpsUsers = connectedOnly ? basicUsers.filter((user) => [user, formUrlDecode(user), strictDecode(user)].some((form) => MENTIONS_HTTPS.test(form))) : [];
  if (named.length === 0 && httpsUsers.length === 0) return;
  // One query: the rows, each with one consent if there is any.
  const rows =
    named.length === 0
      ? []
      : await prisma.oauthClient.findMany({
          where: { clientId: { in: named } },
          select: { clientId: true, clientDiscoveryId: true, oauthconsents: { select: { id: true }, take: 1 } },
        });
  const withRow = new Set(rows.map((row) => row.clientId));
  const noRow = named.filter((id) => !withRow.has(id));
  const nobodyAllowed = rows.filter((row) => row.clientDiscoveryId === CIMD_DISCOVERY_ID && row.oauthconsents.length === 0).map((row) => row.clientId);
  // A second layer on the paths that answer only connected clients: a Basic user that mentions
  // https is refused unless what the plugin makes of it is a connected client. The first layer
  // reads the user the way the plugin does, so this only matters if the two ever disagree.
  const connected = new Set(withRow);
  for (const id of nobodyAllowed) connected.delete(id);
  const unexplained = httpsUsers.some((user) => !connected.has(formUrlDecode(user)));
  if (noRow.length === 0 && nobodyAllowed.length === 0 && !unexplained) return;

  const refused = connectedOnly ? [...noRow, ...nobodyAllowed] : path === "/oauth2/authorize" ? [] : noRow;
  if (refused.length > 0 || unexplained) refuseClient();
  for (const id of noRow) {
    if (unusableAddress(id)) {
      throw new APIError("BAD_REQUEST", { error: "invalid_client", error_description: "client_id is not an address Coppice can fetch." });
    }
  }
  if (!takeNewClientRequests(noRow.length + nobodyAllowed.length)) {
    throw new APIError(
      "TOO_MANY_REQUESTS",
      { error: "temporarily_unavailable", error_description: "too many new assistants are connecting, try again in a minute" },
      { "Retry-After": "60" },
    );
  }
}
