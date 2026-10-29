import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, type ReactNode } from "react";
import { boardYear } from "@/components/ledger/board-year";
import { WorkspaceShell } from "@/components/ledger/shell";
import { AuthzError, checkMembership, requireUser, roleLabel } from "@/lib/authz";
import { dbNow } from "@/lib/claims";
import { prisma, withTenant } from "@/lib/db";
import { TERMINAL_STAGES } from "@/lib/stages";

// The frame around every page of a workspace: spine, book-title header, status line. It reads who
// is signed in and checks they belong here (a stranger gets the same 404 as a workspace that does
// not exist), then loads the few numbers the status line prints. "Due" is the queue's own
// definition: open companies whose follow-up date has arrived.
const load = cache(async (workspaceId: string) => {
  const user = await requireUser();
  let membership;
  try {
    membership = await checkMembership(user.id, workspaceId);
  } catch (e) {
    if (e instanceof AuthzError) notFound();
    throw e;
  }
  const now = await dbNow();
  const [workspace, counts] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true, claimWindowDays: true } }),
    withTenant(membership, async (tx) => {
      const active = { workspaceId, archivedAt: null };
      const [companies, due] = await Promise.all([
        tx.company.count({ where: active }),
        tx.company.count({ where: { ...active, stage: { notIn: TERMINAL_STAGES }, nextFollowUpAt: { lte: now } } }),
      ]);
      return { companies, due };
    }),
  ]);
  return { user, membership, workspace, counts, now };
});

export async function generateMetadata({ params }: LayoutProps<"/[workspaceId]">): Promise<Metadata> {
  const { workspaceId } = await params;
  const { workspace } = await load(workspaceId);
  return { title: workspace.name };
}

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/[workspaceId]">) {
  const { workspaceId } = await params;
  const { user, membership, workspace, counts, now } = await load(workspaceId);
  return (
    <WorkspaceShell
      workspaceId={workspaceId}
      workspaceName={workspace.name}
      volume={boardYear(now).long}
      claimWindowDays={workspace.claimWindowDays}
      stats={counts}
      me={{ name: user.name, email: user.email, roleLabel: roleLabel(membership.role) }}
    >
      {children}
    </WorkspaceShell>
  );
}
