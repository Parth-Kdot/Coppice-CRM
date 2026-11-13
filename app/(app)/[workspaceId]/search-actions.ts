"use server";

import { z } from "zod";
import { AuthzError, requireMembership } from "@/lib/authz";
import { notFound } from "@/lib/messages";
import { searchCompanies as findCompanies, type FoundCompany } from "@/lib/search";
import { workspaceIdSchema, type ActionResult } from "@/lib/validation";

// The command palette's company search (lib/search.ts has the query). Like every action it checks
// membership first (every server action starts with requireMembership or requireOwner).

const querySchema = z.string().trim().min(1).max(100);

export async function searchCompanies(workspaceId: string, query: string): Promise<ActionResult<FoundCompany[]>> {
  const parsedId = workspaceIdSchema.safeParse(workspaceId);
  const parsedQuery = querySchema.safeParse(query);
  if (!parsedId.success) return notFound("Workspace");
  if (!parsedQuery.success) return { ok: true, data: [] };

  let membership;
  try {
    membership = await requireMembership(parsedId.data);
  } catch (e) {
    if (e instanceof AuthzError) return notFound("Workspace");
    throw e;
  }
  return { ok: true, data: await findCompanies(membership, parsedQuery.data) };
}
