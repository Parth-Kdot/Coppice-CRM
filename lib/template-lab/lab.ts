import type { Membership } from "@/lib/authz";
import { dbNow } from "@/lib/claims";
import { advisoryXactLock, withTenant, type Tenant } from "@/lib/db";
import { verifiedFacts } from "@/lib/facts";
import { rate, tally, type OutreachRow } from "@/lib/stats-math";
import { archiveTemplatesIn, experimentLockKey } from "@/lib/templates";
import { checkContext, checkVariants, normaliseVariant, PROBLEM_TEXT, templateProblem, type LabVariant } from "@/lib/template-lab/check";
import { ARM_LABELS, experimentVerdict, suggestArm, type ArmView, type ExperimentView } from "@/lib/template-lab/experiment";
import { EXPERIMENT_ALREADY_RUNNING, TEMPLATE_GONE } from "@/lib/template-lab/propose";
import { LAB_FACTS_SHOWN } from "@/lib/template-lab/prompt";
import { TEMPLATE_LIMITS, type ActionResult } from "@/lib/validation";

// Template Lab experiments (AI feature 7, part 2): starting one, ending one, and reading the one
// the stats page shows. Owners only (checked here as well as in the server actions). One RUNNING
// experiment per workspace: enforced here under the workspace's advisory lock and by a partial
// unique index in the database. Nothing is ever deleted: ending archives the arms the owner did
// not keep, and the stats keep every arm's history.

const ownersOnly = { ok: false, error: "Only the workspace owner can do that." } as const;
export const VARIANTS_FAILED = "One of those variants no longer passes Coppice's checks. Ask for new variants.";
const NOT_RUNNING = { ok: false, error: "That experiment isn't running." } as const;
const NOT_AN_ARM = { ok: false, error: "Pick one of the experiment's templates." } as const;

// "<base name> (B)": the name of a variant, kept inside a template name's limit. If an earlier
// experiment already made one (an archived "Fall pitch (B)"), the label gets a number: "(B 2)".
function variantName(base: string, label: string, taken: Set<string>): string {
  const room = (suffix: string) => base.slice(0, TEMPLATE_LIMITS.name - suffix.length).trimEnd() + suffix;
  for (let n = 1; ; n++) {
    const name = room(` (${n === 1 ? label : `${label} ${n}`})`);
    if (!taken.has(name.toLowerCase())) return name;
  }
}

export type StartedExperiment = { experimentId: string; arms: { templateId: string; label: string; name: string }[] };

// Creates the variant templates, the experiment and its arms in one transaction. `picks` are
// checked again here, against the template as it is now and the verified facts as they are now:
// they came back from the browser, so they are never trusted. Arm A is the original.
export async function startExperiment(owner: Membership, baseTemplateId: string, picks: LabVariant[]): Promise<ActionResult<StartedExperiment>> {
  if (owner.role !== "owner") return ownersOnly;
  if (picks.length < 1 || picks.length > ARM_LABELS.length - 1) return { ok: false, error: "Pick one or two variants to try." };
  const facts = await verifiedFacts(owner, LAB_FACTS_SHOWN);
  const context = checkContext(facts);

  return withTenant(owner, async (tx): Promise<ActionResult<StartedExperiment>> => {
    const { workspaceId } = owner;
    await advisoryXactLock(tx, experimentLockKey(workspaceId));
    if (await tx.templateExperiment.findFirst({ where: { workspaceId, status: "RUNNING" }, select: { id: true } })) {
      return { ok: false, error: EXPERIMENT_ALREADY_RUNNING };
    }
    const base = await tx.template.findFirst({ where: { id: baseTemplateId, workspaceId, archivedAt: null }, select: { id: true, name: true, body: true } });
    if (!base) return { ok: false, error: TEMPLATE_GONE };
    const contact = templateProblem(base.body);
    if (contact) return { ok: false, error: contact };

    const variants = picks.map(normaliseVariant);
    const { kept, dropped } = checkVariants(base.body, variants, context);
    if (dropped.length > 0 || kept.length !== variants.length) {
      return { ok: false, error: dropped[0] ? `${VARIANTS_FAILED} (${PROBLEM_TEXT[dropped[0].problem]})` : VARIANTS_FAILED };
    }

    const taken = new Set((await tx.template.findMany({ where: { workspaceId }, select: { name: true } })).map((t) => t.name.toLowerCase()));
    const arms: StartedExperiment["arms"] = [{ templateId: base.id, label: ARM_LABELS[0], name: base.name }];
    const created: { templateId: string; label: string; kind: string; summary: string }[] = [];
    for (const [i, variant] of kept.entries()) {
      const label = ARM_LABELS[i + 1];
      const name = variantName(base.name, label, taken);
      taken.add(name.toLowerCase());
      const template = await tx.template.create({
        data: { workspaceId, name, body: variant.body, familyId: base.id, variantNote: variant.summary },
        select: { id: true },
      });
      arms.push({ templateId: template.id, label, name });
      created.push({ templateId: template.id, label, kind: variant.kind, summary: variant.summary });
    }

    const experiment = await tx.templateExperiment.create({
      data: { workspaceId, baseTemplateId: base.id, startedById: owner.userId },
      select: { id: true },
    });
    await tx.experimentArm.createMany({
      data: [
        { workspaceId, experimentId: experiment.id, templateId: base.id, label: ARM_LABELS[0], kind: "original", summary: "The original template." },
        ...created.map((c) => ({ workspaceId, experimentId: experiment.id, ...c })),
      ],
    });
    return { ok: true, data: { experimentId: experiment.id, arms } };
  });
}

