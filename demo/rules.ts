import type { ClaimState, IsoDateTime } from "./types";

// Pure rules shared by the engine, the selectors and the screens. The helpers re-exported from
// lib/ are the real app's own code (no database, no server-only imports), so the prototypes flag
// duplicates and unsupported claims exactly like the real app will.

export { checkRules, factNumbers } from "@/lib/claim-rules";
export type { Finding as RuleFinding, RuleContext } from "@/lib/claim-rules";
export { composeLinks } from "@/lib/compose-links";
export type { ComposeLinks } from "@/lib/compose-links";
export { fill, unfill, PLACEHOLDERS } from "@/lib/placeholders";
export { domainKey, groupLookAlikes, matchReasons, nameKey, orderedPair } from "@/lib/duplicates";

// What a screen should show for a company's claim: nobody holds it, you hold it, someone else holds
// it, or someone's claim ran out. Same rule as claimState in lib/claims.ts.
export function claimStateOf(
  claim: { claimedById: string | null; claimExpiresAt: IsoDateTime | null },
  now: IsoDateTime,
  userId: string,
): ClaimState {
  if (claim.claimedById === null || claim.claimExpiresAt === null) return "free";
  if (Date.parse(claim.claimExpiresAt) <= Date.parse(now)) return "expired";
  return claim.claimedById === userId ? "mine" : "theirs";
}

// Facts last checked more than a year ago get a Stale badge.
export const isFactStale = (fact: { verifiedAt: IsoDateTime | null; createdAt: IsoDateTime }, now: IsoDateTime): boolean =>
  Date.parse(now) - Date.parse(fact.verifiedAt ?? fact.createdAt) > 365 * 24 * 60 * 60 * 1000;

// "Sofia Martinez" becomes "SM". For avatars and compact lists.
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return `${first}${last}`.toUpperCase();
}
