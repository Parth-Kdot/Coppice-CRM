import type { ReactNode } from "react";
import { WorkspaceShell } from "../../_ledger/shell";

// Every workspace screen sits in the Ledger shell: the spine, the page header, the main column.
export default async function WorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  return <WorkspaceShell ws={ws}>{children}</WorkspaceShell>;
}
