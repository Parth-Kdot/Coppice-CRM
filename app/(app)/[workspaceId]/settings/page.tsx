import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { WarningIcon } from "@/components/ledger/icons";
import { InviteForm } from "@/components/ledger/invite-form";
import { YearMargin } from "@/components/ledger/marks";
import { PageHead } from "@/components/ledger/shared";
import { Stepper } from "@/components/ledger/stepper";
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
import "@/components/ledger/pages.css";
import { pageTitle } from "../page-title";

export async function generateMetadata({ params }: PageProps<"/[workspaceId]/settings">): Promise<Metadata> {
  const { workspaceId } = await params;
  return pageTitle(workspaceId, "Settings");
}

// Dates here carry the year ("Sep 3, 2025"), because a member's join date is read against the board year beside it.
const fullDay = (date: Date) =>
  date.toLocaleDateString("en-US", { timeZone: "America/Indiana/Indianapolis", month: "short", day: "numeric", year: "numeric" });

const METER_CELLS = 20;

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
      select: { id: true, userId: true, role: true, createdAt: true, user: { select: { name: true, email: isOwner } } },
      orderBy: { createdAt: "asc" },
    }),
    isOwner
      ? prisma.invitation.findMany({
          where: { workspaceId, status: "pending", expiresAt: { gt: new Date() } },
          select: { id: true, email: true, role: true, expiresAt: true },
          orderBy: { createdAt: "desc" },
        })
      : [],
    aiUsage({ userId: me.userId, workspaceId }),
  ]);

  const ids = <input type="hidden" name="workspaceId" value={workspaceId} />;
  const filled = ai.limit > 0 ? Math.min(METER_CELLS, Math.ceil((ai.used / ai.limit) * METER_CELLS)) : ai.used > 0 ? METER_CELLS : 0;
  const atLimit = ai.used >= ai.limit;

  return (
    <div className="lg-page-settings">
      <PageHead title={`${workspace.name}: settings`}>
        <Link href={`/${workspaceId}`} className="lg-btn">
          Back
        </Link>
      </PageHead>

      <div className="lg-sections">
        <section className="lg-sec" aria-labelledby="set-members">
          <div className="lg-sec-label">
            <h2 id="set-members" className="lg-sec-title">
              Members
            </h2>
            <p className="lg-sec-sub">{members.length === 1 ? "One person" : `${members.length} people`} in this workspace.</p>
          </div>
          <div className="lg-sec-body">
            <ol className="lg-register">
              {members.map((member) => {
                const role: Role = member.role === "owner" ? "owner" : "member";
                const otherRole: Role = role === "owner" ? "member" : "owner";
                const isMe = member.userId === me.userId;
                return (
                  <li key={member.id} className="lg-memberitem">
                    <div className="lg-member">
                      <YearMargin iso={member.createdAt} />
                      <div className="lg-memberbody">
                        <p className="lg-membername">
                          <strong>{member.user.name}</strong>
                          {isMe && <span className="lg-muted"> (you)</span>}
                          {member.user.email && <span className="lg-muted">, {member.user.email}</span>}
                        </p>
                        <p className="lg-membermeta">
                          {roleLabel(role)}, joined {fullDay(member.createdAt)}
                        </p>
                        {(isOwner || isMe) && (
                          <div className="lg-memberacts">
                            {isOwner && (
                              <ActionForm
                                action={changeMemberRole}
                                submitLabel={role === "owner" ? "Make Officer" : "Make Owner"}
                                successMessage={role === "owner" ? `${member.user.name} is now an Officer.` : `${member.user.name} is now an Owner.`}
                                small
                              >
                                {ids}
                                <input type="hidden" name="memberId" value={member.id} />
                                <input type="hidden" name="role" value={otherRole} />
                              </ActionForm>
                            )}
                            {isOwner && !isMe && (
                              <ActionForm
                                action={removeMember}
                                submitLabel="Remove"
                                successMessage={`${member.user.name} removed.`}
                                confirmMessage={`Remove ${member.user.name} from ${workspace.name}?`}
                                small
                              >
                                {ids}
                                <input type="hidden" name="memberId" value={member.id} />
                              </ActionForm>
                            )}
                            {isMe && (
                              <ActionForm action={leaveWorkspace} submitLabel="Leave workspace" confirmMessage={`Leave ${workspace.name}?`} small>
                                {ids}
                              </ActionForm>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            {isOwner && (
              <p className="lg-hint mt-3">To hand the workspace to someone else, make them Owner, then make yourself Officer or leave.</p>
            )}
          </div>
        </section>

        {isOwner && (
          <section className="lg-sec" aria-labelledby="set-invites">
            <div className="lg-sec-label">
              <h2 id="set-invites" className="lg-sec-title">
                Invitations
              </h2>
              <p className="lg-sec-sub">No email is sent. Tell them to sign in with this Google email and click Join.</p>
            </div>
            <div className="lg-sec-body">
              {invitations.length === 0 ? (
                <p className="lg-muted">No pending invitations.</p>
              ) : (
                <ul className="lg-invitelist">
                  {invitations.map((invite) => (
                    <li key={invite.id}>
                      <span>
                        <strong>{invite.email}</strong>: {roleLabel(invite.role === "owner" ? "owner" : "member")}, pending until {fullDay(invite.expiresAt)}
                      </span>
                      <ActionForm action={cancelInvitation} submitLabel="Cancel" successMessage="Invitation canceled." small>
                        {ids}
                        <input type="hidden" name="invitationId" value={invite.id} />
                      </ActionForm>
                    </li>
                  ))}
                </ul>
              )}
              <InviteForm workspaceId={workspaceId} action={inviteMember} />
            </div>
          </section>
        )}

        <section className="lg-sec" aria-labelledby="set-claims">
          <div className="lg-sec-label">
            <h2 id="set-claims" className="lg-sec-title">
              Claim window
            </h2>
            <p className="lg-sec-sub">How long an officer holds a company after claiming it, before anyone else can take it.</p>
          </div>
          <div className="lg-sec-body">
            {isOwner ? (
              <>
                <ActionForm action={updateClaimWindow} submitLabel="Save" successMessage="Saved." className="lg-setrow">
                  {ids}
                  <Stepper name="days" label="Claim window in days" defaultValue={workspace.claimWindowDays} min={CLAIM_WINDOW_MIN_DAYS} max={CLAIM_WINDOW_MAX_DAYS} />
                  <span>days</span>
                </ActionForm>
                <p className="lg-hint mt-2">Claims already taken keep the expiry they were given.</p>
              </>
            ) : (
              <p>Claims last {workspace.claimWindowDays} days.</p>
            )}
          </div>
        </section>

        <section className="lg-sec" aria-labelledby="set-ai">
          <div className="lg-sec-label">
            <h2 id="set-ai" className="lg-sec-title">
              AI
            </h2>
            <p className="lg-sec-sub">
              <span className="lg-aistate" data-on={ai.enabled && isConfigured()}>
                {!isConfigured() ? "Unavailable on this server" : ai.enabled ? "On for this workspace" : "Off for this workspace"}
              </span>
            </p>
          </div>
          <div className="lg-sec-body">
            <p className="max-w-[66ch]">
              Drafts pitch emails from facts your workspace has verified. AI runs on Google&apos;s free Gemini tier, which may use what
              it&apos;s sent to improve Google&apos;s products. Contact names are filled in after a draft comes back, and email addresses and
              phone numbers are masked. A name in your packet, a note or an edited draft can still reach it, so leave those out.
            </p>
            <p className="max-w-[66ch]">
              Smart import, an option on the CSV importer, sends Gemini a sheet&apos;s headers, up to 15 sample rows and its company names, and sends its
              free-text cells to Groq instead. Both can include names; email addresses and phone numbers are masked. Groq says it doesn&apos;t keep what it&apos;s sent by
              default, apart from logs it may hold for up to 30 days to look into errors or abuse.
            </p>
            {!isConfigured() && (
              <p className="lg-error">
                <WarningIcon size={16} />
                <span>AI isn&apos;t set up on this server yet: it needs a GEMINI_API_KEY.</span>
              </p>
            )}
            <div className="lg-usage">
              <p className="lg-usage-line">
                {ai.used} AI {ai.used === 1 ? "call" : "calls"} in the last {AI_WINDOW_DAYS} days, out of {ai.limit}.
              </p>
              <div className="lg-meter" data-full={atLimit || undefined} aria-hidden="true">
                {Array.from({ length: METER_CELLS }, (_, i) => (
                  <span key={i} data-on={i < filled || undefined} />
                ))}
              </div>
              {atLimit && ai.limit > 0 && <p className="lg-error">Limit reached. An owner can raise it below.</p>}
            </div>
            <p className="mt-3">
              <Link href={`/${workspaceId}/facts`} className="lg-link">
                {isOwner ? "Manage the fact sheet" : "See the fact sheet"}
              </Link>
            </p>
            {isOwner ? (
              <ActionForm action={updateAiSettings} submitLabel="Save" successMessage="Saved." className="lg-aiform">
                {ids}
                <label className="lg-switch">
                  <input name="enabled" type="checkbox" defaultChecked={ai.enabled} className="lg-check" />
                  <span>AI on for this workspace</span>
                </label>
                <div className="lg-setrow">
                  <span className="lg-label !mb-0">
                    Limit
                  </span>
                  <Stepper name="limit" label={`AI calls allowed per ${AI_WINDOW_DAYS} days`} defaultValue={ai.limit} min={0} max={AI_LIMIT_MAX} step={10} />
                  <span>calls per {AI_WINDOW_DAYS} days</span>
                </div>
              </ActionForm>
            ) : (
              <p className="mt-3">AI is {ai.enabled ? "on" : "off"} for this workspace.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
