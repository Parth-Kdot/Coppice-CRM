import { checkOwner } from "@/lib/authz";
import { prisma } from "@/lib/db";

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
