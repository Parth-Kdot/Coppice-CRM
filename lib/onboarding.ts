import type { Prisma } from "@/generated/prisma/client";
import { heldBy, notHeldByOthers } from "@/lib/claims";
import { withTenant, type Tenant } from "@/lib/db";
import { TERMINAL_STAGES } from "@/lib/stages";
import type { TourName, TourRole } from "@/lib/onboarding-steps";

// One person's progress through the onboarding tours in one workspace (model OnboardingProgress).
// Every read and write runs inside withTenant, and the table's row-level security only ever shows
// the caller their own row, so these functions take the tenant and nothing else to say whose row.
// Queries run one after another inside a transaction (never Promise.all on one connection).
//
//   getProgress(tenant)            The row, or null when the basics have not started.
//   advance(tenant, tour, step)    Saves the next unseen card. Creates the row on first use; a step
//                                  only ever moves forward, so an old tab can't wind it back.
//   complete(tenant, tour, role)   Marks a tour finished. The finish time is written once; the
//                                  basics also record the role they were finished as.
//   dismissAi(tenant)              "Later" on the AI offer, or the AI tour ended early.
//   tourCompany(tenant, now)       A company page the tour can show: one you hold, else an open one
//                                  nobody else holds, else null.

export type Progress = {
  basicsStep: number;
  basicsDoneAt: Date | null;
  basicsRole: TourRole | null;
  aiStep: number;
  aiDoneAt: Date | null;
  aiDismissedAt: Date | null;
};

const SELECT = { basicsStep: true, basicsDoneAt: true, basicsRole: true, aiStep: true, aiDoneAt: true, aiDismissedAt: true } as const;

export const MAX_STEP = 20;

export async function getProgress(tenant: Tenant): Promise<Progress | null> {
  const row = await withTenant(tenant, (tx) =>
    tx.onboardingProgress.findUnique({ where: { workspaceId_userId: { workspaceId: tenant.workspaceId, userId: tenant.userId } }, select: SELECT }),
  );
  if (!row) return null;
  return { ...row, basicsRole: row.basicsRole === "owner" || row.basicsRole === "member" ? row.basicsRole : null };
}

const key = (tenant: Tenant) => ({ workspaceId_userId: { workspaceId: tenant.workspaceId, userId: tenant.userId } });

// The row exists afterwards. Two first saves racing each other both end with the one row: the
// loser's insert hits the unique key and is ignored.
async function ensureRow(tx: Prisma.TransactionClient, tenant: Tenant): Promise<void> {
  const found = await tx.onboardingProgress.findUnique({ where: key(tenant), select: { id: true } });
  if (found) return;
  await tx.onboardingProgress.createMany({ data: [{ workspaceId: tenant.workspaceId, userId: tenant.userId }], skipDuplicates: true });
}

export async function advance(tenant: Tenant, tour: TourName, step: number): Promise<void> {
  const next = Math.max(0, Math.min(MAX_STEP, Math.trunc(step)));
  await withTenant(tenant, async (tx) => {
    await ensureRow(tx, tenant);
    const where = { workspaceId: tenant.workspaceId, userId: tenant.userId };
    if (tour === "basics") await tx.onboardingProgress.updateMany({ where: { ...where, basicsStep: { lt: next } }, data: { basicsStep: next } });
    else await tx.onboardingProgress.updateMany({ where: { ...where, aiStep: { lt: next } }, data: { aiStep: next } });
  });
}

export async function complete(tenant: Tenant, tour: TourName, role: TourRole): Promise<void> {
  const now = new Date();
  await withTenant(tenant, async (tx) => {
    await ensureRow(tx, tenant);
    const where = { workspaceId: tenant.workspaceId, userId: tenant.userId };
    if (tour === "basics") {
      await tx.onboardingProgress.updateMany({ where: { ...where, basicsDoneAt: null }, data: { basicsDoneAt: now } });
      // The role they finished as: an officer made owner later sees the invite card once, and then
      // this says "owner".
      await tx.onboardingProgress.updateMany({ where, data: { basicsRole: role } });
    } else {
      await tx.onboardingProgress.updateMany({ where: { ...where, aiDoneAt: null }, data: { aiDoneAt: now } });
    }
  });
}

export async function dismissAi(tenant: Tenant): Promise<void> {
  const now = new Date();
  await withTenant(tenant, async (tx) => {
    await ensureRow(tx, tenant);
    await tx.onboardingProgress.updateMany({ where: { workspaceId: tenant.workspaceId, userId: tenant.userId, aiDismissedAt: null }, data: { aiDismissedAt: now } });
  });
}

export async function tourCompany(tenant: Tenant, now: Date): Promise<string | null> {
  return withTenant(tenant, async (tx) => {
    const open: Prisma.CompanyWhereInput = { workspaceId: tenant.workspaceId, archivedAt: null, stage: { notIn: TERMINAL_STAGES } };
    const order: Prisma.CompanyOrderByWithRelationInput[] = [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { name: "asc" }];
    const mine = await tx.company.findFirst({ where: { ...open, ...heldBy(tenant.userId, now) }, orderBy: order, select: { id: true } });
    if (mine) return mine.id;
    const free = await tx.company.findFirst({ where: { ...open, ...notHeldByOthers(tenant.userId, now) }, orderBy: order, select: { id: true } });
    return free?.id ?? null;
  });
}
