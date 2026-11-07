"use server";

import { revalidatePath } from "next/cache";
import { failure } from "@/lib/actions";
import { PDF_MAX_BYTES } from "@/lib/ai/pdf";
import { requireOwner } from "@/lib/authz";
import * as facts from "@/lib/facts";
import {
  addFactSchema,
  factRefSchema,
  factSheetRefSchema,
  updateFactSchema,
  verifyFactSchema,
  workspaceIdSchema,
  type ActionResult,
} from "@/lib/validation";

// The fact sheet is the chair's: every action is owner only (checked here and again in lib/facts).

const factsPath = (workspaceId: string) => `/${workspaceId}/facts`;

export async function uploadFactSheet(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = workspaceIdSchema.safeParse(form.get("workspaceId"));
  if (!parsed.success) return { ok: false, error: "Workspace not found." };
  const workspaceId = parsed.data;

  try {
    const owner = await requireOwner(workspaceId);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a PDF file." };
    if (!/\.pdf$/i.test(file.name)) return { ok: false, error: "Choose a PDF file." };
    if (file.size > PDF_MAX_BYTES) return { ok: false, error: "The PDF is over 3.5 MB. Export a smaller copy." };
    const result = await facts.uploadFactSheet(owner, file.name, new Uint8Array(await file.arrayBuffer()));
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  revalidatePath(factsPath(workspaceId));
  return { ok: true, data: undefined };
}

export async function setFactVerified(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = verifyFactSchema.safeParse({ workspaceId: form.get("workspaceId"), factId: form.get("factId"), verified: form.get("verified") });
  if (!parsed.success) return { ok: false, error: "Fact not found." };
  const { workspaceId, factId, verified } = parsed.data;

  try {
    const owner = await requireOwner(workspaceId);
    const result = await facts.setFactVerified(owner, factId, verified);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  revalidatePath(factsPath(workspaceId));
  return { ok: true, data: undefined };
}

// Says whether the edit is verified: a fact from the PDF whose quote no longer supports the new
// text goes back to waiting for a check.
export async function updateFact(_prev: ActionResult<{ verified: boolean }> | null, form: FormData): Promise<ActionResult<{ verified: boolean }>> {
  const parsed = updateFactSchema.safeParse({ workspaceId: form.get("workspaceId"), factId: form.get("factId"), text: form.get("text") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, factId, text } = parsed.data;

  let result: ActionResult<{ verified: boolean }>;
  try {
    const owner = await requireOwner(workspaceId);
    result = await facts.updateFact(owner, factId, text);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  revalidatePath(factsPath(workspaceId));
  return result;
}

// "Verify all n with quotes found": one action and one revalidation for the whole list.
export async function verifyQuotedFacts(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = workspaceIdSchema.safeParse(form.get("workspaceId"));
  if (!parsed.success) return { ok: false, error: "Workspace not found." };
  const workspaceId = parsed.data;

  try {
    const owner = await requireOwner(workspaceId);
    const result = await facts.verifyQuotedFacts(owner);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  revalidatePath(factsPath(workspaceId));
  return { ok: true, data: undefined };
}

export async function addFact(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = addFactSchema.safeParse({ workspaceId: form.get("workspaceId"), text: form.get("text") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, text } = parsed.data;

  try {
    const owner = await requireOwner(workspaceId);
    const result = await facts.addFact(owner, text);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  revalidatePath(factsPath(workspaceId));
  return { ok: true, data: undefined };
}

export async function deleteFact(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = factRefSchema.safeParse({ workspaceId: form.get("workspaceId"), factId: form.get("factId") });
  if (!parsed.success) return { ok: false, error: "Fact not found." };
  const { workspaceId, factId } = parsed.data;

  try {
    const owner = await requireOwner(workspaceId);
    const result = await facts.deleteFact(owner, factId);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  revalidatePath(factsPath(workspaceId));
  return { ok: true, data: undefined };
}

export async function deleteFactSheet(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = factSheetRefSchema.safeParse({ workspaceId: form.get("workspaceId"), factSheetId: form.get("factSheetId") });
  if (!parsed.success) return { ok: false, error: "File not found." };
  const { workspaceId, factSheetId } = parsed.data;

  try {
    const owner = await requireOwner(workspaceId);
    const result = await facts.deleteFactSheet(owner, factSheetId);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  revalidatePath(factsPath(workspaceId));
  return { ok: true, data: undefined };
}
