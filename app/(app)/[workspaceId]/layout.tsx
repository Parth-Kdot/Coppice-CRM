import type { Metadata } from "next";
import { Suspense } from "react";
import { boardYear } from "@/components/ledger/board-year";
import { WorkspaceShell } from "@/components/ledger/shell";
import { TourGate } from "@/components/ledger/tour-gate";
import { TourMenuItems } from "@/components/ledger/user-menu";
import { isConfigured } from "@/lib/ai/client";
import { roleLabel } from "@/lib/authz";
import { basicsDoneElsewhere, complete, getProgress } from "@/lib/onboarding";
import { basicsPending } from "@/lib/onboarding-steps";
import { loadWorkspace } from "./page-title";

// The frame around every page of a workspace: spine, header with the workspace switcher and the
// search, and the page. loadWorkspace reads who is signed in and checks they belong here (a
// stranger gets the same 404 as a workspace that does not exist); it is cached for the request,
// so the queue page reuses the same clock and counts instead of reading them again.
//
// The onboarding tours: the person's progress is read here, after the membership check and one
// query after another (never Promise.all inside withTenant). TourGate goes in the shell's overlay
// slot and loads the tour only when the basics are due or a tour is asked for; the account menu
// gets "Replay the basics" and "AI tour". Someone who finished the basics in another of their
// workspaces is treated as having finished them here too, and that is saved here on the first
// visit (an officer there who is an owner here sees only the invite card).
export async function generateMetadata({ params }: LayoutProps<"/[workspaceId]">): Promise<Metadata> {
  const { workspaceId } = await params;
  const { workspace } = await loadWorkspace(workspaceId);
  return { title: workspace.name };
}

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/[workspaceId]">) {
  const { workspaceId } = await params;
  const { user, membership, workspace, workspaces, counts, now } = await loadWorkspace(workspaceId);
  const progress = await getProgress(membership);
  const elsewhere =
    progress?.basicsDoneAt || !basicsPending(progress, membership.role)
      ? null
      : await basicsDoneElsewhere(
          user.id,
          workspaces.map((w) => w.id).filter((id) => id !== workspaceId),
        );
  // Written down here once, so the other workspaces are only ever asked on the first visit.
  if (elsewhere) await complete(membership, "basics", elsewhere);
  const basicsDone = !!progress?.basicsDoneAt || elsewhere !== null;
  const basicsRole = progress?.basicsDoneAt ? progress.basicsRole : (elsewhere ?? progress?.basicsRole ?? null);
  return (
    <WorkspaceShell
      workspaceId={workspaceId}
      workspaceName={workspace.name}
      workspaces={workspaces}
      volume={boardYear(now).long}
      me={{ name: user.name, email: user.email, roleLabel: roleLabel(membership.role), claimWindowDays: workspace.claimWindowDays }}
      accountItems={<TourMenuItems aiRecommended={!progress?.aiDoneAt} />}
      overlay={
        // useSearchParams (the ?tour= request) inside; the boundary keeps the rest of the page static-safe.
        <Suspense fallback={null}>
          <TourGate
            pending={basicsPending(basicsDone ? { basicsDoneAt: true, basicsRole } : progress, membership.role)}
            workspaceId={workspaceId}
            workspaceName={workspace.name}
            role={membership.role}
            empty={counts.companies === 0}
            aiConfigured={isConfigured()}
            aiOn={workspace.aiEnabled}
            mcpOn={workspace.mcpEnabled}
            claimWindowDays={workspace.claimWindowDays}
            progress={{
              basicsStep: progress?.basicsStep ?? 0,
              basicsDone,
              basicsRole,
              basicsHidden: !!progress?.basicsHiddenAt,
              aiStep: progress?.aiStep ?? 0,
              aiDone: !!progress?.aiDoneAt,
              aiDismissed: !!progress?.aiDismissedAt,
            }}
          />
        </Suspense>
      }
    >
      {children}
    </WorkspaceShell>
  );
}
