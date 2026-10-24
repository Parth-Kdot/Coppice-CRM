import { withTenant, type Tenant } from "@/lib/db";
import { domainKey, matchReasons, nameKey, orderedPair, type MatchReason } from "@/lib/duplicates";
import type { ActionResult } from "@/lib/validation";
import type { Prisma } from "@/generated/prisma/client";

// Company and contact logic. Every function runs inside withTenant, so row-level security limits
// it to the caller's workspace; each query also names workspaceId itself (project rule 1).
// Callers (server actions) check membership and validate input first. Nothing here is ever
// removed automatically: "remove" means archive, and only on a person's explicit choice.

type Tx = Prisma.TransactionClient;

export type CompanyFields = { name: string; industry?: string | null; website?: string | null; notes?: string | null };
export type ContactFields = { name: string; email?: string | null; title?: string | null };

// `archived` matches are included on purpose: re-adding a company that was archived last year
// should offer to unarchive it (with its history) instead of starting an empty duplicate.
export type DuplicateMatch = { id: string; name: string; website: string | null; archived: boolean; matchedOn: MatchReason[] };

type EditableField = keyof CompanyFields;
export type FieldConflict = { field: EditableField; theirs: string | null; yours: string | null };

// Saving either succeeds, stops to ask about look-alike companies, or (for edits) stops because
// someone else changed the same field first.
export type SaveResult =
  | { status: "saved"; companyId: string }
  | { status: "possible-duplicates"; matches: DuplicateMatch[] }
  | { status: "conflict"; conflicts: FieldConflict[] };

// An edit: the values the person submitted, and the values the form showed when it loaded.
export type CompanyEdit = { changes: CompanyFields; original: CompanyFields };

const keysFor = (fields: CompanyFields) => ({ nameKey: nameKey(fields.name), domainKey: domainKey(fields.website) });

// Companies in this workspace (active or archived) that look like `keys`, minus pairs already
// marked separate.
async function findMatches(
  tx: Tx,
  workspaceId: string,
  keys: { nameKey: string; domainKey: string | null },
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const candidates = await tx.company.findMany({
    where: {
      workspaceId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [{ nameKey: keys.nameKey }, ...(keys.domainKey ? [{ domainKey: keys.domainKey }] : [])],
    },
    select: { id: true, name: true, website: true, nameKey: true, domainKey: true, archivedAt: true },
    orderBy: { createdAt: "asc" },
  });
  let separate = new Set<string>();
  if (excludeId && candidates.length > 0) {
    const decisions = await tx.companyPairDecision.findMany({
      where: { workspaceId, OR: [{ companyAId: excludeId }, { companyBId: excludeId }] },
      select: { companyAId: true, companyBId: true },
    });
    separate = new Set(decisions.map((d) => (d.companyAId === excludeId ? d.companyBId : d.companyAId)));
  }
  return candidates
    .filter((c) => !separate.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, website: c.website, archived: c.archivedAt !== null, matchedOn: matchReasons(keys, c) }));
}

// Remember "these are separate" for each acknowledged match, so the pair never flags again.
async function recordSeparate(tx: Tx, tenant: Tenant, companyId: string, otherIds: string[]) {
  const data = otherIds.map((otherId) => {
    const [companyAId, companyBId] = orderedPair(companyId, otherId);
    return { workspaceId: tenant.workspaceId, companyAId, companyBId, decidedById: tenant.userId };
  });
  if (data.length > 0) await tx.companyPairDecision.createMany({ data, skipDuplicates: true });
}

// Matches the person hasn't yet said are separate. Ids they "acknowledged" that aren't actual
// matches are ignored, so a stale or tampered list can't create decisions for random companies.
function split(matches: DuplicateMatch[], separateFrom: string[]) {
  const acknowledged = new Set(separateFrom);
  return {
    unresolved: matches.filter((m) => !acknowledged.has(m.id)),
    confirmedSeparate: matches.filter((m) => acknowledged.has(m.id)).map((m) => m.id),
  };
}

export function createCompany(tenant: Tenant, fields: CompanyFields, separateFrom: string[] = []): Promise<SaveResult> {
  return withTenant(tenant, async (tx) => {
    const keys = keysFor(fields);
    const { unresolved, confirmedSeparate } = split(await findMatches(tx, tenant.workspaceId, keys), separateFrom);
    if (unresolved.length > 0) return { status: "possible-duplicates", matches: unresolved };
    const company = await tx.company.create({
      data: { workspaceId: tenant.workspaceId, ...fields, ...keys },
      select: { id: true },
    });
    await recordSeparate(tx, tenant, company.id, confirmedSeparate);
    return { status: "saved", companyId: company.id };
  });
}

const EDITABLE: EditableField[] = ["name", "industry", "website", "notes"];
const value = (fields: CompanyFields, field: EditableField) => fields[field] ?? null;

