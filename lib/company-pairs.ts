import type { Membership } from "@/lib/authz";
import { releaseForArchive } from "@/lib/claims";
import { recordSeparate, type DuplicateMatch, type Tx } from "@/lib/companies";
import { withTenant, type Tenant } from "@/lib/db";
import { matchReasons, orderedPair, type MatchReason } from "@/lib/duplicates";
import { notFound } from "@/lib/messages";
import type { ActionResult } from "@/lib/validation";

// Look-alike pairs on the board and in the review sheet: listPossibleDuplicatePairs,
// listDuplicateReview, countPossibleDuplicates, markSeparate and resolveAsDuplicate. Companies are
// never merged: a person marks a pair separate (remembered), or keeps one and archives the other.

type DuplicatePair = { a: DuplicateMatch; b: DuplicateMatch; matchedOn: MatchReason[] };

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
    if (found !== 2) return notFound("Company");
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
    if (active !== 2) return notFound("Company");
    const refused = await releaseForArchive(tx, actor, removeId);
    if (refused) return { ok: false, error: refused };
    await tx.company.updateMany({
      where: { id: removeId, workspaceId: actor.workspaceId },
      data: { archivedAt: new Date() },
    });
    return { ok: true, data: undefined };
  });
}
