import type { Channel, Stage } from "@/generated/prisma/client";
import type { Membership } from "@/lib/authz";
import { when } from "@/lib/dates";
import { prisma, withTenant, type Tenant } from "@/lib/db";
import { STAGE_LABELS, TERMINAL_STAGES } from "@/lib/stages";
import type { ActionResult } from "@/lib/validation";
import type { Prisma } from "@/generated/prisma/client";

// Everything that touches a claim lives here (project rule 2). A claim says "I'm pitching this
// company": while it's live, nobody else can log outreach on it, move its stage or archive it
// (owners can). Claims expire on their own after the workspace's claim window.
//
// Rules this file keeps:
// - Who wins a claim is decided by one conditional UPDATE, never by reading first in code, so two
//   people clicking at the same moment can never both win (rule 2).
// - Every expiry check uses the database clock, now() in SQL, never the server's (rule 3).
// - Logging outreach is one transaction: if the claim check fails, nothing is written (rule 4).

type Tx = Prisma.TransactionClient;

// Follow-up dates are calendar days in West Lafayette, whatever time zone the server runs in.
const TIME_ZONE = "America/Indiana/Indianapolis";

// The company's claim as the database sees it right now. `live` is worked out by Postgres.
type ClaimRow = {
  stage: Stage;
  archived: boolean;
  claimedById: string | null;
  holderName: string | null;
  claimExpiresAt: Date | null;
  live: boolean;
};

// Reads a company's claim. With `lock`, the row stays locked until the transaction ends, so the
// caller's check and its write can't be split by someone else's change.
async function readClaim(tx: Tx, workspaceId: string, companyId: string, { lock = false } = {}): Promise<ClaimRow | null> {
  const rows = lock
    ? await tx.$queryRaw<ClaimRow[]>`
        SELECT c.stage, c."archivedAt" IS NOT NULL AS archived, c."claimedById", u.name AS "holderName",
               c."claimExpiresAt", (c."claimedById" IS NOT NULL AND c."claimExpiresAt" > now()) AS live
        FROM "Company" c LEFT JOIN "user" u ON u.id = c."claimedById"
        WHERE c.id = ${companyId} AND c."workspaceId" = ${workspaceId}
        FOR UPDATE OF c`
    : await tx.$queryRaw<ClaimRow[]>`
        SELECT c.stage, c."archivedAt" IS NOT NULL AS archived, c."claimedById", u.name AS "holderName",
               c."claimExpiresAt", (c."claimedById" IS NOT NULL AND c."claimExpiresAt" > now()) AS live
        FROM "Company" c LEFT JOIN "user" u ON u.id = c."claimedById"
        WHERE c.id = ${companyId} AND c."workspaceId" = ${workspaceId}`;
  return rows[0] ?? null;
}

const NOT_FOUND = { ok: false, error: "Company not found." } as const;
const closedMessage = (stage: Stage) => `This company is ${STAGE_LABELS[stage]}, so it can't be claimed.`;
const until = (row: ClaimRow) => when(row.claimExpiresAt as Date);

// A live claim by someone else blocks this person, unless they're an owner.
function blockedBy(row: ClaimRow, actor: Membership): string | null {
  if (!row.live || row.claimedById === actor.userId || actor.role === "owner") return null;
  return `${row.holderName} holds this company until ${until(row)}. Ask them, or an owner.`;
}

// The database's clock, for pages that show whether a claim is still live ("held until",
// "expired"). Comparing against the server's clock instead could disagree with the claim SQL.
export async function dbNow(): Promise<Date> {
  const [{ now }] = await prisma.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
  return now;
}

// What a page should show for a company's claim, given the database's time (from dbNow) and who
// is looking: nobody holds it, you hold it, someone else holds it, or someone's claim ran out.
export type ClaimState = "free" | "mine" | "theirs" | "expired";
export function claimState(claim: { claimedById: string | null; claimExpiresAt: Date | null }, now: Date, userId: string): ClaimState {
  if (claim.claimedById === null || claim.claimExpiresAt === null) return "free";
  if (claim.claimExpiresAt <= now) return "expired";
  return claim.claimedById === userId ? "mine" : "theirs";
}

// Today's date in West Lafayette ("2026-10-25"), from the database clock.
export async function dbToday(): Promise<string> {
  const [{ today }] = await prisma.$queryRaw<{ today: string }[]>`
    SELECT to_char((now() AT TIME ZONE ${TIME_ZONE})::date, 'YYYY-MM-DD') AS today`;
  return today;
}

