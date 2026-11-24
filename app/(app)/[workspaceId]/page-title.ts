import type { Metadata } from "next";
import { workspaceName } from "./load-workspace";

// Tab titles for the pages inside a workspace. The membership check comes first (inside
// workspaceName), so a stranger gets the same 404 as everywhere else and the name is never read for them.
export async function pageTitle(workspaceId: string, page: string): Promise<Metadata> {
  return { title: { absolute: `${page}, ${await workspaceName(workspaceId)}` } };
}
