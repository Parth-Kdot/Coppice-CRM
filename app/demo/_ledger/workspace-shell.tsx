"use client";

import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { boardYear } from "@/components/ledger/board-year";
import { WorkspaceShell } from "@/components/ledger/shell";
import { useDemoState, useIsMember, useMe, useWorkspace, useWorkspaceStats } from "@/demo/store";

// The real shell (spine, book-title header, status line) fed from the in-browser store. A workspace
// the person does not belong to is the same 404 as one that does not exist.
export function DemoWorkspaceShell({ ws, children }: { ws: string; children: ReactNode }) {
  const state = useDemoState();
  const workspace = useWorkspace(ws);
  const isMember = useIsMember(ws);
  const me = useMe(ws);
  const stats = useWorkspaceStats(ws);
  if (!workspace || !isMember) notFound();
  return (
    <WorkspaceShell
      workspaceId={ws}
      workspaceName={workspace.name}
      volume={boardYear(new Date(state.now)).long}
      claimWindowDays={workspace.claimWindowDays}
      stats={{ companies: stats.total, due: stats.due }}
      me={{ name: me.person.name, email: me.person.email, roleLabel: me.roleLabel }}
    >
      {children}
    </WorkspaceShell>
  );
}
