import { APIError } from "better-auth/api";
import type { Prisma } from "@/generated/prisma/client";
import { advisoryXactLock, prisma } from "@/lib/db";
import { metadataUrlProblem } from "@/lib/mcp/cimd-fetch";

// How many times a minute Coppice may fetch a client metadata document, counted at the place
// where the fetch happens (lib/auth.ts, the isMetadataDocumentUrlAllowed option of cimd()).
//
// Why here. The plugin calls that option with the exact client_id it has resolved, awaited, once
// for every network fetch (a re-read of a stored document included), right before the request.
// Every endpoint where the plugin looks a client up ends up there: authorize, token, revoke,
// consent, continue, public-client, end-session, introspect and userinfo, the last two through the
// azp of an access token. So these budgets do not depend on how a request was written or which
// field named the client. The first filter in lib/mcp/cimd-gate.ts reads requests the way the
// plugin does and keeps recognisable junk away from the plugin, but anything it misses is still
// counted here.
//
// What an answer looks like. When a budget is used up, the option throws a 429 with the error
// temporarily_unavailable and a Retry-After of 60 seconds. The plugin passes that on unchanged
// on authorize (which answers JSON, not a redirect), token, revoke, consent, continue and
// public-client. It wraps it on three endpoints: end-session answers 500 server_error "Unable to
// resolve the logout client", userinfo answers 401 invalid_token, and introspect answers
// {"active":false} for the azp of a token. The consent page catches it and says Coppice is busy.
// The plugin also treats a refusal as a failed fetch (see lib/auth.ts for what that costs).
//
// The three budgets, each a sliding minute kept in memory by one server instance:
// - A client nobody has allowed (no consent row names it) takes one of 30 slots, and no more than
//   5 of those for one site (URL origin), so the 30 cannot all be aimed at one site. Nothing a
//   client like that does can take a slot from the other two budgets.
// - A client somebody allowed, whose last fetch on this instance ended with the document stored (or
//   that this instance has not allowed a fetch for yet, or whose mark was pushed out of the 2000
//   kept), takes one of 120 slots.
// - A client somebody allowed whose last fetch on this instance did not end with the document
//   stored takes one of 20 slots and never one of the 120. Without that, about 120 allowed documents
//   that stopped answering, each retried once a minute, would use the 120 for good. How it is known: when the
//   option allows a fetch for an allowed client it marks that client. The cimd options
//   onClientCreated and onClientRefreshed (lib/auth.ts) remove the mark. The plugin calls them
//   only after it has stored the document, and a 304 from a revalidation reaches
//   onClientRefreshed, so a client that is still marked when it is next fetched is failing. The
//   marks live in a map of at most 2000 clients, and the oldest mark is dropped first.
// A refused fetch takes no slot. The clients that count as allowed are read from the database (one
// query, taken as a parameter so that tests of the counters need no database). If that query
// fails, the answer is the same 429 and not a raw error.
//
// What these budgets rest on, outside this file. The plugin can also fetch a client's jwks_uri
// (private_key_jwt) through the same transport without calling the option. That can't happen,
// because lib/mcp/cimd-fetch.ts refuses a document that names a jwks_uri and any
// token_endpoint_auth_method other than none. Those two refusals are part of what these budgets
// rest on. A fetch is also bounded to 5 seconds and 5 KB there, so at most 30 fetches for
// clients nobody allowed can be in flight at once.
//
// Where they stop. All counters are in memory per server instance (in development, per reload),
// so a second instance has its own. The first fetch of an allowed client that this instance has
// not fetched yet counts as healthy, whenever it happens. So each failing allowed document can take
// one of the 120 once per instance, at a time its sender chooses, before its mark sends it to the
// 20: a set of more than about 120 can use the 120 for a minute, or part of it over several
// minutes. The account cap at the bottom of this file limits how many documents one person can
// allow.

