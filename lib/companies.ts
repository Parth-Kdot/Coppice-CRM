import type { Membership } from "@/lib/authz";
import { releaseForArchive } from "@/lib/claims";
import { withTenant, type Tenant } from "@/lib/db";
import { domainKey, matchReasons, nameKey, orderedPair, type MatchReason } from "@/lib/duplicates";
import type { ActionResult } from "@/lib/validation";
import type { Channel, Prisma } from "@/generated/prisma/client";

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
// Look-alikes are listed up to MATCH_LIMIT, name matches first; `total` counts them all, so the form
// can say "and 280 more".
export type SaveResult =
  | { status: "saved"; companyId: string }
  | { status: "possible-duplicates"; matches: DuplicateMatch[]; total: number }
  | { status: "conflict"; conflicts: FieldConflict[] };

// An edit: the values the person submitted, and the values the form showed when it loaded.
export type CompanyEdit = { changes: CompanyFields; original: CompanyFields };

const keysFor = (fields: CompanyFields) => ({ nameKey: nameKey(fields.name), domainKey: domainKey(fields.website) });

// At most this many look-alikes are listed (and sent back as "separate entries"); the rest are counted.
export const MATCH_LIMIT = 20;

type Keys = { nameKey: string; domainKey: string | null };

// Which companies count as look-alikes of `keys`: same name or same website, in this workspace,
// active or archived, minus this company itself and the ones already marked separate from it.
async function matchWhere(tx: Tx, workspaceId: string, keys: Keys, excludeId?: string): Promise<Prisma.CompanyWhereInput> {
  const skip: string[] = [];
  if (excludeId) {
    const decisions = await tx.companyPairDecision.findMany({
      where: { workspaceId, OR: [{ companyAId: excludeId }, { companyBId: excludeId }] },
      select: { companyAId: true, companyBId: true },
    });
    skip.push(excludeId, ...decisions.map((d) => (d.companyAId === excludeId ? d.companyBId : d.companyAId)));
  }
  return {
    workspaceId,
    ...(skip.length > 0 ? { id: { notIn: skip } } : {}),
    OR: [{ nameKey: keys.nameKey }, ...(keys.domainKey ? [{ domainKey: keys.domainKey }] : [])],
  };
}

// The first MATCH_LIMIT look-alikes, same name first (oldest first within each), and how many
// there are in all. Never an unbounded list: a shared website can match hundreds.
async function findMatches(tx: Tx, workspaceId: string, keys: Keys, excludeId?: string): Promise<{ matches: DuplicateMatch[]; total: number }> {
  const where = await matchWhere(tx, workspaceId, keys, excludeId);
  const select = { id: true, name: true, website: true, nameKey: true, domainKey: true, archivedAt: true } as const;
  const byName = await tx.company.findMany({ where: { AND: [where, { nameKey: keys.nameKey }] }, select, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: MATCH_LIMIT });
  const bySite =
    keys.domainKey && byName.length < MATCH_LIMIT
      ? await tx.company.findMany({
          where: { AND: [where, { domainKey: keys.domainKey }, { nameKey: { not: keys.nameKey } }] },
          select,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: MATCH_LIMIT - byName.length,
        })
      : [];
  const found = [...byName, ...bySite];
  const total = found.length < MATCH_LIMIT ? found.length : await tx.company.count({ where });
  const matches = found.map((c) => ({ id: c.id, name: c.name, website: c.website, archived: c.archivedAt !== null, matchedOn: matchReasons(keys, c) }));
  return { matches, total };
}

// Every look-alike's id, for "Separate entries: save anyway" when there were more than the form could list.
async function allMatchIds(tx: Tx, workspaceId: string, keys: Keys, excludeId?: string): Promise<string[]> {
  const rows = await tx.company.findMany({ where: await matchWhere(tx, workspaceId, keys, excludeId), select: { id: true } });
  return rows.map((r) => r.id);
}

// Remember "these are separate" for each acknowledged match, so the pair never flags again.
async function recordSeparate(tx: Tx, tenant: Tenant, companyId: string, otherIds: string[]) {
  const data = otherIds.map((otherId) => {
    const [companyAId, companyBId] = orderedPair(companyId, otherId);
    return { workspaceId: tenant.workspaceId, companyAId, companyBId, decidedById: tenant.userId };
  });
  if (data.length > 0) await tx.companyPairDecision.createMany({ data, skipDuplicates: true });
}

