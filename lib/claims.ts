import { withTenant, type Tenant } from "@/lib/db";
import type { Stage } from "@/generated/prisma/client";
import type { ActionResult } from "@/lib/validation";

// Everything that touches a claim lives here (project rule 2). Milestone 3 adds claimCompany,
// releaseClaim, forceRelease and logOutreach; for now this holds the stage change, because moving
// a company to Committed or Declined must also clear its claim.

const TERMINAL: Stage[] = ["COMMITTED", "DECLINED"];

export type StageChangeResult = { changed: boolean; fromStage: Stage; toStage: Stage };

// Moves a company to a new stage and records the move in StageChange.
// The row is locked first (SELECT ... FOR UPDATE), so two people moving the same company at the
// same moment are handled one after the other and the history's "from" stage is always right.
export function changeStage(tenant: Tenant, companyId: string, toStage: Stage): Promise<ActionResult<StageChangeResult>> {
  return withTenant(tenant, async (tx) => {
    const rows = await tx.$queryRaw<{ stage: Stage }[]>`
      SELECT stage FROM "Company"
      WHERE id = ${companyId} AND "workspaceId" = ${tenant.workspaceId} AND "archivedAt" IS NULL
      FOR UPDATE`;
    if (rows.length === 0) return { ok: false, error: "Company not found." };

    const fromStage = rows[0].stage;
    if (fromStage === toStage) return { ok: true, data: { changed: false, fromStage, toStage } };

    const closesTheDeal = TERMINAL.includes(toStage);
    await tx.company.update({
      where: { id_workspaceId: { id: companyId, workspaceId: tenant.workspaceId } },
      // A finished company can't stay claimed: nobody should be "holding" it any more.
      data: { stage: toStage, ...(closesTheDeal ? { claimedById: null, claimExpiresAt: null } : {}) },
    });
    await tx.stageChange.create({
      data: { workspaceId: tenant.workspaceId, companyId, changedById: tenant.userId, fromStage, toStage },
    });
    return { ok: true, data: { changed: true, fromStage, toStage } };
  });
}
