import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins/organization";
import { prisma } from "@/lib/db";

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
  // A workspace holds the org's whole history, so it is never deleted from the app.
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

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  socialProviders: {
    google: {
      clientId: requireEnv("GOOGLE_CLIENT_ID"),
      clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    },
  },
  disabledPaths: workspaceHttpPaths,
  // nextCookies must stay last: it lets server actions set the session cookie.
  plugins: [workspaces, nextCookies()],
});
