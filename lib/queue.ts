import type { Prisma } from "@/generated/prisma/client";
import { dbNow, heldBy, notHeldByOthers } from "@/lib/claims";
import { withTenant, type Tenant } from "@/lib/db";
import { TERMINAL_STAGES } from "@/lib/stages";
import type { QueueFilters } from "@/lib/validation";

// The follow-up queue, the workspace's home screen. "Due" is every open company whose follow-up
// date has arrived, most overdue first; "Fresh leads" (never contacted) are companies nobody has
// written to yet and nobody else holds. "Now" is the database's clock (dbNow), the same one the
// claim SQL uses; the page passes the one its layout already read. A fixed, small number of
// queries per load, each one at a time inside withTenant (never Promise.all on one transaction).
//
//   getQueueHome()  the home screen: due companies in three groups, yours (held by you), up for
//                   grabs (free or the claim ran out) and held by others, plus counts.
//   getFreshLeads() one page of fresh leads, for the collapsed list at the bottom of the queue.
//   getQueue()      the flat due list with optional filters, for the MCP tool get_follow_up_queue.

export const QUEUE_SIZE = 50;
// Rows each group can load through "Show 50 more" (?upto=), and the most it ever renders.
export const QUEUE_STEP = 50;
export const QUEUE_CAP = 200;
// Held by others: read-only rows behind a disclosure, the first 50 only.
export const HELD_SHOWN = 50;
// Fresh leads load 20 at a time, up to 100, when the list is opened.
export const FRESH_PAGE = 20;
export const FRESH_CAP = 100;
// A note is one muted line on the queue; nobody reads 2 KB of it there.
export const NOTE_CHARS = 200;

const ROW = {
  id: true,
  name: true,
  nextFollowUpAt: true,
  // Read only, for the claim badge; liveness is decided against `now` by claimState().
  claimedById: true,
  claimExpiresAt: true,
  claimedBy: { select: { name: true } },
} as const;

// The latest outreach note, through the relation: one row per company, not every note.
const ROW_WITH_NOTE = {
  ...ROW,
  outreach: { where: { note: { not: null } }, orderBy: [{ sentAt: "desc" }, { id: "asc" }], take: 1, select: { note: true } },
} as const satisfies Prisma.CompanySelect;

type NoteRecord = Prisma.CompanyGetPayload<{ select: typeof ROW_WITH_NOTE }>;
export type QueueRow = Prisma.CompanyGetPayload<{ select: typeof ROW }> & { lastNote: string | null };

const trimNote = (note: string | null | undefined): string | null => {
  if (!note) return null;
  const text = note.trim();
  return text.length > NOTE_CHARS ? `${text.slice(0, NOTE_CHARS - 1).trimEnd()}…` : text;
};
const withNote = ({ outreach, ...row }: NoteRecord): QueueRow => ({ ...row, lastNote: trimNote(outreach[0]?.note) });

const DUE_ORDER: Prisma.CompanyOrderByWithRelationInput[] = [{ nextFollowUpAt: "asc" }, { name: "asc" }, { id: "asc" }];
const open = (workspaceId: string) => ({ workspaceId, archivedAt: null, stage: { notIn: TERMINAL_STAGES } });
// Claim rules stay in lib/claims.ts (only it writes a claim); these only combine its filters.
// Up for grabs: nobody holds it (never claimed, or anyone's claim ran out, yours included). User ids
// are never empty, so "not held by anyone but ''" is "not held by anyone".
const NOBODY = "";
const unclaimed = (now: Date): Prisma.CompanyWhereInput => notHeldByOthers(NOBODY, now);
// Someone else holds it with a live claim.
const heldByOthers = (userId: string, now: Date): Prisma.CompanyWhereInput => ({ NOT: notHeldByOthers(userId, now) });
const freshWhere = (tenant: Tenant, now: Date): Prisma.CompanyWhereInput => ({
  ...open(tenant.workspaceId),
  stage: "NOT_CONTACTED",
  nextFollowUpAt: null,
  ...notHeldByOthers(tenant.userId, now),
});

export type QueueGroup = { rows: QueueRow[]; count: number };
export type QueueHome = {
  now: Date;
  yours: QueueGroup;
  grabs: QueueGroup;
  heldByOthers: QueueGroup;
  // Never contacted and not held by someone else; the rows load only when the list is opened.
  freshCount: number;
  // Companies you hold whose follow-up is not due yet (or has no date), so the home screen can say so.
  yoursNotDue: number;
};

export const clampUpto = (upto: number | null | undefined): number =>
  Math.min(QUEUE_CAP, Math.max(QUEUE_STEP, Math.round((upto ?? QUEUE_STEP) / QUEUE_STEP) * QUEUE_STEP));

