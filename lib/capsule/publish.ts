import { dbNow } from "@/lib/claims";
import type { Membership } from "@/lib/authz";
import { withTenant } from "@/lib/db";
import { fail, findReport, isOwner, NO_HANDOFF, OWNER_ONLY, type Done } from "./shared";

// Step 2f: publish. Publishing needs at least one approved card that is not hidden. It sets the
// status to PUBLISHED and the time (the database's clock); every member can then read the capsule
// for that year (lib/capsule/view.ts memberView). An owner can unpublish to keep editing: the
// status goes back to DRAFT and officers see nothing again. Past years stay readable once published.

export async function publishReport(actor: Membership, reportId: string): Promise<Done> {
  if (!isOwner(actor)) return fail(OWNER_ONLY);
  const now = await dbNow();
  return withTenant(actor, async (tx) => {
    const report = await findReport(tx, actor.workspaceId, reportId);
    if (!report) return fail(NO_HANDOFF);
    if (report.status === "PUBLISHED") return { ok: true, data: undefined };
    const shown = await tx.relationshipCard.count({
      where: { reportId, workspaceId: actor.workspaceId, approvedAt: { not: null }, redactions: { none: { bulletIndex: null } } },
    });
    if (shown === 0) return fail("Approve at least one card before publishing.");
    await tx.handoffReport.updateMany({ where: { id: reportId, workspaceId: actor.workspaceId, status: "DRAFT" }, data: { status: "PUBLISHED", publishedAt: now } });
    return { ok: true, data: undefined };
  });
}

export async function unpublishReport(actor: Membership, reportId: string): Promise<Done> {
  if (!isOwner(actor)) return fail(OWNER_ONLY);
  return withTenant(actor, async (tx) => {
    const report = await findReport(tx, actor.workspaceId, reportId);
    if (!report) return fail(NO_HANDOFF);
    await tx.handoffReport.updateMany({ where: { id: reportId, workspaceId: actor.workspaceId, status: "PUBLISHED" }, data: { status: "DRAFT", publishedAt: null } });
    return { ok: true, data: undefined };
  });
}
