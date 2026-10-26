"use server";

import { revalidatePath } from "next/cache";
import { failure } from "@/lib/actions";
import { requireMembership } from "@/lib/authz";
import * as drafts from "@/lib/drafts";
import type { DraftView } from "@/lib/drafts";
import { draftEmailSchema, type ActionResult } from "@/lib/validation";

// The Pitch Drafter's button. Any member may draft; drafting claims the company for them, so the
// page, board and queue are refreshed to show the new holder. Gemini answers in 5 to 45 seconds;
// the function may run up to the company page's maxDuration.
export async function draftEmail(_prev: ActionResult<DraftView[]> | null, form: FormData): Promise<ActionResult<DraftView[]>> {
  const parsed = draftEmailSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    companyId: form.get("companyId"),
    kind: form.get("kind"),
    contactId: form.get("contactId"),
    note: form.get("note"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, companyId, ...request } = parsed.data;

  let result: ActionResult<DraftView[]>;
  try {
    const member = await requireMembership(workspaceId);
    result = await drafts.draftEmail(member, companyId, request);
  } catch (e) {
    return failure(e);
  }
  revalidatePath(`/${workspaceId}/companies/${companyId}`);
  revalidatePath(`/${workspaceId}/board`);
  revalidatePath(`/${workspaceId}`);
  return result;
}
