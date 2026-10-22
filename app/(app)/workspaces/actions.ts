"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { failure } from "@/lib/actions";
import { requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { createWorkspaceSchema, invitationIdSchema, type ActionResult } from "@/lib/validation";

export async function createWorkspace(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireUser();
  const parsed = createWorkspaceSchema.safeParse({ name: form.get("name") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  let workspaceId: string;
  try {
    // Better Auth checks allowUserToCreateOrganization (Option B) and makes the creator the owner.
    // The slug is required by Better Auth but unused: we always look workspaces up by id.
    const workspace = await auth.api.createOrganization({
      body: { name: parsed.data.name, slug: randomUUID() },
      headers: await headers(),
    });
    workspaceId = workspace.id;
  } catch (e) {
    return failure(e);
  }
  redirect(`/${workspaceId}`);
}

export async function acceptInvitation(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = invitationIdSchema.safeParse(form.get("invitationId"));
  if (!parsed.success) return { ok: false, error: "Invitation not found." };

  let workspaceId: string;
  try {
    // Better Auth refuses unless the invitation's email matches the signed-in, verified email.
    const result = await auth.api.acceptInvitation({
      body: { invitationId: parsed.data },
      headers: await headers(),
    });
    // Better Auth results use its own field name (organizationId), even though our column is workspaceId.
    workspaceId = result.member.organizationId;
  } catch (e) {
    // A second Join click (or a resubmit after going back) is refused because the invitation
    // is no longer pending. If you already joined, just take you there instead of erroring.
    const joined = await workspaceAlreadyJoined(user.id, parsed.data);
    if (!joined) return failure(e);
    workspaceId = joined;
  }
  redirect(`/${workspaceId}`);
}

async function workspaceAlreadyJoined(userId: string, invitationId: string): Promise<string | null> {
  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
    select: { workspaceId: true },
  });
  if (!invitation) return null;
  const membership = await prisma.membership.findUnique({
    where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId } },
    select: { workspaceId: true },
  });
  return membership?.workspaceId ?? null;
}
