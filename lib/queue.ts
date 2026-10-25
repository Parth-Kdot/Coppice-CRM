import type { Prisma } from "@/generated/prisma/client";
import { SHOW_ALL_LIMIT } from "@/lib/board";
import { dbNow, heldBy, notHeldByOthers } from "@/lib/claims";
import { withTenant, type Tenant } from "@/lib/db";
import { TERMINAL_STAGES } from "@/lib/stages";
import type { QueueFilters } from "@/lib/validation";

// The follow-up queue, the workspace's home screen. "Due" is every open company whose follow-up
// date has arrived, most overdue first; "Never contacted" is fresh leads nobody else holds.
// "Now" is the database's clock (dbNow), the same one the claim SQL uses. A fixed number of
// queries per load, each one at a time inside withTenant.

export const QUEUE_SIZE = 50;

const ROW = {
  id: true,
  name: true,
  nextFollowUpAt: true,
  // Read only, for the claim badge; liveness is decided against `now` by claimState().
  claimedById: true,
  claimExpiresAt: true,
  claimedBy: { select: { name: true } },
} as const;

export type QueueRow = Prisma.CompanyGetPayload<{ select: typeof ROW }> & { lastNote: string | null };
export type Queue = {
  now: Date;
  due: QueueRow[];
  dueCount: number;
  never: QueueRow[] | null;
  neverCount: number;
};

export async function getQueue(tenant: Tenant, filters: QueueFilters): Promise<Queue> {
  const now = await dbNow();
  return withTenant(tenant, async (tx) => {
    const workspaceId = tenant.workspaceId;
    // "Only mine": companies I hold with a claim that hasn't expired.
    const mine = filters.mine ? heldBy(tenant.userId, now) : {};
    const open = { workspaceId, archivedAt: null, stage: { notIn: TERMINAL_STAGES } };

    const dueWhere: Prisma.CompanyWhereInput = { ...open, ...mine, nextFollowUpAt: { lte: now } };
    const dueLimit = filters.all === "due" ? SHOW_ALL_LIMIT : QUEUE_SIZE;
    const due = await tx.company.findMany({
      where: dueWhere,
      select: ROW,
      orderBy: [{ nextFollowUpAt: "asc" }, { name: "asc" }, { id: "asc" }],
      take: dueLimit,
    });
    const dueCount = await tx.company.count({ where: dueWhere });

    // Fresh leads: never contacted, no follow-up yet, and not held by someone else.
    const neverWhere: Prisma.CompanyWhereInput = {
      ...open,
      stage: "NOT_CONTACTED",
      nextFollowUpAt: null,
      ...(filters.mine ? mine : notHeldByOthers(tenant.userId, now)),
    };
    const neverCount = await tx.company.count({ where: neverWhere });
    const never =
      filters.never && neverCount > 0
        ? await tx.company.findMany({
            where: neverWhere,
            select: ROW,
            orderBy: [{ createdAt: "desc" }, { id: "asc" }],
            take: filters.all === "never" ? SHOW_ALL_LIMIT : QUEUE_SIZE,
          })
        : null;

    // The latest note for each company shown, in one query rather than one per row.
    const shown = [...due, ...(never ?? [])];
    const notes = shown.length
      ? await tx.outreach.findMany({
          where: { workspaceId, companyId: { in: shown.map((c) => c.id) }, note: { not: null } },
          select: { companyId: true, note: true },
          orderBy: [{ sentAt: "desc" }, { id: "asc" }],
        })
      : [];
    const lastNote = new Map<string, string>();
    for (const n of notes) if (!lastNote.has(n.companyId)) lastNote.set(n.companyId, n.note as string);
    const withNote = (c: (typeof shown)[number]) => ({ ...c, lastNote: lastNote.get(c.id) ?? null });

    return { now, due: due.map(withNote), dueCount, never: never?.map(withNote) ?? null, neverCount };
  });
}
