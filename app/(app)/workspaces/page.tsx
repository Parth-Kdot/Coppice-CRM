import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { SignOutButton } from "@/components/auth-buttons";
import { Disclosure } from "@/components/ledger/disclosure";
import { LogoMark } from "@/components/ledger/logo";
import { Empty } from "@/components/ledger/shared";
import { canCreateWorkspace } from "@/lib/auth";
import { requireUser, roleLabel, type Role } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { WORKSPACE_NAME_MAX } from "@/lib/limits";
import { acceptInvitation, createWorkspace } from "./actions";
import "@/components/ledger/ledger.css";
import "@/components/ledger/auth.css";

export const metadata: Metadata = { title: "Your workspaces" };

// What a role means, in one line, for someone deciding whether to join.
const ROLE_LINE: Record<Role, string> = {
  member: "Officers claim companies and log outreach.",
  owner: "Owners also invite people and change settings.",
};

// Two letters for a workspace's thumbnail: "Riverbend Robotics Club" is "RR".
function initials(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const [first = "?", second] = words;
  const letters = second ? first.charAt(0) + second.charAt(0) : first.slice(0, 2);
  return letters.toUpperCase();
}

const asRole = (role: string): Role => (role.split(",").includes("owner") ? "owner" : "member");

export default async function WorkspacesPage() {
  const user = await requireUser();

  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    select: { role: true, workspace: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  // Only invitations addressed to this user's own verified email. Workspaces are never
  // listed or searchable, and there is no form to look up other emails.
  const invitations = user.emailVerified
    ? await prisma.invitation.findMany({
        where: { email: user.email.toLowerCase(), status: "pending", expiresAt: { gt: new Date() } },
        select: { id: true, role: true, workspace: { select: { name: true } }, user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const canCreate = canCreateWorkspace(user.email);
  // One workspace and nothing to decide: open it. (Someone who may create workspaces stays, so the
  // "New workspace" form is reachable.)
  if (memberships.length === 1 && invitations.length === 0 && !canCreate) redirect(`/${memberships[0].workspace.id}`);
  const nothingHere = memberships.length === 0 && invitations.length === 0;

  const createForm = (
    <div className="lg-createform">
      <ActionForm action={createWorkspace} submitLabel="Create" primary className="lg-createrow">
        <label className="lg-createfield">
          <span className="lg-label">Workspace name</span>
          <input name="name" required minLength={2} maxLength={WORKSPACE_NAME_MAX} placeholder="Your org's name" className="lg-input" autoComplete="off" />
        </label>
      </ActionForm>
    </div>
  );

  return (
    <div className="lg-wslist">
      <a className="lg-skip" href="#main">
        Skip to the page
      </a>
      <header className="lg-wshead">
        <Link href="/" className="lg-wslogo" aria-label="Coppice, home">
          <LogoMark size={40} />
          <span className="font-display text-[length:var(--fs-4)] font-medium tracking-[0.01em] text-ink">Coppice</span>
        </Link>
        <div className="lg-wsme">
          <p className="lg-wsme-name lg-trunc" title={user.email}>
            {user.name}
          </p>
          <SignOutButton />
        </div>
      </header>
      <div className="lg-double-rule" />

      <main id="main" tabIndex={-1} className="lg-wsmain lg-page-enter">
        <h1 className="lg-h1">{canCreate && memberships.length === 0 && invitations.length === 0 ? "Create your workspace" : "Your workspaces"}</h1>

        {memberships.length > 0 && (
          <>
            <p className="lg-sub">Pick a workspace.</p>
            <ul className="lg-wscards" aria-label="Your workspaces">
              {memberships.map(({ role, workspace }) => (
                <li key={workspace.id}>
                  <Link href={`/${workspace.id}`} className="lg-wscard">
                    <span className="lg-wsinit" aria-hidden="true">
                      {initials(workspace.name)}
                    </span>
                    <span className="lg-wscard-text">
                      <span className="lg-wscard-name">{workspace.name}</span>
                      <span className="lg-wscard-role">{roleLabel(asRole(role))}</span>
                    </span>
                    <span className="lg-wscard-open" aria-hidden="true">
                      Open
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        {invitations.length > 0 && (
          <section className="lg-wssect" aria-labelledby="ws-invites">
            <h2 id="ws-invites" className="lg-h2">
              Invitations
            </h2>
            <ul className="lg-invites">
              {invitations.map((invite) => {
                const role = asRole(invite.role ?? "member");
                return (
                  <li key={invite.id}>
                    <div className="lg-invites-text">
                      <p className="lg-wrap-any">
                        <strong>{invite.workspace.name}</strong> · invited by {invite.user.name} as {roleLabel(role)}
                      </p>
                      <p className="lg-hint">{ROLE_LINE[role]}</p>
                    </div>
                    <ActionForm action={acceptInvitation} submitLabel="Join" submitAriaLabel={`Join ${invite.workspace.name}`} primary>
                      <input type="hidden" name="invitationId" value={invite.id} />
                    </ActionForm>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {nothingHere && !canCreate && (
          <div className="lg-wsnone">
            <Empty kind="no-workspace">
              <p className="lg-empty-title">No workspace is linked to this account yet.</p>
              <p className="lg-wsnone-email">{user.email}</p>
              <p className="lg-sub mt-1">Ask your workspace owner to invite this email, or sign in with a different Google account.</p>
              <div className="mt-3">
                <SignOutButton label="Use a different account" />
              </div>
            </Empty>
          </div>
        )}

        {canCreate &&
          (nothingHere ? (
            <section className="lg-wssect lg-wsfirst" aria-label="Create a workspace">
              <p className="lg-sub">You become its Owner. Next: import your spreadsheet and invite officers.</p>
              {createForm}
            </section>
          ) : (
            <div className="lg-wssect">
              <Disclosure variant="inline" summary="+ New workspace">
                <p className="lg-sub">You become its Owner. Next: import your spreadsheet and invite officers.</p>
                {createForm}
              </Disclosure>
            </div>
          ))}
      </main>
    </div>
  );
}
