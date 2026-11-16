import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins/jwt";
import { organization } from "better-auth/plugins/organization";
import { cimd } from "@better-auth/cimd";
import { mcp } from "@better-auth/mcp";
import { prisma } from "@/lib/db";
import { MCP_SCOPES, mcpResourceUrl } from "@/lib/mcp/config";
import { allowDocumentFetch, clearFailingMark, createConsentWithinCap } from "@/lib/mcp/cimd-budget";
import { cimdFetch } from "@/lib/mcp/cimd-fetch";
import { guardClientLookup } from "@/lib/mcp/cimd-gate";
import { endGrantsWithoutConsent } from "@/lib/mcp/connections";
import { SCOPE_CHECKED_PATHS, registrationProblem, scopeProblem } from "@/lib/mcp/oauth-limits";

// Only emails listed in WORKSPACE_CREATOR_EMAILS can create workspaces. Everyone else joins through
// an invitation.
export function canCreateWorkspace(email: string): boolean {
  const allowed = (process.env.WORKSPACE_CREATOR_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

// Fail fast: a missing setting stops the server at startup with a clear message,
// instead of breaking halfway through someone's sign-in.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env.`);
  return value;
}

// Better Auth reads BETTER_AUTH_SECRET itself; this only checks that it exists.
requireEnv("BETTER_AUTH_SECRET");

const workspaces = organization({
  // Enforced on the server, so hiding the create form is not the only guard.
  allowUserToCreateOrganization: (user) => canCreateWorkspace(user.email),
  // Invitations are accepted from inside the app (the app never sends email).
  sendInvitationEmail: async () => {},
  invitationExpiresIn: 60 * 60 * 24 * 7,
  cancelPendingInvitationsOnReInvite: true,
  requireEmailVerificationOnInvitation: true,
  // Better Auth's own delete stays off: it removes the memberships before the workspace, which the
  // keep-an-owner trigger refuses. An owner deletes a workspace from Settings through
  // lib/workspaces.ts (deleteWorkspace), which deletes the workspace row and lets everything cascade.
  disableOrganizationDeletion: true,
  // Better Auth calls these "organization" and "member"; we call them Workspace and
  // Membership, with workspaceId everywhere, to match the rest of the schema.
  schema: {
    session: { fields: { activeOrganizationId: "activeWorkspaceId" } },
    organization: {
      modelName: "workspace",
      additionalFields: {
        claimWindowDays: { type: "number", required: true, defaultValue: 14, input: false },
      },
    },
    member: { modelName: "membership", fields: { organizationId: "workspaceId" } },
    invitation: { fields: { organizationId: "workspaceId" } },
  },
});

// The browser never calls Better Auth's workspace endpoints; it only signs in and out.
// Every workspace change goes through our server actions (which call auth.api directly,
// not over HTTP), so all of /api/auth/organization/* is switched off. Without this, any
// member could call list-members to read every member's email, or skip our owner checks.
// The list comes from the plugin itself, so endpoints added in later versions are blocked too.
const workspaceHttpPaths = Object.values(workspaces.endpoints)
  .map((endpoint) => endpoint.path)
  .filter((path): path is string => typeof path === "string");

// The MCP server (app/api/mcp): outside AI assistants sign in here with OAuth and get a short-lived
// token for Coppice. The plugins do all of the OAuth work (registration, consent, PKCE, signing);
// nothing here is hand-written token logic. Choices that matter:
// - Open Dynamic Client Registration, because hosted assistants register themselves. Anyone can
//   register a client, so the consent page shows the client's name and where it sends you back,
//   and every new client needs a person's Allow (consent is per user per client; a registered
//   client can't skip it). What a registration, a consent or a token request may contain is
//   bounded (lib/mcp/oauth-limits.ts).
// - Client ID Metadata Documents (cimd, below) are on next to open registration: an assistant
//   can use the URL of a JSON document it hosts as its client_id, and Coppice fetches it.
// - Only the authorization-code flow (with PKCE) and refresh. No client_credentials: every
//   token belongs to a person, and the tools act as that person.
// - Tokens are bound to the MCP URL (mcpResourceUrl) and last an hour; refresh tokens rotate
//   and a reused one is refused (no grace window).
const assistants = mcp({
  loginPage: "/oauth/signin",
  consentPage: "/oauth/consent",
  resource: mcpResourceUrl(),
  scopes: [...MCP_SCOPES],
  resources: [{ identifier: mcpResourceUrl(), name: "Coppice", accessTokenTtl: 60 * 60, allowedScopes: [...MCP_SCOPES] }],
  grantTypes: ["authorization_code", "refresh_token"],
  accessTokenExpiresIn: 60 * 60,
  refreshTokenReuseInterval: 0,
  allowDynamicClientRegistration: true,
  allowUnauthenticatedClientRegistration: true,
  // Desktop and command-line assistants register http://127.0.0.1 callbacks without saying
  // they are native apps; "infer" accepts those without loosening the rules for web clients.
  clientRegistrationDefaultApplicationType: "infer",
});

// Client ID Metadata Documents. The plugin adds a discovery for https client_ids to the MCP
// plugin above; both discovery documents then say client_id_metadata_document_supported. What to
// know about it:
// - Where Coppice can fetch. An assistant can use the https URL of a JSON document it hosts as its
//   client_id, and the plugin fetches that URL inside its client lookup. That lookup runs on every
//   endpoint that resolves a client: /oauth2/authorize (before any sign-in, so anyone can start
//   one), the token endpoint including refresh, consent, continue, public-client, revoke,
//   end-session, and introspect and userinfo through the azp of an access token. A new URL is
//   fetched, checked and saved as an oauthClient row marked clientDiscoveryId "cimd" (no secret, no
//   password-style login), before anyone has signed in or allowed anything. For a known client the
//   plugin keeps the document in memory, per server instance, for the time the transport gives it
//   (see below), then asks again with If-None-Match. Nothing is fetched in the background. If the
//   assistant's host is down when its entry has expired, the refresh fails (400 invalid_client, then
//   the plugin's own 429 for a minute). The refresh token is kept, so the assistant's next try after
//   its host answers again works.
// - How it fetches (lib/mcp/cimd-fetch.ts): the app's own transport, because the plugin leaves
//   the network to the app. One GET to a public https name on the standard port, resolved once with
//   every answer checked, connected to the checked address, no redirects, 5 s and 5 KB, no
//   compression. A failure is a 400 invalid_client and saves nothing. The same file applies the
//   client name and field rules of lib/mcp/oauth-limits.ts to the document, since the plugin applies
//   them only to registration, and refuses a jwks_uri, anything but token_endpoint_auth_method
//   none, and a U+0000 character or an unpaired surrogate in any value or key (the database refuses
//   or alters them). A body that is not valid UTF-8 JSON is refused too, since the plugin would
//   decode it more loosely.
// - How long a checked document is reused. The transport writes the only cache header the plugin
//   sees: max-age with what the origin declared, minus its Age, held between 5 and 60 minutes. A
//   document that says no-store, private, no-cache or max-age=0 is reused for 5 minutes, so one that
//   keeps answering costs one fetch every five minutes per instance and not one per request. A
//   changed document is picked up when the lifetime Coppice gave it runs out: within five minutes
//   for no-store or a short max-age, and within sixty minutes at the latest.
// - Origin binding. A document's redirect_uris, client_uri and post_logout_redirect_uris must be
//   on the document's own origin. Loopback and private-use callbacks, which desktop assistants
//   use, are still accepted by the plugin. Without redirect_uris here, a document at one site
//   could list callbacks on another.
// - The budgets sit at the fetch (lib/mcp/cimd-budget.ts, the isMetadataDocumentUrlAllowed option
//   below). The plugin calls that option with the exact client_id it resolved, right before every
//   network fetch and re-read included, so the budgets apply on every endpoint above, whatever field
//   or header named the client. Per server instance, in memory, each a minute that slides: 30 fetches
//   for clients nobody allowed, at most 5 of them for one site, so the 30 can't be aimed at one
//   site; 120 for allowed clients; and 20 for allowed clients whose last fetch on this instance did
//   not end with the document stored, which never take from the 120. A client counts as allowed when
//   a consent row names it. The cimd options onClientCreated and onClientRefreshed below tell the
//   budget that a document was stored. A refused fetch answers 429 temporarily_unavailable with Retry-After 60 on
//   authorize, token, revoke, consent, continue and public-client. The plugin wraps it elsewhere:
//   end-session answers 500 server_error "Unable to resolve the logout client", userinfo answers 401
//   invalid_token, and introspect answers {"active":false} for the azp of a token.
// - One account may allow at most 10 assistants that came from a metadata document, since using up
//   the 120 with documents that answer takes about 600 of them (one fetch per five minutes each).
//   The cap is applied where the consent row is inserted: Better Auth's database client below
//   stores a consent through createConsentWithinCap, which counts and inserts in one transaction
//   under a lock for the person, so Allows sent at the same moment are counted one after the other
//   and an 11th is refused with a 400 before anything is stored. Registered assistants are not
//   counted.
// - The plugin's own limits are set as ceilings that ordinary traffic can't reach, and the budgets
//   above do the limiting. The plugin takes its slots (rate, per site rate, concurrency, per client
//   state) before it calls the option, so a request that the option then refuses has already used
//   them. Left tight, they would be what gets drained: ten junk ids a minute at one assistant's
//   site would use up that site's ten and lock the real assistant out of its next re-read. So:
//   1000 fetches a minute, 1000 per site, 64 in flight, 64 per site in flight. Real fetches are
//   bounded by the budgets, each at most 5 s and 5 KB, so at most 30 fetches for clients nobody
//   allowed can be in flight, and they can't hold all 64 slots.
// - minimumFetchInterval is 60 seconds. The plugin forgets a client's last fetch time after every
//   successful fetch, so this only spaces out retries after a failure, and a connected document
//   that has started failing is tried at most once a minute per instance. The cost: a refusal by
//   the budget is a failed fetch to the plugin, so the refused id, a real connected assistant
//   included, can't be fetched again on this instance for 60 s even if the budget frees at once,
//   on every endpoint, authorize included; requests that joined the refused fetch fail with it; and
//   a person whose assistant's site hiccups waits a minute before a retry works. For that minute the
//   plugin answers 429 itself with no Retry-After, and app/api/auth/[...all]/route.ts adds
//   Retry-After 60 to a 429 under /api/auth/oauth2/ that has none.
// - maxCacheEntries is 2000. It bounds the cached documents and the plugin's per client and per
//   site entries. A cached document can take about 10 KB of memory, so the worst case is about 22 MB
//   per plugin instance; expired entries stay until newer ones push them out. It must stay above
//   1000: at most about 1000 per client entries a minute can't be evicted, so the per client state
//   can never report that it is full. It does not bound the length of a client key, because the
//   plugin records the client_id before the budget runs; the gate's 512 character refusal keeps
//   those short for every id it recognises.
// - The gate (lib/mcp/cimd-gate.ts) is a first filter in hooks.before. It refuses recognisable junk
//   before the plugin sees it, so the plugin's ceilings stay far from full. It is not what protects
//   the budgets: it reads requests the way the plugin does as far as is known, and anything it
//   misses is still counted at the fetch.
// - Limits that remain. (a) A sender needs no sign-in to use the 30 fetches a minute for new
//   assistants, which delays new connections only. (b) Rows for documents nobody allowed are still
//   saved, at most 30 a minute per instance, with no clean-up job; open registration already allows
//   the same. (c) Allowed documents that fail share 20 fetches a minute after their first failed
//   fetch on an instance. That first fetch on each instance, and the first one after a mark is
//   pushed out of the 2000 kept, still comes from the 120. So each failing allowed document can
//   take one of the 120 once per instance, at a time its sender chooses: a set of more than about
//   120 can use the 120 for a minute, or part of it over several minutes. A real assistant whose
//   own site is failing competes for the 20 with other failing documents. Using up the 120 with
//   documents that answer takes about 600 of them, which is 60 accounts at 10 each. (d) A flood of
//   more than about a thousand requests a minute that the gate fails to recognise could fill the
//   plugin's ceilings; that is an ordinary volume attack and is left to the rate limits. (e) All
//   counters and the cache are in memory per auth instance: each server instance, in development
//   each reload, and any bundle that loads lib/auth.ts on its own (the consent page, if it is not
//   shared with the API route, may then cost one more fetch). (f) The 60
//   second wait after a failed or refused fetch described above. (g) On end-session, userinfo and
//   introspect a refused fetch shows as the plugin's own 500, 401 or {"active":false}, not as a 429.
// - What it shows. The consent page and Settings show the document's client_name and a line
//   naming the host the document came from (lib/mcp/connections.ts). logo_uri is never loaded.
const clientDocuments = cimd({
  fetchClientMetadataResource: cimdFetch,
  metadataProfile: "mcp-2026-07-28",
  // Called with the exact id the plugin is about to fetch: false for an address Coppice would
  // never fetch, a thrown 429 when a budget is used up.
  isMetadataDocumentUrlAllowed: (url) => allowDocumentFetch(url),
  // Both run only after the plugin has stored the document, so the id is no longer failing.
  onClientCreated: ({ client }) => clearFailingMark(client.clientId),
  onClientRefreshed: ({ client }) => clearFailingMark(client.clientId),
  originBoundFields: ["post_logout_redirect_uris", "client_uri", "redirect_uris"],
  metadataFetchPolicy: {
    minimumFetchInterval: 60,
    maximumFetchesPerMinute: 1000,
    maximumFetchesPerOriginPerMinute: 1000,
    maximumConcurrentFetches: 64,
    maximumConcurrentFetchesPerOrigin: 64,
  },
  maxCacheEntries: 2000,
});

// Client management over HTTP is off: Coppice never lets a person create, edit or list OAuth
// clients, and these endpoints would let any signed-in account store client rows of any size.
// Assistants register through open registration (/oauth2/register), which has its own limits.
// Editing a consent is off too: nothing in the app calls it, and it stores whatever scope list it
// is sent. A consent is only ever made on the consent page.
const oauthClientAdminPaths = [
  "/oauth2/create-client",
  "/oauth2/update-client",
  "/oauth2/delete-client",
  "/oauth2/get-client",
  "/oauth2/get-clients",
  "/oauth2/client/rotate-secret",
  "/oauth2/update-consent",
];

// The database client Better Auth uses. It is the app's client with one change: a consent row is
// stored through createConsentWithinCap, which holds one account to 10 assistants that came from a
// metadata document (lib/mcp/cimd-budget.ts). Everything else goes to the database unchanged.
const authDatabase = prisma.$extends({ query: { oauthConsent: { create: ({ args }) => createConsentWithinCap(args) } } });

export const auth = betterAuth({
  database: prismaAdapter(authDatabase, { provider: "postgresql" }),
  // The session is also kept in a signed cookie for five minutes, so most page loads read it without
  // two database round trips (session, then user). Membership is still checked against the database
  // on every request (lib/authz.ts), so removing someone from a workspace takes effect at once;
  // only signing out on another device can take up to five minutes to reach this one.
  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  socialProviders: {
    google: {
      clientId: requireEnv("GOOGLE_CLIENT_ID"),
      clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    },
  },
  // /token hands out a session JWT signed with the same key as MCP access tokens. Nothing in the
  // app uses it, so it is off: a session JWT must never pass as an assistant's token.
  disabledPaths: [...workspaceHttpPaths, "/token", ...oauthClientAdminPaths],
  // Limits on what open registration and the scope lists of the OAuth flow accept
  // (lib/mcp/oauth-limits.ts), on top of the plugin's own.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Who may make Coppice fetch a client's metadata document (lib/mcp/cimd-gate.ts).
      await guardClientLookup(ctx.path, { query: ctx.query, body: ctx.body, headers: ctx.headers, request: ctx.request });
      if (ctx.path === "/oauth2/register") {
        const problem = registrationProblem(ctx.body);
        if (problem) throw new APIError("BAD_REQUEST", { error: "invalid_client_metadata", error_description: problem });
      }
      if (SCOPE_CHECKED_PATHS.has(ctx.path)) {
        const problem = scopeProblem(ctx.query, ctx.body);
        if (problem) throw new APIError("BAD_REQUEST", { error: "invalid_scope", error_description: problem });
      }
    }),
    // The plugin's delete-consent removes only the consent row, and its token endpoint would go on
    // refreshing that client's tokens. Afterwards, every token the signed-in person holds for a
    // client they no longer have a consent for is deleted (lib/mcp/connections.ts), so the next
    // refresh gets invalid_grant and the assistant asks the person to connect again.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/oauth2/delete-consent") return;
      const session = await getSessionFromCtx(ctx).catch(() => null);
      if (session) await endGrantsWithoutConsent(session.user.id);
    }),
  },
  // Limits requests to /api/auth/* per IP: 3 sign-in attempts per 10 seconds, 100 requests per
  // 10 seconds otherwise. Counts live in the database (the rateLimit table) so every server
  // instance shares them; in memory, each Vercel instance would keep its own count. On in every
  // environment so tests check the same behavior production has.
  // The OAuth plugin sets no limit of its own for consent and continue, and each accepted consent
  // writes a row, so they get a tighter limit than the general one.
  rateLimit: {
    enabled: true,
    storage: "database",
    customRules: {
      "/oauth2/consent": { window: 60, max: 10 },
      "/oauth2/continue": { window: 60, max: 10 },
    },
  },
  // jwt() holds the signing keys (the jwks table, private keys encrypted with BETTER_AUTH_SECRET)
  // that the MCP plugin signs access tokens with. disableSettingJwtHeader: no session JWT on
  // get-session either.
  // nextCookies must stay last: it lets server actions set the session cookie.
  plugins: [workspaces, jwt({ disableSettingJwtHeader: true }), assistants, clientDocuments, nextCookies()],
});
