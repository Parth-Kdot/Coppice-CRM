import { APIError } from "better-auth/api";
import { prisma } from "@/lib/db";
import { metadataUrlProblem } from "@/lib/mcp/cimd-fetch";

// Who may make Coppice fetch a client's metadata document (lib/auth.ts, hooks.before).
//
// The plugin looks a client up by its client_id on many endpoints. For an https client_id it has
// no fresh copy of, a lookup is a fetch, and it takes a slot from a budget that the whole server
// instance shares (120 fetches a minute) before it does anything else, even when the fetch then
// fails. /oauth2/authorize does this before it asks for a sign-in, so anyone can start one. The
// plugin also saves a client row as soon as a first fetch succeeds, before anybody has signed in
// or allowed anything, so a row alone proves nothing about an assistant.
//
// A client is connected when its oauthClient row exists and either it was not made from a
// metadata document (clientDiscoveryId is not "cimd") or at least one oauthConsent row names it,
// which means a person allowed it. Disconnect in Settings deletes the consent, so an assistant
// nobody has connected any more is not connected again. A code is only issued after a consent is
// stored, so a real assistant is connected before its first token request.
//
// What this does, for every request that names an https client_id:
// - A connected client is never touched here.
// - The token, revoke, introspect and end-session endpoints answer invalid_client at once for a
//   client that is not connected, whether it has no row or a metadata document row nobody allowed.
//   The plugin is not called, so nothing is fetched.
// - The consent, continue, public-client and public-client-prelogin endpoints do the same for an
//   address with no row. For a metadata document row nobody has allowed yet they let the request
//   through, because the first connect needs them.
// - /oauth2/authorize lets a request through for any client that is not connected, with a row or
//   without. An address with no row that Coppice would never fetch (http, an IP address, a private
//   name, too long) is refused first, before it takes a slot from the plugin's budget.
// - Every request let through for a client that is not connected takes one slot from
//   NEW_CLIENT_FETCHES_PER_MINUTE for each such client it names, on every one of those paths. The
//   slots last a minute and are kept in memory by this instance. When none are left the answer is
//   429 temporarily_unavailable with Retry-After, and a new assistant tries again a minute later.
//   For the nine paths in CLIENT_LOOKUP_PATHS this share is the only way a client that is not
//   connected can make Coppice fetch. A first connect takes four or five slots: authorize,
//   continue (which counts twice, because the plugin runs authorize again from inside it), the
//   consent page's lookup and the consent itself.
// - Which client a request names is read the way the plugin reads it, including the user part of a
//   Basic header (decoded as the plugin decodes it: a bad escape such as %zz stays as it is, a
//   leading byte order mark is dropped). On the token, revoke, introspect and end-session paths a
//   Basic user that mentions https in any letter case, in the raw text or after either way of
//   decoding it, is refused unless what the plugin makes of it is a connected client.
//
// Why connected assistants are not starved, and where that stops. The share is a quarter of the
// plugin's budget of 120 fetches a minute (lib/auth.ts), so the other 90 a minute can only be
// used by requests that name a connected client. That counts fetch starts only. The plugin's limit
// on fetches in flight (16 at once) is shared by everyone, and the share does not bound it: a
// sender whose documents are slow can have clients that are not connected hold all 16 for up to 5
// seconds each (the transport's time limit), and the 30 slots allow that for about 10 seconds of
// every minute. A connected assistant whose cached document has run out and that needs a fetch in
// such a window gets 429 and succeeds when it tries again.
//
// For a connected client the transport's freshness floor (lib/mcp/cimd-fetch.ts) keeps a document
// that answers reused for at least five minutes, so it costs at most one fetch every five minutes
// per instance. That does not hold for a connected document that has started to fail: the plugin
// stores only a fetch that worked, so every request that names it fetches again, held back only
// by the plugin's one-second wait between fetches for one client and its limit of 10 a minute for
// one site. One account that allowed a dozen connected documents on different sites, all failing,
// could use the whole 120 a minute until they stop being named.
//
// What this does not do:
// - A first fetch can't wait for a sign-in: the plugin signs the sign-in redirect itself and gives
//   no way to do that without resolving the client first. So no account is required, and a
//   determined sender can hold the share at zero. That delays new connections only.
// - The plugin still saves a row for every valid document it fetches, nobody allowed or not, at
//   most 30 a minute per instance. Open registration already lets anyone save client rows, and no
//   clean-up job exists.
// - One signed-in account that allows hundreds of its own documents is not limited. Each one is a
//   consent row tied to that account, and each one that answers costs one fetch every five
//   minutes per instance.

export const NEW_CLIENT_FETCHES_PER_MINUTE = 30;
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

// Start times of the new-client lookups this instance let through in the last minute. In memory,
// like the plugin's own budget, so the two stay comparable.
const lookupStarts: number[] = [];

export function resetNewClientFetches() {
  lookupStarts.length = 0;
}

function takeNewClientFetches(count: number, now = Date.now()): boolean {
  while (lookupStarts.length > 0 && now - lookupStarts[0] >= WINDOW_MS) lookupStarts.shift();
  if (lookupStarts.length + count > NEW_CLIENT_FETCHES_PER_MINUTE) return false;
  for (let i = 0; i < count; i++) lookupStarts.push(now);
  return true;
}

// The plugin refuses these shapes itself, but only after it has taken a slot from its budget.
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

// The claims of a JWT, read without checking the signature. Only used to learn which client a
// request names; the plugin does the verifying.
function unverifiedClaims(jwt: unknown): Record<string, unknown> {
  if (typeof jwt !== "string") return {};
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8"));
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

type Source = { query?: unknown; body?: unknown; headers?: Headers | null; request?: Request | null };

// Every client_id a request names, wherever the plugin would look for one, and the user parts of
// its Basic header as they were sent.
async function namedClientIds(source: Source): Promise<{ ids: string[]; basicUsers: string[] }> {
  const basicUsers: string[] = [];
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
    add(assertion.sub);
    add(assertion.iss);
    const hint = unverifiedClaims(fields.id_token_hint);
    add(hint.azp);
    for (const aud of Array.isArray(hint.aud) ? hint.aud : [hint.aud]) add(aud);
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
  return { ids: [...found].filter(isHttpsUrl), basicUsers };
}

// Throws the error the OAuth endpoints use when a request must not go on to the plugin, or
// returns. `path` is relative to /api/auth.
export async function guardClientLookup(path: string, source: Source): Promise<void> {
  if (!CLIENT_LOOKUP_PATHS.has(path)) return;
  const { ids: named, basicUsers } = await namedClientIds(source);
  const connectedOnly = CONNECTED_ONLY_PATHS.has(path);
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
  if (refused.length > 0 || unexplained) {
    const basic = /^Basic +/i.test(source.request?.headers.get("authorization") ?? "");
    throw new APIError(basic ? "UNAUTHORIZED" : "BAD_REQUEST", { error: "invalid_client", error_description: "client not found" }, basic ? { "WWW-Authenticate": "Basic" } : undefined);
  }
  for (const id of noRow) {
    if (unusableAddress(id)) {
      throw new APIError("BAD_REQUEST", { error: "invalid_client", error_description: "client_id is not an address Coppice can fetch." });
    }
  }
  if (!takeNewClientFetches(noRow.length + nobodyAllowed.length)) {
    throw new APIError(
      "TOO_MANY_REQUESTS",
      { error: "temporarily_unavailable", error_description: "too many new assistants are connecting, try again in a minute" },
      { "Retry-After": "60" },
    );
  }
}