// Ends a running experiment and keeps one of its arms. The others are archived in the same
// transaction (never deleted, so the stats keep their history); the arm kept stays as it is.
export async function endExperiment(owner: Membership, experimentId: string, keepTemplateId: string): Promise<ActionResult> {
  if (owner.role !== "owner") return ownersOnly;
  const at = await dbNow();
  return withTenant(owner, async (tx): Promise<ActionResult> => {
    const { workspaceId } = owner;
    await advisoryXactLock(tx, experimentLockKey(workspaceId));
    const experiment = await tx.templateExperiment.findFirst({
      where: { id: experimentId, workspaceId, status: "RUNNING" },
      select: { id: true, arms: { select: { templateId: true } } },
    });
    if (!experiment) return NOT_RUNNING;
    if (!experiment.arms.some((a) => a.templateId === keepTemplateId)) return NOT_AN_ARM;
    await tx.templateExperiment.update({
      where: { id: experiment.id },
      data: { status: "ENDED", endedAt: at, keptTemplateId: keepTemplateId },
    });
    await archiveTemplatesIn(tx, workspaceId, experiment.arms.map((a) => a.templateId).filter((id) => id !== keepTemplateId), at);
    return { ok: true, data: undefined };
  });
}

// The experiment the stats page's Lab panel shows: the running one, or else the one that ended
// last. Each arm's numbers cover only the sends logged while the experiment ran (from its start,
// and to its end if it ended), counted by the scorecard's own rules (lib/stats-math.ts): an old
// send of the original template, from before the experiment, would not be a fair comparison.
export async function getExperimentView(tenant: Tenant): Promise<ExperimentView | null> {
  const now = await dbNow();
  const found = await withTenant(tenant, async (tx) => {
    const { workspaceId } = tenant;
    const experiment =
      (await tx.templateExperiment.findFirst({ where: { workspaceId, status: "RUNNING" }, select: { id: true } })) ??
      (await tx.templateExperiment.findFirst({ where: { workspaceId, status: "ENDED" }, orderBy: [{ endedAt: "desc" }, { id: "desc" }], select: { id: true } }));
    if (!experiment) return null;
    const row = await tx.templateExperiment.findUniqueOrThrow({
      where: { id: experiment.id },
      select: {
        id: true,
        status: true,
        startedAt: true,
        endedAt: true,
        baseTemplateId: true,
        keptTemplateId: true,
        arms: { select: { templateId: true, label: true, kind: true, summary: true, template: { select: { name: true, archivedAt: true } } }, orderBy: { label: "asc" } },
      },
    });
    const outreach = await tx.outreach.findMany({
      where: {
        workspaceId,
        templateId: { in: row.arms.map((a) => a.templateId) },
        sentAt: { gte: row.startedAt, ...(row.endedAt ? { lte: row.endedAt } : {}) },
      },
      select: { id: true, companyId: true, templateId: true, channel: true, sentAt: true, gotReply: true },
    });
    return { row, outreach };
  });
  if (!found) return null;

  const { row, outreach } = found;
  const rows: OutreachRow[] = outreach.map((o) => ({ ...o, aiDrafted: false, industry: null }));
  const arms: ArmView[] = row.arms.map((a) => ({
    templateId: a.templateId,
    name: a.template.name,
    label: a.label,
    kind: a.kind,
    summary: a.summary,
    archived: a.template.archivedAt !== null,
    kept: a.templateId === row.keptTemplateId,
    stat: rate(tally(rows.filter((r) => r.templateId === a.templateId), now)),
  }));
  return {
    id: row.id,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    baseTemplateId: row.baseTemplateId,
    keptTemplateId: row.keptTemplateId,
    arms,
    verdict: experimentVerdict(arms),
    suggested: row.status === "RUNNING" ? suggestArm(arms.map((a) => ({ label: a.label, sends: a.stat.sent }))) : null,
  };
}
