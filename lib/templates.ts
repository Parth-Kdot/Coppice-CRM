import type { Membership } from "@/lib/authz";
import { withTenant, type Tenant } from "@/lib/db";
import type { ActionResult } from "@/lib/validation";

// Outreach templates (Milestone 5): the emails a workspace sends again and again, so stats can say
// which ones get replies. Owners write, edit, archive and unarchive them; every member can read
// them and pick one when logging outreach or drafting. A template is never deleted: outreach points
// at it, so archiving takes it out of the pickers and keeps its history in the stats.
// The body may only use {{firstName}}, {{senderName}} and {{orgName}} (checked in lib/validation.ts).

const ownersOnly = { ok: false, error: "Only the workspace owner can manage templates." } as const;
const NOT_FOUND = { ok: false, error: "Template not found." } as const;

export type TemplateFields = { name: string; body: string };

// What the pickers show: the templates that can still be used, by name.
export type TemplateOption = { id: string; name: string; body: string };

export function activeTemplates(tenant: Tenant): Promise<TemplateOption[]> {
  return withTenant(tenant, (tx) =>
    tx.template.findMany({
      where: { workspaceId: tenant.workspaceId, archivedAt: null },
      select: { id: true, name: true, body: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
  );
}

export type TemplateRow = TemplateOption & { archivedAt: Date | null; uses: number };

// Every template for Settings, archived ones too, each with how many outreach entries used it. The
// counts come from one grouped query, not one per template.
export function listTemplates(tenant: Tenant): Promise<TemplateRow[]> {
  return withTenant(tenant, async (tx) => {
    const templates = await tx.template.findMany({
      where: { workspaceId: tenant.workspaceId },
      select: { id: true, name: true, body: true, archivedAt: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    const used = await tx.outreach.groupBy({
      by: ["templateId"],
      where: { workspaceId: tenant.workspaceId, templateId: { not: null } },
      _count: { _all: true },
    });
    const uses = new Map(used.map((g) => [g.templateId, g._count._all]));
    return templates.map((t) => ({ ...t, uses: uses.get(t.id) ?? 0 }));
  });
}

// Two templates with the same name would be impossible to tell apart in a picker or in the stats.
// This is a read then a write with no unique index behind it, so two owners saving the same name at
// the same instant could both get through. That race is accepted: a workspace has one or two
// owners, and a duplicate is harmless and can be renamed or archived. A unique index on
// ("workspaceId", lower(name)) in a migration would close it if it ever matters.
const sameName = (name: string) => ({ equals: name, mode: "insensitive" as const });
const nameTaken = (name: string, archived: boolean) =>
  archived
    ? `An archived template is already called "${name}". Unarchive it, or pick another name.`
    : `A template is already called "${name}". Pick another name.`;

export function createTemplate(owner: Membership, fields: TemplateFields): Promise<ActionResult<{ templateId: string }>> {
  return withTenant(owner, async (tx) => {
    if (owner.role !== "owner") return ownersOnly;
    const clash = await tx.template.findFirst({
      where: { workspaceId: owner.workspaceId, name: sameName(fields.name) },
      select: { archivedAt: true },
    });
    if (clash) return { ok: false, error: nameTaken(fields.name, clash.archivedAt !== null) };
    const template = await tx.template.create({
      data: { workspaceId: owner.workspaceId, name: fields.name, body: fields.body },
      select: { id: true },
    });
    return { ok: true, data: { templateId: template.id } };
  });
}

// Edits apply to future outreach; what was already logged keeps counting for this template.
export function updateTemplate(owner: Membership, templateId: string, fields: TemplateFields): Promise<ActionResult> {
  return withTenant(owner, async (tx) => {
    if (owner.role !== "owner") return ownersOnly;
    const clash = await tx.template.findFirst({
      where: { workspaceId: owner.workspaceId, name: sameName(fields.name), id: { not: templateId } },
      select: { archivedAt: true },
    });
    if (clash) return { ok: false, error: nameTaken(fields.name, clash.archivedAt !== null) };
    const { count } = await tx.template.updateMany({
      where: { id: templateId, workspaceId: owner.workspaceId, archivedAt: null },
      data: { name: fields.name, body: fields.body },
    });
    return count === 1 ? { ok: true, data: undefined } : { ok: false, error: "Template not found, or it's archived. Unarchive it to edit it." };
  });
}

export function archiveTemplate(owner: Membership, templateId: string): Promise<ActionResult> {
  return withTenant(owner, async (tx) => {
    if (owner.role !== "owner") return ownersOnly;
    const { count } = await tx.template.updateMany({
      where: { id: templateId, workspaceId: owner.workspaceId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    return count === 1 ? { ok: true, data: undefined } : NOT_FOUND;
  });
}

// Names are unique across archived templates too, so an unarchived template never clashes.
export function unarchiveTemplate(owner: Membership, templateId: string): Promise<ActionResult> {
  return withTenant(owner, async (tx) => {
    if (owner.role !== "owner") return ownersOnly;
    const { count } = await tx.template.updateMany({
      where: { id: templateId, workspaceId: owner.workspaceId, archivedAt: { not: null } },
      data: { archivedAt: null },
    });
    return count === 1 ? { ok: true, data: undefined } : NOT_FOUND;
  });
}
