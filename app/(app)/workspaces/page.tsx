import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { SignOutButton } from "@/components/auth-buttons";
import { boardYear } from "@/components/ledger/board-year";
import { LogoMark } from "@/components/ledger/logo";
import { Empty } from "@/components/ledger/shared";
import { canCreateWorkspace } from "@/lib/auth";
import { requireUser, roleLabel, type Role } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { acceptInvitation, createWorkspace } from "./actions";
import "@/components/ledger/ledger.css";
import "@/components/ledger/auth.css";

export const metadata: Metadata = { title: "Your workspaces" };

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
        select: { id: true, role: true, workspace: { select: { name: true } } },
      })
    : [];

  const canCreate = canCreateWorkspace(user.email);
  const nothingHere = memberships.length === 0 && invitations.length === 0;
  const volume = boardYear(new Date()).long;

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
          <p className="lg-wsme-name">{user.name}</p>
          <SignOutButton />
        </div>
      </header>
      <div className="lg-double-rule" />

      <main id="main" tabIndex={-1} className="lg-wsmain lg-page-enter">
        <h1 className="lg-h1">Your workspaces</h1>

        {memberships.length > 0 && (
          <>
            <p className="lg-sub">Open a volume to see its queue.</p>
            <ul className="lg-shelf" aria-label="Your workspaces">
              {memberships.map(({ role, workspace }, i) => (
                <li key={workspace.id} className="lg-volume" data-tone={i % 3}>
                  <Link href={`/${workspace.id}`} className="lg-vspine" aria-label={`${workspace.name}, ${roleLabel(role as Role)}`}>
                    <span className="lg-vband" aria-hidden="true" />
                    <span className="lg-vtitle">{workspace.name}</span>
                    <span className="lg-vband" aria-hidden="true" />
                    <span className="lg-vyear" aria-hidden="true">
                      {volume}
                    </span>
                  </Link>
                  <p className="lg-vcap">
                    <span className="lg-vname">{workspace.name}</span> ({roleLabel(role as Role)})
                  </p>
                </li>
              ))}
            </ul>
            <div className="lg-shelfedge" aria-hidden="true" />
          </>
        )}

        {invitations.length > 0 && (
          <section className="lg-wssect" aria-labelledby="ws-invites">
            <h2 id="ws-invites" className="lg-h2">
              Invitations
            </h2>
            <ul className="lg-invites">
              {invitations.map((invite) => (
                <li key={invite.id}>
                  <p>
                    <strong>{invite.workspace.name}</strong> as {roleLabel(invite.role === "owner" ? "owner" : "member")}
                  </p>
                  <ActionForm action={acceptInvitation} submitLabel="Join" primary>
                    <input type="hidden" name="invitationId" value={invite.id} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          </section>
        )}

        {nothingHere && !canCreate && (
          <Empty kind="no-workspace">
            <p className="font-display text-[length:var(--fs-4)] font-medium leading-snug">
              No workspace is linked to <strong>{user.email}</strong>.
            </p>
            <p className="lg-sub mt-1">Ask your sponsorship chair to invite this email, or sign in with a different Google account.</p>
            <div className="mt-3">
              <SignOutButton label="Use a different account" />
            </div>
          </Empty>
        )}

        {canCreate && (
          <section className="lg-wssect" aria-labelledby="ws-create">
            <h2 id="ws-create" className="lg-h2">
              Create a workspace
            </h2>
            <p className="lg-sub mt-1">You become its Owner. Invite your officers from Settings afterwards.</p>
            <div className="lg-createform">
              <ActionForm action={createWorkspace} submitLabel="Create" primary className="flex flex-wrap items-end gap-2">
                <label className="block flex-1">
                  <span className="lg-label">Workspace name</span>
                  <input name="name" required placeholder="Your org's name" className="lg-input" autoComplete="off" />
                </label>
              </ActionForm>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
