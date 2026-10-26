"use server";

import { revalidatePath } from "next/cache";
import { failure } from "@/lib/actions";
import { requireMembership } from "@/lib/authz";
import * as claimCheck from "@/lib/claim-check";
import type { DraftCheck } from "@/lib/claim-check";
import * as drafts from "@/lib/drafts";
import type { DraftView } from "@/lib/drafts";
import { checkDraftSchema, draftEmailSchema, type ActionResult } from "@/lib/validation";

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

// "Check again": runs the Claim Checker's AI pass on the draft as edited. Changes nothing but the
// stored check, so no page needs refreshing.
export async function checkDraft(_prev: ActionResult<DraftCheck> | null, form: FormData): Promise<ActionResult<DraftCheck>> {
  const parsed = checkDraftSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    draftId: form.get("draftId"),
    subject: form.get("subject"),
    body: form.get("body"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, draftId, ...text } = parsed.data;
  try {
    const member = await requireMembership(workspaceId);
    return await claimCheck.checkDraft(member, draftId, text);
  } catch (e) {
    return failure(e);
  }
}
