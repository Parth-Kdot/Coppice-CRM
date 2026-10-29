import type { Metadata } from "next";
import { WorkspacesPage } from "../_ledger/pages/workspaces-page";

export const metadata: Metadata = { title: "Your workspaces" };

export default function Page() {
  return <WorkspacesPage />;
}
