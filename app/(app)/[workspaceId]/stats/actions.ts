"use server";

import { revalidatePath } from "next/cache";
import { failure } from "@/lib/actions";
import { requireMembership, requireOwner } from "@/lib/authz";
import { explainScorecard } from "@/lib/scorecard/explain";
import { endExperiment as endLabExperiment, startExperiment as startLabExperiment, type StartedExperiment } from "@/lib/template-lab/lab";
import { proposeVariants as proposeLabVariants, type Proposal } from "@/lib/template-lab/propose";
import { endExperimentSchema, explainStatsSchema, proposeVariantsSchema, startExperimentSchema, type ActionResult } from "@/lib/validation";

// The stats page's AI features: "Explain these numbers" (any member) and the Template Lab (owners
// only). Each checks who is asking (requireMembership, requireOwner), then runs the work in
// lib/scorecard or lib/template-lab, which check the role again inside withTenant. The AI calls
// are made there, outside any database transaction, and only ever on a click.

// The explanation shows on the stats page only.
const refreshStats = (workspaceId: string) => revalidatePath(`/${workspaceId}/stats`);

// Starting or ending an experiment changes the templates in Settings, in the stats page and in the
// log form and drafter on every company page.
function refreshTemplates(workspaceId: string) {
  revalidatePath(`/${workspaceId}/settings`);
  refreshStats(workspaceId);
  revalidatePath(`/${workspaceId}/companies/[companyId]`, "page");
}

// "Explain these numbers". The model's call takes a few seconds and counts against the workspace's
// AI limit like any other; the stored explanation is read by the page after it refreshes.
export async function explainStats(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = explainStatsSchema.safeParse({ workspaceId: form.get("workspaceId") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  try {
    const member = await requireMembership(parsed.data.workspaceId);
    const result = await explainScorecard(member);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  refreshStats(parsed.data.workspaceId);
  return { ok: true, data: undefined };
}

// "Try a variant": 2 or 3 checked variants of one template, shown read-only. Saves nothing.
export async function proposeVariants(_prev: ActionResult<Proposal> | null, form: FormData): Promise<ActionResult<Proposal>> {
  const parsed = proposeVariantsSchema.safeParse({ workspaceId: form.get("workspaceId"), templateId: form.get("templateId") });
  if (!parsed.success) return { ok: false, error: "Template not found." };
  try {
    const owner = await requireOwner(parsed.data.workspaceId);
    return await proposeLabVariants(owner, parsed.data.templateId);
  } catch (e) {
    return failure(e);
  }
}

// Runs the template against the one or two variants the owner picked. `variants` is a JSON field.
export async function startExperiment(_prev: ActionResult<StartedExperiment> | null, form: FormData): Promise<ActionResult<StartedExperiment>> {
  const parsed = startExperimentSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    templateId: form.get("templateId"),
    variants: form.get("variants"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, templateId, variants } = parsed.data;
  let result: ActionResult<StartedExperiment>;
  try {
    const owner = await requireOwner(workspaceId);
    result = await startLabExperiment(owner, templateId, variants);
  } catch (e) {
    return failure(e);
  }
  if (result.ok) refreshTemplates(workspaceId);
  return result;
}

// Ends the running experiment, keeping one template; the others are archived, never deleted.
export async function endExperiment(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = endExperimentSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    experimentId: form.get("experimentId"),
    keepTemplateId: form.get("keepTemplateId"),
  });
  if (!parsed.success) return { ok: false, error: "Pick the template to keep." };
  const { workspaceId, experimentId, keepTemplateId } = parsed.data;
  try {
    const owner = await requireOwner(workspaceId);
    const result = await endLabExperiment(owner, experimentId, keepTemplateId);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  refreshTemplates(workspaceId);
  return { ok: true, data: undefined };
}
