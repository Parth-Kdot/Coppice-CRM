import type { Metadata } from "next";
import { cache } from "react";
import { requireMembershipOr404 } from "@/lib/authz";
import { prisma } from "@/lib/db";

// Tab titles for the pages inside a workspace. The membership check comes first, so a stranger gets
// the same 404 as everywhere else and the workspace name is never read for them.
const workspaceName = cache(async (workspaceId: string) => {
  await requireMembershipOr404(workspaceId);
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true } });
  return workspace.name;
});

export async function pageTitle(workspaceId: string, page: string): Promise<Metadata> {
  return { title: `${page}, ${await workspaceName(workspaceId)}` };
}