// Claims a company for the workspace's claim window. Succeeds if nobody holds it, the claim has
// expired, or you already hold it (which renews it). The whole decision is the WHERE clause of
// one UPDATE: Postgres locks the row, so of two simultaneous claims the second re-checks the
// WHERE after the first commits and changes nothing.
export function claimCompany(actor: Tenant, companyId: string): Promise<ActionResult<{ claimExpiresAt: Date }>> {
  return withTenant(actor, async (tx) => {
    const won = await tx.$queryRaw<{ claimExpiresAt: Date }[]>`
      UPDATE "Company"
      SET "claimedById" = ${actor.userId},
          "claimExpiresAt" = now() + make_interval(days => (SELECT "claimWindowDays" FROM public.workspace WHERE id = ${actor.workspaceId})),
          "updatedAt" = now()
      WHERE id = ${companyId} AND "workspaceId" = ${actor.workspaceId}
        AND "archivedAt" IS NULL
        AND stage NOT IN ('COMMITTED', 'DECLINED')
        AND ("claimedById" IS NULL OR "claimExpiresAt" <= now() OR "claimedById" = ${actor.userId})
      RETURNING "claimExpiresAt"`;
    if (won.length === 1) return { ok: true, data: won[0] };

    // Lost: say why, and who holds it.
    const row = await readClaim(tx, actor.workspaceId, companyId);
    if (!row || row.archived) return NOT_FOUND;
    if (TERMINAL_STAGES.includes(row.stage)) return { ok: false, error: closedMessage(row.stage) };
    // Only reachable if the holder released in the instant between the UPDATE and this read, which
    // no test can time reliably, so coverage skips it.
    /* v8 ignore next */
    if (!row.live) return { ok: false, error: "The claim on this company just changed. Try again." };
    return { ok: false, error: `${row.holderName} claimed this first. They hold it until ${until(row)}.` };
  });
}

// Gives up your own claim. Only works if it's still yours.
export function releaseClaim(actor: Tenant, companyId: string): Promise<ActionResult> {
  return withTenant(actor, async (tx) => {
    const { count } = await tx.company.updateMany({
      where: { id: companyId, workspaceId: actor.workspaceId, claimedById: actor.userId },
      data: { claimedById: null, claimExpiresAt: null },
    });
    return count === 1 ? { ok: true, data: undefined } : { ok: false, error: "You don't hold this company." };
  });
}

// An owner clears anyone's claim, for an officer who went quiet.
export function forceRelease(actor: Membership, companyId: string): Promise<ActionResult> {
  return withTenant(actor, async (tx) => {
    if (actor.role !== "owner") return { ok: false, error: "Only an owner can force-release a claim." };
    const { count } = await tx.company.updateMany({
      where: { id: companyId, workspaceId: actor.workspaceId, claimedById: { not: null } },
      data: { claimedById: null, claimExpiresAt: null },
    });
    return count === 1 ? { ok: true, data: undefined } : { ok: false, error: "Nobody holds this company." };
  });
}

// Releases every claim a person holds in this workspace: when they're removed or leave, their
// companies shouldn't stay locked until the claims expire. Returns how many were released.
export function releaseClaimsOf(actor: Tenant, userId: string): Promise<number> {
  return withTenant(actor, async (tx) => {
    const { count } = await tx.company.updateMany({
      where: { workspaceId: actor.workspaceId, claimedById: userId },
      data: { claimedById: null, claimExpiresAt: null },
    });
    return count;
  });
}

export type OutreachInput = { channel: Channel; note: string | null; followUpOn: string };

