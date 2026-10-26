// How two companies are judged "possibly the same". Only ever used to raise a flag a person
// resolves (project rule 5): nothing is merged, blocked or removed automatically.

// Words that don't change which company a name means.
const LEGAL_SUFFIX = /\s+(inc|incorporated|llc|l l c|llp|l l p|pllc|lp|corp|corporation|co|company|ltd|limited|plc|gmbh|ag|sa)$/;

// "Acme, Inc.", "ACME Corp" and " acme corporation " all become "acme". Lowercased, accents and
// punctuation removed, "&" read as "and", a leading "the" and trailing legal suffixes dropped.
export function nameKey(name: string): string {
  let key = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the\s+(?=\S)/, "");
  // Strip suffixes one at a time ("Acme Co., Inc."), but never down to nothing ("Inc" stays "inc").
  while (LEGAL_SUFFIX.test(key)) key = key.replace(LEGAL_SUFFIX, "");
  return key || name.trim().toLowerCase();
}

// "https://www.Acme.com/about" and "acme.com" both become "acme.com". Returns null for anything
// that isn't a real domain, so blank or junk websites never match each other.
export function domainKey(website: string | null | undefined): string | null {
  const raw = website?.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

export type MatchReason = "name" | "website";

// Which keys two companies share. An empty list means they don't look alike.
export function matchReasons(
  a: { nameKey: string; domainKey: string | null },
  b: { nameKey: string; domainKey: string | null },
): MatchReason[] {
  const reasons: MatchReason[] = [];
  if (a.nameKey === b.nameKey) reasons.push("name");
  if (a.domainKey !== null && a.domainKey === b.domainKey) reasons.push("website");
  return reasons;
}

type Keyed = { id: string; nameKey: string; domainKey: string | null };

// Sorts items into groups of look-alikes. Linked transitively: if A shares a name with B and B
// shares a website with C, all three are one group. Returns only groups of two or more, each with
// the kinds of key that joined it. (A union-find: each item points toward a representative of its
// group, and two groups merge when an item links them.)
export function groupLookAlikes<T extends Keyed>(items: T[]): { members: T[]; matchedOn: MatchReason[] }[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const up = parent.get(id) ?? id;
    if (up === id) return id;
    const root = find(up);
    parent.set(id, root);
    return root;
  };

  const firstWithKey = new Map<string, string>();
  const joinedBy = new Map<string, MatchReason>();
  const link = (id: string, key: string, reason: MatchReason) => {
    const other = firstWithKey.get(key);
    if (other === undefined) return firstWithKey.set(key, id);
    parent.set(find(id), find(other));
    joinedBy.set(key, reason);
  };
  for (const item of items) {
    link(item.id, `name:${item.nameKey}`, "name");
    if (item.domainKey) link(item.id, `site:${item.domainKey}`, "website");
  }

  const groups = new Map<string, { members: T[]; matchedOn: Set<MatchReason> }>();
  for (const item of items) {
    const root = find(item.id);
    if (!groups.has(root)) groups.set(root, { members: [], matchedOn: new Set() });
    groups.get(root)!.members.push(item);
  }
  for (const [key, reason] of joinedBy) groups.get(find(firstWithKey.get(key) as string))!.matchedOn.add(reason);

  return [...groups.values()]
    .filter((g) => g.members.length > 1)
    .map((g) => ({ members: g.members, matchedOn: [...g.matchedOn].sort() as MatchReason[] }));
}

// A pair is always stored smaller id first, matching the CHECK in the companies_core migration.
export function orderedPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}
