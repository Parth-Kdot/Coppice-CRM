"use server";

import { revalidatePath } from "next/cache";
import { failure } from "@/lib/actions";
import { requireMembership } from "@/lib/authz";
import { disconnect } from "@/lib/mcp/connections";
import { disconnectAssistantSchema, type ActionResult } from "@/lib/validation";

// Settings > AI assistants: Disconnect one of your own connected assistants.
//
// Yours only, owners included. A connection belongs to the person, not to the workspace (one
// assistant reaches every workspace they are in), so an owner ending a member's connection here
// would also cut it off from workspaces that owner has no say in. Owners already control their
// workspace with the assistants switch and by removing a member.
//
// The workspace id only says which Settings page asked (membership is checked, and that page is
// refreshed); the person is always the signed-in user, never anything in the form.
export async function disconnectAssistant(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = disconnectAssistantSchema.safeParse({ workspaceId: form.get("workspaceId"), clientId: form.get("clientId") });
  if (!parsed.success) return { ok: false, error: "Assistant not found." };
  const { workspaceId, clientId } = parsed.data;

  try {
    const { userId } = await requireMembership(workspaceId);
    const result = await disconnect(userId, clientId);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e, "disconnectAssistant");
  }
  revalidatePath(`/${workspaceId}/settings`);
  return { ok: true, data: undefined };
}
