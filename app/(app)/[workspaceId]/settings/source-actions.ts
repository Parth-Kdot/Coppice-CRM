"use server";

import { revalidatePath } from "next/cache";
import { failure } from "@/lib/action-failure";
import { requireOwner } from "@/lib/authz";
import { notFound } from "@/lib/messages";
import * as sources from "@/lib/research/sources";
import { addResearchSourceSchema, renameResearchSourceSchema, researchSourceRefSchema, type ActionResult } from "@/lib/validation";

// Approved research sources (Settings). Owner only: checked here, again in lib/research/sources.ts,
// and by the database's row-level security.

const settingsPath = (workspaceId: string) => `/${workspaceId}/settings`;

export async function addResearchSource(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = addResearchSourceSchema.safeParse({ workspaceId: form.get("workspaceId"), url: form.get("url"), label: form.get("label") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, url, label } = parsed.data;

  try {
    const owner = await requireOwner(workspaceId);
    const result = await sources.addSource(owner, url, label);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  revalidatePath(settingsPath(workspaceId));
  return { ok: true, data: undefined };
}

export async function renameResearchSource(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = renameResearchSourceSchema.safeParse({ workspaceId: form.get("workspaceId"), sourceId: form.get("sourceId"), label: form.get("label") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, sourceId, label } = parsed.data;

  try {
    const owner = await requireOwner(workspaceId);
    const result = await sources.renameSource(owner, sourceId, label);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  revalidatePath(settingsPath(workspaceId));
  return { ok: true, data: undefined };
}

export async function archiveResearchSource(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = researchSourceRefSchema.safeParse({ workspaceId: form.get("workspaceId"), sourceId: form.get("sourceId") });
  if (!parsed.success) return notFound("Source");
  const { workspaceId, sourceId } = parsed.data;

  try {
    const owner = await requireOwner(workspaceId);
    const result = await sources.archiveSource(owner, sourceId);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  revalidatePath(settingsPath(workspaceId));
  return { ok: true, data: undefined };
}
