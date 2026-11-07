import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AuthzError, checkMembership, requireUser, roleLabel, type Role } from "@/lib/authz";
import { dbNow } from "@/lib/claims";
import { prisma, withTenant } from "@/lib/db";

// What every page of a workspace needs, read once per request (React cache): who is signed in,
// their membership (a stranger gets the same 404 as a workspace that does not exist, and nothing
// else is read for them), the workspace, the database clock, how many companies it has, and the
// person's other workspaces for the header's switcher. The layout, the tab titles and the queue
// all call this and share one result. Queries run one after another; never Promise.all inside
// withTenant (one transaction is one connection, and pg will refuse parallel queries on it).
export type WorkspaceChoice = { id: string; name: string; role: string };

export const loadWorkspace = cache(async (workspaceId: string) => {
  const user = await requireUser();
  let membership;
  try {
    membership = await checkMembership(user.id, workspaceId);
  } catch (e) {
    if (e instanceof AuthzError) notFound();
    throw e;
  }
  const now = await dbNow();
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true, claimWindowDays: true, aiEnabled: true, mcpEnabled: true } });
  const companies = await withTenant(membership, (tx) => tx.company.count({ where: { workspaceId, archivedAt: null } }));
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    select: { role: true, workspace: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  const workspaces: WorkspaceChoice[] = memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: roleLabel(m.role as Role) }));
  return { user, membership, workspace, counts: { companies }, now, workspaces };
});

// Tab titles for the pages inside a workspace. The membership check comes first (inside
// loadWorkspace), so a stranger gets the same 404 as everywhere else and the name is never read for them.
export async function pageTitle(workspaceId: string, page: string): Promise<Metadata> {
  const { workspace } = await loadWorkspace(workspaceId);
  return { title: { absolute: `${page}, ${workspace.name}` } };
}
