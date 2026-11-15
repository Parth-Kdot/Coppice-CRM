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
import { cimdFetch, metadataUrlProblem } from "@/lib/mcp/cimd-fetch";
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
// - When Coppice fetches. Whenever a client_id is an https URL, inside the client lookup:
//   /oauth2/authorize (before any sign-in, so anyone can start a fetch), the token endpoint
//   including refresh, consent, the consent page, revoke, introspect and end-session. A new URL is
//   fetched, checked and saved as an oauthClient row marked clientDiscoveryId "cimd" (no secret,
//   no password-style login), before anyone has signed in or allowed anything. The gate
//   (lib/mcp/cimd-gate.ts) treats such a client as connected only once a consent row names it.
//   For a client that is not connected, the token, revoke, introspect and end-session endpoints
//   answer invalid_client without calling the plugin, and the other endpoints pass it on only
//   for a row nobody has allowed yet, so the first connect works. For a known client the plugin
//   keeps the document in memory, per server instance, for the time the transport gives it (see
//   below), then asks again with If-None-Match. Nothing is fetched in the background. If the
//   assistant's host is down when its entry has expired, refresh fails and the person connects
//   again.
// - How it fetches (lib/mcp/cimd-fetch.ts): the app's own transport, because the plugin leaves
//   the network to the app. One GET to a public https name on the standard port, resolved once with
//   every answer checked, connected to the checked address, no redirects, 5 s and 5 KB, no
//   compression. A failure is a 400 invalid_client and saves nothing. The same file applies the
//   client name and field rules of lib/mcp/oauth-limits.ts to the document, since the plugin applies
//   them only to registration, and refuses anything but token_endpoint_auth_method none. A body that
//   is not valid UTF-8 JSON is refused too, since the plugin would decode it more loosely.
// - How long a checked document is reused. The transport writes the only cache header the plugin
//   sees: max-age with what the origin declared, minus its Age, held between 5 and 60 minutes.
//   A document that says no-store, private, no-cache or max-age=0 is reused for 5 minutes, so one that
//   keeps answering costs one fetch every five minutes per instance and not one per request. The draft lets a
//   server set its own bounds. A changed document is picked up within five minutes at the latest.
// - Origin binding. A document's redirect_uris, client_uri and post_logout_redirect_uris must be
//   on the document's own origin. Loopback and private-use callbacks, which desktop assistants
//   use, are still accepted by the plugin. Without redirect_uris here, a document at one site
//   could list callbacks on another.
// - Budgets, all per server instance and kept in memory. The plugin allows 120 fetches a minute,
//   10 a minute and 2 at once for one site, and 16 at once, on top of its rate limits on
//   authorize and token requests. A request over budget is refused at once, not queued. The
//   plugin takes a slot before any lookup, so the gate (lib/mcp/cimd-gate.ts) is what keeps
//   anonymous requests from using them up: a client that is not connected takes one of 30 slots
//   a minute for each request that names it, on every endpoint the gate lets through, and every
//   other request for it is refused before the plugin is called. The gate reads the client_id the
//   way the plugin does, Basic headers included. That leaves at least 90 fetch starts a minute
//   that only requests naming a connected client can use. The 16 fetches in flight at once are
//   shared: slow documents from clients that are not connected can hold all of them for a few
//   seconds at a time (up to the 5 s limit, about 10 s of every minute at 30 slots), and a
//   connected assistant that needs a fetch then gets 429 until it tries again. The plugin's own
//   minimumFetchInterval stays at its default (one second), because a document that can't be
//   cached is looked up several times within seconds during one connect.
// - Limits that remain. A first fetch needs no sign-in (the plugin signs the sign-in redirect
//   itself), so a sender can hold the 30 slots at zero, which only delays new connections. The
//   plugin still saves a row for each valid document nobody allowed, at most 30 a minute per
//   instance; open registration already lets anyone save client rows, and no clean-up job runs.
//   One signed-in account that allows hundreds of its own documents could still use much of the
//   budget, and no per-account cap exists: each one is a consent row tied to that account, and
//   each one that answers costs one fetch every five minutes per instance. A connected document
//   that keeps failing is not held to that: the plugin stores only a fetch that worked, so it is
//   fetched again on about every request that names it, once a second at most, and one account
//   with a dozen failing connected documents on different sites could use the whole 120 a minute.
// - What it shows. The consent page and Settings show the document's client_name and a line
//   naming the host the document came from (lib/mcp/connections.ts). logo_uri is never loaded.
const clientDocuments = cimd({
  fetchClientMetadataResource: cimdFetch,
  metadataProfile: "mcp-2026-07-28",
  // A pure check with no lookup, as the plugin asks; the transport does the network checks.
  isMetadataDocumentUrlAllowed: (url) => metadataUrlProblem(url) === null,
  originBoundFields: ["post_logout_redirect_uris", "client_uri", "redirect_uris"],
  metadataFetchPolicy: {
    maximumFetchesPerMinute: 120,
    maximumFetchesPerOriginPerMinute: 10,
    maximumConcurrentFetches: 16,
    maximumConcurrentFetchesPerOrigin: 2,
  },
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

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
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
