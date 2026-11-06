"use server";

import { revalidatePath } from "next/cache";
import { failure } from "@/lib/actions";
import { requireOwner } from "@/lib/authz";
import * as templates from "@/lib/templates";
import { createTemplateSchema, templateRefSchema, updateTemplateSchema, type ActionResult } from "@/lib/validation";

// Templates in Settings. Owners only: checked here (requireOwner) and again in lib/templates.ts,
// which runs inside withTenant. A template is archived, never deleted, so its stats survive.

// The templates show in Settings, in the log form and drafter on every company page, and in stats.
function refresh(workspaceId: string) {
  revalidatePath(`/${workspaceId}/settings`);
  revalidatePath(`/${workspaceId}/stats`);
  revalidatePath(`/${workspaceId}/companies/[companyId]`, "page");
}

export async function createTemplate(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = createTemplateSchema.safeParse({ workspaceId: form.get("workspaceId"), name: form.get("name"), body: form.get("body") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, ...fields } = parsed.data;

  try {
    const owner = await requireOwner(workspaceId);
    const result = await templates.createTemplate(owner, fields);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  refresh(workspaceId);
  return { ok: true, data: undefined };
}

export async function updateTemplate(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = updateTemplateSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    templateId: form.get("templateId"),
    name: form.get("name"),
    body: form.get("body"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, templateId, ...fields } = parsed.data;

  try {
    const owner = await requireOwner(workspaceId);
    const result = await templates.updateTemplate(owner, templateId, fields);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  refresh(workspaceId);
  return { ok: true, data: undefined };
}

export async function archiveTemplate(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = templateRefSchema.safeParse({ workspaceId: form.get("workspaceId"), templateId: form.get("templateId") });
  if (!parsed.success) return { ok: false, error: "Template not found." };
  const { workspaceId, templateId } = parsed.data;

  try {
    const owner = await requireOwner(workspaceId);
    const result = await templates.archiveTemplate(owner, templateId);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  refresh(workspaceId);
  return { ok: true, data: undefined };
}

export async function unarchiveTemplate(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = templateRefSchema.safeParse({ workspaceId: form.get("workspaceId"), templateId: form.get("templateId") });
  if (!parsed.success) return { ok: false, error: "Template not found." };
  const { workspaceId, templateId } = parsed.data;

  try {
    const owner = await requireOwner(workspaceId);
    const result = await templates.unarchiveTemplate(owner, templateId);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  refresh(workspaceId);
  return { ok: true, data: undefined };
}
