import type { Membership } from "@/lib/authz";
import { runAi, type AiRunError } from "@/lib/ai/run";
import { factNumbers } from "@/lib/claim-rules";
import { withTenant } from "@/lib/db";
import { verifiedFacts } from "@/lib/facts";
import { checkVariants, normaliseVariant, templateProblem, type LabVariant } from "@/lib/template-lab/check";
import { LAB_FACTS_SHOWN, LAB_SYSTEM, labPrompt } from "@/lib/template-lab/prompt";
import { labReplySchema, type ActionResult, type LabReply } from "@/lib/validation";

// "Try a variant" (AI feature 7, part 2): the model proposes 2 or 3 one-change variants of a
// template and code checks every one (lib/template-lab/check.ts). Nothing is saved here: the
// variants are shown read-only, and the owner starts an experiment with the ones they pick
// (lib/template-lab/lab.ts), which checks them again.

const ownersOnly = { ok: false, error: "Only the workspace owner can do that." } as const;
export const TEMPLATE_GONE = "Template not found, or it's archived.";
export const EXPERIMENT_ALREADY_RUNNING = "An experiment is already running. End it first.";

export type Proposal = {
  templateId: string;
  templateName: string;
  // Variants that passed every check, at most three, in the order the model gave them.
  variants: LabVariant[];
  // How many the model proposed that were dropped by a check.
  dropped: number;
  model: string;
};

// The model sees the template with "<" and ">" swapped for look-alikes (promptSafe), so a variant
// that kept them is turned back before it is compared. Only when the template has none of the
// look-alikes itself, so the turn-back can never change a template's own characters.
const restore = (original: string) => (text: string) => (/[‹›]/.test(original) ? text : text.replace(/‹/g, "<").replace(/›/g, ">"));

export async function proposeVariants(owner: Membership, templateId: string): Promise<ActionResult<Proposal>> {
  if (owner.role !== "owner") return ownersOnly;
  const found = await withTenant(owner, async (tx) => ({
    template: await tx.template.findFirst({ where: { id: templateId, workspaceId: owner.workspaceId, archivedAt: null }, select: { name: true, body: true } }),
    running: await tx.templateExperiment.findFirst({ where: { workspaceId: owner.workspaceId, status: "RUNNING" }, select: { id: true } }),
  }));
  if (!found.template) return { ok: false, error: TEMPLATE_GONE };
  // Both refuse before any AI call is made, so nothing is counted against the limit.
  if (found.running) return { ok: false, error: EXPERIMENT_ALREADY_RUNNING };
  const { name, body } = found.template;
  const contact = templateProblem(body);
  if (contact) return { ok: false, error: contact };

  const facts = (await verifiedFacts(owner)).slice(0, LAB_FACTS_SHOWN);
  const context = { factNumbers: factNumbers(facts) };
  const fix = restore(body);
  const prepared = (reply: LabReply) => reply.variants.map((v) => normaliseVariant({ ...v, body: fix(v.body) }));
  const accept = (reply: LabReply): AiRunError | null => (checkVariants(body, prepared(reply), context).kept.length > 0 ? null : "broke_rules");

  const result = await runAi(owner, { feature: "TEMPLATE_LAB", system: LAB_SYSTEM, prompt: labPrompt(body, facts), schema: labReplySchema }, { accept });
  if (!result.ok) return result;

  const all = prepared(result.data);
  const { kept } = checkVariants(body, all, context);
  return { ok: true, data: { templateId, templateName: name, variants: kept, dropped: all.length - kept.length, model: result.model } };
}
