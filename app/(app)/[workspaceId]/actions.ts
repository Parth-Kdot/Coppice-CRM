"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { failure } from "@/lib/actions";
import { requireOwner } from "@/lib/authz";
import { inviteMemberSchema, type ActionResult } from "@/lib/validation";

export async function inviteMember(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = inviteMemberSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    email: form.get("email"),
    role: form.get("role"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, email, role } = parsed.data;

  try {
    await requireOwner(workspaceId);
    // No email is sent (rule 6). The invitee sees a Join button after signing in with this email.
    await auth.api.createInvitation({
      body: { email, role, organizationId: workspaceId },
      headers: await headers(),
    });
  } catch (e) {
    return failure(e);
  }
  revalidatePath(`/${workspaceId}`);
  return { ok: true, data: undefined };
}