// Records that you contacted the company. One transaction:
// 1. A conditional UPDATE that only matches if YOU hold a LIVE claim. It sets last contacted
//    and the next follow-up, renews your claim, and moves Not contacted to Contacted. It also
//    returns the stage from before, so the history is right.
// 2. If it matched nothing, return why. Nothing has been written.
// 3. Otherwise add the Outreach row, and a StageChange row if the stage moved.
export function logOutreach(actor: Tenant, companyId: string, input: OutreachInput): Promise<ActionResult<{ outreachId: string }>> {
  return withTenant(actor, async (tx) => {
    // The follow-up must be from today to a year out, "today" being West Lafayette's date.
    const [{ inRange }] = await tx.$queryRaw<{ inRange: boolean }[]>`
      SELECT ${input.followUpOn}::date BETWEEN (now() AT TIME ZONE ${TIME_ZONE})::date
                                         AND (now() AT TIME ZONE ${TIME_ZONE})::date + 365 AS "inRange"`;
    if (!inRange) return { ok: false, error: "Pick a follow-up date from today to a year from now." };

    const updated = await tx.$queryRaw<{ fromStage: Stage; toStage: Stage }[]>`
      UPDATE "Company" c
      SET "lastContactedAt" = now(),
          "nextFollowUpAt" = (${input.followUpOn}::date)::timestamp AT TIME ZONE ${TIME_ZONE},
          "claimExpiresAt" = now() + make_interval(days => (SELECT "claimWindowDays" FROM public.workspace WHERE id = ${actor.workspaceId})),
          stage = CASE WHEN c.stage = 'NOT_CONTACTED' THEN 'CONTACTED'::"Stage" ELSE c.stage END,
          "updatedAt" = now()
      FROM (SELECT id, stage FROM "Company" WHERE id = ${companyId} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE) before
      WHERE c.id = before.id
        AND c."claimedById" = ${actor.userId} AND c."claimExpiresAt" > now()
        AND c."archivedAt" IS NULL AND c.stage NOT IN ('COMMITTED', 'DECLINED')
      RETURNING before.stage AS "fromStage", c.stage AS "toStage"`;

    if (updated.length === 0) {
      const row = await readClaim(tx, actor.workspaceId, companyId);
      if (!row || row.archived) return NOT_FOUND;
      if (TERMINAL_STAGES.includes(row.stage)) return { ok: false, error: `This company is ${STAGE_LABELS[row.stage]}. Nothing was saved.` };
      if (row.live) return { ok: false, error: `${row.holderName} holds this company now, until ${until(row)}. Nothing was saved.` };
      if (row.claimedById === actor.userId) {
        return { ok: false, error: "Your claim on this company has expired. Claim it again, then log your outreach. Nothing was saved." };
      }
      return { ok: false, error: "Claim this company before logging outreach. Nothing was saved." };
    }

    const { fromStage, toStage } = updated[0];
    const outreach = await tx.outreach.create({
      data: { workspaceId: actor.workspaceId, companyId, senderId: actor.userId, channel: input.channel, note: input.note },
      select: { id: true },
    });
    if (fromStage !== toStage) {
      await tx.stageChange.create({
        data: { workspaceId: actor.workspaceId, companyId, changedById: actor.userId, fromStage, toStage },
      });
    }
    return { ok: true, data: { outreachId: outreach.id } };
  });
}

export type StageChangeResult = { changed: boolean; fromStage: Stage; toStage: Stage };

// Moves a company to a new stage and records the move in StageChange. The row is locked first,
// so two people moving the same company at the same moment are handled one after the other and
// the history's "from" stage is always right. A company someone else holds can only be moved by
// them or an owner. Moving to Committed or Declined also clears the claim: the pitch is over.
export function changeStage(actor: Membership, companyId: string, toStage: Stage): Promise<ActionResult<StageChangeResult>> {
  return withTenant(actor, async (tx) => {
    const row = await readClaim(tx, actor.workspaceId, companyId, { lock: true });
    if (!row || row.archived) return NOT_FOUND;

    const fromStage = row.stage;
    if (fromStage === toStage) return { ok: true, data: { changed: false, fromStage, toStage } };
    const blocked = blockedBy(row, actor);
    if (blocked) return { ok: false, error: blocked };

    const closesTheDeal = TERMINAL_STAGES.includes(toStage);
    await tx.company.update({
      where: { id_workspaceId: { id: companyId, workspaceId: actor.workspaceId } },
      data: { stage: toStage, ...(closesTheDeal ? { claimedById: null, claimExpiresAt: null } : {}) },
    });
    await tx.stageChange.create({
      data: { workspaceId: actor.workspaceId, companyId, changedById: actor.userId, fromStage, toStage },
    });
    return { ok: true, data: { changed: true, fromStage, toStage } };
  });
}

// Called by lib/companies.ts inside its archive transaction, before archiving. Refuses if someone
// else holds a live claim (unless the actor is an owner); otherwise clears the claim, so a
// company never comes back from the archive still claimed. Returns an error message, or null.
export async function releaseForArchive(tx: Tx, actor: Membership, companyId: string): Promise<string | null> {
  const row = await readClaim(tx, actor.workspaceId, companyId, { lock: true });
  if (!row || row.archived) return NOT_FOUND.error;
  const blocked = blockedBy(row, actor);
  if (blocked) return blocked;
  if (row.claimedById !== null) {
    await tx.company.update({
      where: { id_workspaceId: { id: companyId, workspaceId: actor.workspaceId } },
      data: { claimedById: null, claimExpiresAt: null },
    });
  }
  return null;
}
