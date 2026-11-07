import type { Metadata } from "next";
import { WorkspaceShell } from "@/components/ledger/shell";
import { roleLabel } from "@/lib/authz";
import { loadWorkspace } from "./page-title";

// The frame around every page of a workspace: spine, header with the workspace switcher and the
// search, and the page. loadWorkspace reads who is signed in and checks they belong here (a
// stranger gets the same 404 as a workspace that does not exist); it is cached for the request,
// so the queue page reuses the same clock and counts instead of reading them again.
export async function generateMetadata({ params }: LayoutProps<"/[workspaceId]">): Promise<Metadata> {
  const { workspaceId } = await params;
  const { workspace } = await loadWorkspace(workspaceId);
  return { title: workspace.name };
}

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/[workspaceId]">) {
  const { workspaceId } = await params;
  const { user, membership, workspace, workspaces } = await loadWorkspace(workspaceId);
  return (
    <WorkspaceShell
      workspaceId={workspaceId}
      workspaceName={workspace.name}
      workspaces={workspaces}
      me={{ name: user.name, email: user.email, roleLabel: roleLabel(membership.role), claimWindowDays: workspace.claimWindowDays }}
    >
      {children}
    </WorkspaceShell>
  );
}
