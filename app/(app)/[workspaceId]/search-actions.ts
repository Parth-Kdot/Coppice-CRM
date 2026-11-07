"use server";

import { z } from "zod";
import type { Stage } from "@/generated/prisma/enums";
import { AuthzError, requireMembership } from "@/lib/authz";
import { withTenant } from "@/lib/db";
import { workspaceIdSchema, type ActionResult } from "@/lib/validation";

// The command palette's company search. A read only: it finds active companies of the workspace
// whose name, website or industry contains the text. Like every action it checks membership first
// (project rule 1) and reads inside withTenant, so row-level security applies as well.
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

const querySchema = z.string().trim().min(1).max(100);

// Postgres treats % and _ in a LIKE pattern as wildcards; a search for "100%" means the text.
const literal = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

const LIMIT = 8;

export async function searchCompanies(workspaceId: string, query: string): Promise<ActionResult<FoundCompany[]>> {
  const parsedId = workspaceIdSchema.safeParse(workspaceId);
  const parsedQuery = querySchema.safeParse(query);
  if (!parsedId.success) return { ok: false, error: "Workspace not found." };
  if (!parsedQuery.success) return { ok: true, data: [] };

  let membership;
  try {
    membership = await requireMembership(parsedId.data);
  } catch (e) {
    if (e instanceof AuthzError) return { ok: false, error: "Workspace not found." };
    throw e;
  }

  const text = parsedQuery.data;
  const contains = { contains: literal(text), mode: "insensitive" } as const;
  const select = { id: true, name: true, stage: true, industry: true, website: true, nextFollowUpAt: true } as const;
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" });
  const needle = text.toLowerCase();
  const found: FoundCompany[] = [];
  await withTenant(membership, async (tx) => {
    const active = { workspaceId: membership.workspaceId, archivedAt: null };
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
  return { ok: true, data: found };
}
