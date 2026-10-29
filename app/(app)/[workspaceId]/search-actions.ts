"use server";

import { z } from "zod";
import type { Stage } from "@/generated/prisma/enums";
import { AuthzError, requireMembership } from "@/lib/authz";
import { withTenant } from "@/lib/db";
import { workspaceIdSchema, type ActionResult } from "@/lib/validation";

// The command palette's company search. A read only: it finds active companies of the workspace
// whose name, website or industry contains the text. Like every action it checks membership first
// (project rule 1) and reads inside withTenant, so row-level security applies as well.

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
  const rows = await withTenant(membership, (tx) =>
    tx.company.findMany({
      where: {
        workspaceId: membership.workspaceId,
        archivedAt: null,
        OR: [{ name: contains }, { website: contains }, { industry: contains }],
      },
      select: { id: true, name: true, stage: true, industry: true, website: true, nextFollowUpAt: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 40,
    }),
  );

  const needle = text.toLowerCase();
  const ranked = rows
    .map((row) => {
      const name = row.name.toLowerCase();
      const matchedOn: FoundCompany["matchedOn"] = name.includes(needle) ? "name" : row.website?.toLowerCase().includes(needle) ? "website" : "industry";
      // Names that start with the text first, then names that contain it, then website and industry.
      const rank = name.startsWith(needle) ? 0 : matchedOn === "name" ? 1 : matchedOn === "website" ? 2 : 3;
      return { rank, found: { id: row.id, name: row.name, stage: row.stage, industry: row.industry, matchedOn, nextFollowUpAt: row.nextFollowUpAt?.toISOString() ?? null } };
    })
    .sort((a, b) => a.rank - b.rank || a.found.name.localeCompare(b.found.name))
    .slice(0, LIMIT)
    .map((x) => x.found);
  return { ok: true, data: ranked };
}