export const NEW_CLIENT_FETCHES_PER_MINUTE = 30;
export const NEW_CLIENT_FETCHES_PER_SITE_PER_MINUTE = 5;
export const CONNECTED_FETCHES_PER_MINUTE = 120;
export const FAILING_CONNECTED_FETCHES_PER_MINUTE = 20;
export const MAX_FAILING_MARKS = 2000;
export const MAX_DOCUMENT_CLIENTS_PER_ACCOUNT = 10;

const WINDOW_MS = 60_000;
const CIMD_DISCOVERY_ID = "cimd";

// True when at least one consent row names the client: a person allowed it.
export type ConsentReader = (clientId: string) => Promise<boolean>;

// The default reader. count with take 1 stops at the first row. No other read on the paths the fetch
// point runs on uses count on this table, which lets a test make exactly this read fail.
export const clientHasConsent: ConsentReader = async (clientId) => (await prisma.oauthConsent.count({ where: { clientId }, take: 1 })) > 0;

// Start times, oldest first. Each list is trimmed to the last minute whenever it is used.
type Start = { at: number; origin: string };
const newStarts: Start[] = [];
const connectedStarts: Start[] = [];
const failingStarts: Start[] = [];
// Allowed clients whose last allowed fetch has not ended with the document stored.
const marks = new Map<string, true>();

function trim(starts: Start[], now: number) {
  while (starts.length > 0 && now - starts[0].at >= WINDOW_MS) starts.shift();
}

export function resetCimdBudgets() {
  newStarts.length = 0;
  connectedStarts.length = 0;
  failingStarts.length = 0;
  marks.clear();
}

// What each counter used in the last minute, and how many clients are marked. For tests.
export function cimdBudgetSnapshot(now = Date.now()) {
  for (const starts of [newStarts, connectedStarts, failingStarts]) trim(starts, now);
  return { newClients: newStarts.length, connected: connectedStarts.length, failingConnected: failingStarts.length, marked: marks.size };
}

// Called by the cimd options onClientCreated and onClientRefreshed: the document was stored.
export function clearFailingMark(clientId: string) {
  marks.delete(clientId);
}

function refusal(description: string) {
  return new APIError("TOO_MANY_REQUESTS", { error: "temporarily_unavailable", error_description: description }, { "Retry-After": "60" });
}

// The body of isMetadataDocumentUrlAllowed. Returns false for an address Coppice would never fetch,
// returns true after taking a slot, and throws the 429 when the slot is not there.
export async function allowDocumentFetch(clientId: string, readConsent: ConsentReader = clientHasConsent, clock: () => number = Date.now): Promise<boolean> {
  if (metadataUrlProblem(clientId) !== null) return false;
  let connected: boolean;
  try {
    connected = await readConsent(clientId);
  } catch (error) {
    console.error("[cimd] the consent lookup for the fetch budget failed:", error instanceof Error ? error.name : "unknown error");
    throw refusal("Coppice could not check this assistant just now, try again in a minute");
  }
  // Everything from here to the return runs without waiting, so two requests can't take one slot.
  const now = clock();
  if (!connected) {
    trim(newStarts, now);
    const origin = new URL(clientId).origin;
    if (newStarts.length >= NEW_CLIENT_FETCHES_PER_MINUTE || newStarts.filter((start) => start.origin === origin).length >= NEW_CLIENT_FETCHES_PER_SITE_PER_MINUTE) {
      throw refusal("too many new assistants are connecting, try again in a minute");
    }
    newStarts.push({ at: now, origin });
    return true;
  }
  const failing = marks.has(clientId);
  const starts = failing ? failingStarts : connectedStarts;
  trim(starts, now);
  if (starts.length >= (failing ? FAILING_CONNECTED_FETCHES_PER_MINUTE : CONNECTED_FETCHES_PER_MINUTE)) {
    throw refusal("too many assistants are refreshing, try again in a minute");
  }
  starts.push({ at: now, origin: "" });
  marks.delete(clientId);
  marks.set(clientId, true);
  while (marks.size > MAX_FAILING_MARKS) {
    const oldest = marks.keys().next().value;
    if (oldest === undefined) break;
    marks.delete(oldest);
  }
  return true;
}

