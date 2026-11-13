import { dbNow, dbToday } from "@/lib/claims";
import type { Membership } from "@/lib/authz";
import { withTenant } from "@/lib/db";
import { proposeRecontact } from "./calendar";
import { fail, findReport, isOwner, NO_CARD, NO_HANDOFF, OWNER_ONLY, PUBLISHED_LOCK, type Done, type Tx } from "./shared";
import { cardBody } from "./types";

// Step 2c: review and redact. The owner reads the cards and, for each, approves it, hides one
// bullet or hides the whole card. Hiding writes an ArchiveRedaction row and can be undone (the row
// is deleted) until the handoff is published; bullet text can't be edited, which would break the
// quote that proves it. Nothing here touches a company. Approving a card also proposes its
// re-contact date (lib/capsule/calendar.ts).

// A card of this workspace, in a handoff that can still be changed.
async function openCard(tx: Tx, actor: Membership, cardId: string) {
  const card = await tx.relationshipCard.findFirst({
    where: { id: cardId, workspaceId: actor.workspaceId },
    select: { id: true, reportId: true, bullets: true, approvedAt: true, company: { select: { stage: true } }, report: { select: { status: true } }, redactions: { select: { bulletIndex: true } } },
  });
  if (!card) return { ok: false, error: NO_CARD } as const;
  if (card.report.status !== "DRAFT") return { ok: false, error: PUBLISHED_LOCK } as const;
  return { ok: true, card } as const;
}

// Hides a bullet (its index on the card) or, with null, the whole card; or shows it again.
// Doing either twice is fine.
export async function setHidden(actor: Membership, cardId: string, bulletIndex: number | null, hidden: boolean): Promise<Done> {
  if (!isOwner(actor)) return fail(OWNER_ONLY);
  return withTenant(actor, async (tx) => {
    const opened = await openCard(tx, actor, cardId);
    if (!opened.ok) return fail(opened.error);
    const { card } = opened;
    if (bulletIndex !== null && bulletIndex >= cardBody(card.bullets).bullets.length) return fail("That bullet isn't on this card.");
    if (hidden) {
      // ON CONFLICT DO NOTHING: the unique index and the partial one for whole-card rows both apply.
      await tx.archiveRedaction.createMany({ data: [{ workspaceId: actor.workspaceId, cardId, bulletIndex, hiddenById: actor.userId }], skipDuplicates: true });
    } else {
      await tx.archiveRedaction.deleteMany({ where: { workspaceId: actor.workspaceId, cardId, bulletIndex } });
    }
    return { ok: true, data: undefined };
  });
}

// Approves a card: it will be shown to officers once the handoff is published. A hidden card can't
// be approved (show it again first). Approving an approved card changes nothing.
export async function approveCard(actor: Membership, cardId: string): Promise<Done> {
  if (!isOwner(actor)) return fail(OWNER_ONLY);
  const [now, today] = await Promise.all([dbNow(), dbToday()]);
  return withTenant(actor, async (tx) => {
    const opened = await openCard(tx, actor, cardId);
    if (!opened.ok) return fail(opened.error);
    const { card } = opened;
    if (card.redactions.some((r) => r.bulletIndex === null)) return fail("This card is hidden. Show it again before approving it.");
    if (card.approvedAt) return { ok: true, data: undefined };
    const hidden = new Set(card.redactions.map((r) => r.bulletIndex));
    const visible = cardBody(card.bullets).bullets.filter((_, i) => !hidden.has(i));
    await tx.relationshipCard.updateMany({
      where: { id: cardId, workspaceId: actor.workspaceId, approvedAt: null },
      data: { approvedAt: now, approvedById: actor.userId, recontactOn: proposeRecontact(visible, card.company.stage, today) },
    });
    return { ok: true, data: undefined };
  });
}

// "Approve the rest": every card that is not hidden and not approved yet. Returns how many.
export async function approveRest(actor: Membership, reportId: string): Promise<Done<{ approved: number }>> {
  if (!isOwner(actor)) return fail(OWNER_ONLY);
  const [now, today] = await Promise.all([dbNow(), dbToday()]);
  return withTenant(actor, async (tx) => {
    const report = await findReport(tx, actor.workspaceId, reportId);
    if (!report) return fail(NO_HANDOFF);
    if (report.status !== "DRAFT") return fail(PUBLISHED_LOCK);
    const cards = await tx.relationshipCard.findMany({
      where: { reportId, workspaceId: actor.workspaceId, approvedAt: null, redactions: { none: { bulletIndex: null } } },
      select: { id: true, bullets: true, company: { select: { stage: true } }, redactions: { select: { bulletIndex: true } } },
    });
    // One update for each distinct proposed date (at most a dozen), not one per card.
    const groups = new Map<string | null, string[]>();
    for (const card of cards) {
      const hidden = new Set(card.redactions.map((r) => r.bulletIndex));
      const proposed = proposeRecontact(cardBody(card.bullets).bullets.filter((_, i) => !hidden.has(i)), card.company.stage, today);
      const list = groups.get(proposed);
      if (list) list.push(card.id);
      else groups.set(proposed, [card.id]);
    }
    let approved = 0;
    for (const [recontactOn, ids] of groups) {
      const { count } = await tx.relationshipCard.updateMany({
        where: { id: { in: ids }, workspaceId: actor.workspaceId, approvedAt: null },
        data: { approvedAt: now, approvedById: actor.userId, recontactOn },
      });
      approved += count;
    }
    return { ok: true, data: { approved } };
  });
}
