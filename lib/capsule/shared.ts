import type { Prisma } from "@/generated/prisma/client";
import { aiUsage } from "@/lib/ai/run";
import type { Membership } from "@/lib/authz";
import type { Tenant } from "@/lib/db";
import type { ActionResult } from "@/lib/validation";

// What the Time Capsule's steps share (lib/capsule/): messages, the owner check and the AI switch.
// The actions in app/(app)/[workspaceId]/capsule/actions.ts check membership first (requireOwner for
// every step of the handoff); the functions here check the role again, so a function called from
// anywhere else is just as strict, and the database's policies say the same for writes.

export type Tx = Prisma.TransactionClient;

export const OWNER_ONLY = "Only an owner can do that.";
export const NO_HANDOFF = "That handoff wasn't found.";
export const NO_CARD = "That card wasn't found.";
export const PUBLISHED_LOCK = "This handoff is published. Unpublish it to change it.";

export const fail = (error: string) => ({ ok: false as const, error });

export const isOwner = (actor: Membership): boolean => actor.role === "owner";

export async function aiOn(tenant: Tenant): Promise<boolean> {
  return (await aiUsage(tenant)).enabled;
}

export type Done<T = undefined> = ActionResult<T>;

// The report of this workspace, with its status, for the steps that change it. Null when it isn't
// there (or is another workspace's: the query names the workspace, and row-level security agrees).
export function findReport(tx: Tx, workspaceId: string, reportId: string) {
  return tx.handoffReport.findFirst({ where: { id: reportId, workspaceId } });
}
