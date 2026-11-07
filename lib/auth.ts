import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins/jwt";
import { organization } from "better-auth/plugins/organization";
import { mcp } from "@better-auth/mcp";
import { prisma } from "@/lib/db";
import { MCP_SCOPES, mcpResourceUrl } from "@/lib/mcp/config";
import { SCOPE_CHECKED_PATHS, registrationProblem, scopeProblem } from "@/lib/mcp/oauth-limits";

// Option B (owner decision 2026-10-21): only emails listed in WORKSPACE_CREATOR_EMAILS
// can create workspaces. Everyone else joins through an invitation.
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
  // Invitations are accepted from inside the app (rule 6: the app never sends email).
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
// - Client ID Metadata Documents (@better-auth/cimd) are left off: in 1.7.10 its Node fetcher
//   can crash the process on a malformed reply from a client's server, fixed only in 1.7.15,
//   which needs a newer Better Auth.
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
      if (ctx.path === "/oauth2/register") {
        const problem = registrationProblem(ctx.body);
        if (problem) throw new APIError("BAD_REQUEST", { error: "invalid_client_metadata", error_description: problem });
      }
      if (SCOPE_CHECKED_PATHS.has(ctx.path)) {
        const problem = scopeProblem(ctx.query, ctx.body);
        if (problem) throw new APIError("BAD_REQUEST", { error: "invalid_scope", error_description: problem });
      }
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
  plugins: [workspaces, jwt({ disableSettingJwtHeader: true }), assistants, nextCookies()],
});
