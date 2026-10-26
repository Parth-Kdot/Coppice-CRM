import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { isConfigured } from "@/lib/ai/client";
import { AI_WINDOW_DAYS, aiUsage } from "@/lib/ai/run";
import { requireMembershipOr404, roleLabel, type Role } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { AI_LIMIT_MAX, CLAIM_WINDOW_MAX_DAYS, CLAIM_WINDOW_MIN_DAYS } from "@/lib/validation";
import {
  cancelInvitation,
  changeMemberRole,
  inviteMember,
  leaveWorkspace,
  removeMember,
  updateAiSettings,
  updateClaimWindow,
} from "./actions";

export default async function SettingsPage({ params }: PageProps<"/[workspaceId]/settings">) {
  const { workspaceId } = await params;
  const me = await requireMembershipOr404(workspaceId);
  const isOwner = me.role === "owner";

  const [workspace, members, invitations, ai] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { name: true, claimWindowDays: true },
    }),
    prisma.membership.findMany({
      where: { workspaceId },
      // Emails are only loaded for owners, so they never reach an officer's browser at all.
      select: { id: true, userId: true, role: true, user: { select: { name: true, email: isOwner } } },
      orderBy: { createdAt: "asc" },
    }),
    isOwner
      ? prisma.invitation.findMany({
          where: { workspaceId, status: "pending", expiresAt: { gt: new Date() } },
          select: { id: true, email: true, role: true },
          orderBy: { createdAt: "desc" },
        })
      : [],
    aiUsage({ userId: me.userId, workspaceId }),
  ]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{workspace.name}: settings</h1>
        <Link href={`/${workspaceId}`} className="rounded border px-3 py-1">
          Back
        </Link>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Members</h2>
        <ul className="flex flex-col gap-3">
          {members.map((member) => {
            const role: Role = member.role === "owner" ? "owner" : "member";
            const otherRole: Role = role === "owner" ? "member" : "owner";
            const isMe = member.userId === me.userId;
            return (
              <li key={member.id} className="flex flex-wrap items-center gap-3">
                <span>
                  {member.user.name}
                  {member.user.email && ` (${member.user.email})`}: {roleLabel(role)}
                  {isMe && " (you)"}
                </span>
                {isOwner && (
                  <ActionForm action={changeMemberRole} submitLabel={role === "owner" ? "Make Officer" : "Make Owner"}>
                    <input type="hidden" name="workspaceId" value={workspaceId} />
                    <input type="hidden" name="memberId" value={member.id} />
                    <input type="hidden" name="role" value={otherRole} />
                  </ActionForm>
                )}
                {isOwner && !isMe && (
                  <ActionForm
                    action={removeMember}
                    submitLabel="Remove"
                    confirmMessage={`Remove ${member.user.name} from ${workspace.name}?`}
                  >
                    <input type="hidden" name="workspaceId" value={workspaceId} />
                    <input type="hidden" name="memberId" value={member.id} />
                  </ActionForm>
                )}
                {isMe && (
                  <ActionForm action={leaveWorkspace} submitLabel="Leave workspace" confirmMessage={`Leave ${workspace.name}?`}>
                    <input type="hidden" name="workspaceId" value={workspaceId} />
                  </ActionForm>
                )}
              </li>
            );
          })}
        </ul>
        {isOwner && (
          <p className="text-sm text-zinc-500">
            To hand the workspace to someone else, make them Owner, then make yourself Officer or leave.
          </p>
        )}
      </section>

      {isOwner && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Invitations</h2>
          <p className="text-sm text-zinc-500">
            No email is sent. Tell them to sign in with this Google email and click Join.
          </p>
          <ActionForm action={inviteMember} submitLabel="Invite" successMessage="Invitation created.">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input name="email" type="email" required placeholder="name@purdue.edu" aria-label="Email" className="rounded border px-2 py-1" />
            <select name="role" defaultValue="member" aria-label="Role" className="rounded border px-2 py-1">
              <option value="member">Officer</option>
              <option value="owner">Owner</option>
            </select>
          </ActionForm>
          <ul className="flex flex-col gap-2 text-sm">
            {invitations.map((invite) => (
              <li key={invite.id} className="flex items-center gap-3">
                <span>
                  {invite.email}: {roleLabel(invite.role === "owner" ? "owner" : "member")}, pending
                </span>
                <ActionForm action={cancelInvitation} submitLabel="Cancel">
                  <input type="hidden" name="workspaceId" value={workspaceId} />
                  <input type="hidden" name="invitationId" value={invite.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Claim window</h2>
        <p className="text-sm text-zinc-500">
          How long an officer holds a company after claiming it, before anyone else can take it.
        </p>
        {isOwner ? (
          <ActionForm action={updateClaimWindow} submitLabel="Save" successMessage="Saved.">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input
              name="days"
              type="number"
              required
              min={CLAIM_WINDOW_MIN_DAYS}
              max={CLAIM_WINDOW_MAX_DAYS}
              defaultValue={workspace.claimWindowDays}
              aria-label="Claim window in days"
              className="w-20 rounded border px-2 py-1"
            />
            <span>days</span>
          </ActionForm>
        ) : (
          <p>Claims last {workspace.claimWindowDays} days.</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">AI</h2>
        <p className="text-sm text-zinc-500">
          Drafts pitch emails from facts your workspace has verified. AI runs on Google&apos;s free Gemini tier, which may use what
          it&apos;s sent to improve Google&apos;s products, so names and email addresses are never sent to it.
        </p>
        {!isConfigured() && <p className="text-sm text-amber-700">AI isn&apos;t set up on this server yet: it needs a GEMINI_API_KEY.</p>}
        <p className="text-sm">
          {ai.used} AI {ai.used === 1 ? "call" : "calls"} in the last {AI_WINDOW_DAYS} days, out of {ai.limit}.
        </p>
        {isOwner ? (
          <ActionForm action={updateAiSettings} submitLabel="Save" successMessage="Saved.">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <label className="flex items-center gap-2">
              <input name="enabled" type="checkbox" defaultChecked={ai.enabled} />
              <span>AI on for this workspace</span>
            </label>
            <label className="flex items-center gap-2">
              <span>Limit</span>
              <input
                name="limit"
                type="number"
                required
                min={0}
                max={AI_LIMIT_MAX}
                defaultValue={ai.limit}
                aria-label={`AI calls allowed per ${AI_WINDOW_DAYS} days`}
                className="w-24 rounded border px-2 py-1"
              />
              <span>calls per {AI_WINDOW_DAYS} days</span>
            </label>
          </ActionForm>
        ) : (
          <p>AI is {ai.enabled ? "on" : "off"} for this workspace.</p>
        )}
      </section>
    </main>
  );
}