// Saves only the fields the person actually changed, and only if each one still holds the value
// their form loaded. That check and the write are one UPDATE, so two people editing at the same
// moment can't overwrite each other: editing different fields both succeed, the same field is a
// conflict the second person sees (with the other value) instead of a silent overwrite.
export function updateCompany(
  tenant: Tenant,
  companyId: string,
  edit: CompanyEdit,
  separateFrom: string[] = [],
): Promise<ActionResult<SaveResult>> {
  return withTenant(tenant, async (tx) => {
    const where = { id: companyId, workspaceId: tenant.workspaceId };
    const current = await tx.company.findFirst({ where, select: { name: true, industry: true, website: true, notes: true } });
    if (!current) return { ok: false, error: "Company not found." };

    const changed = EDITABLE.filter((f) => value(edit.changes, f) !== value(edit.original, f));
    if (changed.length === 0) return { ok: true, data: { status: "saved", companyId } };

    const conflictsWith = (now: CompanyFields): FieldConflict[] =>
      changed
        .filter((f) => value(now, f) !== value(edit.original, f))
        .map((f) => ({ field: f, theirs: value(now, f), yours: value(edit.changes, f) }));
    const early = conflictsWith(current);
    if (early.length > 0) return { ok: true, data: { status: "conflict", conflicts: early } };

    const changes = Object.fromEntries(changed.map((f) => [f, value(edit.changes, f)])) as Partial<CompanyFields>;
    let keys: ReturnType<typeof keysFor> | undefined;
    if (changed.includes("name") || changed.includes("website")) {
      keys = keysFor({ ...current, ...changes } as CompanyFields);
      const { unresolved, confirmedSeparate } = split(await findMatches(tx, tenant.workspaceId, keys, companyId), separateFrom);
      if (unresolved.length > 0) return { ok: true, data: { status: "possible-duplicates", matches: unresolved } };
      await recordSeparate(tx, tenant, companyId, confirmedSeparate);
    }

    const originals = Object.fromEntries(changed.map((f) => [f, value(edit.original, f)]));
    const { count } = await tx.company.updateMany({ where: { ...where, ...originals }, data: { ...changes, ...keys } });
    if (count === 0) {
      // Someone saved the same field between our read and our write. (Companies are never
      // deleted, only archived, so the row is still there.)
      const now = await tx.company.findFirstOrThrow({ where, select: { name: true, industry: true, website: true, notes: true } });
      return { ok: true, data: { status: "conflict", conflicts: conflictsWith(now) } };
    }
    return { ok: true, data: { status: "saved", companyId } };
  });
}

async function setArchived(tenant: Tenant, companyId: string, archived: boolean): Promise<ActionResult> {
  return withTenant(tenant, async (tx) => {
    const { count } = await tx.company.updateMany({
      where: { id: companyId, workspaceId: tenant.workspaceId, archivedAt: archived ? null : { not: null } },
      data: { archivedAt: archived ? new Date() : null },
    });
    return count === 1 ? { ok: true, data: undefined } : { ok: false, error: "Company not found." };
  });
}

// Hidden from the board and queue, kept with all its history, and recoverable.
export const archiveCompany = (tenant: Tenant, companyId: string) => setArchived(tenant, companyId, true);
export const unarchiveCompany = (tenant: Tenant, companyId: string) => setArchived(tenant, companyId, false);

// Everything the company page shows. Stage history is capped at the latest 50 moves.
export function getCompanyDetail(tenant: Tenant, companyId: string) {
  return withTenant(tenant, (tx) =>
    tx.company.findFirst({
      where: { id: companyId, workspaceId: tenant.workspaceId },
      select: {
        id: true,
        name: true,
        industry: true,
        website: true,
        notes: true,
        stage: true,
        archivedAt: true,
        updatedAt: true,
        contacts: { select: { id: true, name: true, email: true, title: true }, orderBy: { createdAt: "asc" } },
        stageChanges: {
          select: { id: true, fromStage: true, toStage: true, changedAt: true, changedBy: { select: { name: true } } },
          orderBy: { changedAt: "desc" },
          take: 50,
        },
      },
    }),
  );
}

export type CompanyDetail = NonNullable<Awaited<ReturnType<typeof getCompanyDetail>>>;

// Industries already used in this workspace, for the industry box's suggestions, so "Tech",
// "tech" and "Technology" don't drift apart. Capped at 200.
export function listIndustries(tenant: Tenant): Promise<string[]> {
  return withTenant(tenant, async (tx) => {
    const rows = await tx.company.findMany({
      where: { workspaceId: tenant.workspaceId, industry: { not: null } },
      distinct: ["industry"],
      select: { industry: true },
      orderBy: { industry: "asc" },
      take: 200,
    });
    return rows.map((r) => r.industry as string);
  });
}

