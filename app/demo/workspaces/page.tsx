import type { Metadata } from "next";
import { WorkspacesScreen } from "../_ledger/screens/workspaces";

export const metadata: Metadata = { title: "Workspaces · Coppice" };

export default function WorkspacesPage() {
  return <WorkspacesScreen />;
}
