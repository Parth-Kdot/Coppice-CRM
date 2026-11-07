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

// Everything the company page shows. Stage history is capped at the latest 50 moves and the
// outreach log at the latest 100.
//
// The lists are loaded one query at a time on purpose. Asked for all of them in one nested query,
// Prisma runs the parts at the same moment on the transaction's single connection, which the pg
// driver only tolerates with a deprecation warning (and pg 9 will refuse).
export function getCompanyDetail(tenant: Tenant, companyId: string) {
  return withTenant(tenant, async (tx) => {
    const scope = { companyId, workspaceId: tenant.workspaceId };
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
      orderBy: { sentAt: "desc" },
      take: 100,
    });
    const stageChanges = await tx.stageChange.findMany({
      where: scope,
      select: { id: true, fromStage: true, toStage: true, changedAt: true, via: true, changedBy: { select: { name: true } } },
      orderBy: { changedAt: "desc" },
      take: 50,
    });
    return { ...company, contacts, outreach, stageChanges };
  });
}

export type CompanyDetail = NonNullable<Awaited<ReturnType<typeof getCompanyDetail>>>;

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

// ----- Look-alike pairs on the board (P3 owns this block: listPossibleDuplicatePairs,
// listDuplicateReview, countPossibleDuplicates and DUPLICATE_PAIR_LIMIT) -----

// Look-alike pairs already in the workspace (from imports, edits or simultaneous creates), for the
// "Possible duplicates" box. Pairs a person marked separate are left out. Capped so a workspace
// full of identical names can't produce a huge list.
export const DUPLICATE_PAIR_LIMIT = 50;

// A pair for the board's review sheet: also which one to keep by default (the one with a website
// when only one has it, else the older one).
export type ReviewPair = DuplicatePair & { keepId: string };

type Candidate = { id: string; name: string; website: string | null; nameKey: string; domainKey: string | null };

// Only companies that share a name key or a website key with another active company can be in a
// pair, so read those (two GROUP BYs, then the members) instead of every company in the workspace.
// Each group is a list of companies, oldest first; groups come in the order their oldest member was
// added, name groups and website groups interleaved, the same order a scan of every company gives.
async function lookAlikeGroups(tx: Tx, workspaceId: string): Promise<Candidate[][]> {
  const active = { workspaceId, archivedAt: null };
  const names = await tx.company.groupBy({ by: ["nameKey"], where: active, having: { nameKey: { _count: { gt: 1 } } } });
  const sites = await tx.company.groupBy({ by: ["domainKey"], where: { ...active, domainKey: { not: null } }, having: { domainKey: { _count: { gt: 1 } } } });
  if (names.length === 0 && sites.length === 0) return [];
  const nameKeys = new Set(names.map((g) => g.nameKey));
  const siteKeys = new Set(sites.map((g) => g.domainKey as string));
  const companies = await tx.company.findMany({
    where: { ...active, OR: [{ nameKey: { in: [...nameKeys] } }, { domainKey: { in: [...siteKeys] } }] },
    select: { id: true, name: true, website: true, nameKey: true, domainKey: true },
    orderBy: { createdAt: "asc" },
  });
  const groups = new Map<string, Candidate[]>();
  const add = (key: string, c: Candidate) => {
    const group = groups.get(key);
    if (group) group.push(c);
    else groups.set(key, [c]);
  };
  for (const c of companies) {
    if (nameKeys.has(c.nameKey)) add(`name:${c.nameKey}`, c);
    if (c.domainKey && siteKeys.has(c.domainKey)) add(`site:${c.domainKey}`, c);
  }
  return [...groups.values()];
}

async function separatePairs(tx: Tx, workspaceId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const decisions = await tx.companyPairDecision.findMany({
    where: { workspaceId, companyAId: { in: ids }, companyBId: { in: ids } },
    select: { companyAId: true, companyBId: true },
  });
  return new Set(decisions.map((d) => `${d.companyAId}|${d.companyBId}`));
}

