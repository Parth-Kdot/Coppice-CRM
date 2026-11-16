"use server";

import { AuthzError, requireMembership } from "@/lib/authz";
import { claimState, type ClaimState } from "@/lib/claims";
import { day } from "@/lib/dates";
import { getFreshLeads } from "@/lib/queue";
import { freshLeadsSchema, type ActionResult } from "@/lib/validation";

// The queue's Fresh leads list: companies nobody has written to yet and nobody else holds, newest
// first, 20 at a time up to 100. Loaded only when the person opens the list, so the home screen
// never pays for it. A read only; membership is checked first and the read runs in withTenant.

export type FreshRow = {
  id: string;
  name: string;
  industry: string | null;
  claim: { state: ClaimState; holderName: string | null; until: string | null };
};

export async function loadFreshLeads(workspaceId: string, offset: number): Promise<ActionResult<{ rows: FreshRow[]; more: boolean }>> {
  const parsed = freshLeadsSchema.safeParse({ workspaceId, offset });
  if (!parsed.success) return { ok: false, error: "Could not load fresh leads." };

  let member;
  try {
    member = await requireMembership(parsed.data.workspaceId);
  } catch (e) {
    if (e instanceof AuthzError) return { ok: false, error: "Workspace not found." };
    throw e;
  }

  const page = await getFreshLeads(member, parsed.data.offset);
  return {
    ok: true,
    data: {
      more: page.more,
      rows: page.rows.map((c) => ({
        id: c.id,
        name: c.name,
        industry: c.industry,
        claim: {
          state: claimState(c, page.now, member.userId),
          holderName: c.claimedBy?.name ?? null,
          until: c.claimExpiresAt ? day(c.claimExpiresAt) : null,
        },
      })),
    },
  };
}
