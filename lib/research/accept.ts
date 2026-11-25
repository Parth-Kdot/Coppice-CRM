import type { Via } from "@/generated/prisma/client";
import { AI_OFF_MESSAGE, aiUsage } from "@/lib/ai/run";
import { updateCompany } from "@/lib/companies";
import { withTenant, type Tenant } from "@/lib/db";
import { COMPANY_ARCHIVED, notFound } from "@/lib/messages";
import { loadBrief, type BriefView } from "@/lib/research/brief";
import { DOOR_LABELS } from "@/lib/research/doors";
import { ASK_CHANGED, FLAG_LABELS, isAccepted } from "@/lib/research/sections";
import { COMPANY_LIMITS, type ActionResult } from "@/lib/validation";

// Accepting one item of a research brief (lib/research/brief.ts): the only way a brief changes a
// company, and only when a person clicks "Add to notes" on that item.

// The line added to the company's notes for an entry of any section or a team inbox.
function noteLine(brief: BriefView, itemId: string): string | null {
  const item = brief.items.find((i) => i.id === itemId);
  if (item) {
    const deadline = item.deadline ? ` Deadline: ${item.deadline}.` : "";
    return `Coppice brief, ${DOOR_LABELS[item.door]}: ${item.title}. ${item.detail}${deadline} Source: ${item.url}`;
  }
  const tie = brief.ties.find((t) => t.id === itemId);
  if (tie) return `Coppice brief, campus tie: ${tie.title}. ${tie.detail} Source: ${tie.url}`;
  const flag = brief.flags.find((f) => f.id === itemId);
  if (flag) return `Coppice brief, red flag (${FLAG_LABELS[flag.kind]}): ${flag.title}. Source: ${flag.url}`;
  if (brief.hook?.id === itemId) return `Coppice brief, outreach hook: ${brief.hook.line} Source: ${brief.hook.url}`;
  if (brief.ask?.id === itemId) return `Coppice brief, suggested ask: ${brief.ask.factText}. Why: ${brief.ask.reason} Source: ${brief.ask.url}`;
  const inbox = brief.inboxes.find((i) => i.id === itemId);
  return inbox ? `Coppice brief, team inbox: ${inbox.email}. Source: ${inbox.url}` : null;
}

// "Add to notes": appends one item to the company's notes through the usual company edit (so a
// change someone else made at the same moment is never overwritten), then remembers it was added.
// The notes before the line was added are kept for an hour as the notes' previous version, made by
// `via` (the app, or the person's assistant).
export async function acceptBriefItem(tenant: Tenant, companyId: string, briefId: string, itemId: string, via: Via = "APP"): Promise<ActionResult> {
  // The feature is hidden while AI is off, and refused here too.
  const usage = await aiUsage(tenant);
  if (!usage.enabled) return { ok: false, error: AI_OFF_MESSAGE };
  const brief = await loadBrief(tenant, { id: briefId, companyId });
  if (!brief) return notFound("Brief");
  const line = noteLine(brief, itemId);
  if (!line) return { ok: false, error: "That item isn't in this brief." };
  if (isAccepted(brief, itemId)) return { ok: true, data: undefined };
  // An ask whose fact changed would put a tier in the notes that the workspace no longer stands by.
  if (brief.ask?.id === itemId && brief.ask.changed) return { ok: false, error: ASK_CHANGED };

  const company = await withTenant(tenant, (tx) =>
    tx.company.findFirst({ where: { id: companyId, workspaceId: tenant.workspaceId }, select: { name: true, industry: true, website: true, notes: true, archivedAt: true } }),
  );
  if (!company) return notFound("Company");
  if (company.archivedAt) return { ok: false, error: COMPANY_ARCHIVED };

  const original = { name: company.name, industry: company.industry, website: company.website, notes: company.notes };
  if (!(original.notes ?? "").includes(line)) {
    const notes = original.notes ? `${original.notes}\n${line}` : line;
    if (notes.length > COMPANY_LIMITS.notes) return { ok: false, error: "The company's notes are full. Shorten them first." };
    const saved = await updateCompany(tenant, companyId, { changes: { ...original, notes }, original }, [], via);
    if (!saved.ok) return saved;
    if (saved.data.status !== "saved") return { ok: false, error: "Someone else just edited this company. Reload the page and try again." };
  }
  await withTenant(tenant, (tx) =>
    tx.companyBrief.updateMany({ where: { id: briefId, workspaceId: tenant.workspaceId, NOT: { accepted: { has: itemId } } }, data: { accepted: { push: itemId } } }),
  );
  return { ok: true, data: undefined };
}
