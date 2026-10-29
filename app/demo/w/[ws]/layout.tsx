import type { ReactNode } from "react";
import { DemoWorkspaceShell } from "../../_ledger/workspace-shell";

// Every workspace screen sits in the real shell: the spine, the page header, the status line.
export default async function WorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  return <DemoWorkspaceShell ws={ws}>{children}</DemoWorkspaceShell>;
}
