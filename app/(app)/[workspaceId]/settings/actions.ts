"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { failure } from "@/lib/action-failure";
import { requireMembership, requireOwner } from "@/lib/authz";
import { releaseClaimsOf } from "@/lib/claims";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/messages";
import {
  DELETE_NAME_MISMATCH,
  ONLY_OWNER_MESSAGE,
  deleteWorkspace as deleteWorkspaceRow,
  inviteExpiryLabel,
  memberUserId,
  renameWorkspace as renameWorkspaceRow,
  setAiSettings,
  setClaimWindow,
  setMcpEnabled,
} from "@/lib/workspaces";
import {
  aiSettingsSchema,
  cancelInvitationSchema,
  changeRoleSchema,
  claimWindowSchema,
  deleteWorkspaceSchema,
  inviteMemberSchema,
  mcpSettingsSchema,
  memberSchema,
  renameWorkspaceSchema,
  workspaceIdSchema,
  type ActionResult,
} from "@/lib/validation";

// Every action checks our own rule first (requireOwner / requireMembership), then calls
// Better Auth, which checks again (roles, last owner, right workspace) before writing.

const settingsPath = (workspaceId: string) => `/${workspaceId}/settings`;

// renewed: this email already had a pending invitation (in any letter case), which Better Auth
// replaced with this one. until: the new expiry, as the page writes dates ("Nov 14").
export type InviteResult = { email: string; renewed: boolean; until: string };

export async function inviteMember(_prev: ActionResult<InviteResult> | null, form: FormData): Promise<ActionResult<InviteResult>> {
  const parsed = inviteMemberSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    email: form.get("email"),
    role: form.get("role"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, email, role } = parsed.data;

  let result: InviteResult;
  try {
    await requireOwner(workspaceId);
    const existing = await prisma.invitation.findFirst({
      where: { workspaceId, status: "pending", expiresAt: { gt: new Date() }, email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    // No email is sent: the app never sends email. The invitee sees a Join button after signing in with this email.
    // Better Auth cancels an older pending invitation for the same email (cancelPendingInvitationsOnReInvite).
    const invitation = await auth.api.createInvitation({
      body: { email, role, organizationId: workspaceId },
      headers: await headers(),
    });
    result = { email, renewed: existing !== null, until: inviteExpiryLabel(new Date(invitation.expiresAt)) };
  } catch (e) {
    return failure(e, "inviteMember");
  }
  revalidatePath(settingsPath(workspaceId));
  return { ok: true, data: result };
}

export async function cancelInvitation(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = cancelInvitationSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    invitationId: form.get("invitationId"),
  });
  if (!parsed.success) return notFound("Invitation");
  const { workspaceId, invitationId } = parsed.data;

  try {
    await requireOwner(workspaceId);
    await auth.api.cancelInvitation({ body: { invitationId }, headers: await headers() });
  } catch (e) {
    return failure(e, "cancelInvitation");
  }
  revalidatePath(settingsPath(workspaceId));
  return { ok: true, data: undefined };
}

// Make Owner / Make Officer. Transferring ownership is: make someone Owner, then make
// yourself Officer (or leave). Better Auth refuses to demote the last owner.
export async function changeMemberRole(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = changeRoleSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    memberId: form.get("memberId"),
    role: form.get("role"),
  });
  if (!parsed.success) return notFound("Member");
  const { workspaceId, memberId, role } = parsed.data;

  try {
    await requireOwner(workspaceId);
    await auth.api.updateMemberRole({
      body: { memberId, role, organizationId: workspaceId },
      headers: await headers(),
    });
  } catch (e) {
    return failure(e, "changeMemberRole");
  }
  revalidatePath(settingsPath(workspaceId));
  return { ok: true, data: undefined };
}

// Removing someone also releases their claims, so their companies don't stay locked until the
// claims expire. Released after the removal succeeds, by the owner doing the removing.
export async function removeMember(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = memberSchema.safeParse({ workspaceId: form.get("workspaceId"), memberId: form.get("memberId") });
  if (!parsed.success) return notFound("Member");
  const { workspaceId, memberId } = parsed.data;

  try {
    const owner = await requireOwner(workspaceId);
    const memberUser = await memberUserId(workspaceId, memberId);
    if (!memberUser) return notFound("Member");
    await auth.api.removeMember({
      body: { memberIdOrEmail: memberId, organizationId: workspaceId },
      headers: await headers(),
    });
    await releaseClaimsOf(owner, memberUser);
  } catch (e) {
    return failure(e, "removeMember");
  }
  revalidatePath(settingsPath(workspaceId));
  return { ok: true, data: undefined };
}

