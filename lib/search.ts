import type { Stage } from "@/generated/prisma/enums";
import { literal } from "@/lib/board";
import { withTenant, type Tenant } from "@/lib/db";

// The command palette's company search. A read only: it finds active companies of the workspace
// whose name, website or industry contains the text, inside withTenant so row-level security
// applies. The caller has already checked membership (app/(app)/[workspaceId]/search-actions.ts).
//
// Ranking happens in the database, before the limit, in up to three small queries that stop once
// 8 are found: names that start with the text, then names that contain it, then website or industry
// matches. (Taking the first 40 by name and ranking afterwards lost the best matches in a big
// workspace: "st" returned eight "Acme Health" rows matched on "Testing" and no "Stark ...".) Ties
// sort like people read numbers: "Stark 9" before "Stark 10".

export type FoundCompany = {
  id: string;
  name: string;
  stage: Stage;
  industry: string | null;
  // Which field matched, in words: "name", "website" or "industry".
  matchedOn: "name" | "website" | "industry";
  // ISO text of the follow-up date, or null when there is none.
  nextFollowUpAt: string | null;
};

const LIMIT = 8;

export async function searchCompanies(tenant: Tenant, text: string): Promise<FoundCompany[]> {
  const contains = { contains: literal(text), mode: "insensitive" } as const;
  const select = { id: true, name: true, stage: true, industry: true, website: true, nextFollowUpAt: true } as const;
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" });
  const needle = text.toLowerCase();
  const found: FoundCompany[] = [];
  await withTenant(tenant, async (tx) => {
    const active = { workspaceId: tenant.workspaceId, archivedAt: null };
    const tiers = [
      { name: { startsWith: literal(text), mode: "insensitive" as const } },
      { name: contains },
      { NOT: { name: contains }, OR: [{ website: contains }, { industry: contains }] },
    ];
    // One query per tier, one at a time (never Promise.all inside withTenant), stopping once full.
    for (const tier of tiers) {
      if (found.length >= LIMIT) break;
      const rows = await tx.company.findMany({
        where: { ...active, ...tier, id: { notIn: found.map((f) => f.id) } },
        select,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: LIMIT - found.length,
      });
      for (const row of rows.sort(byName)) {
        const matchedOn: FoundCompany["matchedOn"] = row.name.toLowerCase().includes(needle) ? "name" : row.website?.toLowerCase().includes(needle) ? "website" : "industry";
        found.push({ id: row.id, name: row.name, stage: row.stage, industry: row.industry, matchedOn, nextFollowUpAt: row.nextFollowUpAt?.toISOString() ?? null });
      }
    }
  });
  return found;
}