export async function getQueueHome(tenant: Tenant, options: { upto?: number | null; now?: Date } = {}): Promise<QueueHome> {
  const now = options.now ?? (await dbNow());
  const take = clampUpto(options.upto);
  return withTenant(tenant, async (tx) => {
    const due: Prisma.CompanyWhereInput = { ...open(tenant.workspaceId), nextFollowUpAt: { lte: now } };

    // A group's count is only asked for when its page came back full; otherwise the rows are all of it.
    const yoursWhere = { ...due, ...heldBy(tenant.userId, now) };
    const yoursRows = (await tx.company.findMany({ where: yoursWhere, select: ROW_WITH_NOTE, orderBy: DUE_ORDER, take })).map(withNote);
    const yoursCount = yoursRows.length < take ? yoursRows.length : await tx.company.count({ where: yoursWhere });

    const grabsWhere = { AND: [due, unclaimed(now)] };
    const grabsRows = (await tx.company.findMany({ where: grabsWhere, select: ROW_WITH_NOTE, orderBy: DUE_ORDER, take })).map(withNote);
    const grabsCount = grabsRows.length < take ? grabsRows.length : await tx.company.count({ where: grabsWhere });

    // Read-only rows: no note needed.
    const heldWhere = { AND: [due, heldByOthers(tenant.userId, now)] };
    const heldRows = await tx.company.findMany({ where: heldWhere, select: ROW, orderBy: DUE_ORDER, take: HELD_SHOWN });
    const heldCount = heldRows.length < HELD_SHOWN ? heldRows.length : await tx.company.count({ where: heldWhere });

    const freshCount = await tx.company.count({ where: freshWhere(tenant, now) });
    const yoursNotDue = await tx.company.count({
      where: { ...open(tenant.workspaceId), ...heldBy(tenant.userId, now), OR: [{ nextFollowUpAt: null }, { nextFollowUpAt: { gt: now } }] },
    });

    return {
      now,
      yours: { rows: yoursRows, count: yoursCount },
      grabs: { rows: grabsRows, count: grabsCount },
      heldByOthers: { rows: heldRows.map((r) => ({ ...r, lastNote: null })), count: heldCount },
      freshCount,
      yoursNotDue,
    };
  });
}

export type FreshLead = Prisma.CompanyGetPayload<{ select: typeof ROW & { industry: true } }>;

// One page of fresh leads, newest first. `more` says whether another page exists below the cap.
export async function getFreshLeads(tenant: Tenant, offset: number, now?: Date): Promise<{ now: Date; rows: FreshLead[]; more: boolean }> {
  const at = now ?? (await dbNow());
  const skip = Math.max(0, Math.min(FRESH_CAP - FRESH_PAGE, Math.floor(offset)));
  const rows = await withTenant(tenant, (tx) =>
    tx.company.findMany({
      where: freshWhere(tenant, at),
      select: { ...ROW, industry: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip,
      take: FRESH_PAGE + 1,
    }),
  );
  const more = rows.length > FRESH_PAGE && skip + FRESH_PAGE < FRESH_CAP;
  return { now: at, rows: rows.slice(0, FRESH_PAGE), more };
}

// ----- The flat queue, for the MCP tool -----

export type Queue = {
  now: Date;
  due: QueueRow[];
  dueCount: number;
  never: QueueRow[] | null;
  neverCount: number;
};

export async function getQueue(tenant: Tenant, filters: QueueFilters, at?: Date): Promise<Queue> {
  const now = at ?? (await dbNow());
  return withTenant(tenant, async (tx) => {
    const workspaceId = tenant.workspaceId;
    // "Only mine": companies I hold with a claim that hasn't expired.
    const mine = filters.mine ? heldBy(tenant.userId, now) : {};

    const dueWhere: Prisma.CompanyWhereInput = { ...open(workspaceId), ...mine, nextFollowUpAt: { lte: now } };
    // "All" is capped like every list: 200 rows at most.
    const dueLimit = filters.all === "due" ? QUEUE_CAP : QUEUE_SIZE;
    const due = await tx.company.findMany({ where: dueWhere, select: ROW_WITH_NOTE, orderBy: DUE_ORDER, take: dueLimit });
    const dueCount = due.length < dueLimit ? due.length : await tx.company.count({ where: dueWhere });

    // Fresh leads: never contacted, no follow-up yet, and not held by someone else.
    const neverWhere: Prisma.CompanyWhereInput = filters.mine
      ? { ...open(workspaceId), stage: "NOT_CONTACTED", nextFollowUpAt: null, ...mine }
      : freshWhere(tenant, now);
    const neverCount = await tx.company.count({ where: neverWhere });
    const never =
      filters.never && neverCount > 0
        ? await tx.company.findMany({
            where: neverWhere,
            select: ROW_WITH_NOTE,
            orderBy: [{ createdAt: "desc" }, { id: "asc" }],
            take: filters.all === "never" ? QUEUE_CAP : QUEUE_SIZE,
          })
        : null;

    return { now, due: due.map(withNote), dueCount, never: never?.map(withNote) ?? null, neverCount };
  });
}