// Looks for look-alikes and works out which ones the person has already said are separate. Ids
// they "acknowledged" that aren't actual matches are ignored, so a stale or tampered list can't
// create decisions for random companies. When there were more matches than the form could list
// and the person said "separate" to every one it listed, they said it to the whole list ("and 280
// more"): the server records a decision for every match it finds, rather than trusting ids from
// the browser.
async function resolveMatches(tx: Tx, workspaceId: string, keys: Keys, separateFrom: string[], excludeId?: string) {
  const { matches, total } = await findMatches(tx, workspaceId, keys, excludeId);
  const acknowledged = new Set(separateFrom);
  const unresolved = matches.filter((m) => !acknowledged.has(m.id));
  if (unresolved.length > 0) {
    return { unresolved, unresolvedTotal: total - (matches.length - unresolved.length), confirmedSeparate: [] };
  }
  const confirmedSeparate = total > matches.length ? await allMatchIds(tx, workspaceId, keys, excludeId) : matches.map((m) => m.id);
  return { unresolved, unresolvedTotal: 0, confirmedSeparate };
}

export function createCompany(tenant: Tenant, fields: CompanyFields, separateFrom: string[] = []): Promise<SaveResult> {
  return withTenant(tenant, async (tx) => {
    const keys = keysFor(fields);
    const { unresolved, unresolvedTotal, confirmedSeparate } = await resolveMatches(tx, tenant.workspaceId, keys, separateFrom);
    if (unresolved.length > 0) return { status: "possible-duplicates", matches: unresolved, total: unresolvedTotal };
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
      const { unresolved, unresolvedTotal, confirmedSeparate } = await resolveMatches(tx, tenant.workspaceId, keys, separateFrom, companyId);
      if (unresolved.length > 0) return { ok: true, data: { status: "possible-duplicates", matches: unresolved, total: unresolvedTotal } };
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

// Hidden from the board and queue, kept with all its history, and recoverable. A company someone
// else holds can only be archived by them or an owner; archiving clears the claim (lib/claims.ts).
export function archiveCompany(actor: Membership, companyId: string): Promise<ActionResult> {
  return withTenant(actor, async (tx) => {
    const refused = await releaseForArchive(tx, actor, companyId);
    if (refused) return { ok: false, error: refused };
    await tx.company.updateMany({
      where: { id: companyId, workspaceId: actor.workspaceId },
      data: { archivedAt: new Date() },
    });
    return { ok: true, data: undefined };
  });
}

export function unarchiveCompany(tenant: Tenant, companyId: string): Promise<ActionResult> {
  return withTenant(tenant, async (tx) => {
    const { count } = await tx.company.updateMany({
      where: { id: companyId, workspaceId: tenant.workspaceId, archivedAt: { not: null } },
      data: { archivedAt: null },
    });
    return count === 1 ? { ok: true, data: undefined } : { ok: false, error: "Company not found." };
  });
}

// How much of a company's history the page loads: the latest 100 outreach entries and 50 stage
// moves, or with "Show older" up to 500 of each. The totals are always counted, so the page can
// say "the latest 100 of 200".
export const DETAIL_TAKE = { outreach: 100, history: 50, max: 500 } as const;
export type DetailOptions = { outreach?: number; history?: number };

// Everything the company page shows about the company itself.
//
// The lists are loaded one query at a time on purpose. Asked for all of them in one nested query,
// Prisma runs the parts at the same moment on the transaction's single connection, which the pg
// driver only tolerates with a deprecation warning (and pg 9 will refuse).
export function getCompanyDetail(tenant: Tenant, companyId: string, options: DetailOptions = {}) {
  return withTenant(tenant, (tx) => readCompanyDetail(tx, tenant, companyId, options));
}

async function readCompanyDetail(tx: Tx, tenant: Tenant, companyId: string, options: DetailOptions) {
  const scope = { companyId, workspaceId: tenant.workspaceId };
  const take = (n: number | undefined, fallback: number) => Math.min(DETAIL_TAKE.max, Math.max(1, Math.floor(n ?? fallback)));
  const company = await tx.company.findFirst({
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
      lastContactedAt: true,
      nextFollowUpAt: true,
      // Read only; whether the claim is still live is decided against dbNow() (lib/claims.ts).
      claimedById: true,
      claimExpiresAt: true,
      claimedVia: true,
      claimedBy: { select: { name: true } },
      _count: { select: { outreach: true, stageChanges: true } },
    },
  });
  if (!company) return null;
  const contacts = await tx.contact.findMany({
    where: scope,
    select: { id: true, name: true, email: true, title: true },
    orderBy: { createdAt: "asc" },
  });
  const outreach = await tx.outreach.findMany({
    where: scope,
    select: {
      id: true,
      channel: true,
      note: true,
      sentAt: true,
      aiDraftId: true,
      gotReply: true,
      via: true,
      sender: { select: { name: true } },
      template: { select: { name: true } },
    },
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    take: take(options.outreach, DETAIL_TAKE.outreach),
  });
  const stageChanges = await tx.stageChange.findMany({
    where: scope,
    select: { id: true, fromStage: true, toStage: true, changedAt: true, via: true, changedBy: { select: { name: true } } },
    orderBy: [{ changedAt: "desc" }, { id: "desc" }],
    take: take(options.history, DETAIL_TAKE.history),
  });
  const { _count, ...rest } = company;
  return { ...rest, contacts, outreach, stageChanges, outreachTotal: _count.outreach, stageChangeTotal: _count.stageChanges };
}

export type CompanyDetail = NonNullable<Awaited<ReturnType<typeof getCompanyDetail>>>;

// Active companies that look like this one (same name or website, not marked separate), for the
// header's "Same as Acme: archive this one". A few at most.
export type LookAlike = { id: string; name: string };

// The whole company page in one transaction, one query after another: the company, the
// workspace's industries (for Edit details), its templates (for the log form) and up to three
// active look-alikes. One pooled connection per page view instead of one per list.
export function getCompanyPage(tenant: Tenant, companyId: string, options: DetailOptions = {}) {
  return withTenant(tenant, async (tx) => {
    const company = await readCompanyDetail(tx, tenant, companyId, options);
    if (!company) return null;
    const industries = await readIndustries(tx, tenant);
    const templates = await tx.template.findMany({
      where: { workspaceId: tenant.workspaceId, archivedAt: null },
      select: { id: true, name: true, body: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    let lookAlikes: LookAlike[] = [];
    if (company.archivedAt === null) {
      const where = await matchWhere(tx, tenant.workspaceId, keysFor(company), companyId);
      lookAlikes = await tx.company.findMany({
        where: { AND: [where, { archivedAt: null }] },
        select: { id: true, name: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 3,
      });
    }
    return { company, industries, templates, lookAlikes };
  });
}

// The latest outreach on a company, for "Which outreach got the reply?" after a stage move.
export const REPLY_CHOICES = 10;
export type ReplyChoice = {
  id: string;
  sentAt: Date;
  channel: Channel;
  senderName: string;
  templateName: string | null;
  aiDrafted: boolean;
  note: string | null;
  gotReply: boolean;
};

export function replyChoices(tenant: Tenant, companyId: string): Promise<ReplyChoice[]> {
  return withTenant(tenant, async (tx) => {
    const rows = await tx.outreach.findMany({
      where: { companyId, workspaceId: tenant.workspaceId },
      select: { id: true, sentAt: true, channel: true, note: true, gotReply: true, aiDraftId: true, sender: { select: { name: true } }, template: { select: { name: true } } },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      take: REPLY_CHOICES,
    });
    return rows.map(({ sender, template, aiDraftId, ...row }) => ({
      ...row,
      senderName: sender.name,
      templateName: template?.name ?? null,
      aiDrafted: aiDraftId !== null,
    }));
  });
}

// Industries already used in this workspace, for the industry box's suggestions, so "Tech",
// "tech" and "Technology" don't drift apart. Capped at 200.
export function listIndustries(tenant: Tenant): Promise<string[]> {
  return withTenant(tenant, (tx) => readIndustries(tx, tenant));
}

async function readIndustries(tx: Tx, tenant: Tenant): Promise<string[]> {
  const rows = await tx.company.findMany({
    where: { workspaceId: tenant.workspaceId, industry: { not: null } },
    distinct: ["industry"],
    select: { industry: true },
    orderBy: { industry: "asc" },
    take: 200,
  });
  return rows.map((r) => r.industry as string);
}

export type DuplicatePair = { a: DuplicateMatch; b: DuplicateMatch; matchedOn: MatchReason[] };

// Look-alike pairs already in the workspace (from imports, edits or simultaneous creates), for the
// "Possible duplicates" box. Pairs a person marked separate are left out. Capped so a workspace
// full of identical names can't produce a huge list.
export const DUPLICATE_PAIR_LIMIT = 50;

export function listPossibleDuplicatePairs(tenant: Tenant, limit = DUPLICATE_PAIR_LIMIT): Promise<DuplicatePair[]> {
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

// "These are the same": the person keeps one and the other is archived (never deleted), under the
// same claim rule as archiving.
export function resolveAsDuplicate(actor: Membership, keepId: string, removeId: string): Promise<ActionResult> {
  return withTenant(actor, async (tx) => {
    if (keepId === removeId) return { ok: false, error: "Pick two different companies." };
    const active = await tx.company.count({
      where: { workspaceId: actor.workspaceId, archivedAt: null, id: { in: [keepId, removeId] } },
    });
    if (active !== 2) return { ok: false, error: "Company not found." };
    const refused = await releaseForArchive(tx, actor, removeId);
    if (refused) return { ok: false, error: refused };
    await tx.company.updateMany({
      where: { id: removeId, workspaceId: actor.workspaceId },
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
