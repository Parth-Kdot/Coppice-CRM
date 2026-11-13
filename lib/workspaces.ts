import { cache } from "react";
import { checkOwner } from "@/lib/authz";
import { day } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { WORKSPACES_SHOWN } from "@/lib/limits";

// The workspace's own settings row, read once per request (React cache): the layout, the tab
// titles, the page and the AI checks all ask for the same few columns, and a render now reads them
// once between them. Server actions and route handlers are not inside a render, so they read afresh.
// Callers have already checked that the person belongs to the workspace.
export const workspaceRow = cache(async (workspaceId: string) =>
  prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { name: true, claimWindowDays: true, aiEnabled: true, aiMonthlyLimit: true, mcpEnabled: true },
  }),
);

// The workspaces a person belongs to, oldest membership first, up to WORKSPACES_SHOWN: for the
// header's switcher and for the assistants' list of workspaces.
export const listMyWorkspaces = (userId: string) =>
  prisma.membership.findMany({
    where: { userId },
    select: { role: true, workspace: { select: { id: true, name: true, mcpEnabled: true } } },
    orderBy: { createdAt: "asc" },
    take: WORKSPACES_SHOWN,
  });

// The user behind a membership row of this workspace, or null when there is no such member.
export const memberUserId = async (workspaceId: string, memberId: string) =>
  (await prisma.membership.findFirst({ where: { id: memberId, workspaceId }, select: { userId: true } }))?.userId ?? null;

// A second Join click (or a resubmit after going back) finds the invitation no longer pending. If the
// person already joined, this is the workspace they joined, so they can be taken there.
export async function workspaceAlreadyJoined(userId: string, invitationId: string): Promise<string | null> {
  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
    select: { workspaceId: true },
  });
  if (!invitation) return null;
  const membership = await prisma.membership.findUnique({
    where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId } },
    select: { workspaceId: true },
  });
  return membership?.workspaceId ?? null;
}

// What the only owner reads where Make Officer and Leave would be, and what leaveWorkspace says if
// the page was out of date.
export const ONLY_OWNER_MESSAGE = "You're the only owner. Make someone else Owner first.";

// An invitation's expiry as Settings writes it: "Nov 14".
export const inviteExpiryLabel = (expiresAt: Date) => day(expiresAt);

// How long a claim lasts before someone else can take the company. The claim SQL
// (lib/claims.ts) reads this. Owner only; takes a userId (like checkOwner) so it can be tested directly.
export async function setClaimWindow(userId: string, workspaceId: string, days: number): Promise<void> {
  await checkOwner(userId, workspaceId);
  await prisma.workspace.update({ where: { id: workspaceId }, data: { claimWindowDays: days } });
}

// The workspace's AI switch and its limit on AI calls per 30 days (lib/ai/run.ts). Owner only.
export async function setAiSettings(userId: string, workspaceId: string, settings: { enabled: boolean; limit: number }): Promise<void> {
  await checkOwner(userId, workspaceId);
  await prisma.workspace.update({ where: { id: workspaceId }, data: { aiEnabled: settings.enabled, aiMonthlyLimit: settings.limit } });
}

// The workspace's switch for outside AI assistants (the MCP server, lib/mcp). Off by default;
// while off, every tool refuses this workspace. Owner only.
export async function setMcpEnabled(userId: string, workspaceId: string, enabled: boolean): Promise<void> {
  await checkOwner(userId, workspaceId);
  await prisma.workspace.update({ where: { id: workspaceId }, data: { mcpEnabled: enabled } });
}

// Settings > Workspace: rename (owner only). The name is already trimmed and checked
// (renameWorkspaceSchema in lib/validation).
export async function renameWorkspace(userId: string, workspaceId: string, name: string): Promise<void> {
  await checkOwner(userId, workspaceId);
  await prisma.workspace.update({ where: { id: workspaceId }, data: { name } });
}

export const DELETE_NAME_MISMATCH = "Type the workspace's name exactly to delete it.";

// Settings > Workspace > Danger zone: delete the workspace and everything in it (owner only), once the
// owner has typed its name. Deleting the workspace row cascades to its memberships, invitations,
// companies, outreach and templates; the keep-an-owner trigger lets memberships go when their
// workspace goes. Returns false (nothing deleted) when the typed name doesn't match.
export async function deleteWorkspace(userId: string, workspaceId: string, typedName: string): Promise<boolean> {
  await checkOwner(userId, workspaceId);
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });
  if (!workspace || workspace.name.trim() !== typedName.trim()) return false;
  await prisma.workspace.delete({ where: { id: workspaceId } });
  return true;
}
