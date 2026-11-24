"use server";

import { AuthzError, requireMembership } from "@/lib/authz";
import { dbNow } from "@/lib/claims";
import { notFound } from "@/lib/messages";
import { advance, complete, dismissAi, setBasicsHidden, tourCompany } from "@/lib/onboarding";
import { tourProgressSchema, workspaceIdSchema, type ActionResult } from "@/lib/validation";

// The onboarding tours' two server calls (components/ledger/tour.tsx). Membership is checked first;
// the writes then run in withTenant, where row-level security lets a person touch only their own
// progress row. Neither call re-renders the page: the tour keeps its own state, so a save never
// disturbs what the person is doing.
//
//   saveTourProgress  A card was passed, the last card was reached, the AI tour was put off, or
//                     the basics were hidden into the pill or resumed from it.
//                     The role recorded with the finished basics is the server's, never the client's.
//   loadTourCompany   Which company page the tour shows for the "log outreach" and AI cards.

export async function saveTourProgress(input: {
  workspaceId: string;
  tour: "basics" | "ai";
  step: number;
  event: "step" | "done" | "later" | "hide" | "show";
}): Promise<ActionResult> {
  const parsed = tourProgressSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Could not save your place in the tour." };

  let member;
  try {
    member = await requireMembership(parsed.data.workspaceId);
  } catch (e) {
    if (e instanceof AuthzError) return notFound("Workspace");
    throw e;
  }

  const { tour, step, event } = parsed.data;
  if (event === "step") await advance(member, tour, step);
  else if (event === "done") {
    await advance(member, tour, step);
    await complete(member, tour, member.role);
  } else if (event === "later") await dismissAi(member);
  else await setBasicsHidden(member, event === "hide");
  return { ok: true, data: undefined };
}

export async function loadTourCompany(workspaceId: string): Promise<ActionResult<{ companyId: string | null }>> {
  const parsed = workspaceIdSchema.safeParse(workspaceId);
  if (!parsed.success) return notFound("Workspace");

  let member;
  try {
    member = await requireMembership(parsed.data);
  } catch (e) {
    if (e instanceof AuthzError) return notFound("Workspace");
    throw e;
  }
  return { ok: true, data: { companyId: await tourCompany(member, await dbNow()) } };
}