// A cap on the assistants one account can connect through a metadata document. Using up the 120
// slots with documents that answer takes about 600 of them (one fetch every five minutes each), so
// one person may hold at most MAX_DOCUMENT_CLIENTS_PER_ACCOUNT. Registered assistants are not
// counted. A refusal is a 400 with the sentence below, which the consent buttons show
// (components/oauth-consent.tsx).
//
// Where it is enforced: at the insert of the consent row. lib/auth.ts gives Better Auth a database
// client whose oauthConsent.create is createConsentWithinCap. The only place the installed plugins
// create a consent is the consent endpoint (oauth-provider, consentEndpoint), which does so through
// the adapter and so through that call. The other write to this table that an HTTP request could
// reach, /oauth2/update-consent, only updates a row and is in disabledPaths (lib/auth.ts). For a
// document assistant the count and the insert run in one transaction that first takes an advisory
// lock for the person, the way the app's other limits do (lib/db.ts). Two Allows for one person
// therefore go one after the other, on every server instance, and the second counts what the first
// stored. So the rows can't go past the maximum whatever order requests arrive in, and whatever the
// endpoint does after the insert. An Allow at the maximum is refused before anything is stored, and
// the plugin makes no authorization code for it. When the person already has a consent row for the
// assistant, the plugin updates that row and never reaches this call. A second row for the same
// assistant is not counted again.
//
// What is accepted:
// - Each insert for a document assistant holds one pooled connection for a short transaction, and
//   may wait there for another Allow by the same person to finish (maxWait 10 s, timeout 15 s). A
//   stall longer than that fails that Allow with a 500 and stores nothing.
// - A consent row can be stored by an Allow that then answers an error, because the plugin inserts
//   before its last steps. That row is within the cap, shows in Settings and can be disconnected.
//   This was so before the cap existed.
// - Two rows for one person and one assistant are possible (the table has no unique index on them)
//   and count once.
const CAP_SENTENCE = `You have connected ${MAX_DOCUMENT_CLIENTS_PER_ACCOUNT} assistants this way. Disconnect one in Settings first.`;

// prisma.oauthConsent.create with the cap applied. A consent for a registered assistant, or one
// with no person on it, is stored as it is.
export async function createConsentWithinCap<A extends Prisma.OauthConsentCreateArgs>(args: A) {
  const { userId, clientId } = args.data as { userId?: unknown; clientId?: unknown };
  if (typeof userId !== "string" || typeof clientId !== "string") return prisma.oauthConsent.create(args);
  const client = await prisma.oauthClient.findFirst({ where: { clientId }, select: { clientDiscoveryId: true } });
  if (client?.clientDiscoveryId !== CIMD_DISCOVERY_ID) return prisma.oauthConsent.create(args);
  return prisma.$transaction(
    async (tx) => {
      await advisoryXactLock(tx, `document-clients:${userId}`);
      const held = await tx.oauthConsent.findMany({
        where: { userId, oauthclient: { clientDiscoveryId: CIMD_DISCOVERY_ID } },
        select: { clientId: true },
        distinct: ["clientId"],
        take: MAX_DOCUMENT_CLIENTS_PER_ACCOUNT + 1,
      });
      if (held.length >= MAX_DOCUMENT_CLIENTS_PER_ACCOUNT && !held.some((row) => row.clientId === clientId)) {
        throw new APIError("BAD_REQUEST", { error: "invalid_request", error_description: CAP_SENTENCE });
      }
      return tx.oauthConsent.create(args);
    },
    // Room for the pooler, and for a few Allows waiting on the same lock.
    { maxWait: 10_000, timeout: 15_000 },
  );
}
