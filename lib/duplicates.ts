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

// Hosts that many unrelated companies share (a LinkedIn page, a Linktree, a Google Site). Their
// host alone says nothing about which company it is, so for these the key is the host plus the
// path segment(s) that name the page: "linkedin.com/company/acme", "linktr.ee/acme".
export const SHARED_HOSTS = [
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "linktr.ee",
  "sites.google.com",
  "google.com",
  "youtube.com",
  "github.com",
  "medium.com",
  "notion.site",
  "wixsite.com",
] as const;

// Path words that only say what kind of page follows ("linkedin.com/company/acme",
// "youtube.com/channel/x", "sites.google.com/view/acme"), so the next segment is kept too.
const PAGE_KIND = new Set(["company", "companies", "in", "school", "showcase", "pages", "page", "groups", "channel", "c", "user", "view", "site", "s", "pg", "people", "org", "orgs"]);

// A country or mobile prefix on a shared host ("uk.linkedin.com", "m.facebook.com") is the same site.
const SITE_PREFIX = /^(?:m|mobile|web|[a-z]{2})\./;

function sharedHost(host: string): string | null {
  for (const shared of SHARED_HOSTS) {
    if (host === shared) return shared;
    if (host.endsWith(`.${shared}`) && SITE_PREFIX.test(host.slice(0, -shared.length))) return shared;
  }
  return null;
}

// "https://www.Acme.com/about" and "acme.com" both become "acme.com". Returns null for anything
// that isn't a real domain, so blank or junk websites never match each other. On a shared host the
// page's own path is kept ("linkedin.com/company/acme"), and a bare shared host is null.
export function domainKey(website: string | null | undefined): string | null {
  const raw = website?.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (!host.includes(".")) return null;
    const shared = sharedHost(host);
    if (!shared) return host;
    const segments = url.pathname
      .split("/")
      .map((part) => {
        try {
          return decodeURIComponent(part).trim().toLowerCase();
        } catch {
          return part.trim().toLowerCase();
        }
      })
      .filter(Boolean);
    if (segments.length === 0) return null;
    const take = PAGE_KIND.has(segments[0]) ? 2 : 1;
    if (segments.length < take) return null;
    return `${shared}/${segments.slice(0, take).join("/")}`;
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

// ----- Look-alikes the exact keys miss (Smart import) -----

// The exact keys above miss "Lilly" and "Eli Lilly", or "CAT" and "Caterpillar". Smart import
// (lib/smart-import/) flags those too, through the same import duplicate review: code finds a name
// inside another, and the AI may suggest other pairs with a reason. Still only ever a flag.
export type LookalikeReason = "contained" | "ai";

// Names where one is a whole-word part of the other: "Lilly" and "Eli Lilly". At least 4 letters,
// so "AI" or "Co" don't match everything.
export function containedName(a: string, b: string): boolean {
  return containedKey(nameKey(a), nameKey(b));
}

// The same check on two name keys already worked out (lookalikePairs compares many).
export function containedKey(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short === long || short.replace(/ /g, "").length < 4) return false;
  return ` ${long} `.includes(` ${short} `);
}

// `key` names the item to the AI (r12 for row 12, c3 for a saved company), so a suggested pair can
// be checked against items that really exist.
export type LookalikeItem = { key: string; name: string; isRow: boolean; nameKey: string; domainKey: string | null };
export type LookalikePair<T> = { members: [T, T]; reason: LookalikeReason; why: string };

// A word in more names than this ("group") says nothing, so its names aren't compared.
const COMMON_WORD = 200;

// Pairs that look alike though the exact keys miss them, each with at least one row from the file:
// first the code's contained names, then the AI's suggestions that name two real, different items.
// Pairs the exact keys already join (same name key or website) are left to that review. At most
// `max` pairs.
//
// The code's check runs on every preview against every saved company, so it only compares what
// can become a pair: for each word, the rows that have it with each other and with the saved
// companies that have it (never two saved companies), and it stops once `max` pairs are found.
export function lookalikePairs<T extends LookalikeItem>(items: T[], suggested: { a: string; b: string; reason: string }[], max: number): LookalikePair<T>[] {
  const pairs = new Map<string, LookalikePair<T>>();
  const full = () => pairs.size >= max;
  const add = (x: T, y: T, reason: LookalikeReason, why: string) => {
    if (x === y || (!x.isRow && !y.isRow)) return;
    if (x.nameKey === y.nameKey || (x.domainKey !== null && x.domainKey === y.domainKey)) return;
    const id = x.key < y.key ? `${x.key}|${y.key}` : `${y.key}|${x.key}`;
    if (!pairs.has(id) && !full()) pairs.set(id, { members: [x, y], reason, why });
  };
  const contained = (x: T, y: T) => {
    if (containedKey(x.nameKey, y.nameKey)) add(x, y, "contained", `"${x.name}" and "${y.name}" share a name`);
  };

  // Code: one name inside the other, compared only between names sharing a word.
  const byWord = new Map<string, { rows: T[]; saved: T[] }>();
  for (const item of items) {
    for (const word of new Set(item.nameKey.split(" "))) {
      let bucket = byWord.get(word);
      if (!bucket) byWord.set(word, (bucket = { rows: [], saved: [] }));
      (item.isRow ? bucket.rows : bucket.saved).push(item);
    }
  }
  compare: for (const { rows, saved } of byWord.values()) {
    if (rows.length === 0 || rows.length + saved.length > COMMON_WORD) continue;
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) contained(rows[i], rows[j]);
      for (const company of saved) contained(rows[i], company);
      if (full()) break compare;
    }
  }

  const byKey = new Map(items.map((i) => [i.key, i]));
  for (const pair of suggested) {
    if (full()) break;
    const x = byKey.get(pair.a.trim());
    const y = byKey.get(pair.b.trim());
    const reason = pair.reason.trim();
    if (x && y && reason) add(x, y, "ai", `AI: ${reason}`);
  }
  return [...pairs.values()];
}
