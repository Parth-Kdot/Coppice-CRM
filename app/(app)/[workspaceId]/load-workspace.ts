import { notFound } from "next/navigation";
import { cache } from "react";
import type { WorkspaceChoice } from "@/components/ledger/workspace-switcher";
import { AuthzError, checkMembership, requireUser } from "@/lib/authz";
import { dbNow } from "@/lib/claims";
import { withTenant } from "@/lib/db";
import { roleLabel, toRole } from "@/lib/roles";
import { listMyWorkspaces, workspaceRow } from "@/lib/workspaces";

// Who is signed in and their membership in this workspace, read once per request (React cache). A
// stranger gets the same 404 as a workspace that does not exist, and nothing else is read for them.
export const signedInMember = cache(async (workspaceId: string) => {
  const user = await requireUser();
  try {
    return { user, membership: await checkMembership(user.id, workspaceId) };
  } catch (e) {
    if (e instanceof AuthzError) notFound();
    throw e;
  }
});

// The workspace's name for a tab title: the membership check and the one row, nothing else. A page's
// title is read on every navigation, so it must not load the whole workspace (loadWorkspace).
export const workspaceName = cache(async (workspaceId: string) => {
  await signedInMember(workspaceId);
  return (await workspaceRow(workspaceId)).name;
});

// What every page of a workspace needs, read once per request (React cache): the sign-in and
// membership, the workspace, the database clock, whether it has any company, and the person's other
// workspaces for the header's switcher. The layout and the queue call this and share one result.
// Queries run one after another; never Promise.all inside withTenant (one transaction is one
// connection, and pg will refuse parallel queries on it).
//
// counts.companies is 0 when the workspace has no active company and 1 otherwise: callers only ask
// whether it is empty, so an existence check stands in for counting every row.
export const loadWorkspace = cache(async (workspaceId: string) => {
  const { user, membership } = await signedInMember(workspaceId);
  const now = await dbNow();
  const workspace = await workspaceRow(workspaceId);
  const hasCompany = await withTenant(membership, async (tx) => (await tx.company.findFirst({ where: { workspaceId, archivedAt: null }, select: { id: true } })) !== null);
  const memberships = await listMyWorkspaces(user.id);
  const workspaces: WorkspaceChoice[] = memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: roleLabel(toRole(m.role)) }));
  // Past the cap, the workspace being viewed is still in the switcher.
  if (!workspaces.some((w) => w.id === workspaceId)) workspaces.push({ id: workspaceId, name: workspace.name, role: roleLabel(membership.role) });
  return { user, membership, workspace, counts: { companies: hasCompany ? 1 : 0 }, now, workspaces };
});