function collectPairs(groups: Candidate[][], separate: Set<string>, limit: number): ReviewPair[] {
  const pairs = new Map<string, ReviewPair>();
  for (const group of groups) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [aId, bId] = orderedPair(group[i].id, group[j].id);
        const id = `${aId}|${bId}`;
        if (separate.has(id) || pairs.has(id)) continue;
        const [a, b] = aId === group[i].id ? [group[i], group[j]] : [group[j], group[i]];
        const reasons = matchReasons(a, b);
        const view = (c: Candidate) => ({ id: c.id, name: c.name, website: c.website, archived: false, matchedOn: reasons });
        // group[i] is the older one (the group is oldest first).
        const keep = !group[i].website && group[j].website ? group[j] : group[i];
        pairs.set(id, { a: view(a), b: view(b), matchedOn: reasons, keepId: keep.id });
        if (pairs.size >= limit) return [...pairs.values()];
      }
    }
  }
  return [...pairs.values()];
}

// The pairs for the board's review sheet, with the one to keep by default.
export function listDuplicateReview(tenant: Tenant, limit = DUPLICATE_PAIR_LIMIT): Promise<ReviewPair[]> {
  return withTenant(tenant, async (tx) => {
    const groups = await lookAlikeGroups(tx, tenant.workspaceId);
    const separate = await separatePairs(tx, tenant.workspaceId, [...new Set(groups.flat().map((c) => c.id))]);
    return collectPairs(groups, separate, limit);
  });
}

export async function listPossibleDuplicatePairs(tenant: Tenant, limit = DUPLICATE_PAIR_LIMIT): Promise<DuplicatePair[]> {
  const pairs = await listDuplicateReview(tenant, limit);
  return pairs.map(({ a, b, matchedOn }) => ({ a, b, matchedOn }));
}

// A group this big is counted with arithmetic (pairs minus decisions, as two counts) instead of
// listing its pairs one by one.
const BIG_GROUP_PAIRS = 400;

// How many look-alike pairs there are, for the badge on the board's More menu, without building
// the list: counts stop at `cap` (the badge reads "50+"). Small groups are paired up exactly; a big
// group (300 companies on one shared website) is counted as its pairs minus the decisions inside
// it, read as a count, so a workspace with tens of thousands of decisions never reads them all.
// Equals listPossibleDuplicatePairs(...).length whenever that is below the cap.
export function countPossibleDuplicates(tenant: Tenant, cap = DUPLICATE_PAIR_LIMIT + 1): Promise<number> {
  return withTenant(tenant, async (tx) => {
    const groups = await lookAlikeGroups(tx, tenant.workspaceId);
    if (groups.length === 0) return 0;
    const pairsIn = (n: number) => (n * (n - 1)) / 2;
    // Small groups first, so a pair counted there is known when a big group overlaps it.
    groups.sort((x, y) => x.length - y.length);
    const small = groups.filter((g) => pairsIn(g.length) <= BIG_GROUP_PAIRS);
    const separate = await separatePairs(tx, tenant.workspaceId, [...new Set(small.flat().map((c) => c.id))]);
    const seen = new Set<string>();
    for (const pair of collectPairs(small, separate, cap)) seen.add(`${pair.a.id}|${pair.b.id}`);
    if (seen.size >= cap) return cap;

    for (const group of groups.slice(small.length)) {
      const ids = group.map((c) => c.id);
      const inGroup = new Set(ids);
      const decided = await tx.companyPairDecision.count({ where: { workspaceId: tenant.workspaceId, companyAId: { in: ids }, companyBId: { in: ids } } });
      // Pairs of this group already counted from a smaller group (same name and same website).
      const overlap = [...seen].filter((key) => key.split("|").every((id) => inGroup.has(id))).length;
      const fresh = pairsIn(group.length) - decided - overlap;
      if (seen.size + fresh >= cap) return cap;
      // Mostly decided: few pairs left, so list them exactly (rare, and bounded by the group).
      const groupSeparate = await separatePairs(tx, tenant.workspaceId, ids);
      for (const pair of collectPairs([group], groupSeparate, Number.POSITIVE_INFINITY)) seen.add(`${pair.a.id}|${pair.b.id}`);
      if (seen.size >= cap) return cap;
    }
    return seen.size;
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
