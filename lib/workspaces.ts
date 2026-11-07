import { checkOwner } from "@/lib/authz";
import { day } from "@/lib/dates";
import { prisma } from "@/lib/db";

// What the only owner reads where Make Officer and Leave would be, and what leaveWorkspace says if
// the page was out of date.
export const ONLY_OWNER_MESSAGE = "You're the only owner. Make someone else Owner first.";

// An invitation's expiry as Settings writes it: "Nov 14".
export const inviteExpiryLabel = (expiresAt: Date) => day(expiresAt);

// How long a claim lasts before someone else can take the company. Milestone 3's claim SQL
// reads this. Owner only; takes a userId (like checkOwner) so it can be tested directly.
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
