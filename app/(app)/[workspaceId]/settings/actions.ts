"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { failure } from "@/lib/actions";
import { requireMembership, requireOwner } from "@/lib/authz";
import { setClaimWindow } from "@/lib/workspaces";
import {
  cancelInvitationSchema,
  changeRoleSchema,
  claimWindowSchema,
  inviteMemberSchema,
  memberSchema,
  workspaceIdSchema,
  type ActionResult,
} from "@/lib/validation";

// Every action checks our own rule first (requireOwner / requireMembership), then calls
// Better Auth, which checks again (roles, last owner, right workspace) before writing.

const settingsPath = (workspaceId: string) => `/${workspaceId}/settings`;

export async function inviteMember(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = inviteMemberSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    email: form.get("email"),
    role: form.get("role"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, email, role } = parsed.data;

  try {
    await requireOwner(workspaceId);
    // No email is sent (rule 6). The invitee sees a Join button after signing in with this email.
    await auth.api.createInvitation({
      body: { email, role, organizationId: workspaceId },
      headers: await headers(),
    });
  } catch (e) {
    return failure(e);
  }
  revalidatePath(settingsPath(workspaceId));
  return { ok: true, data: undefined };
}

export async function cancelInvitation(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = cancelInvitationSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    invitationId: form.get("invitationId"),
  });
  if (!parsed.success) return { ok: false, error: "Invitation not found." };
  const { workspaceId, invitationId } = parsed.data;

  try {
    await requireOwner(workspaceId);
    await auth.api.cancelInvitation({ body: { invitationId }, headers: await headers() });
  } catch (e) {
    return failure(e);
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
  if (!parsed.success) return { ok: false, error: "Member not found." };
  const { workspaceId, memberId, role } = parsed.data;

  try {
    await requireOwner(workspaceId);
    await auth.api.updateMemberRole({
      body: { memberId, role, organizationId: workspaceId },
      headers: await headers(),
    });
  } catch (e) {
    return failure(e);
  }
  revalidatePath(settingsPath(workspaceId));
  return { ok: true, data: undefined };
}

// Milestone 3: removing someone must also release their claims through lib/claims.ts.
export async function removeMember(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = memberSchema.safeParse({ workspaceId: form.get("workspaceId"), memberId: form.get("memberId") });
  if (!parsed.success) return { ok: false, error: "Member not found." };
  const { workspaceId, memberId } = parsed.data;

  try {
    await requireOwner(workspaceId);
    await auth.api.removeMember({
      body: { memberIdOrEmail: memberId, organizationId: workspaceId },
      headers: await headers(),
    });
  } catch (e) {
    return failure(e);
  }
  revalidatePath(settingsPath(workspaceId));
  return { ok: true, data: undefined };
}

// Any member can leave. Better Auth refuses if you are the last owner.
export async function leaveWorkspace(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = workspaceIdSchema.safeParse(form.get("workspaceId"));
  if (!parsed.success) return { ok: false, error: "Workspace not found." };
  const workspaceId = parsed.data;

  try {
    await requireMembership(workspaceId);
    await auth.api.leaveOrganization({ body: { organizationId: workspaceId }, headers: await headers() });
  } catch (e) {
    return failure(e);
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
    return failure(e);
  }
  revalidatePath(settingsPath(workspaceId));
  return { ok: true, data: undefined };
}
