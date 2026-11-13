"use server";

import { revalidatePath } from "next/cache";
import { failure } from "@/lib/action-failure";
import { requireMembership } from "@/lib/authz";
import * as accept from "@/lib/research/accept";
import * as research from "@/lib/research/brief";
import type { BriefView } from "@/lib/research/brief";
import { acceptBriefItemSchema, requestBriefSchema, type ActionResult } from "@/lib/validation";

// The research brief's buttons on the company page. Any member may ask for a brief while AI is on
// (lib/research/brief.ts refuses otherwise); reading the pages and two AI calls take up to a few
// minutes, within the company page's maxDuration.
export async function requestBrief(_prev: ActionResult<BriefView> | null, form: FormData): Promise<ActionResult<BriefView>> {
  const parsed = requestBriefSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    companyId: form.get("companyId"),
    sourceIds: form.getAll("sourceId"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, companyId, sourceIds } = parsed.data;

  let result: ActionResult<BriefView>;
  try {
    const member = await requireMembership(workspaceId);
    result = await research.requestBrief(member, companyId, sourceIds);
  } catch (e) {
    return failure(e);
  }
  revalidatePath(`/${workspaceId}/companies/${companyId}`);
  return result;
}

// "Add to notes": the only way a brief changes the company, one item at a time.
export async function acceptBriefItem(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = acceptBriefItemSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    companyId: form.get("companyId"),
    briefId: form.get("briefId"),
    itemId: form.get("itemId"),
  });
  if (!parsed.success) return { ok: false, error: "That item isn't in this brief." };
  const { workspaceId, companyId, briefId, itemId } = parsed.data;

  try {
    const member = await requireMembership(workspaceId);
    const result = await accept.acceptBriefItem(member, companyId, briefId, itemId);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  revalidatePath(`/${workspaceId}/companies/${companyId}`);
  return { ok: true, data: undefined };
}
