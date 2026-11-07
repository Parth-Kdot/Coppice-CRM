import { aiUsage } from "@/lib/ai/run";
import { updateCompany } from "@/lib/companies";
import { withTenant, type Tenant } from "@/lib/db";
import { loadBrief, type BriefView } from "@/lib/research/brief";
import { DOOR_LABELS } from "@/lib/research/doors";
import { COMPANY_LIMITS, type ActionResult } from "@/lib/validation";

// Accepting one item of a research brief (lib/research/brief.ts): the only way a brief changes a
// company, and only when a person clicks "Add to notes" on that item.

// The line added to the company's notes for an item or a team inbox.
function noteLine(brief: BriefView, itemId: string): string | null {
  const item = brief.items.find((i) => i.id === itemId);
  if (item) {
    const deadline = item.deadline ? ` Deadline: ${item.deadline}.` : "";
    return `Coppice brief, ${DOOR_LABELS[item.door]}: ${item.title}. ${item.detail}${deadline} Source: ${item.url}`;
  }
  const inbox = brief.inboxes.find((i) => i.id === itemId);
  return inbox ? `Coppice brief, team inbox: ${inbox.email}. Source: ${inbox.url}` : null;
}

// "Add to notes": appends one item to the company's notes through the usual company edit (so a
// change someone else made at the same moment is never overwritten), then remembers it was added.
export async function acceptBriefItem(tenant: Tenant, companyId: string, briefId: string, itemId: string): Promise<ActionResult> {
  // The feature is hidden while AI is off, and refused here too.
  const usage = await aiUsage(tenant);
  if (!usage.enabled) return { ok: false, error: "AI is turned off for this workspace. An owner can turn it on in Settings." };
  const brief = await loadBrief(tenant, { id: briefId, companyId });
  if (!brief) return { ok: false, error: "Brief not found." };
  const line = noteLine(brief, itemId);
  if (!line) return { ok: false, error: "That item isn't in this brief." };
  const already = brief.items.some((i) => i.id === itemId && i.accepted) || brief.inboxes.some((i) => i.id === itemId && i.accepted);
  if (already) return { ok: true, data: undefined };

  const company = await withTenant(tenant, (tx) =>
    tx.company.findFirst({ where: { id: companyId, workspaceId: tenant.workspaceId }, select: { name: true, industry: true, website: true, notes: true, archivedAt: true } }),
  );
  if (!company) return { ok: false, error: "Company not found." };
  if (company.archivedAt) return { ok: false, error: "This company is archived. Unarchive it first." };

  const original = { name: company.name, industry: company.industry, website: company.website, notes: company.notes };
  if (!(original.notes ?? "").includes(line)) {
    const notes = original.notes ? `${original.notes}\n${line}` : line;
    if (notes.length > COMPANY_LIMITS.notes) return { ok: false, error: "The company's notes are full. Shorten them first." };
    const saved = await updateCompany(tenant, companyId, { changes: { ...original, notes }, original });
    if (!saved.ok) return saved;
    if (saved.data.status !== "saved") return { ok: false, error: "Someone else just edited this company. Reload the page and try again." };
  }
  await withTenant(tenant, (tx) =>
    tx.companyBrief.updateMany({ where: { id: briefId, workspaceId: tenant.workspaceId, NOT: { accepted: { has: itemId } } }, data: { accepted: { push: itemId } } }),
  );
  return { ok: true, data: undefined };
}