export type DuplicatePair = { a: DuplicateMatch; b: DuplicateMatch; matchedOn: MatchReason[] };

// Look-alike pairs already in the workspace (from imports, edits or simultaneous creates), for the
// "Possible duplicates" box. Pairs a person marked separate are left out. Capped so a workspace
// full of identical names can't produce a huge list.
export function listPossibleDuplicatePairs(tenant: Tenant, limit = 50): Promise<DuplicatePair[]> {
  return withTenant(tenant, async (tx) => {
    const companies = await tx.company.findMany({
      where: { workspaceId: tenant.workspaceId, archivedAt: null },
      select: { id: true, name: true, website: true, nameKey: true, domainKey: true },
      orderBy: { createdAt: "asc" },
    });
    const decisions = await tx.companyPairDecision.findMany({
      where: { workspaceId: tenant.workspaceId },
      select: { companyAId: true, companyBId: true },
    });
    const separate = new Set(decisions.map((d) => `${d.companyAId}|${d.companyBId}`));

    // Group by each key, then pair up companies within a group.
    const groups = new Map<string, typeof companies>();
    for (const c of companies) {
      for (const key of [`name:${c.nameKey}`, ...(c.domainKey ? [`site:${c.domainKey}`] : [])]) {
        groups.set(key, [...(groups.get(key) ?? []), c]);
      }
    }
    const pairs = new Map<string, DuplicatePair>();
    for (const group of groups.values()) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const [aId, bId] = orderedPair(group[i].id, group[j].id);
          const id = `${aId}|${bId}`;
          if (separate.has(id) || pairs.has(id)) continue;
          const [a, b] = aId === group[i].id ? [group[i], group[j]] : [group[j], group[i]];
          const reasons = matchReasons(a, b);
          const view = (c: typeof a) => ({ id: c.id, name: c.name, website: c.website, archived: false, matchedOn: reasons });
          pairs.set(id, { a: view(a), b: view(b), matchedOn: reasons });
          if (pairs.size >= limit) return [...pairs.values()];
        }
      }
    }
    return [...pairs.values()];
  });
}

// "These are separate": remembered so the pair stops being flagged.
export function markSeparate(tenant: Tenant, companyId: string, otherId: string): Promise<ActionResult> {
  return withTenant(tenant, async (tx) => {
    if (companyId === otherId) return { ok: false, error: "Pick two different companies." };
    const found = await tx.company.count({ where: { workspaceId: tenant.workspaceId, id: { in: [companyId, otherId] } } });
    if (found !== 2) return { ok: false, error: "Company not found." };
    await recordSeparate(tx, tenant, companyId, [otherId]);
    return { ok: true, data: undefined };
  });
}

// "These are the same": the person keeps one and the other is archived (never deleted).
export function resolveAsDuplicate(tenant: Tenant, keepId: string, removeId: string): Promise<ActionResult> {
  return withTenant(tenant, async (tx) => {
    if (keepId === removeId) return { ok: false, error: "Pick two different companies." };
    const active = await tx.company.count({
      where: { workspaceId: tenant.workspaceId, archivedAt: null, id: { in: [keepId, removeId] } },
    });
    if (active !== 2) return { ok: false, error: "Company not found." };
    await tx.company.updateMany({
      where: { id: removeId, workspaceId: tenant.workspaceId },
      data: { archivedAt: new Date() },
    });
    return { ok: true, data: undefined };
  });
}

export function addContact(tenant: Tenant, companyId: string, fields: ContactFields): Promise<ActionResult<{ contactId: string }>> {
  return withTenant(tenant, async (tx) => {
    const company = await tx.company.findFirst({ where: { id: companyId, workspaceId: tenant.workspaceId }, select: { id: true } });
    if (!company) return { ok: false, error: "Company not found." };
    const contact = await tx.contact.create({
      data: { workspaceId: tenant.workspaceId, companyId, ...fields },
      select: { id: true },
    });
    return { ok: true, data: { contactId: contact.id } };
  });
}

export function updateContact(tenant: Tenant, contactId: string, fields: ContactFields): Promise<ActionResult> {
  return withTenant(tenant, async (tx) => {
    const { count } = await tx.contact.updateMany({ where: { id: contactId, workspaceId: tenant.workspaceId }, data: fields });
    return count === 1 ? { ok: true, data: undefined } : { ok: false, error: "Contact not found." };
  });
}

// Contacts are people's details, not company history, so removing one really deletes it.
export function removeContact(tenant: Tenant, contactId: string): Promise<ActionResult> {
  return withTenant(tenant, async (tx) => {
    const { count } = await tx.contact.deleteMany({ where: { id: contactId, workspaceId: tenant.workspaceId } });
    return count === 1 ? { ok: true, data: undefined } : { ok: false, error: "Contact not found." };
  });
}
