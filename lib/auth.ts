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

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
  plugins: [
    organization({
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
    }),
    // Must stay last: lets server actions set the session cookie.
    nextCookies(),
  ],
});
