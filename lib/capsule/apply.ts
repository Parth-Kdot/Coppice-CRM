import type { Membership } from "@/lib/authz";
import { changeStage, setFollowUp } from "@/lib/claims";
import { withTenant } from "@/lib/db";
import { fail, findReport, isOwner, NO_CARD, NO_HANDOFF, OWNER_ONLY, type Done } from "./shared";

// Step 2e, the two clicks that change a company: "Apply" puts each saved re-contact date on its
// company, and "Reopen for next year" moves a Committed company back to Contacted. Everything else
// in the capsule only reads company rows. Both go through lib/claims.ts (setFollowUp, changeStage),
// so a claim held by someone else, a closed deal and an out-of-range date are refused exactly as
// they are anywhere else in the app, and each refusal is reported with its reason.

export type AppliedDates = {
  set: { companyId: string; name: string; date: string }[];
  refused: { companyId: string; name: string; reason: string }[];
  // Approved cards with no date: nothing to apply.
  blank: number;
};

const DECLINED_LEFT_ALONE = "This company declined, so it is left alone.";

// Applies every saved date of the handoff's approved, unhidden cards, one company after another
// (each is its own database call, never inside another transaction). A Declined company is listed
// as left alone without being touched. A Committed company is asked like any other and refused by
// setFollowUp, because a closed deal can't take a date: its row has "Reopen for next year".
// Applying again is fine: it sets the same dates again.
export async function applyCalendar(actor: Membership, reportId: string): Promise<Done<AppliedDates>> {
  if (!isOwner(actor)) return fail(OWNER_ONLY);
  const cards = await withTenant(actor, async (tx) => {
    const report = await findReport(tx, actor.workspaceId, reportId);
    if (!report) return null;
    const order = new Map((report.companyIds as string[]).map((id, i) => [id, i]));
    const rows = await tx.relationshipCard.findMany({
      where: { reportId, workspaceId: actor.workspaceId, approvedAt: { not: null }, redactions: { none: { bulletIndex: null } } },
      select: { companyId: true, recontactOn: true, company: { select: { name: true, stage: true } } },
    });
    return rows.sort((a, b) => (order.get(a.companyId) ?? 0) - (order.get(b.companyId) ?? 0));
  });
  if (!cards) return fail(NO_HANDOFF);

  const data: AppliedDates = { set: [], refused: [], blank: 0 };
  for (const card of cards) {
    const { companyId, recontactOn: date } = card;
    const name = card.company.name;
    if (date === null) data.blank += 1;
    else if (card.company.stage === "DECLINED") data.refused.push({ companyId, name, reason: DECLINED_LEFT_ALONE });
    else {
      const result = await setFollowUp(actor, companyId, date);
      if (result.ok) data.set.push({ companyId, name, date });
      else data.refused.push({ companyId, name, reason: result.error });
    }
  }
  return { ok: true, data };
}

export type Reopened = { companyId: string; name: string };

// "Reopen for next year": one Committed company with an approved card in this workspace's handoffs
// goes back to Contacted, through changeStage (which records the move and checks any claim). Never
// in bulk: it takes one card. The owner's confirmation is the page's, before this is called.
export async function reopenForNextYear(actor: Membership, cardId: string): Promise<Done<Reopened>> {
  if (!isOwner(actor)) return fail(OWNER_ONLY);
  const card = await withTenant(actor, (tx) =>
    tx.relationshipCard.findFirst({
      where: { id: cardId, workspaceId: actor.workspaceId, approvedAt: { not: null } },
      select: { companyId: true, company: { select: { name: true, stage: true } } },
    }),
  );
  if (!card) return fail(NO_CARD);
  if (card.company.stage !== "COMMITTED") return fail(`${card.company.name} is not Committed, so there is nothing to reopen.`);
  const result = await changeStage(actor, card.companyId, "CONTACTED");
  if (!result.ok) return fail(result.error);
  return { ok: true, data: { companyId: card.companyId, name: card.company.name } };
}
