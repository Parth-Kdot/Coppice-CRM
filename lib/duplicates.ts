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

// A pair is always stored smaller id first, matching the CHECK in the companies_core migration.
export function orderedPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}