// Any member can leave, except the only owner. Your claims are released before you leave, while
// you're still a member (afterwards row-level security wouldn't let you), so the only-owner check
// comes first: otherwise a refused leave would already have dropped your claims for others to take.
// Better Auth checks the last owner again, and the keep-an-owner trigger stops a race.
export async function leaveWorkspace(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = workspaceIdSchema.safeParse(form.get("workspaceId"));
  if (!parsed.success) return notFound("Workspace");
  const workspaceId = parsed.data;

  try {
    const me = await requireMembership(workspaceId);
    if (me.role === "owner") {
      const owners = await prisma.membership.count({ where: { workspaceId, role: { contains: "owner" } } });
      if (owners <= 1) return { ok: false, error: ONLY_OWNER_MESSAGE };
    }
    await releaseClaimsOf(me, me.userId);
    await auth.api.leaveOrganization({ body: { organizationId: workspaceId }, headers: await headers() });
  } catch (e) {
    return failure(e, "leaveWorkspace");
  }
  redirect("/workspaces");
}

export async function updateClaimWindow(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = claimWindowSchema.safeParse({ workspaceId: form.get("workspaceId"), days: form.get("days") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, days } = parsed.data;

  try {
    const { userId } = await requireOwner(workspaceId);
    await setClaimWindow(userId, workspaceId, days);
  } catch (e) {
    return failure(e, "updateClaimWindow");
  }
  revalidatePath(settingsPath(workspaceId));
  return { ok: true, data: undefined };
}

export async function updateAiSettings(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = aiSettingsSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    enabled: form.get("enabled"),
    limit: form.get("limit"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, enabled, limit } = parsed.data;

  try {
    const { userId } = await requireOwner(workspaceId);
    await setAiSettings(userId, workspaceId, { enabled, limit });
  } catch (e) {
    return failure(e, "updateAiSettings");
  }
  revalidatePath(settingsPath(workspaceId));
  return { ok: true, data: undefined };
}

export async function updateMcpSettings(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = mcpSettingsSchema.safeParse({ workspaceId: form.get("workspaceId"), enabled: form.get("enabled") });
  if (!parsed.success) return notFound("Workspace");
  const { workspaceId, enabled } = parsed.data;

  try {
    const { userId } = await requireOwner(workspaceId);
    await setMcpEnabled(userId, workspaceId, enabled);
  } catch (e) {
    return failure(e, "updateMcpSettings");
  }
  revalidatePath(settingsPath(workspaceId));
  return { ok: true, data: undefined };
}

// Settings > Workspace (owner): a new name for the workspace.
export async function renameWorkspace(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = renameWorkspaceSchema.safeParse({ workspaceId: form.get("workspaceId"), name: form.get("name") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, name } = parsed.data;

  try {
    const { userId } = await requireOwner(workspaceId);
    await renameWorkspaceRow(userId, workspaceId, name);
  } catch (e) {
    return failure(e, "renameWorkspace");
  }
  // The name is in the shell's header on every page of the workspace.
  revalidatePath(`/${workspaceId}`, "layout");
  return { ok: true, data: undefined };
}

// Settings > Workspace > Danger zone (owner): delete the workspace and everything in it, once the
// owner has typed its name. Then off to the workspace list.
export async function deleteWorkspace(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = deleteWorkspaceSchema.safeParse({ workspaceId: form.get("workspaceId"), confirmName: form.get("confirmName") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, confirmName } = parsed.data;

  try {
    const { userId } = await requireOwner(workspaceId);
    const deleted = await deleteWorkspaceRow(userId, workspaceId, confirmName);
    if (!deleted) return { ok: false, error: DELETE_NAME_MISMATCH };
  } catch (e) {
    return failure(e, "deleteWorkspace");
  }
  revalidatePath("/workspaces");
  redirect("/workspaces");
}
